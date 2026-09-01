import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { parseModelConfigFromRequest } from '@/lib/config/aiModels';
import { runWithModelConfig } from '@/lib/config/aiModelsServer';
import { reembedTenantCorpus, isTenantEmbeddingStale } from '@/lib/services/reembedService';
import { getEnv } from '@/lib/env/runtimeEnv';
import { guardPermission } from '@/lib/auth/permissions';
import { serverErrorResponse } from '@/lib/api/safeError';
import { db } from '@/lib/storage/db';

export const dynamic = 'force-dynamic';

// Re-embedding a large corpus is a long-running operation (hundreds of
// provider calls). Static constant per the Next.js segment-config contract;
// Vercel enforces its own ceiling on top.
export const maxDuration = 300;

/**
 * POST /api/v1/settings/models/reembed
 *
 * Manually re-embeds the ENTIRE tenant corpus with the currently active
 * embedding model. The settings save path triggers this automatically when
 * embeddingModel changes; this endpoint exists for:
 *   - recovery after a partial/failed automatic re-embed,
 *   - tenants whose vector index was restored from a different model's backup,
 *   - GET-style staleness checks via ?check=1.
 *
 * Security parity: settings:write permission required; the tenant scope is
 * always the AUTHENTICATED tenant, never a body parameter.
 */
export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const denied = await guardPermission(authCtx, 'settings:write');
    if (denied) return denied;

    getEnv('GEMINI_API_KEY', req);
    getEnv('DATABASE_URL', req);
    getEnv('POSTGRES_URL', req);
    getEnv('QDRANT_URL', req);
    getEnv('QDRANT_API_KEY', req);

    const tenantId = authCtx.tenantId;
    const modelConfig = parseModelConfigFromRequest(req);

    return await runWithModelConfig(modelConfig, async () => {
      // Read-only staleness probe: lets the UI warn before touching vectors.
      const url = new URL(req.url);
      if (url.searchParams.get('check') === '1') {
        const stale = await isTenantEmbeddingStale(tenantId);
        return NextResponse.json({ success: true, stale, activeModel: modelConfig.embeddingModel });
      }

      const result = await reembedTenantCorpus(tenantId);

      await db.addSyncLog({
        id: `log-reembed-manual-${Date.now()}`,
        tenantId,
        sourceId: 'settings/models/reembed',
        sourceName: 'إعادة تضمين يدوية لقاعدة المعرفة',
        status: result.failed === 0 ? 'success' : 'failed',
        itemsProcessed: result.reembedded,
        durationMs: result.durationMs,
        message:
          result.failed === 0
            ? `إعادة تضمين يدوية بنموذج ${result.modelUsed}: تم ${result.reembedded} مقطع من أصل ${result.total}`
            : `إعادة تضمين يدوية بنموذج ${result.modelUsed}: نجح ${result.reembedded} وفشل ${result.failed} — ${result.errors.slice(0, 3).join('؛ ')}`,
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json({
        success: result.failed === 0,
        message:
          result.failed === 0
            ? `تمت إعادة تضمين ${result.reembedded} مقطع بنموذج ${result.modelUsed} بنجاح`
            : `اكتملت إعادة التضمين مع أخطاء: نجح ${result.reembedded}، فشل ${result.failed}`,
        reembed: result,
      });
    });
  } catch (err: any) {
    return serverErrorResponse('settings/models/reembed POST', err);
  }
});
