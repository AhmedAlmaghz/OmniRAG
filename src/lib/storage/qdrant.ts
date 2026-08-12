let client: any = null;
let collectionVerified = false;
const COLLECTION_NAME = 'omnirag_chunks';

export function getQdrantClient(): any {
  if (typeof window !== 'undefined') return null; // Safe guard for client-side compilation
  if (client) return client;

  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;

  if (!url) {
    console.warn('Qdrant URL (QDRANT_URL) is missing. Qdrant semantic search will be bypassed.');
    return null;
  }

  try {
    const { QdrantClient } = require('@qdrant/js-client-rest');
    client = new QdrantClient({
      url,
      apiKey: apiKey || undefined,
    });
    return client;
  } catch (error) {
    console.error('Failed to initialize Qdrant client:', error);
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
      console.log(`Creating Qdrant collection "${COLLECTION_NAME}" with 3072-dimensional cosine similarity vectors...`);
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
    console.log(`Qdrant collection "${COLLECTION_NAME}" verified successfully.`);
  } catch (error) {
    console.error('Error ensuring Qdrant collection exists:', error);
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
  await ensureQdrantCollection();
  const qc = getQdrantClient();
  if (!qc) return;

  try {
    // Generate an integer or standard UUID hash from the string ID, Qdrant supports both string UUIDs and 64-bit integers.
    // If the string id doesn't match a standard UUID format, we can use a hash-based pseudo UUID.
    let pointId = params.id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pointId)) {
      // Create a valid pseudo-UUID by hashing the string ID
      const cleaned = pointId.replace(/[^a-f0-9]/gi, '');
      if (cleaned.length >= 32) {
        pointId = `${cleaned.slice(0, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12, 16)}-${cleaned.slice(16, 20)}-${cleaned.slice(20, 32)}`;
      } else {
        // Fallback: create a 32-char hex string
        const hash = Array.from(pointId).reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0);
        const hex = Math.abs(hash).toString(16).padStart(32, '0');
        pointId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
      }
    }

    await qc.upsert(COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: pointId,
          vector: params.vector,
          payload: params.payload,
        },
      ],
    });
  } catch (error) {
    console.error(`Failed to upsert point ${params.id} into Qdrant:`, error);
  }
}

export async function deleteQdrantChunk(id: string) {
  await ensureQdrantCollection();
  const qc = getQdrantClient();
  if (!qc) return;

  try {
    let pointId = id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pointId)) {
      const cleaned = pointId.replace(/[^a-f0-9]/gi, '');
      if (cleaned.length >= 32) {
        pointId = `${cleaned.slice(0, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12, 16)}-${cleaned.slice(16, 20)}-${cleaned.slice(20, 32)}`;
      } else {
        const hash = Array.from(pointId).reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0);
        const hex = Math.abs(hash).toString(16).padStart(32, '0');
        pointId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
      }
    }
    await qc.delete(COLLECTION_NAME, {
      points: [pointId],
    });
  } catch (error) {
    console.error(`Failed to delete point ${id} from Qdrant:`, error);
  }
}

export async function updateQdrantDocumentPayload(documentId: string, tenantId: string, payloadUpdates: Record<string, any>) {
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
    console.error(`Failed to update payload for document ${documentId} in Qdrant:`, error);
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
    console.error(`Failed to delete points for document ${documentId} from Qdrant:`, error);
  }
}

export async function searchQdrantSemantic(params: {
  vector: number[];
  tenantId: string;
  collectionIds?: string[];
  limit: number;
  scoreThreshold?: number;
}): Promise<Array<{
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  chunkIndex: number;
  pageNumber: number;
  language: string;
  semanticScore: number;
}>> {
  await ensureQdrantCollection();
  const qc = getQdrantClient();
  if (!qc) return [];

  try {
    // Mandatory isolation filter + optional collectionIds filters
    const filterConditions: any[] = [
      { key: 'tenantId', match: { value: params.tenantId } },
    ];

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
      results = Array.isArray(qRes) ? qRes : (qRes?.points || []);
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
      results = Array.isArray(sRes) ? sRes : (sRes?.points || []);
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
    console.error('Qdrant semantic search failed:', error);
    return [];
  }
}
