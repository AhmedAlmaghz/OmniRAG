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
import {
  upsertMembership,
  acceptInvitation,
  getInvitationByToken,
  isInvitationUsable,
} from '@/lib/services/membershipService';

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
 * Register a new account. Two modes:
 *  - Create mode (default): provisions a new tenant, seeds defaults, and opens
 *    an httpOnly session with an owner membership.
 *  - Join mode (`inviteToken`): the account is created WITHOUT a new tenant —
 *    it joins the inviting workspace through the invitation (creating an
 *    account is no longer synonymous with creating a workspace).
 * In both modes any other pending invitations addressed to the same email are
 * accepted best-effort so the user lands in every workspace they were invited
 * to. Email uniqueness is enforced by the users table's unique constraint.
 */
export async function POST(req: NextRequest) {
  // Rate-limit BEFORE any work, including before CSRF/Argon2, so a flood of
  // registration requests cannot weaponise Argon2 hashing as a CPU DoS.
  const rl = await checkRateLimit(req, REGISTER_RATE_LIMIT, REGISTER_RATE_WINDOW);
  if (!rl.success && rl.response) return rl.response;

  if (!isCsrfOk(req)) return csrfDenied();
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const workspaceName = typeof body.workspaceName === 'string' ? body.workspaceName.trim() : '';
    const inviteToken = typeof body.inviteToken === 'string' ? body.inviteToken.trim() : '';

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

    // Join mode: validate the invitation BEFORE creating anything so a bad
    // token never leaves a half-provisioned account behind.
    let joinInvitation: Awaited<ReturnType<typeof getInvitationByToken>> = null;
    if (inviteToken) {
      joinInvitation = await getInvitationByToken(inviteToken);
      if (!joinInvitation || !isInvitationUsable(joinInvitation)) {
        return NextResponse.json(
          {
            error: 'الدعوة غير صالحة أو منتهية الصلاحية (Invitation invalid or expired)',
            code: '400_BAD_INVITATION',
          },
          { status: 400 },
        );
      }
      if (joinInvitation.email !== email) {
        return NextResponse.json(
          {
            error: 'هذه الدعوة موجهة لبريد إلكتروني آخر (Invitation was issued to a different email)',
            code: '400_INVITATION_EMAIL_MISMATCH',
          },
          { status: 400 },
        );
      }
    } else if (!workspaceName) {
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
    const tenantId = joinInvitation ? joinInvitation.tenantId : `tenant-${randomUUID()}`;

    const passwordHash = await hashPassword(password);

    await db.createUser({ id: userId, email, passwordHash, tenantId, createdAt: now });

    if (!joinInvitation) {
      await db.createTenant({
        id: tenantId,
        name: workspaceName,
        plan: 'starter',
        createdAt: now,
        settings: DEFAULT_TENANT_SETTINGS,
      });
      // Owner membership for the creator (Phase 5 contract).
      await upsertMembership({
        id: `mem-${randomUUID()}`,
        userId,
        tenantId,
        role: 'owner',
        status: 'active',
        createdAt: now,
      });

      try {
        await seedNewTenant(tenantId, workspaceName);
      } catch (seedErr) {
        // Non-fatal: tenant row exists; later calls auto-seed default data on first read.
        console.warn('[auth/register] seedNewTenant failed (non-fatal):', (seedErr as Error)?.message);
      }
    }

    // Convert the presented invitation (and any other pending invitations
    // addressed to this email) into memberships — best-effort so a stale
    // invite can never block account creation.
    if (joinInvitation) {
      try {
        await acceptInvitation(joinInvitation.token, userId, email);
      } catch (err) {
        console.warn('[auth/register] acceptInvitation failed:', (err as Error)?.message);
      }
    }

    const token = createSessionToken();
    const expiresAt = sessionExpiryIso();
    await db.createSession({ token, userId, tenantId, expiresAt, createdAt: now });
    await db.deleteExpiredSessions().catch(() => {});

    const res = NextResponse.json(
      { tenantId, userEmail: email, joinedExistingWorkspace: Boolean(joinInvitation) },
      { status: 201 },
    );
    return setSessionCookie(res, { token });
  } catch (err) {
    return serverErrorResponse('auth/register', err);
  }
}
