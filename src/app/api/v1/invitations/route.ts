import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { db } from '@/lib/storage/db';
import { serverErrorResponse } from '@/lib/api/safeError';
import {
  acceptInvitation,
  getInvitationByToken,
  listPendingInvitationsByEmail,
  updateInvitationStatus,
} from '@/lib/services/membershipService';
import { guardQuota } from '@/lib/services/planService';

export const dynamic = 'force-dynamic';

/**
 * Workspace invitations from the INVITEE's perspective (Phase 5).
 * GET  — pending invitations addressed to the caller's email, across all
 *        workspaces (the "inbox" shown after login).
 * POST — actions: accept {token} | decline {token}.
 *
 * These endpoints are about the caller's own identity, not tenant resources,
 * so no RBAC permission gate applies — any authenticated user may see and
 * act on invitations addressed to their email.
 */

export const GET = withAuthAndRateLimit(async (_req, authCtx) => {
  try {
    const user = await db.getUserById(authCtx.userId);
    if (!user?.email) {
      return NextResponse.json({ invitations: [] });
    }

    const invitations = await listPendingInvitationsByEmail(user.email);
    // Enrich with workspace + inviter names so the UI can render context.
    const enriched = await Promise.all(
      invitations.map(async (inv) => {
        const tenant = await db.getTenant(inv.tenantId).catch(() => undefined);
        const inviter = inv.invitedBy ? await db.getUserById(inv.invitedBy).catch(() => undefined) : undefined;
        return {
          id: inv.id,
          tenantId: inv.tenantId,
          workspaceName: tenant?.name || '',
          role: inv.role,
          token: inv.token,
          invitedBy: inviter?.email || '',
          expiresAt: inv.expiresAt,
          createdAt: inv.createdAt,
        };
      }),
    );
    return NextResponse.json({ invitations: enriched });
  } catch (err) {
    return serverErrorResponse('invitations GET', err);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const body = await req.json();
    const action = String(body.action || '');
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
      return NextResponse.json({ error: 'رمز الدعوة مطلوب (Invitation token required)' }, { status: 400 });
    }

    const user = await db.getUserById(authCtx.userId);
    if (!user?.email) {
      return NextResponse.json({ error: 'تعذّر تحديد بريد الحساب (Could not resolve account email)' }, { status: 400 });
    }

    if (action === 'accept') {
      // Plan quota (Phase 7): the target workspace's member ceiling still
      // applies at accept time (the plan may have downgraded since invite).
      const invitation = await getInvitationByToken(token);
      if (invitation) {
        const quotaDenied = await guardQuota(invitation.tenantId, 'maxMembers');
        if (quotaDenied) return quotaDenied;
      }
      try {
        const membership = await acceptInvitation(token, authCtx.userId, user.email);
        const tenant = await db.getTenant(membership.tenantId).catch(() => undefined);
        await db.addAuditLog({
          id: `audit-${randomUUID()}`,
          tenantId: membership.tenantId,
          actorId: authCtx.userId,
          action: 'INVITATION_ACCEPTED',
          resourceType: 'invitation',
          resourceId: membership.id,
          status: 'success',
          details: `انضم العضو (${user.email}) إلى مساحة العمل بدور (${membership.role}).`,
          timestamp: new Date().toISOString(),
        });
        return NextResponse.json({
          success: true,
          membership,
          tenant: { id: membership.tenantId, name: tenant?.name || '' },
        });
      } catch (acceptErr) {
        // Readable validation errors from acceptInvitation (bad token, email
        // mismatch, expired) — surface the message, not a 500.
        return NextResponse.json({ error: (acceptErr as Error).message }, { status: 400 });
      }
    }

    if (action === 'decline') {
      const inv = await getInvitationByToken(token);
      if (!inv) {
        return NextResponse.json({ error: 'الدعوة غير موجودة أو تم حذفها (Invitation not found)' }, { status: 404 });
      }
      if (inv.email !== user.email.trim().toLowerCase()) {
        return NextResponse.json(
          { error: 'هذه الدعوة موجهة لبريد إلكتروني آخر (Invitation was issued to a different email)' },
          { status: 403 },
        );
      }
      await updateInvitationStatus(inv.id, 'revoked');
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'إجراء غير معروف (Unknown action)' }, { status: 400 });
  } catch (err) {
    return serverErrorResponse('invitations POST', err);
  }
});
