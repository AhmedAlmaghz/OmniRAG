import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { serverErrorResponse } from '@/lib/api/safeError';
import { updateTenantConfig, getTenantConfig } from '@/lib/services/tenantConfigService';
import {
  toVectorStoreCatalog,
  getVectorStoreById,
  getVectorStoreSelection,
  clearVectorStoreSelectionCache,
} from '@/lib/storage/vectors/registry';
import {
  toObjectStoreCatalog,
  getObjectStoreById,
  getObjectStoreSelection,
  clearObjectStoreSelectionCache,
} from '@/lib/storage/objects/registry';

export const dynamic = 'force-dynamic';

/**
 * Storage backend selection (Phase 2).
 *
 * GET  — catalog of vector + object backends with live configured status and
 *        the tenant's current effective selection.
 * POST — persists { vectorStoreId?, objectStoreId? } into tenant settings.
 *        Unknown ids are rejected (400) so a typo can't silently fall back.
 */

export const GET = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const gate = await requirePermission(authCtx, 'settings:read');
    if (!gate.allowed) {
      return NextResponse.json({ error: 'غير مصرح (Forbidden)', code: '403_FORBIDDEN' }, { status: 403 });
    }

    const config = await getTenantConfig(authCtx.tenantId);
    const vectorSelection = await getVectorStoreSelection(authCtx.tenantId);
    const objectSelection = await getObjectStoreSelection(authCtx.tenantId);

    return NextResponse.json({
      success: true,
      vectorStores: toVectorStoreCatalog().map((s) => ({
        ...s,
        configured: getVectorStoreById(s.id)?.isConfigured() ?? false,
      })),
      objectStores: toObjectStoreCatalog().map((s) => ({
        ...s,
        configured: getObjectStoreById(s.id)?.isConfigured() ?? false,
      })),
      selection: {
        vectorStoreId: vectorSelection.store.id,
        vectorStoreExplicit: vectorSelection.explicit,
        objectStoreId: objectSelection.store.id,
        objectStoreExplicit: objectSelection.explicit,
        savedVectorStoreId: config.vectorStoreId || null,
        savedObjectStoreId: config.objectStoreId || null,
      },
    });
  } catch (error: any) {
    return serverErrorResponse('storage GET', error);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const gate = await requirePermission(authCtx, 'settings:write');
    if (!gate.allowed) {
      return NextResponse.json({ error: 'غير مصرح (Forbidden)', code: '403_FORBIDDEN' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const updates: { vectorStoreId?: string; objectStoreId?: string } = {};

    if (body?.vectorStoreId !== undefined) {
      const store = getVectorStoreById(String(body.vectorStoreId));
      if (!store) {
        return NextResponse.json(
          { error: `مخزن متجهات غير معروف: ${body.vectorStoreId}`, code: '400_BAD_REQUEST' },
          { status: 400 },
        );
      }
      updates.vectorStoreId = store.id;
    }
    if (body?.objectStoreId !== undefined) {
      const store = getObjectStoreById(String(body.objectStoreId));
      if (!store) {
        return NextResponse.json(
          { error: `مخزن كائنات غير معروف: ${body.objectStoreId}`, code: '400_BAD_REQUEST' },
          { status: 400 },
        );
      }
      updates.objectStoreId = store.id;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'لا يوجد تحديث مطلوب', code: '400_BAD_REQUEST' }, { status: 400 });
    }

    const saved = await updateTenantConfig(authCtx.tenantId, updates);
    if (!saved) {
      return NextResponse.json(
        { error: 'تعذر حفظ إعدادات التخزين (المستأجر غير موجود؟)', code: '500_SERVER_ERROR' },
        { status: 500 },
      );
    }
    clearVectorStoreSelectionCache();
    clearObjectStoreSelectionCache();

    return NextResponse.json({
      success: true,
      message: 'تم حفظ خلفيات التخزين بنجاح.',
      selection: {
        vectorStoreId: saved.vectorStoreId || null,
        objectStoreId: saved.objectStoreId || null,
      },
    });
  } catch (error: any) {
    return serverErrorResponse('storage POST', error);
  }
});
