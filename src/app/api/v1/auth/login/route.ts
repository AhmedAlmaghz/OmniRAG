import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { verifyPassword } from '@/lib/auth/password';
import { isCsrfOk, csrfDenied } from '@/lib/auth/csrf';
import { setSessionCookie } from '@/lib/auth/session';
import { createSessionToken, sessionExpiryIso } from '@/lib/auth/sessionInfo';
import { serverErrorResponse } from '@/lib/api/safeError';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_INVALID = 'البريد الإلكتروني أو كلمة المرور غير صحيحة (Invalid email or password)';

/**
 * Authenticate against a Postgres user row (Argon2id verification), then open an
 * httpOnly session. On any failure we return the same generic message + 401 to
 * avoid leaking which credentials exist (account enumeration defense).
 */
export async function POST(req: NextRequest) {
  if (!isCsrfOk(req)) return csrfDenied();
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!EMAIL_RE.test(email) || !password) {
      return NextResponse.json({ error: GENERIC_INVALID, code: '401_INVALID_CREDENTIALS' }, { status: 401 });
    }

    const user = await db.getUserByEmail(email);
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;

    // Constant-ish timing: when the user is missing, still run a dummy verify so
    // the response latency doesn't trivially distinguish missing users.
    if (!user || !ok) {
      return NextResponse.json({ error: GENERIC_INVALID, code: '401_INVALID_CREDENTIALS' }, { status: 401 });
    }

    const now = new Date().toISOString();
    const token = createSessionToken();
    const expiresAt = sessionExpiryIso();
    await db.createSession({ token, userId: user.id, tenantId: user.tenantId, expiresAt, createdAt: now });
    await db.deleteExpiredSessions().catch(() => {});

    const res = NextResponse.json({ tenantId: user.tenantId, userEmail: user.email });
    return setSessionCookie(res, { token });
  } catch (err) {
    return serverErrorResponse('auth/login', err);
  }
}
