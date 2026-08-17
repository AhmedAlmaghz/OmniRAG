import { NextRequest, NextResponse } from 'next/server';

interface RateLimitStore {
  [key: string]: { count: number; resetAt: number };
}

const store: RateLimitStore = {};

/**
 * In-memory sliding window Rate Limiter for API endpoints.
 *
 * NOTE: store is per-process and resets on cold start. On serverless (Vercel/
 * Cloud Run) with N concurrent instances the effective limit is N× higher and a
 * cold start wipes the counter. For production-grade throttling back this with
 * an external store (Upstash Redis / Vercel KV). The per-instance limiter
 * remains a useful first line and is what every route currently uses.
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
export function checkRateLimit(
  req: NextRequest,
  limit: number = 30,
  windowMs: number = 60000,
  customKey?: string,
): { success: boolean; response?: NextResponse } {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || '127.0.0.1';
  const path = req.nextUrl.pathname;
  // A customKey REPLACES the IP dimension so the credential bucket is
  // IP-independent (defeats IP rotation in credential stuffing). The plain
  // per-IP bucket preserves its original `(ip,path)` shape.
  const key = customKey ? `${customKey}:${path}` : `${ip}:${path}`;
  const now = Date.now();

  const record = store[key];

  if (!record || now > record.resetAt) {
    store[key] = { count: 1, resetAt: now + windowMs };
    return { success: true };
  }

  if (record.count >= limit) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'تم تجاوز حد الطلبات المسموح به. يرجى المحاولة لاحقاً (Rate Limit Exceeded)',
          code: '429_TOO_MANY_REQUESTS',
          retryAfterMs: record.resetAt - now,
        },
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil((record.resetAt - now) / 1000).toString(),
          },
        },
      ),
    };
  }

  record.count += 1;
  return { success: true };
}
