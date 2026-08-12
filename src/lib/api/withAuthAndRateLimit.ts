import { NextRequest, NextResponse } from 'next/server';
import { verifyApiAuth, AuthenticatedContext } from '../auth/apiAuth';
import { checkRateLimit } from '../security/rateLimiter';

type ApiHandler = (req: NextRequest, authCtx: AuthenticatedContext, props?: any) => Promise<Response | NextResponse>;

export function withAuthAndRateLimit(handler: ApiHandler, options?: { limit?: number; windowMs?: number }) {
  return async (req: NextRequest, props?: any): Promise<Response | NextResponse> => {
    // CORS headers for development/preview environments to avoid any potential sandboxed iframe fetch errors
    const origin = req.headers.get('origin') || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Credentials': 'true',
    };

    if (req.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const injectCors = (res: Response | NextResponse) => {
      try {
        Object.entries(corsHeaders).forEach(([key, val]) => {
          res.headers.set(key, val);
        });
      } catch (e) {
        // Fallback if headers are read-only
        try {
          const newHeaders = new Headers(res.headers);
          Object.entries(corsHeaders).forEach(([key, val]) => {
            newHeaders.set(key, val);
          });
          return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: newHeaders,
          });
        } catch (innerErr) {
          console.warn('Failed to set CORS headers:', innerErr);
        }
      }
      return res;
    };

    // 1. Rate Limiting
    const rateLimit = checkRateLimit(req, options?.limit || 30, options?.windowMs || 60000);
    if (!rateLimit.success && rateLimit.response) {
      return injectCors(rateLimit.response);
    }

    // 2. Authentication
    const authCtx = await verifyApiAuth(req);
    if (!authCtx.authenticated) {
      const unauthorizedRes = authCtx.response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return injectCors(unauthorizedRes);
    }

    // 3. Execution
    try {
      const result = await handler(req, authCtx, props);
      return injectCors(result);
    } catch (err: any) {
      console.error('API Error:', err);
      const errorRes = NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
      return injectCors(errorRes);
    }
  };
}
