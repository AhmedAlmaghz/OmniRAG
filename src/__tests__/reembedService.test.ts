import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Corpus re-embedding service contract tests.
 *
 * The rule these pin: changing the embedding model REQUIRES re-embedding
 * every indexed chunk — vectors from different embedding models live in
 * incomparable spaces, and mixing them turns semantic search into noise.
 * The service must (a) re-embed ALL tenant chunks with the ACTIVE model,
 * (b) batch them through the vector store, and (c) stamp
 * settings.indexedEmbeddingModel so future changes are detectable.
 */

const upsertCalls: any[][] = [];

vi.mock('../lib/storage/db', () => ({
  db: {
    getChunks: vi.fn(async (tenantId: string) => {
      if (tenantId === 'empty-tenant') return [];
      // 120 chunks — forces 3 batches at REEMBED_BATCH_SIZE=50.
      return Array.from({ length: 120 }, (_, i) => ({
        id: `chunk-doc-1-${i + 1}`,
        tenantId,
        documentId: 'doc-1',
        documentTitle: 'كتاب الرياضيات',
        content: `محتوى المقطع ${i + 1}`,
        chunkIndex: i,
        pageNumber: i + 1,
        language: 'ar',
        metadata: {},
      }));
    }),
    getDocuments: vi.fn(async () => [{ id: 'doc-1', collectionIds: ['col-1'] }]),
    updateTenantSettings: vi.fn(async (tenantId: string, settings: any) => {
      settingsCalls.push({ tenantId, settings });
      return { id: tenantId, settings };
    }),
    getTenant: vi.fn(async () => undefined),
    addSyncLog: vi.fn(async () => {}),
  },
}));

// Partial mock: embedBatch is faked (no provider calls), everything else —
// including the REAL embeddingProvenanceId and EMBEDDING_PIPELINE_VERSION —
// stays genuine so the stamp contract tracks the source of truth.
vi.mock('../lib/rag/embedding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rag/embedding')>();
  return {
    ...actual,
    embedBatch: vi.fn(async (texts: string[]) => texts.map((_, i) => [i, i, i])),
  };
});

vi.mock('../lib/storage/vectors/registry', () => ({
  getVectorStoreForTenant: vi.fn(async () => ({
    upsertPoints: vi.fn(async (points: any[]) => {
      upsertCalls.push(points);
      return true;
    }),
  })),
}));

const settingsCalls: any[] = [];

import { reembedTenantCorpus, isTenantEmbeddingStale } from '../lib/services/reembedService';

describe('reembedTenantCorpus', () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    settingsCalls.length = 0;
  });

  it('re-embeds ALL chunks in bounded batches with the ACTIVE model', async () => {
    const result = await reembedTenantCorpus('tenant-acme-01', 'gemini-embedding-2');

    expect(result.total).toBe(120);
    expect(result.reembedded).toBe(120);
    expect(result.failed).toBe(0);
    expect(result.modelUsed).toBe('gemini-embedding-2');
    // 120 chunks / batch size 50 → exactly 3 upsert waves.
    expect(upsertCalls.length).toBe(3);
    expect(upsertCalls[0].length).toBe(50);
    expect(upsertCalls[2].length).toBe(20);
    // Every wave carries the FULL payload contract (collectionIds included).
    const firstPoint = upsertCalls[0][0];
    expect(firstPoint.payload.tenantId).toBe('tenant-acme-01');
    expect(firstPoint.payload.collectionIds).toEqual(['col-1']);
    expect(firstPoint.payload.content).toContain('محتوى المقطع');
  });

  it('stamps settings.indexedEmbeddingModel with the model + pipeline provenance', async () => {
    // The stamp is model#vN — the pipeline version is what makes a corpus
    // self-heal after an embedding-pipeline change even when the model didn't.
    await reembedTenantCorpus('tenant-acme-01', 'google/gemini-embedding-2-preview');
    expect(settingsCalls.length).toBe(1);
    expect(settingsCalls[0].settings).toEqual({
      indexedEmbeddingModel: expect.stringMatching(/^google\/gemini-embedding-2-preview#v\d+$/),
    });
    expect(settingsCalls[0].settings.indexedEmbeddingModel).toBe('google/gemini-embedding-2-preview#v2');
  });

  it('short-circuits cleanly for a tenant with zero chunks (still stamps tracking)', async () => {
    const result = await reembedTenantCorpus('empty-tenant', 'gemini-embedding-2');
    expect(result.total).toBe(0);
    expect(result.reembedded).toBe(0);
    expect(upsertCalls.length).toBe(0);
    expect(settingsCalls[0].settings).toEqual({ indexedEmbeddingModel: 'gemini-embedding-2#v2' });
  });

  it('reports failed batches without aborting the rest of the corpus', async () => {
    // Reimport with a failing store: reuse the module but make the SECOND
    // wave fail — the service must continue with wave 3 and report honestly.
    const { getVectorStoreForTenant } = await import('../lib/storage/vectors/registry');
    const failingStore = {
      upsertPoints: vi.fn(async (points: any[]) => {
        if (upsertCalls.length === 1) {
          upsertCalls.push(points);
          return false; // middle batch fails
        }
        upsertCalls.push(points);
        return true;
      }),
    };
    (getVectorStoreForTenant as any).mockResolvedValue(failingStore);
    upsertCalls.length = 0;

    const result = await reembedTenantCorpus('tenant-acme-01', 'gemini-embedding-2');
    expect(result.reembedded).toBe(70); // wave 1 (50) + wave 3 (20)
    expect(result.failed).toBe(50); // wave 2
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('50');
  });
});

describe('isTenantEmbeddingStale', () => {
  it('treats an empty provenance field on a chunked tenant as stale', async () => {
    const { db } = await import('../lib/storage/db');
    (db.getTenant as any).mockResolvedValue({ settings: {} }); // legacy tenant, no tracking
    (db.getChunks as any).mockResolvedValue([{ id: 'c1' }]);
    expect(await isTenantEmbeddingStale('t1')).toBe(true);
  });

  it('treats an empty provenance field on a chunkless tenant as consistent', async () => {
    const { db } = await import('../lib/storage/db');
    (db.getTenant as any).mockResolvedValue({ settings: {} });
    (db.getChunks as any).mockResolvedValue([]);
    expect(await isTenantEmbeddingStale('t1')).toBe(false);
  });

  it('flags a mismatch between indexed model and active model', async () => {
    const { db } = await import('../lib/storage/db');
    (db.getTenant as any).mockResolvedValue({
      settings: { indexedEmbeddingModel: 'text-embedding-004' },
    });
    // getAiModel('embeddingModel') resolves DEFAULT_AI_MODELS.embeddingModel
    // = 'gemini-embedding-2' in the test environment (no request context).
    (db.getChunks as any).mockResolvedValue([{ id: 'c1' }]);
    expect(await isTenantEmbeddingStale('t1')).toBe(true);
  });

  it('flags a pipeline-version mismatch even with the SAME model (the v0.12.4 normalization upgrade)', async () => {
    const { db } = await import('../lib/storage/db');
    // Corpus embedded with v1 pipeline (raw text) under the SAME model that
    // is active now — still stale because v2 normalizes Arabic before
    // embedding, which changes every vector.
    (db.getTenant as any).mockResolvedValue({
      settings: { indexedEmbeddingModel: 'gemini-embedding-2#v1' },
    });
    (db.getChunks as any).mockResolvedValue([{ id: 'c1' }]);
    expect(await isTenantEmbeddingStale('t1')).toBe(true);
  });

  it('reports consistency when the indexed provenance matches the active model+pipeline', async () => {
    const { db } = await import('../lib/storage/db');
    (db.getTenant as any).mockResolvedValue({
      settings: { indexedEmbeddingModel: 'gemini-embedding-2#v2' },
    });
    (db.getChunks as any).mockResolvedValue([{ id: 'c1' }]);
    expect(await isTenantEmbeddingStale('t1')).toBe(false);
  });
});
