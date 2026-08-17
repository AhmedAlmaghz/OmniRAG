import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { hashPassword } from '@/lib/auth/password';
import { isCsrfOk, csrfDenied } from '@/lib/auth/csrf';
import { setSessionCookie } from '@/lib/auth/session';
import { createSessionToken, sessionExpiryIso } from '@/lib/auth/sessionInfo';
import { seedNewTenant } from '@/actions/seedTenantAction';
import { serverErrorResponse } from '@/lib/api/safeError';
import { checkRateLimit } from '@/lib/security/rateLimiter';
import { TenantSettings } from '@/lib/types/omnirag';
import { randomUUID } from 'crypto';
import { DEFAULT_AI_MODELS } from '@/lib/config/aiModels';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

// Stricter rate limit for registration: 5 sign-ups per minute per IP.
// Prevents automated mass-tenant creation / resource exhaustion attacks.
const REGISTER_RATE_LIMIT = 5;
const REGISTER_RATE_WINDOW = 60000;

const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  chunkSize: 500,
  chunkOverlap: 50,
  hybridWeights: { semantic: 0.7, lexical: 0.3 },
  defaultModel: DEFAULT_AI_MODELS.chatModel,
  dataRetentionDays: 90,
  enablePiiRedaction: true,
  enablePromptSanitizer: true,
};

/**
 * Register a new account, provision its tenant, seed tenant defaults, and open
 * an httpOnly session. Email uniqueness is enforced by the users table's unique
 * constraint; we pre-check for a friendlier message.
 */
export async function POST(req: NextRequest) {
  // Rate-limit BEFORE any work, including before CSRF/Argon2, so a flood of
  // registration requests cannot weaponise Argon2 hashing as a CPU DoS.
  const rl = checkRateLimit(req, REGISTER_RATE_LIMIT, REGISTER_RATE_WINDOW);
  if (!rl.success && rl.response) return rl.response;

  if (!isCsrfOk(req)) return csrfDenied();
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const workspaceName = typeof body.workspaceName === 'string' ? body.workspaceName.trim() : '';

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: 'البريد الإلكتروني غير صالح (Invalid email)', code: '400_INVALID_EMAIL' },
        { status: 400 },
      );
    }
    if (password.length < MIN_PASSWORD) {
      return NextResponse.json(
        {
          error: `كلمة المرور ضعيفة (الحد الأدنى ${MIN_PASSWORD} أحرف) — Password too weak, min ${MIN_PASSWORD} characters`,
          code: '400_WEAK_PASSWORD',
        },
        { status: 400 },
      );
    }
    if (!workspaceName) {
      return NextResponse.json(
        { error: 'يرجى إدخال اسم مساحة العمل (Workspace name required)', code: '400_MISSING_WORKSPACE' },
        { status: 400 },
      );
    }

    const existing = await db.getUserByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: 'البريد الإلكتروني مستخدم بالفعل (Email already in use)', code: '409_EMAIL_EXISTS' },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    // Use cryptographically-random UUIDs for user/tenant identifiers. The
    // previous Date.now()+Math.random scheme was predictable and collision-
    // prone — randomUUID is RFC 4122 v4, 122 bits of CSPRNG entropy.
    const userId = `user-${randomUUID()}`;
    const tenantId = `tenant-${randomUUID()}`;

    const passwordHash = await hashPassword(password);

    await db.createUser({ id: userId, email, passwordHash, tenantId, createdAt: now });
    await db.createTenant({
      id: tenantId,
      name: workspaceName,
      plan: 'starter',
      createdAt: now,
      settings: DEFAULT_TENANT_SETTINGS,
    });

    try {
      await seedNewTenant(tenantId, workspaceName);
    } catch (seedErr) {
      // Non-fatal: tenant row exists; later calls auto-seed default data on first read.
      console.warn('[auth/register] seedNewTenant failed (non-fatal):', (seedErr as Error)?.message);
    }

    const token = createSessionToken();
    const expiresAt = sessionExpiryIso();
    await db.createSession({ token, userId, tenantId, expiresAt, createdAt: now });
    await db.deleteExpiredSessions().catch(() => {});

    const res = NextResponse.json({ tenantId, userEmail: email }, { status: 201 });
    return setSessionCookie(res, { token });
  } catch (err) {
    return serverErrorResponse('auth/register', err);
  }
}
