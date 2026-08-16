import { NextRequest, NextResponse } from 'next/server';
import { verifyApiAuth, AuthenticatedContext } from '../auth/apiAuth';
import { checkRateLimit } from '../security/rateLimiter';
import { getEnv } from '../env/runtimeEnv';
import { db } from '../storage/db';

type ApiHandler = (req: NextRequest, authCtx: AuthenticatedContext, props?: any) => Promise<Response | NextResponse>;

export function withAuthAndRateLimit(handler: ApiHandler, options?: { limit?: number; windowMs?: number }) {
  return async (req: NextRequest, props?: any): Promise<Response | NextResponse> => {
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
        console.log('[withAuthAndRateLimit] Database connection URL changed. Resetting store state.');
        db.resetDatabaseState();
      }

      // 2. Rate Limiting
      const rateLimit = checkRateLimit(req, options?.limit || 30, options?.windowMs || 60000);
      if (!rateLimit.success && rateLimit.response) {
        return rateLimit.response;
      }

      // 3. Authentication (strict: rejects missing/invalid tokens — see apiAuth.ts)
      const authCtx = await verifyApiAuth(req);
      if (!authCtx.authenticated) {
        const unauthorizedRes = authCtx.response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        return unauthorizedRes;
      }

      // 4. Execution
      return await handler(req, authCtx, props);
    } catch (err) {
      console.error('[withAuthAndRateLimit] Unexpected error:', err);
      // Never leak internal error details to clients
      return NextResponse.json({ error: 'خطأ داخلي في الخادم (Internal Server Error)' }, { status: 500 });
    }
  };
}
