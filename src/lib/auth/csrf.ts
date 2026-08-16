import { NextRequest, NextResponse } from 'next/server';

/**
 * CSRF guard for state-changing auth endpoints.
 *
 * The auth session lives in an httpOnly cookie (automatically sent cross-site
 * on top-level navigations by SameSite=Lax), which makes mutation endpoints
 * eligible for CSRF. We require a custom request header that browsers do not
 * send automatically on cross-site requests; `fetchWithAuth` sets this on every
 * call. A same-origin fetch from the SPA carries it; a cross-site form POST
 * cannot.
 */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'XMLHttpRequest';

export function isCsrfOk(req: NextRequest): boolean {
  return req.headers.get(CSRF_HEADER) === CSRF_HEADER_VALUE;
}

export function csrfDenied(): NextResponse {
  return NextResponse.json(
    {
      error: 'طلب غير مصرّح به (Unauthorized request).',
      code: '403_CSRF',
    },
    { status: 403 },
  );
}
