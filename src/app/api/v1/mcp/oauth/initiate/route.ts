import { NextRequest, NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { mcpOAuthManager } from '@/lib/mcp/auth/oauth-manager';
import { getEnv } from '@/lib/env/runtimeEnv';
import { guardPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

/**
 * Derive the OAuth callback URL from the configured public APP_URL rather than
 * the request Host header. Trusting the Host header is a host-header-injection
 * vector (a misconfigured proxy could pin the OAuth callback to an attacker
 * origin). APP_URL is operator-controlled (Cloud Run / Vercel env) and is the
 * canonical public origin.
 */
function deriveRedirectUri(req: NextRequest): string {
  const appUrl = getEnv('APP_URL', req);
  if (appUrl) {
    try {
      const base = new URL(appUrl.trim());
      return `${base.origin}/api/v1/mcp/oauth/callback`;
    } catch {
      // fall through to Host-header fallback (dev only)
    }
  }
  // Fallback for local dev where APP_URL isn't set. Not used in production.
  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}/api/v1/mcp/oauth/callback`;
}

export const POST = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  try {
    const denied = await guardPermission(authCtx, 'mcp:manage');
    if (denied) return denied;

    const body = await req.json();
    const tenantId = authCtx.tenantId;

    const {
      serverId,
      authUrl = 'https://slack.com/oauth/v2/authorize',
      clientId = 'mcp-slack-client-2026',
      scopes = ['chat:write', 'channels:read', 'users:read'],
      resourceIndicator = 'https://api.slack.com',
      expectedIssuer = 'slack.com',
      tokenEndpoint, // optional: provide for a REAL token exchange
      clientSecret, // optional: confidential-client secret
    } = body;

    if (!serverId) {
      return NextResponse.json({ success: false, error: 'معرف خادم الـ MCP (serverId) مطلوب للربط' }, { status: 400 });
    }

    const redirectUri = deriveRedirectUri(req);

    const flow = await mcpOAuthManager.initiateFlow({
      serverId,
      tenantId,
      authUrl,
      clientId,
      scopes,
      resourceIndicator,
      expectedIssuer,
      redirectUri,
      tokenEndpoint,
      clientSecret,
    });

    const realExchange = Boolean(tokenEndpoint && clientId);
    return NextResponse.json({
      success: true,
      serverId,
      authorizationUrl: flow.authorizationUrl,
      state: flow.state,
      resourceIndicator,
      tokenExchange: realExchange ? 'real' : 'simulated',
      rfcValidation: 'RFC 8707 + RFC 9207 Enabled',
    });
  } catch (err: any) {
    console.error('[api/v1/mcp/oauth/initiate] POST error:', err);
    return NextResponse.json({ success: false, error: 'فشل بدء تدفق توثيق OAuth 2.0' }, { status: 500 });
  }
});
