import pg from 'pg';

/**
 * RLS verification probe (v0.12.9) — proves the tenant-isolation policies on
 * `documents`/`chunks` actually behave under a NON-OWNER role:
 *
 *   1. fail-closed   — no `app.current_tenant` set → zero rows visible
 *   2. scoping       — var = tenant A → A's row visible, B's row not
 *   3. write guard   — INSERT with a foreign tenant_id while scoped to A → rejected
 *
 * The app normally connects as the table OWNER (owner bypasses RLS unless
 * FORCE is used) — that is the documented staging posture: zero behavior
 * change today, policies activate the moment a non-owner app role is used.
 * Run the probe against any environment to prove that activation contract:
 *
 *   npm run db:verify-rls
 *
 * Requires DATABASE_URL (or POSTGRES_URL) with CREATE ROLE privilege (the
 * owner/superuser the app normally uses). The probe is self-cleaning: it
 * removes its rows and role on success AND failure.
 */

const PROBE_ROLE = 'omnirag_rls_probe';
const TENANT_A = 'rls-probe-tenant-a';
const TENANT_B = 'rls-probe-tenant-b';
const DOC_PREFIX = 'rls-probe-doc-';

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const { Pool } = pg;

function buildPool(): pg.Pool | null {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    console.error('DATABASE_URL / POSTGRES_URL مطلوب لتشغيل فحص RLS.');
    return null;
  }
  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  const sslMode = new URL(connectionString).searchParams.get('sslmode');
  return new Pool({
    connectionString,
    ssl: isLocal ? false : sslMode === 'disable' ? false : { rejectUnauthorized: false },
    max: 1,
  });
}

async function seedProbeRows(pool: pg.Pool): Promise<void> {
  const rows: Array<[string, string]> = [
    [`${DOC_PREFIX}a`, TENANT_A],
    [`${DOC_PREFIX}b`, TENANT_B],
  ];
  for (const [id, tenantId] of rows) {
    await pool.query(
      `INSERT INTO documents (id, tenant_id, title, content, language, status, created_at)
       VALUES ($1, $2, 'RLS probe', 'temporary probe row — safe to delete', 'ar', 'indexed', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
       ON CONFLICT (id) DO NOTHING`,
      [id, tenantId],
    );
  }
  // One probe API key owned by tenant B — the definer-lookup proof below must
  // find it across the RLS boundary while a scoped read must not.
  await pool.query(
    `INSERT INTO api_keys (id, tenant_id, user_id, name, prefix, key_hash, created_at)
     VALUES ('rls-probe-key', $1, 'rls-probe-user', 'RLS probe key', 'omnirag_live_probe', 'rls-probe-key-hash', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_B],
  );
}

async function cleanup(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(`DELETE FROM documents WHERE id LIKE '${DOC_PREFIX}%'`);
    await pool.query(`DELETE FROM api_keys WHERE id = 'rls-probe-key'`);
    // Revoke EVERYTHING the probe role may hold — DROP ROLE refuses while
    // any grant dependency exists.
    await pool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${PROBE_ROLE}`);
    await pool.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${PROBE_ROLE}`);
    await pool.query(`REVOKE ALL ON SCHEMA public FROM ${PROBE_ROLE}`);
    await pool.query(`DROP ROLE IF EXISTS ${PROBE_ROLE}`);
  } catch (e) {
    console.warn('[verify-rls] cleanup warning (probe artifacts may remain):', (e as Error).message);
  }
}

async function runProbe(pool: pg.Pool): Promise<Check[]> {
  const checks: Check[] = [];

  // Preflight: are the policies even installed? (app must have booted once, or
  // scripts/manual-migration.sql run — both install them idempotently)
  const policies = await pool.query(
    `SELECT count(*)::int AS n FROM pg_policies WHERE policyname = 'tenant_isolation_documents'`,
  );
  const enabled = await pool.query(
    `SELECT relrowsecurity::int AS n FROM pg_class WHERE relname = 'documents'`,
  );
  const policyCount = policies.rows[0].n as number;
  const rlsEnabled = enabled.rows[0].n as number;
  checks.push({
    name: 'policies installed on documents (tenant_isolation_documents)',
    pass: policyCount === 1,
    detail: `policyCount=${policyCount}`,
  });
  checks.push({
    name: 'ROW LEVEL SECURITY enabled on documents',
    pass: rlsEnabled === 1,
    detail: `relrowsecurity=${rlsEnabled}`,
  });
  if (policyCount !== 1 || rlsEnabled !== 1) {
    checks.push({
      name: 'SKIPPED (fix the above first: boot the app once or run npm run db:migrate:manual)',
      pass: false,
      detail: 'policies missing — probe assertions would be meaningless',
    });
    return checks;
  }

  // Non-owner probe role, scoped to the documents + api_keys tables.
  await pool.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
         CREATE ROLE ${PROBE_ROLE} NOLOGIN;
       END IF;
     END $$`,
  );
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`);
  await pool.query(`GRANT SELECT, INSERT, DELETE ON documents TO ${PROBE_ROLE}`);
  await pool.query(`GRANT SELECT ON api_keys TO ${PROBE_ROLE}`);
  await pool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${PROBE_ROLE}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL ROLE: the privilege change evaporates with the transaction —
    // the pooled owner connection is never left as the probe role.
    await client.query(`SET LOCAL ROLE ${PROBE_ROLE}`);

    // 1. fail-closed: no tenant var set → zero rows
    const none = await client.query(`SELECT count(*)::int AS n FROM documents WHERE id LIKE '${DOC_PREFIX}%'`);
    checks.push({
      name: 'fail-closed: probe role with NO app.current_tenant sees 0 rows',
      pass: none.rows[0].n === 0,
      detail: `visible=${none.rows[0].n} (expected 0)`,
    });

    // 2. scoped read: var = tenant A → exactly A's row
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [TENANT_A]);
    const scoped = await client.query(`SELECT count(*)::int AS n FROM documents WHERE id LIKE '${DOC_PREFIX}%'`);
    checks.push({
      name: 'scoped read: app.current_tenant=A sees exactly the A row',
      pass: scoped.rows[0].n === 1,
      detail: `visible=${scoped.rows[0].n} (expected 1)`,
    });

    // 3. cross-tenant write rejected by WITH CHECK
    // SAVEPOINT: the expected rejection aborts the transaction — roll back to
    // the savepoint so the remaining checks can still run inside it.
    await client.query('SAVEPOINT write_guard');
    let writeRejected = false;
    try {
      await client.query(
        `INSERT INTO documents (id, tenant_id, title, content, language, status, created_at)
         VALUES ('rls-probe-doc-violation', $1, 'x', 'x', 'ar', 'indexed', '2026-01-01T00:00:00.000Z')`,
        [TENANT_B],
      );
    } catch {
      writeRejected = true;
    }
    await client.query('ROLLBACK TO SAVEPOINT write_guard');
    checks.push({
      name: 'write guard: INSERT with foreign tenant_id is rejected',
      pass: writeRejected,
      detail: writeRejected ? 'rejected by WITH CHECK ✓' : 'INSERT SUCCEEDED — WITH CHECK not enforcing!',
    });

    // 4. SECURITY DEFINER escape: bearer-key auth crosses the RLS boundary
    //    (the hash IS the credential) while a direct scoped read of the same
    //    table stays fail-closed.
    const direct = await client.query(`SELECT count(*)::int AS n FROM api_keys WHERE id = 'rls-probe-key'`);
    checks.push({
      name: 'api_keys direct read hidden by RLS (tenant A cannot see B key)',
      pass: direct.rows[0].n === 0,
      detail: `visible=${direct.rows[0].n} (expected 0)`,
    });
    const viaDefiner = await client.query(`SELECT count(*)::int AS n FROM omnirag_get_api_key_by_hash($1)`, [
      'rls-probe-key-hash',
    ]);
    checks.push({
      name: 'definer lookup finds the key across the RLS boundary',
      pass: viaDefiner.rows[0].n === 1,
      detail: `found=${viaDefiner.rows[0].n} (expected 1)`,
    });

    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  return checks;
}

async function main() {
  const pool = buildPool();
  if (!pool) process.exit(2);

  let checks: Check[] = [];
  try {
    await seedProbeRows(pool);
    checks = await runProbe(pool);
  } catch (err) {
    console.error('[verify-rls] probe crashed:', err);
    checks.push({ name: 'probe executed', pass: false, detail: (err as Error).message });
  } finally {
    await cleanup(pool);
    await pool.end();
  }

  console.log('\n── RLS probe results ──────────────────────────────');
  for (const c of checks) {
    console.log(`${c.pass ? '✅ PASS' : '❌ FAIL'}  ${c.name}  (${c.detail})`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  console.log('───────────────────────────────────────────────────');
  console.log(failed === 0 ? '✅ RLS contract verified.' : `❌ ${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
