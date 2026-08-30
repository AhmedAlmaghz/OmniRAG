import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse, after } from 'next/server';
import { db } from '@/lib/storage/db';
import { getEnv } from '@/lib/env/runtimeEnv';
import { guardPermission } from '@/lib/auth/permissions';
import { dispatchWebhookEvent } from '@/lib/services/webhookService';
import { parseModelConfigFromRequest } from '@/lib/config/aiModels';
import { runWithModelConfig } from '@/lib/config/aiModelsServer';

// The background sync keeps running after the response is sent (Next `after`).
// On serverless hosts this budget covers the whole invocation, including the
// post-response work; generous because OCR/transcription can take minutes.
export const maxDuration = 300;

export const POST = withAuthAndRateLimit(async (req, authCtx, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await guardPermission(authCtx, 'sources:write');
  if (denied) return denied;

  const { id } = await params;
  const tenantId = authCtx.tenantId;

  // Load dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  // Bind the client's configured models BEFORE scheduling the background sync:
  // the sync pipeline runs inside `after()` — outside any request context — so
  // OCR (ocrModel), transcription (whisperModel) and embedding (embeddingModel)
  // must resolve from THIS request's config, captured here and re-bound below.
  const modelConfig = parseModelConfigFromRequest(req);

  const source = await db.getSourceById(id, tenantId);
  if (!source) {
    return NextResponse.json({ error: 'Source connector not found' }, { status: 404 });
  }

  // Syncs can download remote files and run OCR/transcription/embedding
  // pipelines that take MINUTES on large or scanned files. Blocking the HTTP
  // request that long makes gateways/proxies time out and answer with HTML
  // error pages (surfaced in the UI as "Non-JSON response from server").
  // So: mark the connector as syncing, respond immediately, and run the real
  // sync after the response — the UI follows progress via source status and
  // sync logs.
  await db.updateSource(id, { status: 'syncing' }, tenantId);

  after(async () => {
    // Re-bind the captured config: AsyncLocalStorage does not propagate into
    // the post-response callback, so without this the background pipeline
    // would silently fall back to DEFAULT_AI_MODELS.
    await runWithModelConfig(modelConfig, async () => {
      try {
        await db.syncSource(id, tenantId);
        // Outbound webhook (Phase 6) — sync finished successfully. Best-effort:
        // dispatch never throws and must not affect the sync outcome.
        const synced = await db.getSourceById(id, tenantId).catch(() => null);
        await dispatchWebhookEvent(tenantId, 'sync.completed', {
          sourceId: id,
          sourceName: synced?.name ?? null,
        });
      } catch (err) {
        console.error(`[sources/sync] Background sync failed for ${id}:`, err);
        try {
          await db.updateSource(id, { status: 'error', lastError: (err as Error)?.message || String(err) }, tenantId);
        } catch {
          /* best effort */
        }
      }
    });
  });

  return NextResponse.json({
    message: `بدأت مزامنة المصدر ${source.name} في الخلفية — تابع حالة الموصل وسجل المزامنة`,
    started: true,
    source: await db.getSourceById(id, tenantId),
  });
});
