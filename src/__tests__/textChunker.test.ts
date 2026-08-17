import { describe, it, expect } from 'vitest';
import { chunkTextIntoList, DEFAULT_CHUNK_GEOMETRY } from '../lib/rag/textChunker';

/**
 * Phase 7 regression guard: the memory-backed ingestion paths (syncSource,
 * createDocumentVersion, revertDocumentVersion) previously had THREE
 * inconsistent chunkers — syncSource used size 1000 / step 1000 (no overlap),
 * while the version handlers used size 1000 / step 800 (200 overlap). The
 * shared chunker must produce one geometry for all three with a 200-char
 * overlap between adjacent chunks.
 */
describe('Phase 7 — shared text chunker', () => {
  it('produces overlapping windows with step < size', () => {
    const text = 'abcdefghij'.repeat(250); // 2500 chars
    const chunks = chunkTextIntoList(text);

    // size 1000, step 800 → windows 0-1000, 800-1800, 1600-2500 (last is 900
    // chars since it is clipped at the end of the text). 3 chunks total.
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(1000);
    expect(chunks[1].length).toBe(1000);
    expect(chunks[2].length).toBe(900);
    // Adjacent full-length windows MUST share 200 chars (the overlap that
    // syncSource previously lacked). First chunk's last 200 chars == second
    // chunk's first 200 chars.
    const overlap = chunks[0].slice(chunks[0].length - (1000 - 800));
    const prefix = chunks[1].slice(0, 200);
    expect(prefix).toBe(overlap);
  });

  it('respects the default geometry (1000 / 800)', () => {
    expect(DEFAULT_CHUNK_GEOMETRY).toEqual({ size: 1000, step: 800 });
  });

  it('returns a single chunk when text fits one window', () => {
    const out = chunkTextIntoList('short text well under 1000 chars');
    expect(out).toEqual(['short text well under 1000 chars']);
  });

  it('returns an empty array for empty or whitespace-only text', () => {
    expect(chunkTextIntoList('')).toEqual([]);
    expect(chunkTextIntoList('   \n\t  ')).toEqual([]);
  });

  it('terminates when step exceeds size (gap-windows, no overlap)', () => {
    // 500 chars, size 200, step 300. stride=300 > size=200 → non-overlapping
    // windows with a gap: 0-200 and 300-500 = 2 chunks. The contract here is
    // only that the function terminates and covers at least the head and tail.
    const text = 'abcdefghij'.repeat(50); // 500 chars
    const out = chunkTextIntoList(text, { size: 200, step: 300 });
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0]).toBe(text.slice(0, 200));
    expect(out.at(-1)).toBe(text.slice(300, 500));
  });
});
