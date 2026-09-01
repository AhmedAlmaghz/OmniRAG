import { db } from '../storage/db';
import { embedBatch } from '../rag/embedding';
import { getVectorStoreForTenant } from '../storage/vectors/registry';
import { getAiModel } from '../config/aiModels';
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
 * model and stamps `settings.indexedEmbeddingModel` so future model changes
 * can detect the mismatch. Callers should run this inside
 * runWithModelConfig(...) so `getAiModel('embeddingModel')` resolves the
 * NEWLY SAVED config, not the previous one.
 */
export async function reembedTenantCorpus(tenantId: string, modelUsed?: string): Promise<ReembedResult> {
  const startedAt = Date.now();
  const activeModel = modelUsed || getAiModel('embeddingModel');

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
    await db.updateTenantSettings(tenantId, { indexedEmbeddingModel: activeModel });
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
      console.error('[Reembed] batch failed:', msg);
    }
  }

  // Stamp the indexed-model tracking field even on partial failure: the
  // vectors that DID go up are the new model's; the tenant can re-run the
  // operation for any failed batches (errors surface in the sync log).
  await db.updateTenantSettings(tenantId, { indexedEmbeddingModel: activeModel });

  result.durationMs = Date.now() - startedAt;
  return result;
}

/**
 * True when the tenant's stored vectors were built with a DIFFERENT model
 * than the currently active embeddingModel — i.e. the corpus needs a re-embed
 * before semantic search produces meaningful results.
 *
 * An absent indexedEmbeddingModel (legacy tenants) is treated as mismatched
 * ONLY when the tenant actually has chunks: zero-chunk tenants have nothing
 * to re-embed and are always considered consistent.
 */
export async function isTenantEmbeddingStale(tenantId: string): Promise<boolean> {
  const tenant = await db.getTenant(tenantId);
  const indexedWith = tenant?.settings?.indexedEmbeddingModel;
  const active = getAiModel('embeddingModel');
  if (indexedWith === active) return false;
  // Unknown provenance + non-empty corpus → stale; unknown + empty → fine.
  if (!indexedWith) {
    const chunks = await db.getChunks(tenantId);
    return chunks.length > 0;
  }
  return true;
}
