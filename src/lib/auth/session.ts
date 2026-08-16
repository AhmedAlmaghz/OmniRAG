import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';

export const SESSION_COOKIE = 'omnirag-session';
/** Session lifetime: 7 days. Also the cookie maxAge. */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const SESSION_COOKIE_PATH = '/';

/**
 * Read the opaque session token from the request cookie. Returns undefined
 * when absent — callers reject with 401 (no bypass path).
 */
export function getSessionTokenFromRequest(req: NextRequest): string | undefined {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token && token.trim() ? token : undefined;
}

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

export interface SetSessionCookieOptions {
  token: string;
  expiresInSeconds?: number;
}

/**
 * Set the httpOnly session cookie on a Next.js Route Handler Response.
 *
 * Security posture: httpOnly (no JS read), SameSite=Lax (cross-site top-level
 * navigations permitted; guards against CSRF via SameSite), Secure in
 * production, scoped to path '/'. The cookie carries an opaque random token
 * looked up verbatim against the `sessions` table — it is never a JWT, so
 * revocation is immediate (delete the row).
 */
export function setSessionCookie(
  res: NextResponse,
  { token, expiresInSeconds = SESSION_MAX_AGE_SECONDS }: SetSessionCookieOptions,
): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: SESSION_COOKIE_PATH,
    maxAge: expiresInSeconds,
  });
  return res;
}

/** Clear the session cookie (used on logout). */
export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: SESSION_COOKIE_PATH,
    maxAge: 0,
  });
  return res;
}

/**
 * Read the session token from the current request on a Route Handler via the
 * async cookies() helper (Next 16). Prefer getSessionTokenFromRequest for the
 * sync req.cookies path in middleware-style handlers.
 */
export async function getSessionTokenFromCookies(): Promise<string | undefined> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token && token.trim() ? token : undefined;
}
