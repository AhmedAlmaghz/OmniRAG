import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { serverErrorResponse } from '@/lib/api/safeError';
import { updateTenantConfig } from '@/lib/services/tenantConfigService';
import {
  toPipelineTemplateCatalog,
  getPipelineTemplate,
  resolveTenantPipeline,
  DEFAULT_PIPELINE_TEMPLATE_ID,
} from '@/lib/services/extraction/pipelineTemplates';

export const dynamic = 'force-dynamic';

/**
 * Ingestion pipeline templates (Phase 3).
 *
 * GET  — the fast/balanced/accurate template catalog plus the tenant's current
 *        effective selection.
 * POST — persists { pipelineTemplateId } into tenant settings. Unknown ids are
 *        rejected (400) so a typo can't silently fall back to the default.
 */

export const GET = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const gate = await requirePermission(authCtx, 'settings:read');
    if (!gate.allowed) {
      return NextResponse.json({ error: 'غير مصرح (Forbidden)', code: '403_FORBIDDEN' }, { status: 403 });
    }

    const resolved = await resolveTenantPipeline(authCtx.tenantId);
    return NextResponse.json({
      success: true,
      templates: toPipelineTemplateCatalog(),
      defaultTemplateId: DEFAULT_PIPELINE_TEMPLATE_ID,
      selection: resolved,
    });
  } catch (error: any) {
    return serverErrorResponse('pipeline-templates GET', error);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const gate = await requirePermission(authCtx, 'settings:write');
    if (!gate.allowed) {
      return NextResponse.json({ error: 'غير مصرح (Forbidden)', code: '403_FORBIDDEN' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const requested = body?.pipelineTemplateId;
    if (requested === undefined) {
      return NextResponse.json({ error: 'لا يوجد قالب مطلوب', code: '400_BAD_REQUEST' }, { status: 400 });
    }

    const template = getPipelineTemplate(String(requested));
    if (!template) {
      return NextResponse.json(
        { error: `قالب خط أنابيب غير معروف: ${requested}`, code: '400_BAD_REQUEST' },
        { status: 400 },
      );
    }

    const saved = await updateTenantConfig(authCtx.tenantId, { pipelineTemplateId: template.id });
    if (!saved) {
      return NextResponse.json(
        { error: 'تعذر حفظ قالب خط الأنابيب (المستأجر غير موجود؟)', code: '500_SERVER_ERROR' },
        { status: 500 },
      );
    }

    const resolved = await resolveTenantPipeline(authCtx.tenantId);
    return NextResponse.json({
      success: true,
      message: 'تم حفظ قالب خط الأنابيب بنجاح.',
      selection: resolved,
    });
  } catch (error: any) {
    return serverErrorResponse('pipeline-templates POST', error);
  }
});
