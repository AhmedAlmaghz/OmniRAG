import { NextResponse } from 'next/server';
import { randomUUID, randomBytes } from 'crypto';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { db } from '@/lib/storage/db';
import { serverErrorResponse } from '@/lib/api/safeError';
import { guardPermission, type Permission } from '@/lib/auth/permissions';
import {
  upsertResourceShare,
  listSharesForResource,
  listTenantShares,
  deleteResourceShare,
  getMembership,
  getTeam,
  type ResourceShare,
  type ShareResourceType,
  type ShareGranteeType,
  type SharePermission,
} from '@/lib/services/membershipService';

export const dynamic = 'force-dynamic';

const RESOURCE_TYPES: ShareResourceType[] = ['collection', 'conversation', 'document'];

/** Sentinel grantee for the read-only public link of a resource (one per resource). */
const LINK_GRANTEE_ID = 'public-link';

function readPermissionFor(resourceType: ShareResourceType): Permission {
  if (resourceType === 'conversation') return 'conversations:read';
  if (resourceType === 'document') return 'documents:read';
  return 'collections:read';
}

function writePermissionFor(resourceType: ShareResourceType): Permission {
  if (resourceType === 'conversation') return 'conversations:write';
  if (resourceType === 'document') return 'documents:write';
  return 'collections:write';
}

/** Verifies the shared resource actually exists inside the tenant. */
async function resourceExists(tenantId: string, resourceType: ShareResourceType, resourceId: string): Promise<boolean> {
  if (resourceType === 'document') {
    return Boolean(await db.getDocumentById(resourceId, tenantId).catch(() => undefined));
  }
  if (resourceType === 'conversation') {
    return Boolean(await db.getConversationById(resourceId, tenantId).catch(() => undefined));
  }
  const collections = await db.getCollections(tenantId).catch(() => []);
  return collections.some((c) => c.id === resourceId);
}

function shareLinkUrl(linkToken: string): string {
  return `/api/v1/share/${linkToken}`;
}

async function enrichShare(share: ResourceShare) {
  let granteeLabel = '';
  if (share.granteeId === LINK_GRANTEE_ID) {
    granteeLabel = 'رابط قراءة فقط (Read-only link)';
  } else if (share.granteeType === 'user') {
    const user = await db.getUserById(share.granteeId).catch(() => undefined);
    granteeLabel = user?.email || share.granteeId;
  } else {
    const team = await getTeam(share.granteeId, share.tenantId).catch(() => null);
    granteeLabel = team?.name || share.granteeId;
  }
  return {
    ...share,
    granteeLabel,
    isLink: share.granteeId === LINK_GRANTEE_ID,
    linkUrl: share.linkToken ? shareLinkUrl(share.linkToken) : undefined,
  };
}

/**
 * Resource sharing (Phase 5).
 * GET — with ?resourceType&resourceId: the ACL of one resource (needs that
 *       resource type's read permission). Without params: workspace-wide
 *       share overview (members:read).
 * POST — actions: share | unshare | setLink. Mutating a resource's ACL needs
 *        that resource type's write permission.
 */

export const GET = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const tenantId = authCtx.tenantId;
    const resourceType = req.nextUrl.searchParams.get('resourceType') as ShareResourceType | null;
    const resourceId = req.nextUrl.searchParams.get('resourceId');

    if (resourceType && resourceId) {
      if (!RESOURCE_TYPES.includes(resourceType)) {
        return NextResponse.json({ error: 'نوع المورد غير صالح (Invalid resource type)' }, { status: 400 });
      }
      const denied = await guardPermission(authCtx, readPermissionFor(resourceType));
      if (denied) return denied;
      const shares = await listSharesForResource(tenantId, resourceType, resourceId);
      return NextResponse.json({ shares: await Promise.all(shares.map(enrichShare)) });
    }

    const denied = await guardPermission(authCtx, 'members:read');
    if (denied) return denied;
    const shares = await listTenantShares(tenantId);
    return NextResponse.json({ shares: await Promise.all(shares.map(enrichShare)) });
  } catch (err) {
    return serverErrorResponse('shares GET', err);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const body = await req.json();
    const tenantId = authCtx.tenantId;
    const action = String(body.action || '');
    const resourceType = body.resourceType as ShareResourceType;

    if (action === 'share' || action === 'setLink') {
      if (!RESOURCE_TYPES.includes(resourceType)) {
        return NextResponse.json({ error: 'نوع المورد غير صالح (Invalid resource type)' }, { status: 400 });
      }
      const denied = await guardPermission(authCtx, writePermissionFor(resourceType));
      if (denied) return denied;

      const resourceId = String(body.resourceId || '');
      if (!resourceId || !(await resourceExists(tenantId, resourceType, resourceId))) {
        return NextResponse.json({ error: 'المورد غير موجود (Resource not found)' }, { status: 404 });
      }

      // Toggle the read-only public link for the resource.
      if (action === 'setLink') {
        const enable = Boolean(body.enable);
        const existing = (await listSharesForResource(tenantId, resourceType, resourceId)).find(
          (s) => s.granteeType === 'user' && s.granteeId === LINK_GRANTEE_ID,
        );

        if (!enable) {
          if (existing) await deleteResourceShare(existing.id, tenantId);
          return NextResponse.json({ success: true, enabled: false });
        }

        const regenerate = Boolean(body.regenerate) || !existing?.linkToken;
        const linkToken = regenerate ? randomBytes(24).toString('hex') : existing!.linkToken!;
        const expiresAt = typeof body.expiresAt === 'string' && body.expiresAt ? body.expiresAt : undefined;
        const share: ResourceShare = {
          id: existing?.id || `share-${randomUUID()}`,
          tenantId,
          resourceType,
          resourceId,
          granteeType: 'user',
          granteeId: LINK_GRANTEE_ID,
          permission: 'read',
          linkToken,
          sharedBy: authCtx.userId,
          expiresAt,
          createdAt: existing?.createdAt || new Date().toISOString(),
        };
        await upsertResourceShare(share);
        return NextResponse.json({
          success: true,
          enabled: true,
          linkUrl: shareLinkUrl(linkToken),
          share: await enrichShare(share),
        });
      }

      // Grant a user or team access to the resource.
      const granteeType = body.granteeType as ShareGranteeType;
      const granteeId = String(body.granteeId || '');
      const permission: SharePermission = body.permission === 'edit' ? 'edit' : 'read';
      if (granteeType !== 'user' && granteeType !== 'team') {
        return NextResponse.json({ error: 'نوع المستفيد غير صالح (Invalid grantee type)' }, { status: 400 });
      }
      if (!granteeId) {
        return NextResponse.json({ error: 'معرف المستفيد مطلوب (granteeId required)' }, { status: 400 });
      }

      if (granteeType === 'user') {
        const membership = await getMembership(tenantId, granteeId);
        if (!membership || membership.status !== 'active') {
          return NextResponse.json(
            { error: 'المستخدم ليس عضوا في مساحة العمل (User is not a workspace member)' },
            { status: 400 },
          );
        }
      } else {
        const team = await getTeam(granteeId, tenantId);
        if (!team) {
          return NextResponse.json({ error: 'الفريق غير موجود (Team not found)' }, { status: 400 });
        }
      }

      const existing = (await listSharesForResource(tenantId, resourceType, resourceId)).find(
        (s) => s.granteeType === granteeType && s.granteeId === granteeId,
      );
      const share: ResourceShare = {
        id: existing?.id || `share-${randomUUID()}`,
        tenantId,
        resourceType,
        resourceId,
        granteeType,
        granteeId,
        permission,
        linkToken: existing?.linkToken,
        sharedBy: authCtx.userId,
        expiresAt: typeof body.expiresAt === 'string' && body.expiresAt ? body.expiresAt : undefined,
        createdAt: existing?.createdAt || new Date().toISOString(),
      };
      await upsertResourceShare(share);
      await db.addAuditLog({
        id: `audit-${randomUUID()}`,
        tenantId,
        actorId: authCtx.userId,
        action: 'RESOURCE_SHARED',
        resourceType,
        resourceId,
        status: 'success',
        details: `تمت مشاركة المورد مع (${granteeType}: ${granteeId}) بصلاحية (${permission}).`,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: true, share: await enrichShare(share) });
    }

    if (action === 'unshare') {
      const shareId = String(body.shareId || '');
      if (!shareId) {
        return NextResponse.json({ error: 'معرف المشاركة مطلوب (shareId required)' }, { status: 400 });
      }
      const all = await listTenantShares(tenantId);
      const target = all.find((s) => s.id === shareId);
      if (!target) {
        return NextResponse.json({ error: 'المشاركة غير موجودة (Share not found)' }, { status: 404 });
      }
      const denied = await guardPermission(authCtx, writePermissionFor(target.resourceType));
      if (denied) return denied;
      await deleteResourceShare(shareId, tenantId);
      await db.addAuditLog({
        id: `audit-${randomUUID()}`,
        tenantId,
        actorId: authCtx.userId,
        action: 'RESOURCE_UNSHARED',
        resourceType: target.resourceType,
        resourceId: target.resourceId,
        status: 'success',
        details: `تمت إزالة مشاركة المورد عن (${target.granteeType}: ${target.granteeId}).`,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'إجراء غير معروف (Unknown action)' }, { status: 400 });
  } catch (err) {
    return serverErrorResponse('shares POST', err);
  }
});
