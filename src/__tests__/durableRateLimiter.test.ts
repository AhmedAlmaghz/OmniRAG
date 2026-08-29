import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkKeyedRateLimitDurable, resetDurableRateLimitStore } from '../lib/security/durableRateLimiter';
import * as postgres from '../lib/storage/postgres';

/**
 * Durable rate limiter (Postgres-backed fixed windows).
 *
 * The in-memory predecessor multiplied the effective limit by the serverless
 * instance count. These tests pin the durable contract:
 *  - single atomic upsert decides increment-or-reset (no read-modify-write)
 *  - concurrent checks never lose increments (atomicity via ON CONFLICT)
 *  - Postgres failures degrade to the in-memory window, never block traffic
 *  - without a pool (local dev) the memory path serves directly
 */

vi.mock('../lib/storage/postgres', () => ({
  getPostgresPool: vi.fn(),
}));

const getPostgresPool = vi.mocked(postgres.getPostgresPool);

/** In-memory emulation of the atomic UPSERT window semantics. */
class FakeWindowTable {
  rows = new Map<string, { count: number; window_start: string }>();
  failNext = false;

  query = async (_sql: string, params: unknown[]) => {
    if (this.failNext) throw new Error('connection refused');
    const [bucketId, expiryIso, nowIso] = params as [string, string, string];
    const existing = this.rows.get(bucketId);
    if (!existing || existing.window_start <= expiryIso) {
      const row = { count: 1, window_start: nowIso };
      this.rows.set(bucketId, row);
      return { rows: [{ ...row }] };
    }
    existing.count += 1;
    return { rows: [{ ...existing }] };
  };
}

function withTable(table: FakeWindowTable) {
  getPostgresPool.mockReturnValue({ query: table.query } as never);
}

describe('checkKeyedRateLimitDurable — Postgres-backed windows', () => {
  beforeEach(() => {
    resetDurableRateLimitStore();
    getPostgresPool.mockReset();
  });

  it('counts up to the limit then blocks with retryAfterMs', async () => {
    const table = new FakeWindowTable();
    withTable(table);

    for (let i = 0; i < 3; i++) {
      const r = await checkKeyedRateLimitDurable('login:ip:1', 3, 60000);
      expect(r.success).toBe(true);
      expect(r.backend).toBe('postgres');
    }
    const blocked = await checkKeyedRateLimitDurable('login:ip:1', 3, 60000);
    expect(blocked.success).toBe(false);
    expect(blocked.backend).toBe('postgres');
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60000);
  });

  it('never loses increments under concurrent bursts (atomic upsert semantics)', async () => {
    const table = new FakeWindowTable();
    withTable(table);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkKeyedRateLimitDurable('share:public', 5, 60000)),
    );
    const allowed = results.filter((r) => r.success).length;
    // Exactly 5 of 10 concurrent requests may pass a limit of 5 — a lost-update
    // bug would let more through.
    expect(allowed).toBe(5);
  });

  it('expires the window and starts a fresh one', async () => {
    const table = new FakeWindowTable();
    withTable(table);

    // Short 50 ms window.
    for (let i = 0; i < 2; i++) await checkKeyedRateLimitDurable('t', 2, 50);
    expect((await checkKeyedRateLimitDurable('t', 2, 50)).success).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect((await checkKeyedRateLimitDurable('t', 2, 50)).success).toBe(true);
  });

  it('falls back to memory when the Postgres query fails, without blocking', async () => {
    const table = new FakeWindowTable();
    withTable(table);
    table.failNext = true;

    const r = await checkKeyedRateLimitDurable('fallback', 1, 60000);
    expect(r.success).toBe(true);
    expect(r.backend).toBe('memory');

    // Within the degraded latch window the memory store serves and enforces.
    const blocked = await checkKeyedRateLimitDurable('fallback', 1, 60000);
    expect(blocked.success).toBe(false);
    expect(blocked.backend).toBe('memory');
  });

  it('serves from memory when no pool is configured (dev without DB)', async () => {
    getPostgresPool.mockReturnValue(null as never);
    const r = await checkKeyedRateLimitDurable('dev', 10, 60000);
    expect(r.success).toBe(true);
    expect(r.backend).toBe('memory');
  });
});
