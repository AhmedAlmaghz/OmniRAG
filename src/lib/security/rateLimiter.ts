import { NextRequest, NextResponse } from 'next/server';

interface RateLimitStore {
  [key: string]: { count: number; resetAt: number };
}

const store: RateLimitStore = {};

/**
 * In-memory sliding window Rate Limiter for API endpoints
 * @param req NextRequest
 * @param limit Max requests per window
 * @param windowMs Window duration in milliseconds (default 60s)
 */
export function checkRateLimit(
  req: NextRequest,
  limit: number = 30,
  windowMs: number = 60000
): { success: boolean; response?: NextResponse } {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || '127.0.0.1';
  const path = req.nextUrl.pathname;
  const key = `${ip}:${path}`;
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
        }
      ),
    };
  }

  record.count += 1;
  return { success: true };
}
