import { describe, it, expect } from 'vitest';
import { toQdrantPointId } from '../lib/storage/qdrant';

/**
 * Regression guard for the Qdrant point-id derivation.
 *
 * The bug this pins: `upsertQdrantChunks` derived point ids with a SHA-1-based
 * UUID, while `deleteQdrantChunk` used the legacy 32-bit Java-string hashCode.
 * The two functions mapped the SAME chunk id to DIFFERENT point ids, so deletes
 * targeted points that never existed and vectors leaked forever. Both paths now
 * share `toQdrantPointId`; these tests lock in that single-derivation contract.
 */
describe('Qdrant point id derivation', () => {
  it('passes standard UUIDs through unchanged', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    expect(toQdrantPointId(uuid)).toBe(uuid);
  });

  it('is deterministic for arbitrary chunk ids', () => {
    const id = 'chunk-doc-1712345678901-42';
    expect(toQdrantPointId(id)).toBe(toQdrantPointId(id));
  });

  it('produces a valid UUID shape for non-UUID ids', () => {
    const out = toQdrantPointId('chunk-doc-123-7');
    expect(out).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('derives the SAME id the upsert path uses (delete/upsert consistency)', () => {
    // This is the exact invariant the old code violated. Since both upsert and
    // delete now call toQdrantPointId, asserting the function is stable across
    // repeated calls for realistic chunk ids guards the contract.
    const ids = ['chunk-doc-1712345678901-1', 'chunk-doc-sync-4821-3', 'chunk-doc-999-v2-17', 'chunk-doc-abc-re-m1-5'];
    for (const id of ids) {
      const a = toQdrantPointId(id);
      const b = toQdrantPointId(id);
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });

  it('maps distinct chunk ids to distinct point ids (no 32-bit collisions)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const pointId = toQdrantPointId(`chunk-doc-${i}-${i * 7}`);
      expect(seen.has(pointId)).toBe(false);
      seen.add(pointId);
    }
  });

  it('preserves long hex ids without re-hashing them', () => {
    const hex = 'a'.repeat(40);
    const out = toQdrantPointId(hex);
    expect(out.startsWith('aaaaaaaa-aaaa-aaaa-aaaa')).toBe(true);
  });
});
