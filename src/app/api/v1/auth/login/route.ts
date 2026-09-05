import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { verifyPassword, getDummyPasswordHash } from '@/lib/auth/password';
import { isCsrfOk, csrfDenied } from '@/lib/auth/csrf';
import { setSessionCookie } from '@/lib/auth/session';
import { createSessionToken, sessionExpiryIso } from '@/lib/auth/sessionInfo';
import { serverErrorResponse } from '@/lib/api/safeError';
import { originGuardDenied } from '@/lib/api/originGuard';
import { checkRateLimit } from '@/lib/security/rateLimiter';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_INVALID = 'البريد الإلكتروني أو كلمة المرور غير صحيحة (Invalid email or password)';

// Stricter rate limit for the login endpoint: 10 attempts per minute per IP.
// Brute-force / credential-stuffing protection. The general API limiter
// (30/min) is not applied here because /auth/login is not behind
// withAuthAndRateLimit (which verifies a session, meaningless pre-auth).
const LOGIN_RATE_LIMIT = 10;
const LOGIN_RATE_WINDOW = 60000;
// Secondary per-credential bucket: 5 attempts per minute per email, so an
// attacker rotating IPs still hits a per-account ceiling on credential
// stuffing. Combined with the per-IP limit, the effective budget is the
// stricter of the two on each request.
const LOGIN_EMAIL_RATE_LIMIT = 5;

/**
 * Authenticate against a Postgres user row (Argon2id verification), then open an
 * httpOnly session. On any failure we return the same generic message + 401 to
 * avoid leaking which credentials exist (account enumeration defense).
 *
 * Timing-oracle defense: when no user matches the email, we run a full Argon2
 * verification against a cached dummy hash (discarded) so the "user missing"
 * response latency is indistinguishable from the "wrong password" response.
 */
export async function POST(req: NextRequest) {
  // Rate-limit BEFORE any work, including before CSRF, so a flood of bogus
  // requests cannot weaponise the Argon2 dummy-verify as a CPU DoS.
  const rl = await checkRateLimit(req, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW);
  if (!rl.success && rl.response) return rl.response;

  if (!isCsrfOk(req)) return csrfDenied();
  // v0.12.12 (audit item 6): strong Origin gate — blocks login-CSRF (a
  // cross-site form logging the victim into an attacker-controlled account).
  const originDenied = originGuardDenied(req);
  if (originDenied) return originDenied;
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!EMAIL_RE.test(email) || !password) {
      return NextResponse.json({ error: GENERIC_INVALID, code: '401_INVALID_CREDENTIALS' }, { status: 401 });
    }

    // Secondary per-credential throttle: an attacker rotating IPs across the
    // per-IP ceiling still cannot exceed this per-email budget. Checked AFTER
    // input validation so a malformed email cannot seed a bucket entry.
    const emailRl = await checkRateLimit(req, LOGIN_EMAIL_RATE_LIMIT, LOGIN_RATE_WINDOW, email);
    if (!emailRl.success && emailRl.response) return emailRl.response;

    const user = await db.getUserByEmail(email);

    // Timing-oracle defense. Previously the missing-user branch skipped
    // verifyPassword entirely, making "user missing" faster than "wrong
    // password". Now both branches run a full Argon2 verification.
    let ok = false;
    if (user) {
      ok = await verifyPassword(password, user.passwordHash);
    } else {
      // Discarded — runs purely to equalise the response latency.
      const dummyHash = await getDummyPasswordHash();
      await verifyPassword(password, dummyHash);
      ok = false;
    }

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
