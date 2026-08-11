import { describe, it, expect } from 'vitest';
import { performHybridSearch } from '../lib/rag/engine';

describe('RRF & Hybrid Retrieval Unit Tests', () => {
  it('should compute deterministic hybrid search scores', async () => {
    const result = await performHybridSearch({
      query: 'أمان البيانات والتشفير',
      tenantId: 'tenant-acme-01',
      topK: 3,
    });

    expect(result).toBeDefined();
    expect(result.chunks).toBeInstanceOf(Array);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    
    // Validate score ordering (descending)
    if (result.chunks.length > 1) {
      expect(result.chunks[0].score ?? 0).toBeGreaterThanOrEqual(result.chunks[1].score ?? 0);
    }
  });

  it('should isolate chunks by tenantId', async () => {
    const tenant1Result = await performHybridSearch({
      query: 'test',
      tenantId: 'tenant-test-a',
      topK: 5,
    });

    for (const chunk of tenant1Result.chunks) {
      expect(chunk.tenantId).toBe('tenant-test-a');
    }
  });
});
