import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * Tenant-predicate coverage net (v0.12.8) — the app-layer replacement for the
 * intentionally-disabled Postgres RLS.
 *
 * Context: `ensurePostgresTables` in postgres.ts explicitly runs
 * `ALTER TABLE … DISABLE ROW LEVEL SECURITY` and drops legacy policies, because
 * tenant isolation is enforced at the APPLICATION layer: every SQL statement that
 * touches a tenant-scoped table must carry an explicit `tenant_id = $N` predicate
 * bound to a server-derived tenant id (see docs/06-security/overview.md →
 * "وضع Row Level Security: معطّل عن عمد", and docs/audit/2026-08-29-audit-report.md
 * item 4). A single missing predicate = cross-tenant leak — the exact class of bug
 * that shipped in v0.12.2 (fixed and pinned by lexicalTenantIsolation.test.ts).
 *
 * This file is the missing safety net, in two layers:
 *
 * 1. STATIC SCAN — reads the postgres.ts source at test time, extracts every SQL
 *    statement (template literals + quoted strings) and fails if any statement
 *    referencing a tenant-scoped table lacks the predicate, unless it is in the
 *    hand-verified allowlist below (DDL, seed probes, and the two cross-tenant
 *    by-design queries). It also fails on interpolated tenant predicates
 *    (`tenant_id = '…'` / `tenant_id = ${…}`) which would defeat parameter
 *    binding.
 *
 * 2. RUNTIME BINDING (hoisted pg mock, same pattern as lexicalTenantIsolation)
 *    — proves the document read paths and the chunk write path not only *contain*
 *    the predicate but actually BIND the caller's tenant id in the correct
 *    parameter slot, and prime `app.current_tenant` for the future RLS pass.
 */

// ────────────────────────────── Part 1: static scan ──────────────────────────────

const POSTGRES_SOURCE = readFileSync(join(__dirname, '../lib/storage/postgres.ts'), 'utf8');

/** Tables that carry a tenant_id column (from src/db/schema.ts). */
const TENANT_SCOPED_TABLES = [
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
  'api_keys',
  'provider_credentials',
  'memberships',
  'invitations',
  'teams',
  'resource_shares',
  'sso_flows',
  'webhook_endpoints',
  'usage_counters',
] as const;

/** Hand-verified exceptions. Every entry needs a reason a reviewer can audit. */
const ALLOWLIST: Array<{ match: string; reason: string }> = [
  {
    match: 'SELECT COUNT(*) FROM',
    reason: 'Seed emptiness probe in seedPostgresData — count-only on a fresh database, returns no rows.',
  },
  // v0.12.10: the three former cross-tenant-by-design raw statements
  // (api_keys by hash, last-used stamp, scheduled sources) now route through
  // owner-owned SECURITY DEFINER functions (omnirag_get_api_key_by_hash,
  // omnirag_touch_api_key_last_used, omnirag_list_scheduled_sources) created
  // by the migrator — they no longer reference tenant tables directly, so no
  // allowlist entry is needed for them here.
];

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Extract candidate SQL statements from string literals using the TypeScript
 * compiler parser — NOT regex. A regex over raw source mispairs quotes (an
 * apostrophe in a comment, a quote inside a regex literal) and can silently
 * swallow real SQL — a false-negative in a security net is unacceptable. The
 * parser resolves escapes, nested template literals and comments exactly as
 * the compiler does. Template-expression interpolations are replaced with a
 * `${…}` marker so `tenant_id = $${values.length}` remains inspectable while
 * JS values are not leaked into the "SQL".
 */
function extractSqlStatements(rawSource: string): string[] {
  const sourceFile = ts.createSourceFile('postgres.ts', rawSource, ts.ScriptTarget.ES2022, /*setParentNodes*/ false);
  const statements: string[] = [];
  const push = (text: string) => {
    const t = normalize(text);
    // Only real statements: must START with a SQL verb — filters non-SQL strings.
    if (!/^(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i.test(t)) return;
    statements.push(t);
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        text += '${…}' + span.literal.text;
      }
      push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return statements;
}

/** Tables a statement reads from or writes to. */
function referencedTables(stmt: string): string[] {
  const tables = new Set<string>();
  for (const m of stmt.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/gi)) {
    tables.add(m[1].toLowerCase());
  }
  return [...tables];
}

const isDdl = (stmt: string) => /^(CREATE|DROP|ALTER)\b/i.test(stmt);

describe('tenant predicate coverage (static scan of postgres.ts)', () => {
  it('has an allowlist that matches actual SQL (no stale entries)', () => {
    for (const entry of ALLOWLIST) {
      expect(
        extractSqlStatements(POSTGRES_SOURCE).some((stmt) => stmt.includes(entry.match)),
        `allowlist entry no longer matches any SQL: "${entry.match}" — remove or update it`,
      ).toBe(true);
    }
  });

  it('every statement touching a tenant-scoped table carries an explicit tenant predicate', () => {
    const violations: string[] = [];

    for (const stmt of extractSqlStatements(POSTGRES_SOURCE)) {
      if (isDdl(stmt)) continue; // schema bootstrap statements manage no tenant data
      const tenantTables = referencedTables(stmt).filter((t) =>
        (TENANT_SCOPED_TABLES as readonly string[]).includes(t),
      );
      if (tenantTables.length === 0) continue; // global tables (users/tenants/sessions/…) only

      const allowlisted = ALLOWLIST.find((entry) => stmt.includes(entry.match));
      if (allowlisted) continue;

      // Explicit predicate: static slot ($1, $2…) OR a computed slot from the
      // dynamic UPDATE builder (`tenant_id = $${values.length}` still binds a
      // runtime parameter — it is NOT string interpolation of the tenant id).
      // `\$+` absorbs the literal `$$` prefix of computed placeholders.
      const hasPredicate = /tenant_id\s*=\s*\$+[\d{]/i.test(stmt);
      // INSERT statements satisfy the contract by populating the tenant_id column.
      const isTenantInsert = /\bINSERT INTO\b/i.test(stmt) && /tenant_id/i.test(stmt);

      if (!hasPredicate && !isTenantInsert) {
        violations.push(`[${tenantTables.join(', ')}] ${stmt.slice(0, 220)}`);
      }
    }

    expect(
      violations,
      `SQL statements touching tenant-scoped tables WITHOUT a tenant_id predicate.\n` +
        `Either add \`tenant_id = $N\` bound to the server-derived tenant, or justify ` +
        `an entry in ALLOWLIST (with a reason a security reviewer can audit):\n` +
        violations.map((v) => `  • ${v}`).join('\n'),
    ).toEqual([]);
  });

  it('never interpolates a tenant predicate (parameter binding only)', () => {
    const interpolated = extractSqlStatements(POSTGRES_SOURCE).filter((stmt) =>
      /tenant_id\s*=\s*('[^']*'|\$\{)/i.test(stmt),
    );
    expect(
      interpolated,
      'tenant predicates must be bound as $N parameters (server-derived tenant), never ' +
        `string-interpolated:\n${interpolated.map((s) => `  • ${s.slice(0, 200)}`).join('\n')}`,
    ).toEqual([]);
  });
});

// ────────────────────────────── Part 2: runtime binding ──────────────────────────────

type QueryCall = { text: string; params: any[] };

const pgMock = vi.hoisted(() => ({
  queries: [] as QueryCall[],
  client: {
    query: async (text: string, params?: any[]) => {
      pgMock.queries.push({ text, params: params ?? [] });
      // COUNT(*) → seedPostgresData reads rows[0].count; everything else is rowless.
      if (/SELECT\s+COUNT\(/i.test(text)) return { rows: [{ count: '0' }] };
      return { rows: [] };
    },
    release: () => {},
  },
}));

vi.mock('pg', () => {
  class Pool {
    connect = () => Promise.resolve(pgMock.client);
    end = () => Promise.resolve();
    on = () => {};
  }
  return { default: { Pool }, Pool };
});

describe('tenant binding at runtime (document read + chunk write paths)', () => {
  beforeEach(() => {
    pgMock.queries.length = 0;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/omnirag_test?sslmode=disable';
    process.env.PG_TLS_REJECT_UNAUTHORIZED = 'false';
    vi.resetModules();
  });

  it('getPostgresDocuments binds tenant in slot 1 and primes app.current_tenant', async () => {
    const { getPostgresDocuments } = await import('../lib/storage/postgres');
    await getPostgresDocuments('tenant-acme-01');

    const sessionVar = pgMock.queries.find((q) => q.text.includes('set_config'));
    expect(sessionVar, 'app.current_tenant must be primed for the future RLS pass').toBeDefined();
    expect(sessionVar!.params[0]).toBe('tenant-acme-01');

    const select = pgMock.queries.find((q) => /FROM documents/i.test(q.text) && /WHERE/i.test(q.text));
    expect(select, 'documents SELECT must have been issued').toBeDefined();
    expect(select!.text).toContain('tenant_id = $1');
    expect(select!.params[0]).toBe('tenant-acme-01');
  });

  it('getPostgresDocumentById binds tenant in slot 2 (id + tenant composite guard)', async () => {
    const { getPostgresDocumentById } = await import('../lib/storage/postgres');
    await getPostgresDocumentById('doc-001', 'tenant-acme-01');

    const select = pgMock.queries.find((q) => /FROM documents/i.test(q.text) && /WHERE/i.test(q.text));
    expect(select, 'document-by-id SELECT must have been issued').toBeDefined();
    expect(select!.text).toContain('tenant_id = $2');
    expect(select!.params[0]).toBe('doc-001');
    expect(select!.params[1]).toBe('tenant-acme-01');
  });

  it('insertPostgresChunk populates tenant_id inside the transaction', async () => {
    const { insertPostgresChunk } = await import('../lib/storage/postgres');
    await insertPostgresChunk({
      id: 'chunk-test-1',
      tenantId: 'tenant-acme-01',
      documentId: 'doc-test-1',
      content: 'نص اختبار',
      chunkIndex: 0,
      pageNumber: 1,
      language: 'ar',
    });

    const insert = pgMock.queries.find((q) => /INSERT INTO chunks/i.test(q.text));
    expect(insert, 'chunks INSERT must have been issued').toBeDefined();
    expect(insert!.text).toContain('tenant_id');
    expect(insert!.params[1]).toBe('tenant-acme-01');

    // The insert must run inside a transaction that also primed app.current_tenant.
    // Scope relative to OUR insert (the LAST `INSERT INTO chunks` in the capture —
    // earlier ones belong to ensurePostgresTables seeding noise).
    const texts = pgMock.queries.map((q) => q.text);
    let insertIdx = -1;
    for (let i = 0; i < texts.length; i++) {
      if (/INSERT INTO chunks/i.test(texts[i])) insertIdx = i;
    }
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    const beginIdx = texts.lastIndexOf('BEGIN', insertIdx);
    let sessionIdx = -1;
    for (let i = insertIdx - 1; i >= 0; i--) {
      if (texts[i].includes('set_config')) {
        sessionIdx = i;
        break;
      }
    }
    const commitIdx = texts.findIndex((t, i) => i > insertIdx && t === 'COMMIT');
    expect(beginIdx, 'BEGIN before the insert').toBeGreaterThanOrEqual(0);
    expect(sessionIdx, 'app.current_tenant primed inside the transaction').toBeGreaterThan(beginIdx);
    expect(commitIdx, 'COMMIT after the insert').toBeGreaterThan(insertIdx);
  });

  it('deletePostgresDocument guards the delete with the tenant predicate', async () => {
    const { deletePostgresDocument } = await import('../lib/storage/postgres');
    await deletePostgresDocument('doc-001', 'tenant-acme-01');

    const del = pgMock.queries.find((q) => /DELETE FROM documents/i.test(q.text));
    expect(del, 'documents DELETE must have been issued').toBeDefined();
    expect(del!.text).toContain('tenant_id = $2');
    expect(del!.params).toContain('tenant-acme-01');
  });
});
