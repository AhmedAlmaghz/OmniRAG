import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { db } from '@/lib/storage/db';
import { serverErrorResponse } from '@/lib/api/safeError';
import { guardPermission } from '@/lib/auth/permissions';
import { guardQuota } from '@/lib/services/planService';
import {
  createTeam,
  listTenantTeams,
  getTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  listTeamMembers,
  getMembership,
  type Team,
} from '@/lib/services/membershipService';

export const dynamic = 'force-dynamic';

/**
 * Teams management (Phase 5).
 * GET  — list the workspace's teams with their members (members:read).
 * POST — actions: create | rename | delete | addMember | removeMember
 *        (members:manage). Team membership requires an active workspace
 *        membership — a team is a grouping of members, never a grant by itself.
 */

export const GET = withAuthAndRateLimit(async (_req, authCtx) => {
  try {
    const denied = await guardPermission(authCtx, 'members:read');
    if (denied) return denied;

    const teams = await listTenantTeams(authCtx.tenantId);
    const enriched = await Promise.all(
      teams.map(async (team) => {
        const members = await listTeamMembers(team.id);
        const membersWithEmail = await Promise.all(
          members.map(async (tm) => {
            const user = await db.getUserById(tm.userId).catch(() => undefined);
            return {
              userId: tm.userId,
              email: user?.email || '',
              addedBy: tm.addedBy,
              createdAt: tm.createdAt,
            };
          }),
        );
        return { ...team, members: membersWithEmail };
      }),
    );
    return NextResponse.json({ teams: enriched });
  } catch (err) {
    return serverErrorResponse('teams GET', err);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const denied = await guardPermission(authCtx, 'members:manage');
    if (denied) return denied;

    const body = await req.json();
    const tenantId = authCtx.tenantId;
    const action = String(body.action || '');

    if (action === 'create') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 100) {
        return NextResponse.json({ error: 'اسم الفريق مطلوب (Team name required)' }, { status: 400 });
      }
      // Plan quota (Phase 7): team ceiling for the workspace's plan.
      const quotaDenied = await guardQuota(tenantId, 'maxTeams');
      if (quotaDenied) return quotaDenied;
      const team: Team = {
        id: `team-${randomUUID()}`,
        tenantId,
        name,
        description: typeof body.description === 'string' ? body.description.trim() : undefined,
        createdAt: new Date().toISOString(),
      };
      await createTeam(team);
      await db.addAuditLog({
        id: `audit-${randomUUID()}`,
        tenantId,
        actorId: authCtx.userId,
        action: 'TEAM_CREATED',
        resourceType: 'team',
        resourceId: team.id,
        status: 'success',
        details: `تم إنشاء فريق (${name}).`,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: true, team });
    }

    if (action === 'rename') {
      const teamId = String(body.teamId || '');
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const team = teamId ? await getTeam(teamId, tenantId) : null;
      if (!team) return NextResponse.json({ error: 'الفريق غير موجود (Team not found)' }, { status: 404 });
      if (!name || name.length > 100) {
        return NextResponse.json({ error: 'اسم الفريق مطلوب (Team name required)' }, { status: 400 });
      }
      await createTeam({
        ...team,
        name,
        description: typeof body.description === 'string' ? body.description.trim() : team.description,
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'delete') {
      const teamId = String(body.teamId || '');
      const team = teamId ? await getTeam(teamId, tenantId) : null;
      if (!team) return NextResponse.json({ error: 'الفريق غير موجود (Team not found)' }, { status: 404 });
      await deleteTeam(teamId, tenantId);
      await db.addAuditLog({
        id: `audit-${randomUUID()}`,
        tenantId,
        actorId: authCtx.userId,
        action: 'TEAM_DELETED',
        resourceType: 'team',
        resourceId: teamId,
        status: 'success',
        details: `تم حذف فريق (${team.name}).`,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'addMember' || action === 'removeMember') {
      const teamId = String(body.teamId || '');
      const targetUserId = String(body.userId || '');
      const team = teamId ? await getTeam(teamId, tenantId) : null;
      if (!team) return NextResponse.json({ error: 'الفريق غير موجود (Team not found)' }, { status: 404 });
      if (!targetUserId) {
        return NextResponse.json({ error: 'معرف المستخدم مطلوب (userId required)' }, { status: 400 });
      }

      if (action === 'addMember') {
        // Only workspace members can join a team — teams never grant access
        // to outsiders.
        const membership = await getMembership(tenantId, targetUserId);
        if (!membership || membership.status !== 'active') {
          return NextResponse.json(
            { error: 'المستخدم ليس عضوا في مساحة العمل (User is not a workspace member)' },
            { status: 400 },
          );
        }
        await addTeamMember({
          id: `tm-${randomUUID()}`,
          teamId,
          userId: targetUserId,
          addedBy: authCtx.userId,
          createdAt: new Date().toISOString(),
        });
        return NextResponse.json({ success: true });
      }

      await removeTeamMember(teamId, targetUserId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'إجراء غير معروف (Unknown action)' }, { status: 400 });
  } catch (err) {
    return serverErrorResponse('teams POST', err);
  }
});
