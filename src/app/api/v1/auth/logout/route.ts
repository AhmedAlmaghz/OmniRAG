import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { isCsrfOk, csrfDenied } from '@/lib/auth/csrf';
import { clearSessionCookie, getSessionTokenFromRequest } from '@/lib/auth/session';
import { serverErrorResponse } from '@/lib/api/safeError';

export const dynamic = 'force-dynamic';

/**
 * Revoke the current session (delete its row) and clear the httpOnly cookie.
 * Idempotent: a missing or already-expired session still returns 200.
 */
export async function POST(req: NextRequest) {
  if (!isCsrfOk(req)) return csrfDenied();
  try {
    const token = getSessionTokenFromRequest(req);
    if (token) {
      await db.deleteSession(token).catch(() => {});
    }
    const res = NextResponse.json({ ok: true });
    return clearSessionCookie(res);
  } catch (err) {
    return serverErrorResponse('auth/logout', err);
  }
}
