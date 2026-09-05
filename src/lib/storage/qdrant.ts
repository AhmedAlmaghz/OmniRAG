import { createLogger } from '@/lib/logging/logger';

const log = createLogger('LibStorageQdrant');

import { createHash } from 'node:crypto';
import { getEnv } from '../env/runtimeEnv';
import { QdrantClient } from '@qdrant/js-client-rest';

let client: any = null;
let collectionVerified = false;
const COLLECTION_NAME = 'omnirag_chunks';

export function resetQdrantClient() {
  client = null;
  collectionVerified = false;
}

export function getQdrantClient(req?: any): any {
  if (typeof window !== 'undefined') return null; // Safe guard for client-side compilation
  if (client) return client;

  const url = getEnv('QDRANT_URL', req);
  const apiKey = getEnv('QDRANT_API_KEY', req);

  if (!url) {
    log.warn('Qdrant URL (QDRANT_URL) is missing. Qdrant semantic search will be bypassed.');
    return null;
  }

  try {
    client = new QdrantClient({
      url,
      apiKey: apiKey || undefined,
    });
    return client;
  } catch (error) {
    log.error('Failed to initialize Qdrant client:', error);
    return null;
  }
}

export async function ensureQdrantCollection() {
  if (collectionVerified) return;
  const qc = getQdrantClient();
  if (!qc) return;

  try {
    const collectionsRes = await qc.getCollections();
    const exists = collectionsRes.collections.some((c: any) => c.name === COLLECTION_NAME);

    if (!exists) {
      log.info(`Creating Qdrant collection "${COLLECTION_NAME}" with 3072-dimensional cosine similarity vectors...`);
      await qc.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 3072,
          distance: 'Cosine',
        },
      });

      // Create payload indexes for efficient filtering as described in SDLC Section 4
      await qc.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'tenantId',
        field_schema: 'keyword',
      });
      await qc.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'documentId',
        field_schema: 'keyword',
      });
      await qc.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'collectionIds',
        field_schema: 'keyword',
      });
    }
    collectionVerified = true;
    log.info(`Qdrant collection "${COLLECTION_NAME}" verified successfully.`);
  } catch (error) {
    log.error('Error ensuring Qdrant collection exists:', error);
  }
}

export async function upsertQdrantChunk(params: {
  id: string;
  vector: number[];
  payload: {
    tenantId: string;
    documentId: string;
    documentTitle: string;
    content: string;
    chunkIndex: number;
    pageNumber: number;
    language: string;
    collectionIds?: string[];
    [key: string]: any;
  };
}) {
  await upsertQdrantChunks([{ id: params.id, vector: params.vector, payload: params.payload }]);
}

/**
 * Coerces an arbitrary chunk id string into a Qdrant-compatible point id.
 * Standard UUIDs are used as-is; other strings are reduced to a deterministic
 * UUID via a SHA-1-derived 16-byte value (UUID v5-style). This replaces the
 * previous 32-bit Java-string hashCode fallback, which was collision-prone:
 * distinct chunk ids could hash to the same point id, silently overwriting one
 * tenant's vector with another's and mis-targeting deletions. SHA-1 gives ~60
 * bits of practical collision resistance — astronomically better than 32 bits
 * — and is deterministic so re-upserting the same chunk id yields the same
 * point id (idempotent writes).
 *
 * Exported so the delete path and unit tests can assert they derive the SAME
 * point id for a given chunk id (the exact invariant the old code violated).
 */
export function toQdrantPointId(rawId: string): string {
  if (/^[0-9a-f]{8}-[-0-9a-f]{4}-[-0-9a-f]{4}-[-0-9a-f]{4}-[-0-9a-f]{12}$/i.test(rawId)) {
    return rawId;
  }
  // Preserve hex-only ids long enough to form a UUID without altering them.
  const cleaned = rawId.replace(/[^a-f0-9]/gi, '');
  if (cleaned.length >= 32) {
    return `${cleaned.slice(0, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12, 16)}-${cleaned.slice(16, 20)}-${cleaned.slice(20, 32)}`;
  }
  // Deterministic UUID v5-style derivation: SHA-1(name) → version/variant bits
  // → 8-4-4-4-12 hex. Collision-safe across realistic chunk-id cardinalities.
  const digest = createHash('sha1').update(rawId).digest();
  digest[6] = (digest[6] & 0x0f) | 0x50; // version 5
  digest[8] = (digest[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Upserts many chunk points to Qdrant in a SINGLE request. The per-chunk
 * `upsertQdrantChunk` path issued one round-trip per point, so ingesting 50
 * chunks meant 50 sequential Qdrant writes. This batches them into one
 * multi-point upsert, the intended Qdrant bulk-write shape.
 *
 * Returns `true` only when the upsert actually reached Qdrant and succeeded.
 * Callers use this to flip document status to `failed` instead of silently
 * reporting success while zero vectors were stored.
 */
export async function upsertQdrantChunks(
  points: Array<{
    id: string;
    vector: number[];
    payload: {
      tenantId: string;
      documentId: string;
      documentTitle: string;
      content: string;
      chunkIndex: number;
      pageNumber: number;
      language: string;
      collectionIds?: string[];
      [key: string]: any;
    };
  }>,
): Promise<boolean> {
  if (points.length === 0) return true;
  await ensureQdrantCollection();
  const qc = getQdrantClient();
  if (!qc) return false;

  try {
    await qc.upsert(COLLECTION_NAME, {
      wait: true,
      points: points.map((p) => ({ id: toQdrantPointId(p.id), vector: p.vector, payload: p.payload })),
    });
    return true;
  } catch (error) {
    log.error(`Failed to upsert ${points.length} point(s) into Qdrant:`, error);
    return false;
  }
}

/**
 * Deletes a single chunk point by its chunk id.
 *
 * IMPORTANT: this MUST derive the point id with the exact same
 * `toQdrantPointId` used by `upsertQdrantChunks`. The previous implementation
 * re-derived ids with the legacy 32-bit Java-string hashCode, which mapped
 * chunk ids to DIFFERENT point ids than the upsert path created — so deletes
 * silently targeted points that never existed and vectors leaked forever.
 */
export async function deleteQdrantChunk(id: string) {
  await ensureQdrantCollection();
  const qc = getQdrantClient();
  if (!qc) return;

  try {
    await qc.delete(COLLECTION_NAME, {
      points: [toQdrantPointId(id)],
    });
  } catch (error) {
    log.error(`Failed to delete point ${id} from Qdrant:`, error);
  }
}

export async function updateQdrantDocumentPayload(
  documentId: string,
  tenantId: string,
  payloadUpdates: Record<string, any>,
) {
  await ensureQdrantCollection();
  const qc = getQdrantClient();
  if (!qc) return;

  try {
    await qc.setPayload(COLLECTION_NAME, {
      payload: payloadUpdates,
      filter: {
        must: [
          { key: 'tenantId', match: { value: tenantId } },
          { key: 'documentId', match: { value: documentId } },
        ],
      },
    });
  } catch (error) {
    log.error(`Failed to update payload for document ${documentId} in Qdrant:`, error);
  }
}

export async function deleteQdrantDocument(documentId: string, tenantId: string) {
  await ensureQdrantCollection();
  const qc = getQdrantClient();
  if (!qc) return;

  try {
    // Delete by payload filter
    await qc.delete(COLLECTION_NAME, {
      filter: {
        must: [
          { key: 'tenantId', match: { value: tenantId } },
          { key: 'documentId', match: { value: documentId } },
        ],
      },
    });
  } catch (error) {
    log.error(`Failed to delete points for document ${documentId} from Qdrant:`, error);
  }
}

export async function searchQdrantSemantic(params: {
  vector: number[];
  tenantId: string;
  collectionIds?: string[];
  limit: number;
  scoreThreshold?: number;
}): Promise<
  Array<{
    id: string;
    documentId: string;
    documentTitle: string;
    content: string;
    chunkIndex: number;
    pageNumber: number;
    language: string;
    semanticScore: number;
  }>
> {
  await ensureQdrantCollection();
  const qc = getQdrantClient();
  if (!qc) return [];

  try {
    // Mandatory isolation filter + optional collectionIds filters
    const filterConditions: any[] = [{ key: 'tenantId', match: { value: params.tenantId } }];

    if (params.collectionIds && params.collectionIds.length > 0) {
      filterConditions.push({
        key: 'collectionIds',
        match: { any: params.collectionIds },
      });
    }

    let results: any[] = [];

    if (typeof qc.query === 'function') {
      const qRes = await qc.query(COLLECTION_NAME, {
        query: params.vector,
        filter: {
          must: filterConditions,
        },
        limit: params.limit,
        score_threshold: params.scoreThreshold,
        with_payload: true,
      });
      results = Array.isArray(qRes) ? qRes : qRes?.points || [];
    } else if (typeof (qc as any).search === 'function') {
      const sRes = await (qc as any).search(COLLECTION_NAME, {
        vector: params.vector,
        filter: {
          must: filterConditions,
        },
        limit: params.limit,
        score_threshold: params.scoreThreshold,
        with_payload: true,
      });
      results = Array.isArray(sRes) ? sRes : sRes?.points || [];
    }

    return results.map((r: any) => {
      const payload = (r.payload || {}) as any;
      return {
        id: String(r.id),
        documentId: payload.documentId || '',
        documentTitle: payload.documentTitle || '',
        content: payload.content || '',
        chunkIndex: payload.chunkIndex || 0,
        pageNumber: payload.pageNumber || 1,
        language: payload.language || 'ar',
        semanticScore: r.score,
      };
    });
  } catch (error) {
    log.error('Qdrant semantic search failed:', error);
    return [];
  }
}
