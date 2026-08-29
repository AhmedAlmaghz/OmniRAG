import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/security/rateLimiter';
import { buildDocsCsp } from '@/lib/security/securityHeaders';

export const dynamic = 'force-dynamic';

/**
 * Interactive API reference (Swagger UI) for the /api/v1 surface, loading the
 * OpenAPI 3.1 document from /api/docs/openapi.json. Public + rate-limited.
 * UI assets load from the official swagger-ui-dist CDN; no credentials are
 * rendered into the page.
 */
export async function GET(req: NextRequest) {
  const rl = await checkRateLimit(req, 30, 60000);
  if (!rl.success && rl.response) return rl.response;

  // Scoped CSP for this page only (unpkg assets); the app-wide CSP forbids
  // third-party scripts, so this route relaxes exactly what Swagger needs.
  const nonce = req.headers.get('x-csp-nonce') || '';
  const csp = buildDocsCsp(nonce);

  const html = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>OmniRAG API Reference</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #f8fafc; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script nonce="${nonce}">
    window.onload = () => {
      window.ui = window.SwaggerUIBundle({
        url: '/api/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [window.SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout',
      });
    };
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Content-Security-Policy': csp,
    },
  });
}
