import { NextRequest, NextResponse } from 'next/server';
import { verifyApiAuth, AuthenticatedContext } from '../auth/apiAuth';
import { checkRateLimit } from '../security/rateLimiter';

type ApiHandler = (req: NextRequest, authCtx: AuthenticatedContext, props?: any) => Promise<Response | NextResponse>;

export function withAuthAndRateLimit(handler: ApiHandler, options?: { limit?: number; windowMs?: number }) {
  return async (req: NextRequest, props?: any): Promise<Response | NextResponse> => {
    // 1. Rate Limiting
    const rateLimit = checkRateLimit(req, options?.limit || 30, options?.windowMs || 60000);
    if (!rateLimit.success && rateLimit.response) {
      return rateLimit.response;
    }

    // 2. Authentication
    const authCtx = await verifyApiAuth(req);
    if (!authCtx.authenticated) {
      return authCtx.response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 3. Execution
    try {
      return await handler(req, authCtx, props);
    } catch (err: any) {
      console.error('API Error:', err);
      return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
  };
}
