import { describe, it, expect } from 'vitest';
import { embedBatch, generateEmbedding } from '@/lib/rag/embedding';
import type { DocumentChunk } from '@/lib/types/omnirag';
import { MemoryDatabase } from '../lib/storage/db';

// Exercise the batch ingestion primitives so the concurrency-bounded embedding
// wave and the in-memory batch write stay honest, and so the order-preserving
// contract (results align with input order) is locked in.
describe('embedBatch — bounded-concurrency batch embeddings', () => {
  it('returns vectors in the SAME order as the inputs (order-preserving)', async () => {
    const texts = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    const batchVectors = await embedBatch(texts);
    expect(batchVectors).toHaveLength(texts.length);
    // Each result must equal what generateEmbedding would return for that text.
    for (let i = 0; i < texts.length; i++) {
      const direct = await generateEmbedding(texts[i]);
      expect(batchVectors[i].toString()).toBe(direct.toString());
    }
  });

  it('handles an empty input array (no workers spawned)', async () => {
    const r = await embedBatch([]);
    expect(r).toEqual([]);
  });

  it('respects an explicit concurrency limit (rare > args)', async () => {
    const r = await embedBatch(['only-one'], 1);
    expect(r).toHaveLength(1);
    expect(Array.isArray(r[0])).toBe(true);
    expect(r[0].length).toBeGreaterThan(0);
  });
});

describe('MemoryDatabase.addChunks — batch write', () => {
  const db = new MemoryDatabase();

  it('writes all chunks in one call and makes them retrievable by tenant', async () => {
    const tenantId = 'tenant-batch-01';
    const chunks: DocumentChunk[] = Array.from(
      { length: 6 },
      (_, i) =>
        ({
          id: `chk-batch-${i}`,
          tenantId,
          documentId: 'doc-batch',
          content: `chunk ${i}`,
          embedding: [],
          chunkIndex: i,
          documentTitle: 'doc',
          pageNumber: 1,
          language: 'ar',
          meta: {},
          createdAt: new Date().toISOString(),
        }) as DocumentChunk,
    );

    await db.addChunks(chunks);
    const retrieved = await db.getChunks(tenantId);
    expect(retrieved.filter((c) => chunks.some((x) => x.id === c.id))).toHaveLength(6);
  });

  it('is a no-op for an empty array', async () => {
    const before = await db.getChunks('tenant-batch-02');
    await db.addChunks([]);
    const after = await db.getChunks('tenant-batch-02');
    expect(after).toHaveLength(before.length);
  });
});
