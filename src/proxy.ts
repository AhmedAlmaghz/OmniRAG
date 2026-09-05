import { NextResponse, type NextRequest } from 'next/server';
import { getAllowedOrigins, buildCsp, baseSecurityHeaders } from '@/lib/security/securityHeaders';

/**
 * Edge proxy (Next.js 16 — previously the "middleware" convention): CORS
 * handling for /api/* and security headers for every response. Security
 * headers are applied unconditionally — they must not depend on the request
 * carrying a vetted Origin (the previous behavior left non-CORS browser
 * requests with zero hardening).
 */

// Edge runtime: node:crypto is unavailable; the global Web Crypto API is.
declare const crypto: { randomUUID(): string };

function applyCors(response: NextResponse, allowed: string[], origin: string) {
  // Only echo back vetted origins. Never reflect arbitrary / null origins.
  if (origin && origin !== 'null' && allowed.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  }
}

export function proxy(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith('/api/');
  const isProd = process.env.NODE_ENV === 'production';

  const allowed = getAllowedOrigins();
  const origin = request.headers.get('origin') || '';

  // Build the base response that downstream handlers will extend.
  const response = NextResponse.next();

  // Security headers on everything, CORS only on the API surface.
  const headers = baseSecurityHeaders(isProd);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  if (isApi) {
    applyCors(response, allowed, origin);
  } else {
    // Pages: strict CSP with a per-request nonce. The nonce is exposed to the
    // server layout via the request header so layout.tsx can stamp it on the
    // one inline script; response copy keeps it for tests/diagnostics.
    const nonce = crypto.randomUUID();
    response.headers.set('Content-Security-Policy', buildCsp(nonce));
    response.headers.set('x-csp-nonce', nonce);
    // For page requests the nonce must also reach the server component tree:
    // NextRequest headers are immutable, so we forward via the response and
    // re-read it in layout via headers() — see layout.tsx.
    request.headers.set('x-csp-nonce', nonce);
  }

  // Intercept OPTIONS preflight requests immediately.
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: response.headers,
    });
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    '/((?!_next/static|_next/image|favicon.ico|icon.svg).*)',
  ],
};
