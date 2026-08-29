import { NextRequest, NextResponse } from 'next/server';
import { checkKeyedRateLimitDurable, resetDurableRateLimitStore } from './durableRateLimiter';

/**
 * Rate limiter for API endpoints.
 *
 * The window state now lives in Postgres (rate_limit_windows table) via a
 * single atomic upsert per request, so the limit is enforced across ALL
 * serverless instances and survives cold starts — the previous in-memory
 * store multiplied the effective limit by the instance count and reset on
 * every cold boot. When Postgres is unreachable (local dev without a DB,
 * transient outage) the durable limiter falls back to an in-memory window
 * rather than blocking traffic; see durableRateLimiter.ts.
 *
 * @param req NextRequest
 * @param limit Max requests per window
 * @param windowMs Window duration in milliseconds (default 60s)
 * @param customKey Optional credential/account identifier (e.g. email for
 *   login). When provided, the bucket is keyed by `${customKey}:${path}`
 *   WITHOUT the IP, so an attacker rotating IPs cannot evade the per-account
 *   ceiling. Callers typically run BOTH the per-IP limit (no customKey) and
 *   the per-credential limit (with customKey), accepting the stricter result.
 */
export async function checkRateLimit(
  req: NextRequest,
  limit: number = 30,
  windowMs: number = 60000,
  customKey?: string,
): Promise<{ success: boolean; response?: NextResponse }> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || '127.0.0.1';
  const path = req.nextUrl.pathname;
  // A customKey REPLACES the IP dimension so the credential bucket is
  // IP-independent (defeats IP rotation in credential stuffing). The plain
  // per-IP bucket preserves its original `(ip:path)` shape.
  const key = customKey ? `${customKey}:${path}` : `${ip}:${path}`;

  const result = await checkKeyedRateLimitDurable(key, limit, windowMs);
  if (result.success) return { success: true };

  return {
    success: false,
    response: NextResponse.json(
      {
        error: 'تم تجاوز حد الطلبات المسموح به. يرجى المحاولة لاحقاً (Rate Limit Exceeded)',
        code: '429_TOO_MANY_REQUESTS',
        retryAfterMs: result.retryAfterMs ?? windowMs,
      },
      {
        status: 429,
        headers: {
          'Retry-After': Math.ceil((result.retryAfterMs ?? windowMs) / 1000).toString(),
        },
      },
    ),
  };
}

/**
 * Request-independent sliding-window check keyed by an arbitrary bucket
 * identifier (e.g. `apikey:${keyId}` for per-API-key ceilings). Persists via
 * the durable store; use it in auth layers and background services where the
 * caller already knows the credential/account identity.
 */
export async function checkKeyedRateLimit(
  bucketKey: string,
  limit: number,
  windowMs: number = 60000,
): Promise<{ success: boolean; retryAfterMs?: number }> {
  const result = await checkKeyedRateLimitDurable(bucketKey, limit, windowMs);
  if (result.success) return { success: true };
  return { success: false, retryAfterMs: result.retryAfterMs };
}

/** Test/maintenance hook — clears the fallback store inside the durable limiter. */
export function resetRateLimitStore(): void {
  resetDurableRateLimitStore();
}
