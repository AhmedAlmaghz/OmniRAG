import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin') || '*';
  const effectiveOrigin = (origin === 'null' || !origin) ? '*' : origin;
  const hasCredentials = effectiveOrigin !== '*';

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': effectiveOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
  };

  if (hasCredentials) {
    corsHeaders['Access-Control-Allow-Credentials'] = 'true';
  }

  // Intercept OPTIONS preflight requests immediately
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Inject CORS headers for other responses
  const response = NextResponse.next();
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
