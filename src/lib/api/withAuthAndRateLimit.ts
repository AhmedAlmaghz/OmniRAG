import { NextRequest, NextResponse } from 'next/server';
import { verifyApiAuth, AuthenticatedContext } from '../auth/apiAuth';
import { checkRateLimit } from '../security/rateLimiter';
import { getEnv } from '../env/runtimeEnv';
import { db } from '../storage/db';
import { runWithRequestContext } from '../config/requestContext';
import { isSameOriginRequest, getAllowedOrigins } from '../security/securityHeaders';
import { createLogger } from '@/lib/logging/logger';

const log = createLogger('ApiGateway');

/**
 * Second argument Next.js passes to route handlers: an empty object for
 * non-dynamic routes, `{ params }` for dynamic ones. Generic so each route's
 * concrete params shape keeps flowing through its own handler signature.
 * Required (not optional) because dynamic routes destructure it directly.
 */
type ApiHandler<P = Record<string, unknown>> = (
  req: NextRequest,
  authCtx: AuthenticatedContext,
  props: P,
) => Promise<Response | NextResponse>;

/** Echo the correlation id on every response — success, 401/403/429 and 500 alike. */
function withRequestId<T extends Response>(res: T, requestId: string): T {
  try {
    res.headers.set('x-request-id', requestId);
  } catch {
    // Immutable response headers — the id is still preserved in request-scoped logs.
  }
  return res;
}

export function withAuthAndRateLimit<P = Record<string, unknown>>(
  handler: ApiHandler<P>,
  options?: { limit?: number; windowMs?: number },
) {
  // Next.js always passes the second argument (empty object on non-dynamic
  // routes); the `?? {}` keeps hand-written invocations equally safe.
  return async (req: NextRequest, props?: P): Promise<Response | NextResponse> => {
    const requestId = crypto.randomUUID();
    try {
      // 1. Pre-load runtime environment variables to enable global/internal DB calls.
      //    getEnv() itself ignores client-supplied headers in production.
      const envKeys = [
        'DATABASE_URL',
        'POSTGRES_URL',
        'QDRANT_URL',
        'QDRANT_API_KEY',
        'MISTRAL_API_KEY',
        'UNSTRUCTURED_API_KEY',
        'GEMINI_API_KEY',
      ];
      let dbUrlChanged = false;

      envKeys.forEach((key) => {
        const oldVal = getEnv(key);
        const newVal = getEnv(key, req);
        if ((key === 'DATABASE_URL' || key === 'POSTGRES_URL') && newVal && newVal !== oldVal) {
          dbUrlChanged = true;
        }
      });

      if (dbUrlChanged) {
        log.info('Database connection URL changed. Resetting store state.');
        db.resetDatabaseState();
      }

      // 2. Rate Limiting
      const rateLimit = await checkRateLimit(req, options?.limit || 30, options?.windowMs || 60000);
      if (!rateLimit.success && rateLimit.response) {
        return withRequestId(rateLimit.response, requestId);
      }

      // 2b. CSRF origin gate for state-changing requests. Cookie-authenticated
      //     mutations must originate from this deployment or an allowlisted CORS
      //     origin; Bearer API-key traffic is exempt (not ambient credentials).
      if (!isSameOriginRequest(req, getAllowedOrigins())) {
        return withRequestId(
          NextResponse.json({ error: 'Forbidden (cross-origin request rejected)' }, { status: 403 }),
          requestId,
        );
      }

      // 3. Authentication (strict: rejects missing/invalid tokens — see apiAuth.ts)
      const authCtx = await verifyApiAuth(req);
      if (!authCtx.authenticated) {
        const unauthorizedRes = authCtx.response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        return withRequestId(unauthorizedRes, requestId);
      }

      // 4. Execution — bind the authenticated identity (plus the correlation id)
      //    so downstream server code (provider credentials, tenant config, audit,
      //    structured logging) can resolve it without threading it through every
      //    signature.
      const res = await runWithRequestContext(
        { tenantId: authCtx.tenantId, userId: authCtx.userId, apiKeyId: authCtx.apiKeyId, requestId },
        () => handler(req, authCtx, props ?? ({} as P)),
      );
      return withRequestId(res, requestId);
    } catch (err) {
      log.error('Unexpected error:', err);
      // Never leak internal error details to clients
      return withRequestId(
        NextResponse.json({ error: 'خطأ داخلي في الخادم (Internal Server Error)' }, { status: 500 }),
        requestId,
      );
    }
  };
}
