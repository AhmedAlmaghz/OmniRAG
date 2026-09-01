import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression guard for the cross-tenant lexical-search leak (Phase 2).
 *
 * Before the fix, searchPostgresLexical emitted FTS/ILIKE queries with no
 * `tenant_id` predicate (RLS is disabled), so the lexical arm of the hybrid
 * search could return chunks from any tenant. We mock `pg` at the module
 * level (hoisted) and assert that BOTH the primary FTS query and the ILIKE
 * fallback bind the server-derived tenant_id as a parameter and contain a
 * `tenant_id = $N` predicate. No live Postgres is required.
 */

type QueryCall = { text: string; params: any[] };

// Hoisted state shared with the mock `pg` factory. vi.hoisted runs before any
// import, so the factory (which must be self-contained) can read it.
const pgMock = vi.hoisted(() => ({
  queries: [] as QueryCall[],
  throwOn: null as RegExp | null,
  client: {
    query: async (text: string, params?: any[]) => {
      pgMock.queries.push({ text, params: params ?? [] });
      if (pgMock.throwOn && pgMock.throwOn.test(text)) {
        throw new Error('simulated fts failure');
      }
      // COUNT(...) → seedPostgresData reads rows[0].count.
      if (/SELECT\s+COUNT\(/i.test(text)) {
        return { rows: [{ count: '0' }] };
      }
      return { rows: [] };
    },
    release: () => {},
  },
}));

// Replace `pg` for this file's entire module graph. Only ts_rank queries are
// forced to throw (ensurePostgresTables uses to_tsvector for the GIN index,
// never ts_rank, so seeding completes normally).
vi.mock('pg', () => {
  class Pool {
    connect = () => Promise.resolve(pgMock.client);
    end = () => Promise.resolve();
    on = () => {};
  }
  return { default: { Pool }, Pool };
});

describe('searchPostgresLexical tenant isolation (regression)', () => {
  beforeEach(() => {
    pgMock.queries.length = 0;
    pgMock.throwOn = null;
    // Re-initialise the postgres singleton for each test so ensurePostgresTables
    // runs against the fresh mock and `queries` only reflects THIS test's calls.
    vi.resetModules();
  });

  it('binds tenant_id as a parameter on the primary FTS path', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/omnirag_test?sslmode=disable';
    process.env.PG_TLS_REJECT_UNAUTHORIZED = 'false';

    const { searchPostgresLexical } = await import('../lib/storage/postgres');
    const tenantId = 'tenant-acme-01';
    await searchPostgresLexical('data security', tenantId, 10);

    const ftsQuery = pgMock.queries.find((q) => /ts_rank/.test(q.text) && !/ILIKE/.test(q.text));
    expect(ftsQuery, 'FTS SELECT must have been issued').toBeDefined();
    expect(ftsQuery!.text).toContain('tenant_id = $1');
    expect(ftsQuery!.params).toContain(tenantId);

    // BINDING contract (the v0.12.2 regression this pins): param ORDER must
    // match the placeholders' MEANING — [$1 tenant, $2 ftsQuery, $3 dict,
    // $4 limit]. The broken version bound tenant_id to the $3 slot (the
    // dict), returning zero rows on every lexical search while the SQL TEXT
    // still looked correct.
    expect(ftsQuery!.params[0]).toBe(tenantId);
    expect(ftsQuery!.params[1]).toBe('data:* | security:*');
    expect(['arabic', 'english']).toContain(ftsQuery!.params[2]);
    expect(ftsQuery!.params[3]).toBe(10);
  });

  it('binds tenant_id on the ILIKE fallback when FTS throws', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/omnirag_test?sslmode=disable';
    process.env.PG_TLS_REJECT_UNAUTHORIZED = 'false';
    pgMock.throwOn = /ts_rank/;

    const { searchPostgresLexical } = await import('../lib/storage/postgres');
    const tenantId = 'tenant-health-02';
    await searchPostgresLexical('بيانات', tenantId, 5);

    const ilikeQuery = pgMock.queries.find((q) => /ILIKE/.test(q.text));
    expect(ilikeQuery, 'ILIKE fallback must have been issued').toBeDefined();
    expect(ilikeQuery!.text).toContain('tenant_id = $3');
    expect(ilikeQuery!.params).toContain(tenantId);
    expect(ilikeQuery!.text).toMatch(/LIMIT \$4/);
    // Binding: $3 = tenant (index 2 of params), $4 = limit (index 3).
    expect(ilikeQuery!.params[2]).toBe(tenantId);
    expect(ilikeQuery!.params[3]).toBe(5);
  });

  it('binds collection scope on $5 without touching the $1-$4 binding contract', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/omnirag_test?sslmode=disable';
    process.env.PG_TLS_REJECT_UNAUTHORIZED = 'false';

    const { searchPostgresLexical } = await import('../lib/storage/postgres');
    const tenantId = 'tenant-acme-01';
    const collections = ['col-1', 'col-2'];
    await searchPostgresLexical('data security', tenantId, 10, collections);

    const ftsQuery = pgMock.queries.find((q) => /ts_rank/.test(q.text) && !/ILIKE/.test(q.text));
    expect(ftsQuery, 'FTS SELECT must have been issued').toBeDefined();
    // Scope subquery binds the tenant at $1 (NOT the dict slot $3) — the exact
    // second binding bug the v0.12.4 fix repaired. Whitespace/newline-tolerant:
    // the scoped predicate is `tenant_id = $1` followed by the collFilter
    // subquery block, then the tsvector match on the NEXT line.
    expect(ftsQuery!.text).toMatch(/WHERE tenant_id = \$1 AND document_id IN \(/);
    expect(ftsQuery!.text).toMatch(/AND to_tsvector\(\$3, content\) @@ to_tsquery\(\$3, \$2\)/);
    expect(ftsQuery!.params[0]).toBe(tenantId);
    expect(ftsQuery!.params[4]).toEqual(collections);
  });

  it('returns [] and issues no lexical query when tenantId is empty', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/omnirag_test?sslmode=disable';
    process.env.PG_TLS_REJECT_UNAUTHORIZED = 'false';

    const { searchPostgresLexical } = await import('../lib/storage/postgres');
    const result = await searchPostgresLexical('anything', '', 10);
    expect(result).toEqual([]);
    expect(pgMock.queries.some((q) => /ts_rank|ILIKE/.test(q.text))).toBe(false);
  });
});
