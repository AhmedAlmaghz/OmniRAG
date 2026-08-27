import { NextRequest, NextResponse } from 'next/server';
import { mcpOAuthManager } from '@/lib/mcp/auth/oauth-manager';

export const dynamic = 'force-dynamic';

/**
 * Renders a minimal self-closing popup page. The OAuth provider redirects the
 * popup here after authorization; we finish the token exchange server-side and
 * then close the popup, notifying the opener window so McpGateway can refresh
 * the server list. No sensitive data is embedded in the page.
 */
function popupClosePage(success: boolean, message: string): NextResponse {
  const safeMessage = message.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>OmniRAG MCP OAuth</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; }
  .card { text-align: center; padding: 24px 32px; border-radius: 16px; background: #fff; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(15,23,42,.06); }
  .icon { font-size: 28px; margin-bottom: 8px; }
  p { font-size: 13px; margin: 4px 0; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? '✅' : '⛔'}</div>
    <p><strong>${safeMessage}</strong></p>
    <p>OmniRAG MCP Gateway</p>
  </div>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ source: 'omnirag-mcp-oauth', success: ${success ? 'true' : 'false'} }, window.location.origin);
      }
    } catch (e) {}
    setTimeout(function () { window.close(); }, 1500);
  </script>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const iss = searchParams.get('iss') || undefined; // RFC 9207 Issuer

    if (!code || !state) {
      return popupClosePage(false, 'كود التفويض أو القيمة العشوائية (State) مفقودة في Callback');
    }

    const result = await mcpOAuthManager.handleCallback({
      code,
      state,
      iss,
    });

    const success = Boolean(result?.success);
    const message =
      String(result?.message || '').trim() ||
      (success ? 'تم ربط توثيق OAuth بنجاح. يمكنك إغلاق هذه النافذة.' : 'فشل إكمال تدفق توثيق OAuth');
    return popupClosePage(success, message);
  } catch (err: any) {
    console.error('[api/v1/mcp/oauth/callback] GET error:', err);
    return popupClosePage(false, 'حدث خطأ داخلي أثناء إكمال توثيق OAuth');
  }
}
