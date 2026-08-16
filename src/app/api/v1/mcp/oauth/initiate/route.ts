import { NextRequest, NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { mcpOAuthManager } from '@/lib/mcp/auth/oauth-manager';

export const dynamic = 'force-dynamic';

export const POST = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  try {
    const body = await req.json();
    const tenantId = authCtx.tenantId;

    const {
      serverId,
      authUrl = 'https://slack.com/oauth/v2/authorize',
      clientId = 'mcp-slack-client-2026',
      scopes = ['chat:write', 'channels:read', 'users:read'],
      resourceIndicator = 'https://api.slack.com',
      expectedIssuer = 'slack.com',
    } = body;

    if (!serverId) {
      return NextResponse.json({ success: false, error: 'معرف خادم الـ MCP (serverId) مطلوب للربط' }, { status: 400 });
    }

    const host = req.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const redirectUri = `${protocol}://${host}/api/v1/mcp/oauth/callback`;

    const flow = await mcpOAuthManager.initiateFlow({
      serverId,
      tenantId,
      authUrl,
      clientId,
      scopes,
      resourceIndicator,
      expectedIssuer,
      redirectUri,
    });

    return NextResponse.json({
      success: true,
      serverId,
      authorizationUrl: flow.authorizationUrl,
      state: flow.state,
      resourceIndicator,
      rfcValidation: 'RFC 8707 + RFC 9207 Enabled',
    });
  } catch (err: any) {
    console.error('[api/v1/mcp/oauth/initiate] POST error:', err);
    return NextResponse.json({ success: false, error: 'فشل بدء تدفق توثيق OAuth 2.0' }, { status: 500 });
  }
});
