import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { db } from '@/lib/storage/db';
import { serverErrorResponse } from '@/lib/api/safeError';
import { guardPermission, requirePermission } from '@/lib/auth/permissions';
import {
  PLANS,
  PLAN_IDS,
  getTenantPlan,
  getTenantPlanId,
  getTenantUsage,
  normalizePlanId,
  canSwitchPlan,
} from '@/lib/services/planService';
import type { PlanId } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

/**
 * Subscription plan (Phase 7).
 * GET — current plan, live usage per quota, the plan catalog, and whether the
 *       caller may switch plans (settings:read).
 * PUT — switch the workspace plan (billing:manage — owner only). Applies
 *       immediately; quota enforcement reads the plan on every create.
 */

export const GET = withAuthAndRateLimit(async (_req, authCtx) => {
  try {
    const denied = await guardPermission(authCtx, 'settings:read');
    if (denied) return denied;

    const plan = await getTenantPlan(authCtx.tenantId);
    const usage = await getTenantUsage(authCtx.tenantId);
    const manageCheck = await requirePermission(authCtx, 'billing:manage');

    return NextResponse.json({
      success: true,
      plan,
      usage,
      canManage: manageCheck.allowed,
      availablePlans: PLAN_IDS.map((id) => PLANS[id]),
    });
  } catch (error: any) {
    return serverErrorResponse('plan GET', error);
  }
});

export const PUT = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const denied = await guardPermission(authCtx, 'billing:manage');
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const requested = typeof body?.plan === 'string' ? body.plan : '';
    if (!PLAN_IDS.includes(requested as PlanId)) {
      return NextResponse.json(
        {
          error: `خطة غير معروفة — المسموح: ${PLAN_IDS.join(', ')} (Unknown plan id)`,
          code: '400_BAD_PLAN',
        },
        { status: 400 },
      );
    }
    const planId = normalizePlanId(requested);

    // Free-tier lock: without a billing provider, self-serve upgrades would
    // grant unlimited (enterprise) quotas for free. Upgrades require the
    // operator's PLAN_SELF_SERVE=true opt-in; downgrades always pass.
    const currentPlan = await getTenantPlanId(authCtx.tenantId);
    const switchCheck = canSwitchPlan(currentPlan, planId);
    if (!switchCheck.allowed) {
      return NextResponse.json(
        {
          error:
            'ترقية الخطة تتطلب تفعيلًا من الإدارة. يُسمح بتخفيض الخطة فقط عبر الخدمة الذاتية (Plan upgrade requires operator approval; only downgrades are self-serve).',
          code: '403_PLAN_UPGRADE_LOCKED',
        },
        { status: 403 },
      );
    }

    const tenant = await db.updateTenantPlan(authCtx.tenantId, planId);
    if (!tenant) {
      return NextResponse.json(
        { error: 'مساحة العمل غير موجودة (Tenant not found)', code: '404_NOT_FOUND' },
        { status: 404 },
      );
    }

    await db.addAuditLog({
      id: `audit-${randomUUID()}`,
      tenantId: authCtx.tenantId,
      actorId: authCtx.userId,
      action: 'PLAN_CHANGED',
      resourceType: 'tenant',
      resourceId: authCtx.tenantId,
      status: 'success',
      details: `تم تغيير خطة الاشتراك إلى (${planId}).`,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      plan: PLANS[planId],
      usage: await getTenantUsage(authCtx.tenantId),
    });
  } catch (error: any) {
    return serverErrorResponse('plan PUT', error);
  }
});
