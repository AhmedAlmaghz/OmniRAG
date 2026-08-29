/**
 * Durable (Postgres-backed) rate limiting.
 *
 * The legacy in-memory limiter (rateLimiter.ts) is per-process: on serverless
 * the effective limit is N× concurrent instances and every cold start wipes
 * the counters — the login brute-force and share-token buckets were the most
 * exposed. This module provides the same sliding-window contract on top of a
 * single atomic upsert per request, with graceful degradation:
 *
 *   DB configured + query OK   → durable window (authoritative)
 *   DB configured + query err → in-memory fallback (never fail the request
 *                                because the limiter is down)
 *   DB not configured         → in-memory only (local dev / tests)
 *
 * Window semantics match the legacy store exactly (fixed window per bucket,
 * reset on expiry) so call-site behavior is unchanged.
 */

import { getPostgresPool } from '../storage/postgres';

export interface DurableRateResult {
  success: boolean;
  retryAfterMs?: number;
  /** 'postgres' when the durable store answered, 'memory' otherwise. */
  backend: 'postgres' | 'memory';
}

// Fallback store — same shape as the legacy limiter.
const memoryStore: Record<string, { count: number; resetAt: number }> = {};

/** One atomic round-trip: resets expired windows, increments live ones. */
const UPSERT_SQL = `
  INSERT INTO rate_limit_windows (bucket_id, count, window_start)
  VALUES ($1, 1, $3)
  ON CONFLICT (bucket_id) DO UPDATE SET
    count = CASE
      WHEN rate_limit_windows.window_start <= $2 THEN 1
      ELSE rate_limit_windows.count + 1
    END,
    window_start = CASE
      WHEN rate_limit_windows.window_start <= $2 THEN $3
      ELSE rate_limit_windows.window_start
    END
  RETURNING count, window_start;
`;

/** Errors latch the fallback for 30 s so a flaky DB doesn't add latency to every request. */
let degradedUntil = 0;

function memoryCheck(bucketId: string, limit: number, windowMs: number): DurableRateResult {
  const now = Date.now();
  const rec = memoryStore[bucketId];
  if (!rec || now > rec.resetAt) {
    memoryStore[bucketId] = { count: 1, resetAt: now + windowMs };
    return { success: true, backend: 'memory' };
  }
  if (rec.count >= limit) {
    return { success: false, retryAfterMs: rec.resetAt - now, backend: 'memory' };
  }
  rec.count += 1;
  return { success: true, backend: 'memory' };
}

/**
 * Sliding-window check keyed by an arbitrary bucket id. Mirrors the legacy
 * checkKeyedRateLimit contract but persists across instances.
 */
export async function checkKeyedRateLimitDurable(
  bucketId: string,
  limit: number,
  windowMs: number = 60000,
): Promise<DurableRateResult> {
  const pool = getPostgresPool();
  if (!pool || Date.now() < degradedUntil) {
    return memoryCheck(bucketId, limit, windowMs);
  }

  try {
    const now = Date.now();
    const res = await pool.query(UPSERT_SQL, [
      bucketId,
      new Date(now - windowMs).toISOString(),
      new Date(now).toISOString(),
    ]);
    const row = res?.rows?.[0] as { count: number; window_start: string } | undefined;
    if (!row) {
      // No row back means the table is missing (pre-migration deploy) — fall
      // back rather than blocking traffic.
      return memoryCheck(bucketId, limit, windowMs);
    }
    if (row.count > limit) {
      const startedAt = Date.parse(row.window_start);
      const retryAfterMs = Math.max(0, startedAt + windowMs - now);
      return { success: false, retryAfterMs, backend: 'postgres' };
    }
    return { success: true, backend: 'postgres' };
  } catch {
    // Never fail a request because the limiter store is unreachable.
    degradedUntil = Date.now() + 30000;
    return memoryCheck(bucketId, limit, windowMs);
  }
}

/** Test/maintenance hook — clears the fallback store and the degraded latch. */
export function resetDurableRateLimitStore(): void {
  for (const key of Object.keys(memoryStore)) delete memoryStore[key];
  degradedUntil = 0;
}
