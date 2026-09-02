/**
 * Manual SQL migration runner — executes scripts/manual-migration.sql against
 * DATABASE_URL without psql (Windows hosts often lack a psql client).
 *
 *   npm run db:migrate:manual            # uses .env DATABASE_URL
 *   DATABASE_URL=... npm run db:migrate:manual
 *
 * The SQL file is idempotent, so re-running is safe. It does NOT touch the
 * pgboss schema (pg-boss creates it on app boot) or seed data (the app seeds
 * itself on first start) — see the script header for details.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = join(here, 'manual-migration.sql');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
if (!connectionString) {
  console.error('[db:migrate:manual] DATABASE_URL (or POSTGRES_URL) is not set.');
  process.exit(1);
}

const sqlText = readFileSync(SQL_PATH, 'utf8');
const client = new pg.Client({ connectionString });

try {
  await client.connect();
  console.log('[db:migrate:manual] Connected. Executing scripts/manual-migration.sql ...');
  await client.query(sqlText);

  // Verification: count the app tables the script owns.
  const expected = [
    'documents',
    'chunks',
    'sources',
    'sync_logs',
    'collections',
    'mcp_servers',
    'audit_logs',
    'tool_calls',
    'conversations',
    'messages',
    'users',
    'tenants',
    'sessions',
    'api_keys',
    'provider_credentials',
    'webhook_endpoints',
    'memberships',
    'invitations',
    'teams',
    'team_members',
    'resource_shares',
    'sso_flows',
    'rate_limit_windows',
    'usage_counters',
    'schema_meta',
  ];
  const res = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [expected],
  );
  const found = res.rows.map((r) => r.table_name);
  const missing = expected.filter((t) => !found.includes(t));
  console.log(`[db:migrate:manual] Done. ${found.length}/25 tables present.`);
  if (missing.length > 0) {
    console.error('[db:migrate:manual] MISSING TABLES:', missing.join(', '));
    process.exitCode = 1;
  } else {
    console.log('[db:migrate:manual] ✅ Schema complete.');
  }
} catch (err) {
  console.error('[db:migrate:manual] Failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
