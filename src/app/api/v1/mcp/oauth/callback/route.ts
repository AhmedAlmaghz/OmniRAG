import { NextRequest, NextResponse } from 'next/server';
import { mcpOAuthManager } from '@/lib/mcp/auth/oauth-manager';
import { serverErrorResponse } from '@/lib/api/safeError';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const iss = searchParams.get('iss') || undefined; // RFC 9207 Issuer

    if (!code || !state) {
      return NextResponse.json(
        { success: false, error: 'كود التفويض أو القيمة العشوائية (State) مفقودة في Callback' },
        { status: 400 },
      );
    }

    const result = await mcpOAuthManager.handleCallback({
      code,
      state,
      iss,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return serverErrorResponse('mcp/oauth/callback', err);
  }
}
