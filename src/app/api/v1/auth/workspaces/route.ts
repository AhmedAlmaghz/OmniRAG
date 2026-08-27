import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { db } from '@/lib/storage/db';
import { serverErrorResponse } from '@/lib/api/safeError';
import { setSessionCookie, getSessionTokenFromRequest } from '@/lib/auth/session';
import { createSessionToken, sessionExpiryIso } from '@/lib/auth/sessionInfo';
import { listUserMemberships, resolveMembershipRole } from '@/lib/services/membershipService';

export const dynamic = 'force-dynamic';

/**
 * Multi-workspace membership for the signed-in user (Phase 5).
 * GET  — every workspace the user belongs to (role + name), with the current
 *        session's tenant flagged. Legacy tenants (created before the
 *        memberships table) are backfilled transparently by
 *        resolveMembershipRole, so older deployments list their workspace too.
 * POST — switch the session to another workspace the user is a member of.
 *        Issues a NEW session row bound to the target tenant and rotates the
 *        cookie; the previous session row is revoked.
 */

export const GET = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    // Trigger lazy backfill for a legacy home tenant (users.tenant_id) so it
    // appears as a real membership row.
    const user = await db.getUserById(authCtx.userId).catch(() => undefined);
    if (user?.tenantId) {
      await resolveMembershipRole(user.tenantId, authCtx.userId).catch(() => {});
    }

    const memberships = await listUserMemberships(authCtx.userId);
    const workspaces = await Promise.all(
      memberships
        .filter((m) => m.status === 'active')
        .map(async (m) => {
          const tenant = await db.getTenant(m.tenantId).catch(() => undefined);
          return {
            tenantId: m.tenantId,
            name: tenant?.name || m.tenantId,
            role: m.role,
            joinedAt: m.createdAt,
            isCurrent: m.tenantId === authCtx.tenantId,
          };
        }),
    );
    return NextResponse.json({ workspaces });
  } catch (err) {
    return serverErrorResponse('workspaces GET', err);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    // Switching is a browser-session concept; API keys are bound to one tenant.
    if (authCtx.authMethod !== 'session') {
      return NextResponse.json(
        { error: 'تبديل مساحة العمل غير مدعوم لمفاتيح API (Switching is not supported for API keys)' },
        { status: 400 },
      );
    }

    const body = await req.json();
    const targetTenantId = String(body.tenantId || '').trim();
    if (!targetTenantId) {
      return NextResponse.json({ error: 'معرف مساحة العمل مطلوب (tenantId required)' }, { status: 400 });
    }

    const role = await resolveMembershipRole(targetTenantId, authCtx.userId);
    if (!role) {
      return NextResponse.json(
        { error: 'أنت غير عضو في مساحة العمل هذه (Not a member of this workspace)', code: '403_FORBIDDEN' },
        { status: 403 },
      );
    }

    const tenant = await db.getTenant(targetTenantId).catch(() => undefined);
    if (!tenant) {
      return NextResponse.json({ error: 'مساحة العمل غير موجودة (Workspace not found)' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const token = createSessionToken();
    await db.createSession({
      token,
      userId: authCtx.userId,
      tenantId: targetTenantId,
      expiresAt: sessionExpiryIso(),
      createdAt: now,
    });

    // Revoke the session being replaced (its cookie is overwritten anyway).
    const oldToken = getSessionTokenFromRequest(req);
    if (oldToken) await db.deleteSession(oldToken).catch(() => {});

    await db.addAuditLog({
      id: `audit-${randomUUID()}`,
      tenantId: targetTenantId,
      actorId: authCtx.userId,
      action: 'WORKSPACE_SWITCHED',
      resourceType: 'session',
      resourceId: targetTenantId,
      status: 'success',
      details: `تم تبديل الجلسة إلى مساحة العمل (${tenant.name}).`,
      timestamp: now,
    });

    const res = NextResponse.json({ success: true, tenantId: targetTenantId, role });
    return setSessionCookie(res, { token });
  } catch (err) {
    return serverErrorResponse('workspaces POST', err);
  }
});
