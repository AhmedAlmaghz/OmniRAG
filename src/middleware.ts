import { NextResponse, type NextRequest } from 'next/server';

/**
 * Returns the comma-separated list of allowed CORS origins from the
 * ALLOWED_ORIGINS environment variable. In development, localhost and
 * the Cloud Run preview origins are implicitly allowed when none are set.
 */
function getAllowedOrigins(): string[] {
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

export function middleware(request: NextRequest) {
  // Build the base response that downstream handlers will extend.
  const response = NextResponse.next();

  const allowed = getAllowedOrigins();
  const origin = request.headers.get('origin') || '';

  // Only echo back vetted origins. Never reflect arbitrary / null origins.
  if (origin && origin !== 'null' && allowed.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
    // Harden the API with sensible defaults.
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
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
  matcher: '/api/:path*',
};
