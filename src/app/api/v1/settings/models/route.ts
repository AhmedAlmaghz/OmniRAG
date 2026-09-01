import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_AI_MODELS,
  AIModelConfig,
  normalizeModelConfig,
  parseModelConfigFromRequest,
  MODEL_CONFIG_COOKIE,
} from '@/lib/config/aiModels';
import { runWithModelConfig } from '@/lib/config/aiModelsServer';
import { reembedTenantCorpus, type ReembedResult } from '@/lib/services/reembedService';
import { db } from '@/lib/storage/db';
import { serverErrorResponse } from '@/lib/api/safeError';
import { guardPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

/**
 * Runs the mandatory corpus re-embed when the embedding model changed.
 * Returns undefined when there is nothing to re-embed (empty corpus).
 * Wrapped in runWithModelConfig so getAiModel('embeddingModel') resolves the
 * NEW model while vectors are regenerated.
 */
async function maybeReembedOnModelChange(
  tenantId: string,
  newEmbeddingModel: string,
): Promise<ReembedResult | undefined> {
  return runWithModelConfig({ ...DEFAULT_AI_MODELS, embeddingModel: newEmbeddingModel }, async () => {
    const chunkCount = (await db.getChunks(tenantId)).length;
    if (chunkCount === 0) return undefined;
    const result = await reembedTenantCorpus(tenantId, newEmbeddingModel);
    await db.addSyncLog({
      id: `log-reembed-${Date.now()}`,
      tenantId,
      sourceId: 'settings/models',
      sourceName: 'إعادة تضمين قاعدة المعرفة',
      status: result.failed === 0 ? 'success' : 'failed',
      itemsProcessed: result.reembedded,
      durationMs: result.durationMs,
      message:
        result.failed === 0
          ? `تم تغيير نموذج التضمين إلى ${result.modelUsed} وإعادة تضمين ${result.reembedded} مقطع بنجاح`
          : `تغيير نموذج التضمين إلى ${result.modelUsed}: نجح ${result.reembedded} وفشل ${result.failed} مقطع — ${result.errors.slice(0, 3).join('؛ ')}`,
      timestamp: new Date().toISOString(),
    });
    return result;
  });
}

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    const denied = await guardPermission(authCtx, 'settings:read');
    if (denied) return denied;

    // Read the effective model config for this request: header first, then
    // the persisted cookie, finally DEFAULT_AI_MODELS. Sharing the canonical
    // resolver keeps every server path consistent.
    const config = parseModelConfigFromRequest(req);

    return NextResponse.json({
      success: true,
      config,
      defaults: DEFAULT_AI_MODELS,
      serverTime: new Date().toISOString(),
    });
  } catch (error: any) {
    return serverErrorResponse('settings/models GET', error);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    const denied = await guardPermission(authCtx, 'settings:write');
    if (denied) return denied;

    const body = await req.json();

    // Reset action: clear the persisted cookie so non-header requests fall
    // back to DEFAULT_AI_MODELS instead of a stale year-long config. The
    // client-side reset previously cleared localStorage only, leaving this
    // cookie serving outdated models to any request without the header.
    if (body?.action === 'reset') {
      // The default embedding model may differ from what the corpus was
      // indexed with — same mandatory re-embed contract as an explicit change.
      const reembedInfo = await maybeReembedOnModelChange(authCtx.tenantId, DEFAULT_AI_MODELS.embeddingModel);

      const response = NextResponse.json({
        success: true,
        message: reembedInfo
          ? `تمت إعادة الضبط للإعدادات الافتراضية وإعادة تضمين ${reembedInfo.reembedded} مقطع بنموذج ${reembedInfo.modelUsed}`
          : 'تمت إعادة ضبط إعدادات النماذج إلى الافتراضية',
        config: { ...DEFAULT_AI_MODELS },
        ...(reembedInfo ? { reembed: reembedInfo } : {}),
      });
      response.cookies.delete(MODEL_CONFIG_COOKIE);
      return response;
    }

    // normalizeModelConfig fills any missing field (defaults to DEFAULT_AI_MODELS),
    // so adding new keys (whisper/ocr/fallbackModels) needs no special handling.
    const previousConfig = parseModelConfigFromRequest(req);
    const updatedConfig: AIModelConfig = normalizeModelConfig({
      ...body,
      updatedAt: body?.updatedAt || new Date().toISOString(),
    });

    // EMBEDDING MODEL CHANGE → MANDATORY CORPUS RE-EMBED. Vectors from
    // different embedding models live in incomparable spaces: without this,
    // semantic search would compare the NEW model's query vectors against the
    // OLD model's chunk vectors and silently return noise. The re-embed runs
    // INSIDE this request's model context so the new embeddingModel is the one
    // that regenerates every vector.
    let reembed: Awaited<ReturnType<typeof maybeReembedOnModelChange>> = undefined;
    if (updatedConfig.embeddingModel !== previousConfig.embeddingModel) {
      reembed = await maybeReembedOnModelChange(authCtx.tenantId, updatedConfig.embeddingModel);
    }

    const response = NextResponse.json({
      success: true,
      message: reembed
        ? `تم حفظ الإعدادات وإعادة تضمين ${reembed.reembedded} مقطع بالنموذج الجديد (${reembed.modelUsed})`
        : 'تم حفظ إعدادات نماذج الذكاء الاصطناعي بنجاح',
      config: updatedConfig,
      ...(reembed ? { reembed } : {}),
    });

    // Attach as cookie for server-side persistence across requests.
    // parseModelConfigFromRequest reads this as a fallback when the header
    // (attached by fetchWithAuth) is absent.
    response.cookies.set(MODEL_CONFIG_COOKIE, JSON.stringify(updatedConfig), {
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      sameSite: 'lax',
    });

    return response;
  } catch (error: any) {
    return serverErrorResponse('settings/models POST', error);
  }
});
