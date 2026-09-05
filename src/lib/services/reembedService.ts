import { createLogger } from '@/lib/logging/logger';

const log = createLogger('LibServicesReembedService');

import { db } from '../storage/db';
import { embedBatch } from '../rag/embedding';
import { getVectorStoreForTenant } from '../storage/vectors/registry';
import { getAiModel } from '../config/aiModels';
import { embeddingProvenanceId } from '../rag/embedding';
import type { DocumentChunk } from '../types/omnirag';

/**
 * Corpus-wide re-embedding service.
 *
 * WHY THIS EXISTS: vectors from different embedding models live in
 * INCOMPARABLE spaces — a cosine similarity between a query embedded with
 * model A and a chunk embedded with model B is meaningless noise. When the
 * active embeddingModel changes (via settings), every indexed chunk must be
 * re-embedded with the new model, or semantic search silently degrades to
 * garbage while still "working".
 *
 * WHAT IT DOES: reads every chunk of the tenant (chunk grids and lexical
 * rows are untouched — same chunk ids, same text), regenerates embeddings
 * with the CURRENTLY ACTIVE model in bounded-concurrency batches, and
 * upserts the fresh vectors into the tenant's vector store. The lexical arm
 * (Postgres FTS) needs no rebuild because it indexes text, not vectors.
 *
 * Chunk batches are flushed per batch so a huge corpus re-embeds without
 * holding all vectors in memory at once.
 */

/** How many chunks per embedding batch (matches embedBatch's bounded workers). */
const REEMBED_BATCH_SIZE = 50;

export interface ReembedResult {
  total: number;
  reembedded: number;
  failed: number;
  modelUsed: string;
  durationMs: number;
  errors: string[];
}

/**
 * Re-embeds ALL of a tenant's chunks with the currently active embedding
 * model and stamps `settings.indexedEmbeddingModel` (model + pipeline
 * version) so future model/pipeline changes can detect the mismatch.
 * Callers should run this inside runWithModelConfig(...) so
 * `getAiModel('embeddingModel')` resolves the NEWLY SAVED config.
 */
export async function reembedTenantCorpus(tenantId: string, modelUsed?: string): Promise<ReembedResult> {
  const startedAt = Date.now();
  const activeModel = modelUsed || getAiModel('embeddingModel');
  // Provenance stamp = model + pipeline version (v2 = Arabic-normalized).
  // Comparing against THIS id (not the bare model) is what makes the corpus
  // self-heal after a pipeline change even when the model itself didn't.
  const provenance = embeddingProvenanceId(activeModel);

  const allChunks = await db.getChunks(tenantId);
  const result: ReembedResult = {
    total: allChunks.length,
    reembedded: 0,
    failed: 0,
    modelUsed: activeModel,
    durationMs: 0,
    errors: [],
  };

  if (allChunks.length === 0) {
    await db.updateTenantSettings(tenantId, { indexedEmbeddingModel: provenance });
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const vectorStore = await getVectorStoreForTenant(tenantId);

  // Resolve each chunk's parent-document collectionIds once (payload parity
  // with the ingestion path: the vector payload carries collectionIds).
  const collectionIdsByDoc = new Map<string, string[]>();
  const docs = await db.getDocuments(tenantId);
  for (const doc of docs) {
    collectionIdsByDoc.set(doc.id, doc.collectionIds || []);
  }

  for (let offset = 0; offset < allChunks.length; offset += REEMBED_BATCH_SIZE) {
    const batch: DocumentChunk[] = allChunks.slice(offset, offset + REEMBED_BATCH_SIZE);
    try {
      const vectors = await embedBatch(batch.map((c) => c.content));
      const points = batch.map((chunk, i) => ({
        id: chunk.id,
        vector: vectors[i],
        payload: {
          tenantId: chunk.tenantId,
          documentId: chunk.documentId,
          documentTitle: chunk.documentTitle || '',
          content: chunk.content,
          chunkIndex: chunk.chunkIndex || 0,
          pageNumber: chunk.pageNumber || 1,
          language: chunk.language || 'ar',
          collectionIds: collectionIdsByDoc.get(chunk.documentId) || [],
          ...(chunk.metadata || {}),
        },
      }));
      const ok = await vectorStore.upsertPoints(points);
      if (ok) {
        result.reembedded += batch.length;
      } else {
        result.failed += batch.length;
        result.errors.push(`فشل رفع دفعة من ${batch.length} متجه إلى مخزن المتجهات`);
      }
    } catch (err: any) {
      result.failed += batch.length;
      const msg = (err?.message || String(err)).slice(0, 200);
      result.errors.push(`فشل تضمين دفعة (${offset}..${offset + batch.length}): ${msg}`);
      log.error('[Reembed] batch failed:', msg);
    }
  }

  // Stamp the indexed-model tracking field even on partial failure: the
  // vectors that DID go up are the new model's; the tenant can re-run the
  // operation for any failed batches (errors surface in the sync log).
  await db.updateTenantSettings(tenantId, { indexedEmbeddingModel: provenance });

  result.durationMs = Date.now() - startedAt;
  return result;
}

/**
 * True when the tenant's stored vectors were built with a DIFFERENT
 * provenance (model OR embedding-pipeline version) than the currently
 * active one — i.e. the corpus needs a re-embed before semantic search
 * produces meaningful results. This is the exact condition that made
 * dev-pro "break" after the v0.12.3 default-model change: queries embedded
 * with gemini-embedding-2 were compared against text-embedding-004 vectors.
 *
 * An absent indexedEmbeddingModel (legacy tenants, e.g. everything indexed
 * under main) is treated as mismatched ONLY when the tenant actually has
 * chunks: zero-chunk tenants have nothing to re-embed.
 */
export async function isTenantEmbeddingStale(tenantId: string): Promise<boolean> {
  const tenant = await db.getTenant(tenantId);
  const indexedWith = tenant?.settings?.indexedEmbeddingModel;
  const active = embeddingProvenanceId();
  if (indexedWith === active) return false;
  // Unknown provenance + non-empty corpus → stale; unknown + empty → fine.
  if (!indexedWith) {
    const chunks = await db.getChunks(tenantId);
    return chunks.length > 0;
  }
  return true;
}

/**
 * In-flight re-embed dedup: one background self-heal per tenant at a time —
 * concurrent searches must not trigger parallel full-corpus re-embeds.
 */
const selfHealingTenants = new Set<string>();

/**
 * FIRE-AND-FORGET self-heal used by the retrieval engine: when a search
 * notices the corpus vectors are stale (wrong model/pipeline), it schedules
 * a full re-embed in the background so the very first post-upgrade search
 * already fixes the corpus instead of serving noise until the user thinks
 * of pressing a button. Never throws; failures surface in the sync log.
 */
export async function selfHealStaleCorpus(tenantId: string): Promise<void> {
  if (selfHealingTenants.has(tenantId)) return;
  selfHealingTenants.add(tenantId);
  try {
    // CONFIGURATION GUARD: never overwrite real vectors with hash-fallback
    // vectors — if the embedding provider has no key, leave the stale (but
    // real) vectors alone; the engine's staleness downgrade already keeps
    // search honest, and the manual /reembed endpoint reports the reason.
    const { isModelRefConfigured } = await import('../ai/registry/resolve');
    if (!(await isModelRefConfigured(getAiModel('embeddingModel')))) {
      log.warn(
        '[Reembed self-heal] embedding model not configured — skipping to avoid overwriting vectors with fallback hashes.',
      );
      return;
    }
    const result = await reembedTenantCorpus(tenantId);
    await db
      .addSyncLog({
        id: `log-reembed-self-${Date.now()}`,
        tenantId,
        sourceId: 'rag-engine/self-heal',
        sourceName: 'إعادة تضمين تلقائية لقاعدة المعرفة',
        status: result.failed === 0 ? 'success' : 'failed',
        itemsProcessed: result.reembedded,
        durationMs: result.durationMs,
        message:
          result.failed === 0
            ? `اكتشاف تقادم متجهات تلقائي: أعيد تضمين ${result.reembedded} مقطع بنموذج ${result.modelUsed} (pipeline v2)`
            : `إعادة التضمين التلقائية اكتملت جزئياً: نجح ${result.reembedded} وفشل ${result.failed}`,
        timestamp: new Date().toISOString(),
      })
      .catch(() => {});
  } catch (err) {
    log.error('[Reembed self-heal] failed:', (err as Error)?.message);
  } finally {
    selfHealingTenants.delete(tenantId);
  }
}
