import type {
  IVectorStore,
  VectorSearchParams,
  VectorSearchHit,
  VectorPoint,
  VectorChunkPayload,
  VectorMetric,
} from '../types';

/**
 * In-memory vector store — brute-force cosine similarity over a Map.
 *
 * Purpose: local development without any infrastructure, and unit tests that
 * exercise the full ingestion→search loop through the real factory. NOT for
 * production: vectors die with the process and are never shared across
 * instances/replicas.
 */

interface StoredPoint {
  id: string;
  vector: number[];
  payload: VectorChunkPayload;
}

const points = new Map<string, StoredPoint>();

/** Test escape hatch — clears every stored point. */
export function resetMemoryVectorStore(): void {
  points.clear();
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const memoryVectorStore: IVectorStore = {
  id: 'memory',
  nameAr: 'الذاكرة المؤقتة (تطوير)',
  nameEn: 'In-Memory (dev)',

  // Always available — that is the point of the dev backend.
  isConfigured(): boolean {
    return true;
  },

  async ensureCollection(_dimension: number, _metric?: VectorMetric): Promise<void> {
    // Nothing to provision for a Map.
  },

  async upsertPoints(newPoints: VectorPoint[]): Promise<boolean> {
    for (const p of newPoints) {
      if (!Array.isArray(p.vector) || p.vector.length === 0) continue;
      points.set(p.id, { id: p.id, vector: p.vector, payload: { ...p.payload } });
    }
    return true;
  },

  async search(params: VectorSearchParams): Promise<VectorSearchHit[]> {
    const wanted = new Set(params.collectionIds || []);
    const hits: VectorSearchHit[] = [];
    for (const point of points.values()) {
      if (point.payload.tenantId !== params.tenantId) continue; // isolation
      if (wanted.size > 0) {
        const inCollection = (point.payload.collectionIds || []).some((c) => wanted.has(c));
        if (!inCollection) continue;
      }
      const score = cosineSimilarity(params.vector, point.vector);
      if (params.scoreThreshold !== undefined && score < params.scoreThreshold) continue;
      hits.push({
        id: point.id,
        documentId: point.payload.documentId || '',
        documentTitle: point.payload.documentTitle || '',
        content: point.payload.content || '',
        chunkIndex: point.payload.chunkIndex || 0,
        pageNumber: point.payload.pageNumber || 1,
        language: point.payload.language || 'ar',
        semanticScore: score,
      });
    }
    hits.sort((a, b) => b.semanticScore - a.semanticScore);
    return hits.slice(0, Math.max(1, params.limit));
  },

  async deleteByDocument(documentId: string, tenantId: string): Promise<void> {
    for (const [id, point] of points) {
      if (point.payload.documentId === documentId && point.payload.tenantId === tenantId) {
        points.delete(id);
      }
    }
  },

  async deletePoint(id: string): Promise<void> {
    points.delete(id);
  },

  async updateDocumentPayload(
    documentId: string,
    tenantId: string,
    updates: Partial<VectorChunkPayload>,
  ): Promise<void> {
    for (const point of points.values()) {
      if (point.payload.documentId === documentId && point.payload.tenantId === tenantId) {
        point.payload = { ...point.payload, ...updates };
      }
    }
  },
};
