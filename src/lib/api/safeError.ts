import { NextResponse } from 'next/server';

/**
 * Generic, localized messages returned to API clients for server failures.
 * Internal error details never leak here — they are only logged server-side.
 */
const GENERIC_SERVER_ERROR = 'حدث خطأ داخلي في الخادم. يرجى المحاولة مرة أخرى لاحقاً.';

/**
 * Builds a 500 response with a generic client-facing message, while logging
 * the real error (with context) to the server console for operators.
 *
 * Use this in API route catch-blocks instead of returning `err.message`
 * directly, so stack traces / connection strings / driver codes are not
 * exposed to clients (information-disclosure / OWASP A01/A05).
 */
export function serverErrorResponse(context: string, err: unknown): NextResponse {
  console.error(`[api] ${context}:`, err);
  return NextResponse.json({ error: GENERIC_SERVER_ERROR, code: 'INTERNAL_ERROR' }, { status: 500 });
}
