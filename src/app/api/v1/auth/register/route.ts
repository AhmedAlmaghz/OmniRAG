import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { hashPassword } from '@/lib/auth/password';
import { isCsrfOk, csrfDenied } from '@/lib/auth/csrf';
import { setSessionCookie } from '@/lib/auth/session';
import { createSessionToken, sessionExpiryIso } from '@/lib/auth/sessionInfo';
import { seedNewTenant } from '@/actions/seedTenantAction';
import { serverErrorResponse } from '@/lib/api/safeError';
import { TenantSettings } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  chunkSize: 500,
  chunkOverlap: 50,
  hybridWeights: { semantic: 0.7, lexical: 0.3 },
  defaultModel: 'gemini-3.7-flash',
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
    const userId = `user-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const tenantId = `tenant-${userId.slice(-12)}`;

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
