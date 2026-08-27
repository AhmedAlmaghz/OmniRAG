import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { memoryVectorStore, resetMemoryVectorStore } from '@/lib/storage/vectors/adapters/memory';
import {
  VECTOR_STORE_REGISTRY,
  getVectorStore,
  getVectorStoreById,
  getDefaultVectorStore,
  toVectorStoreCatalog,
  clearVectorStoreSelectionCache,
} from '@/lib/storage/vectors/registry';
import type { VectorPoint } from '@/lib/storage/vectors/types';

// Phase 2 storage abstraction tests: the in-memory adapter exercises the full
// IVectorStore contract (the same one Qdrant and pgvector implement), and the
// registry tests pin resolution order + backward-compatible defaults.

function makePoint(id: string, vector: number[], over: Partial<VectorPoint['payload']> = {}): VectorPoint {
  return {
    id,
    vector,
    payload: {
      tenantId: 'tenant-a',
      documentId: 'doc-1',
      documentTitle: 'مستند تجريبي',
      content: `محتوى المقطع ${id}`,
      chunkIndex: 0,
      pageNumber: 1,
      language: 'ar',
      ...over,
    },
  };
}

describe('memory vector store — IVectorStore contract', () => {
  beforeEach(() => {
    resetMemoryVectorStore();
  });

  it('upsert + search round-trip ranks by cosine similarity', async () => {
    await memoryVectorStore.upsertPoints([
      makePoint('near', [1, 0, 0]),
      makePoint('far', [0, 1, 0]),
      makePoint('mid', [0.7, 0.7, 0]),
    ]);

    const hits = await memoryVectorStore.search({ vector: [1, 0, 0], tenantId: 'tenant-a', limit: 10 });
    expect(hits.map((h) => h.id)).toEqual(['near', 'mid', 'far']);
    expect(hits[0].semanticScore).toBeCloseTo(1, 5);
    expect(hits[0].content).toContain('near');
  });

  it('enforces mandatory tenant isolation', async () => {
    await memoryVectorStore.upsertPoints([
      makePoint('a1', [1, 0], { tenantId: 'tenant-a' }),
      makePoint('b1', [1, 0], { tenantId: 'tenant-b' }),
    ]);

    const hitsA = await memoryVectorStore.search({ vector: [1, 0], tenantId: 'tenant-a', limit: 10 });
    expect(hitsA.map((h) => h.id)).toEqual(['a1']);
    const hitsB = await memoryVectorStore.search({ vector: [1, 0], tenantId: 'tenant-b', limit: 10 });
    expect(hitsB.map((h) => h.id)).toEqual(['b1']);
  });

  it('filters by collectionIds intersection', async () => {
    await memoryVectorStore.upsertPoints([
      makePoint('in-col', [1, 0], { collectionIds: ['col-1'] }),
      makePoint('out-col', [1, 0], { collectionIds: ['col-2'] }),
      makePoint('no-col', [1, 0]),
    ]);

    const hits = await memoryVectorStore.search({
      vector: [1, 0],
      tenantId: 'tenant-a',
      collectionIds: ['col-1'],
      limit: 10,
    });
    expect(hits.map((h) => h.id)).toEqual(['in-col']);
  });

  it('applies scoreThreshold and limit', async () => {
    await memoryVectorStore.upsertPoints([
      makePoint('strong', [1, 0]),
      makePoint('weak', [0, 1]), // orthogonal → score 0
    ]);

    const hits = await memoryVectorStore.search({
      vector: [1, 0],
      tenantId: 'tenant-a',
      limit: 10,
      scoreThreshold: 0.5,
    });
    expect(hits.map((h) => h.id)).toEqual(['strong']);

    const limited = await memoryVectorStore.search({ vector: [1, 0], tenantId: 'tenant-a', limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it('deleteByDocument removes only that tenant+document points', async () => {
    await memoryVectorStore.upsertPoints([
      makePoint('d1-c1', [1, 0], { documentId: 'doc-1' }),
      makePoint('d2-c1', [1, 0], { documentId: 'doc-2' }),
      makePoint('d1-other', [1, 0], { documentId: 'doc-1', tenantId: 'tenant-b' }),
    ]);

    await memoryVectorStore.deleteByDocument('doc-1', 'tenant-a');

    const hits = await memoryVectorStore.search({ vector: [1, 0], tenantId: 'tenant-a', limit: 10 });
    expect(hits.map((h) => h.id)).toEqual(['d2-c1']);
    const otherTenant = await memoryVectorStore.search({ vector: [1, 0], tenantId: 'tenant-b', limit: 10 });
    expect(otherTenant.map((h) => h.id)).toEqual(['d1-other']);
  });

  it('updateDocumentPayload rewrites payload fields for the document', async () => {
    await memoryVectorStore.upsertPoints([makePoint('p1', [1, 0], { collectionIds: [] })]);
    await memoryVectorStore.updateDocumentPayload('doc-1', 'tenant-a', { collectionIds: ['col-9'] });

    const hits = await memoryVectorStore.search({
      vector: [1, 0],
      tenantId: 'tenant-a',
      collectionIds: ['col-9'],
      limit: 10,
    });
    expect(hits.map((h) => h.id)).toEqual(['p1']);
  });

  it('upsert is idempotent (same id overwrites, no duplicates)', async () => {
    await memoryVectorStore.upsertPoints([makePoint('same', [1, 0], { content: 'النسخة الأولى' })]);
    await memoryVectorStore.upsertPoints([makePoint('same', [0, 1], { content: 'النسخة الثانية' })]);

    const hits = await memoryVectorStore.search({ vector: [0, 1], tenantId: 'tenant-a', limit: 10 });
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toBe('النسخة الثانية');
  });
});

describe('vector store registry — resolution order', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    clearVectorStoreSelectionCache();
    delete process.env.QDRANT_URL;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    clearVectorStoreSelectionCache();
  });

  it('registers qdrant, pgvector, and memory with unique ids', () => {
    const ids = VECTOR_STORE_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['qdrant', 'pgvector', 'memory']));
  });

  it('catalog is client-safe and carries metadata for every store', () => {
    const catalog = toVectorStoreCatalog();
    expect(catalog).toHaveLength(VECTOR_STORE_REGISTRY.length);
    for (const entry of catalog) {
      expect(entry.nameAr.trim().length).toBeGreaterThan(0);
      expect(entry.nameEn.trim().length).toBeGreaterThan(0);
      expect(entry.descriptionAr.trim().length).toBeGreaterThan(0);
      expect(entry.requirement.trim().length).toBeGreaterThan(0);
    }
  });

  it('defaults to qdrant when QDRANT_URL is set (historical behavior)', () => {
    process.env.QDRANT_URL = 'http://localhost:6333';
    expect(getDefaultVectorStore().id).toBe('qdrant');
    expect(getVectorStore(null).id).toBe('qdrant');
  });

  it('falls back to pgvector when only Postgres is configured', () => {
    process.env.DATABASE_URL = 'postgres://localhost/omnirag';
    expect(getDefaultVectorStore().id).toBe('pgvector');
  });

  it('falls back to memory when nothing is configured', () => {
    expect(getDefaultVectorStore().id).toBe('memory');
  });

  it('honors explicit tenant selection over the default chain', () => {
    process.env.QDRANT_URL = 'http://localhost:6333';
    expect(getVectorStore({ vectorStoreId: 'memory' }).id).toBe('memory');
    expect(getVectorStore({ vectorStoreId: 'pgvector' }).id).toBe('pgvector');
  });

  it('unknown vectorStoreId degrades to the default with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getVectorStore({ vectorStoreId: 'pinecone' }).id).toBe('memory');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('getVectorStoreById resolves every registered store', () => {
    for (const store of VECTOR_STORE_REGISTRY) {
      expect(getVectorStoreById(store.id)).toBe(store);
    }
    expect(getVectorStoreById('nope')).toBeUndefined();
  });
});
