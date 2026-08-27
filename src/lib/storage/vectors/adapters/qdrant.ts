import { getEnv } from '../../../env/runtimeEnv';
import {
  ensureQdrantCollection,
  upsertQdrantChunks,
  searchQdrantSemantic,
  deleteQdrantDocument,
  deleteQdrantChunk,
  updateQdrantDocumentPayload,
} from '../../qdrant';
import type {
  IVectorStore,
  VectorSearchParams,
  VectorSearchHit,
  VectorPoint,
  VectorChunkPayload,
  VectorMetric,
} from '../types';

/**
 * Qdrant adapter — wraps the battle-tested driver in src/lib/storage/qdrant.ts
 * (batched upserts, SHA-1-derived deterministic point ids, mandatory tenant
 * filter, payload indexes). The platform currently fixes the collection at
 * 3072 dimensions (see embedding.ts normalizeToPlatformDim), so the dimension
 * argument is accepted for interface parity but the shared collection is used.
 */
export const qdrantVectorStore: IVectorStore = {
  id: 'qdrant',
  nameAr: 'كيودرانت (Qdrant)',
  nameEn: 'Qdrant',

  isConfigured(): boolean {
    return Boolean(getEnv('QDRANT_URL'));
  },

  async ensureCollection(_dimension: number, _metric?: VectorMetric): Promise<void> {
    await ensureQdrantCollection();
  },

  async upsertPoints(points: VectorPoint[]): Promise<boolean> {
    if (points.length === 0) return true;
    return upsertQdrantChunks(
      points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload as VectorChunkPayload & Record<string, any>,
      })),
    );
  },

  async search(params: VectorSearchParams): Promise<VectorSearchHit[]> {
    return searchQdrantSemantic({
      vector: params.vector,
      tenantId: params.tenantId,
      collectionIds: params.collectionIds,
      limit: params.limit,
      scoreThreshold: params.scoreThreshold,
    });
  },

  async deleteByDocument(documentId: string, tenantId: string): Promise<void> {
    await deleteQdrantDocument(documentId, tenantId);
  },

  async deletePoint(id: string): Promise<void> {
    await deleteQdrantChunk(id);
  },

  async updateDocumentPayload(
    documentId: string,
    tenantId: string,
    updates: Partial<VectorChunkPayload>,
  ): Promise<void> {
    await updateQdrantDocumentPayload(documentId, tenantId, updates as Record<string, any>);
  },
};
