import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logging/logger';

const log = createLogger('Api');

/**
 * Generic, localized messages returned to API clients for server failures.
 * Internal error details never leak here — they are only logged server-side.
 */
const GENERIC_SERVER_ERROR = 'حدث خطأ داخلي في الخادم. يرجى المحاولة مرة أخرى لاحقاً.';

/**
 * Builds a 500 response with a generic client-facing message, while logging
 * the real error (with request context: requestId/tenantId when active) to
 * the structured server log for operators.
 *
 * Use this in API route catch-blocks instead of returning `err.message`
 * directly, so stack traces / connection strings / driver codes are not
 * exposed to clients (information-disclosure / OWASP A01/A05).
 */
export function serverErrorResponse(context: string, err: unknown): NextResponse {
  log.error(context, err);
  return NextResponse.json({ error: GENERIC_SERVER_ERROR, code: 'INTERNAL_ERROR' }, { status: 500 });
}
