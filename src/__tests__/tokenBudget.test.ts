import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Monthly token budget (Phase 4): tokens were recorded per message but never
 * budgeted. These tests pin the plan catalog values and the enforcement math
 * against a mocked Postgres pool.
 */

const postgresMock = vi.hoisted(() => ({
  getPostgresPool: vi.fn(),
  queryAsTenant: vi.fn(),
}));
vi.mock('../lib/storage/postgres', () => ({
  getPostgresPool: postgresMock.getPostgresPool,
  queryAsTenant: postgresMock.queryAsTenant,
}));
vi.mock('../lib/storage/db', () => ({
  db: {
    getTenant: vi.fn(),
    getDocuments: vi.fn(async () => []),
    getCollections: vi.fn(async () => []),
    getSources: vi.fn(async () => []),
    listApiKeys: vi.fn(async () => []),
    listWebhookEndpoints: vi.fn(async () => []),
    updateTenantPlan: vi.fn(),
  },
}));

import { PLANS, getTokenBudgetStatus, recordTokenUsage, getTokenUsage } from '../lib/services/planService';

const getPostgresPool = postgresMock.getPostgresPool;

/** Mutable in-memory usage_counters emulation with atomic upsert semantics. */
const counters = new Map<string, number>();
const fakePool = {
  query: async (sql: string, params: unknown[]) => {
    const [tenantId, period, tokens, now] = params as [string, string, number, string];
    if (sql.startsWith('SELECT tokens_used')) {
      const key = `${tenantId}:${period}`;
      return { rows: counters.has(key) ? [{ tokens_used: counters.get(key) }] : [] };
    }
    if (sql.startsWith('INSERT INTO usage_counters')) {
      const key = `${tenantId}:${period}`;
      counters.set(key, (counters.get(key) ?? 0) + Math.round(tokens));
      return { rows: [] };
    }
    return { rows: [] };
  },
};

describe('plan catalog — monthlyTokenBudget values', () => {
  it('escalates across tiers and leaves enterprise unlimited', () => {
    expect(PLANS.individual.monthlyTokenBudget).toBe(2_000_000);
    expect(PLANS.team.monthlyTokenBudget).toBe(10_000_000);
    expect(PLANS.business.monthlyTokenBudget).toBe(50_000_000);
    expect(PLANS.enterprise.monthlyTokenBudget).toBeNull();
  });
});

describe('token budget enforcement', () => {
  beforeEach(() => {
    counters.clear();
    // planService (v0.12.10) routes through queryAsTenant: emulate its
    // checkout+scope+query contract over the fake pool — including the
    // "not configured" throw the fail-open test relies on.
    getPostgresPool.mockReset().mockReturnValue(fakePool as never);
    postgresMock.queryAsTenant.mockReset().mockImplementation(
      async (_tenantId: string, sql: string, params?: unknown[]) => {
        const pool = getPostgresPool();
        if (!pool) throw new Error('PostgreSQL is not configured');
        return await pool.query(sql, params as any[]);
      },
    );
  });

  it('reports remaining headroom under the limit', async () => {
    await recordTokenUsage('t1', 1_500_000); // individual plan default in db mock
    const status = await getTokenBudgetStatus('t1');
    // db.getTenant is mocked to undefined → plan normalizes to individual (2M).
    expect(status.budget).toBe(2_000_000);
    expect(status.used).toBe(1_500_000);
    expect(status.remaining).toBe(500_000);
    expect(status.exhausted).toBe(false);
  });

  it('flags exhaustion at the ceiling', async () => {
    await recordTokenUsage('t1', 2_000_000);
    const status = await getTokenBudgetStatus('t1');
    expect(status.exhausted).toBe(true);
    expect(status.remaining).toBe(0);
  });

  it('accumulates atomically across concurrent completions', async () => {
    await Promise.all(Array.from({ length: 10 }, () => recordTokenUsage('t2', 5_000)));
    expect(await getTokenUsage('t2')).toBe(50_000);
  });

  it('never throws when the store is away (fail-open)', async () => {
    getPostgresPool.mockReturnValue(null as never);
    await expect(recordTokenUsage('t3', 100)).resolves.toBeUndefined();
    await expect(getTokenUsage('t3')).resolves.toBe(0);
  });

  it('ignores non-positive/NaN token counts', async () => {
    await recordTokenUsage('t4', 0);
    await recordTokenUsage('t4', -5);
    await recordTokenUsage('t4', Number.NaN);
    expect(await getTokenUsage('t4')).toBe(0);
  });
});
