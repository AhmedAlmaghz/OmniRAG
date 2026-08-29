/**
 * Central security-header policy shared by the edge middleware and tests.
 *
 * Threat model notes:
 *  - The SPA is one client bundle served from 'self'; all API traffic is
 *    same-origin (chat streaming included). No third-party scripts/styles are
 *    loaded by the app UI itself.
 *  - The only external asset is the Swagger UI on /api/docs, which builds its
 *    own document via string templates — it gets a route-scoped CSP exception
 *    instead of loosening the global policy.
 *  - LLM-generated content (mermaid SVG, markdown, KaTeX, Shiki) is rendered
 *    into the DOM; a strict CSP is the second layer behind sanitization, so
 *    even a sanitizer miss cannot execute script.
 */

/** Parse a comma-separated allowlist env var; dev-only defaults when empty. */
export function getAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS || '';
  const envList = raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  if (envList.length > 0) return envList;

  // Default allowlist only in development
  if (process.env.NODE_ENV !== 'production') {
    return ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://0.0.0.0:3000'];
  }
  return [];
}

/**
 * Content-Security-Policy for application pages (everything except /api/docs).
 * `nonce` is generated per-request by the middleware; pages must consume it
 * via the x-csp-nonce response header (the layout script is the only inline
 * script in the app).
 */
export function buildCsp(nonce: string): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    // Tailwind v4 CSS-first runtime plus component-level <style> needs inline
    // styles; tightening this requires a styled-components-free pass first.
    "style-src 'self' 'unsafe-inline'",
    // Markdown images render as data:/blob: URIs (AI-generated diagrams,
    // KaTeX4Arabic composition); remote images come from 'self' API proxies.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    // Tesseract.js may create object URLs for the worker harness
    "child-src 'self' blob:",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ];
  return directives.join('; ');
}

/** CSP for the Swagger UI page — scoped to unpkg, never used app-wide. */
export function buildDocsCsp(nonce: string): string {
  const directives = [
    "default-src 'none'",
    `script-src 'self' https://unpkg.com 'nonce-${nonce}'`,
    "style-src 'self' https://unpkg.com 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' https://unpkg.com",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ];
  return directives.join('; ');
}

/** Hardening headers applied to every response (API and pages alike). */
export function baseSecurityHeaders(isProd: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-DNS-Prefetch-Control': 'off',
  };
  // HSTS over plain HTTP breaks local dev; production only.
  if (isProd) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

/**
 * CSRF gate for state-changing API requests: Origin (Referer as fallback)
 * must match the request host or the CORS allowlist. Bearer API keys are
 * exempt — they are not ambient cookie credentials, so cross-site requests
 * cannot carry them.
 */
export function isSameOriginRequest(
  req: { headers: { get(name: string): string | null }; url: string },
  allowedOrigins: string[],
): boolean {
  const method = (req as { method?: string }).method || 'GET';
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return true;

  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) return true;

  const origin = req.headers.get('origin') || '';
  const referer = req.headers.get('referer') || '';

  const candidate = origin || (referer ? safeOriginOf(referer) : '');
  if (!candidate) {
    // No Origin and no Referer at all — legacy clients. SameSite=Lax cookies
    // already cannot be attached cross-site; treat as same-origin.
    return true;
  }

  const host = hostOf(req.url);
  if (!host) return false;
  if (stripProtocol(candidate) === stripProtocol(host)) return true;
  if (allowedOrigins.some((o) => stripProtocol(o) === stripProtocol(candidate))) return true;

  return false;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function safeOriginOf(referer: string): string {
  try {
    return new URL(referer).origin;
  } catch {
    return '';
  }
}

function stripProtocol(u: string): string {
  return u
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .toLowerCase();
}
