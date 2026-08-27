import { NextRequest, NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { db } from '@/lib/storage/db';
import { serverErrorResponse } from '@/lib/api/safeError';
import { guardPermission } from '@/lib/auth/permissions';
import { ROLES, type Role } from '@/lib/auth/permissions';
import { guardQuota } from '@/lib/services/planService';
import {
  listTenantMemberships,
  upsertMembership,
  deleteMembership,
  countTenantOwners,
  getMembership,
  createInvitation,
  listTenantInvitations,
  deleteInvitation,
  findPendingInvitationByEmail,
  newInvitationToken,
  INVITATION_TTL_MS,
  type Invitation,
} from '@/lib/services/membershipService';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Workspace membership management (Phase 5).
 * GET  — list members (with emails + roles) and pending invitations.
 * POST — actions: invite | remove | changeRole | revokeInvite.
 * All mutations require members:manage (owner/admin only).
 */

export const GET = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const denied = await guardPermission(authCtx, 'members:read');
    if (denied) return denied;

    const tenantId = authCtx.tenantId;
    const memberships = await listTenantMemberships(tenantId);

    // Enrich with emails (members list is privileged — members:read gated).
    const members = await Promise.all(
      memberships.map(async (m) => {
        const user = await db.getUserById(m.userId).catch(() => undefined);
        return {
          id: m.id,
          userId: m.userId,
          email: user?.email || '',
          role: m.role,
          status: m.status,
          invitedBy: m.invitedBy,
          createdAt: m.createdAt,
          isSelf: m.userId === authCtx.userId,
        };
      }),
    );

    const invitations = await listTenantInvitations(tenantId);
    return NextResponse.json({ members, invitations });
  } catch (err) {
    return serverErrorResponse('members GET', err);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const body = await req.json();
    const tenantId = authCtx.tenantId;
    const action = String(body.action || '');

    // Action: invite a new member by email.
    if (action === 'invite') {
      const denied = await guardPermission(authCtx, 'members:manage');
      if (denied) return denied;

      // Plan quota (Phase 7): member ceiling for the workspace's plan.
      const quotaDenied = await guardQuota(tenantId, 'maxMembers');
      if (quotaDenied) return quotaDenied;

      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const role: Role = ROLES.includes(body.role) && body.role !== 'owner' ? body.role : 'viewer';
      if (!EMAIL_RE.test(email)) {
        return NextResponse.json({ error: 'البريد الإلكتروني غير صالح (Invalid email)' }, { status: 400 });
      }

      // Already a member?
      const existingUser = await db.getUserByEmail(email);
      if (existingUser) {
        const existingMembership = await getMembership(tenantId, existingUser.id);
        if (existingMembership) {
          return NextResponse.json(
            { error: 'هذا المستخدم عضو في مساحة العمل بالفعل (Already a member)' },
            { status: 409 },
          );
        }
        // Known account, not a member — add directly (no email round-trip needed).
        await upsertMembership({
          id: `mem-${randomUUID()}`,
          userId: existingUser.id,
          tenantId,
          role,
          status: 'active',
          invitedBy: authCtx.userId,
          createdAt: new Date().toISOString(),
        });
        await db.addAuditLog({
          id: `audit-${randomUUID()}`,
          tenantId,
          actorId: authCtx.userId,
          action: 'MEMBER_ADDED_DIRECT',
          resourceType: 'membership',
          resourceId: existingUser.id,
          status: 'success',
          details: `تمت إضافة العضو (${email}) مباشرة بدور (${role}).`,
          timestamp: new Date().toISOString(),
        });
        return NextResponse.json({
          success: true,
          addedDirectly: true,
          invitations: await listTenantInvitations(tenantId),
        });
      }

      const pending = await findPendingInvitationByEmail(tenantId, email);
      if (pending) {
        return NextResponse.json(
          { error: 'توجد دعوة معلقة لهذا البريد بالفعل (Pending invitation already exists)' },
          { status: 409 },
        );
      }

      const invitation: Invitation = {
        id: `inv-${randomUUID()}`,
        tenantId,
        email,
        role,
        token: newInvitationToken(),
        invitedBy: authCtx.userId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      await createInvitation(invitation);
      await db.addAuditLog({
        id: `audit-${randomUUID()}`,
        tenantId,
        actorId: authCtx.userId,
        action: 'MEMBER_INVITED',
        resourceType: 'invitation',
        resourceId: invitation.id,
        status: 'success',
        details: `تمت دعوة (${email}) للانضمام بدور (${role}).`,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: true, invitation, invitations: await listTenantInvitations(tenantId) });
    }

    // Action: change a member's role.
    if (action === 'changeRole') {
      const denied = await guardPermission(authCtx, 'members:manage');
      if (denied) return denied;

      const targetUserId = String(body.userId || '');
      const newRole: Role = ROLES.includes(body.role) ? body.role : 'viewer';
      if (!targetUserId) {
        return NextResponse.json({ error: 'معرف المستخدم مطلوب (userId required)' }, { status: 400 });
      }

      const target = await getMembership(tenantId, targetUserId);
      if (!target) {
        return NextResponse.json({ error: 'العضو غير موجود (Member not found)' }, { status: 404 });
      }

      // Last-owner protection: demoting the only owner locks everyone out.
      if (target.role === 'owner' && newRole !== 'owner') {
        const owners = await countTenantOwners(tenantId);
        if (owners <= 1) {
          return NextResponse.json(
            { error: 'لا يمكن تخفيض دور المالك الوحيد لمساحة العمل (Cannot demote the only owner)' },
            { status: 400 },
          );
        }
      }

      await upsertMembership({ ...target, role: newRole });
      await db.addAuditLog({
        id: `audit-${randomUUID()}`,
        tenantId,
        actorId: authCtx.userId,
        action: 'MEMBER_ROLE_CHANGED',
        resourceType: 'membership',
        resourceId: targetUserId,
        status: 'success',
        details: `تم تغيير دور العضو (${targetUserId}) من (${target.role}) إلى (${newRole}).`,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: true });
    }

    // Action: remove a member.
    if (action === 'remove') {
      const denied = await guardPermission(authCtx, 'members:manage');
      if (denied) return denied;

      const targetUserId = String(body.userId || '');
      if (!targetUserId) {
        return NextResponse.json({ error: 'معرف المستخدم مطلوب (userId required)' }, { status: 400 });
      }
      const target = await getMembership(tenantId, targetUserId);
      if (!target) {
        return NextResponse.json({ error: 'العضو غير موجود (Member not found)' }, { status: 404 });
      }
      if (target.role === 'owner') {
        const owners = await countTenantOwners(tenantId);
        if (owners <= 1) {
          return NextResponse.json(
            { error: 'لا يمكن إزالة المالك الوحيد لمساحة العمل (Cannot remove the only owner)' },
            { status: 400 },
          );
        }
      }

      await deleteMembership(tenantId, targetUserId);
      // Revoke the removed member's sessions for THIS tenant so access stops
      // immediately (sessions carry tenantId; other workspaces are untouched).
      await db.deleteTenantSessionsForUser?.(tenantId, targetUserId).catch(() => {});
      await db.addAuditLog({
        id: `audit-${randomUUID()}`,
        tenantId,
        actorId: authCtx.userId,
        action: 'MEMBER_REMOVED',
        resourceType: 'membership',
        resourceId: targetUserId,
        status: 'success',
        details: `تمت إزالة العضو (${targetUserId}) من مساحة العمل.`,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: true });
    }

    // Action: revoke a pending invitation.
    if (action === 'revokeInvite') {
      const denied = await guardPermission(authCtx, 'members:manage');
      if (denied) return denied;
      const invitationId = String(body.invitationId || '');
      if (invitationId) {
        await deleteInvitation(invitationId, tenantId);
        await db.addAuditLog({
          id: `audit-${randomUUID()}`,
          tenantId,
          actorId: authCtx.userId,
          action: 'INVITATION_REVOKED',
          resourceType: 'invitation',
          resourceId: invitationId,
          status: 'success',
          details: 'تم إلغاء دعوة انضمام معلقة.',
          timestamp: new Date().toISOString(),
        });
      }
      return NextResponse.json({ success: true, invitations: await listTenantInvitations(tenantId) });
    }

    return NextResponse.json({ error: 'إجراء غير معروف (Unknown action)' }, { status: 400 });
  } catch (err) {
    return serverErrorResponse('members POST', err);
  }
});
