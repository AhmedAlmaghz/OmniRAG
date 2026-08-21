import { describe, it, expect } from 'vitest';
import {
  chunkDocument,
  resolveChunkGeometry,
  estimateTokenCount,
  CHARS_PER_TOKEN,
} from '../lib/rag/chunker';

/**
 * Phase 8 regression guard: the unified chunker is the SINGLE source of truth
 * for chunk geometry across every ingestion path (documents POST, syncSource,
 * createDocumentVersion, revertDocumentVersion, reindex). These tests pin the
 * invariants that the old three-way split chunkers violated.
 */
describe('unified chunker — chunkDocument', () => {
  it('returns an empty array for empty or whitespace-only input', () => {
    expect(chunkDocument('')).toEqual([]);
    expect(chunkDocument('   \n\t  ')).toEqual([]);
  });

  it('returns a single chunk when the text fits the budget', () => {
    const out = chunkDocument('نص قصير جدا');
    expect(out).toEqual(['نص قصير جدا']);
  });

  it('is deterministic: same input + config ⇒ identical chunks', () => {
    const text = 'فقرة أولى عن الذكاء الاصطناعي. '.repeat(200);
    const a = chunkDocument(text, { strategy: 'semantic', size: 256, overlap: 20 });
    const b = chunkDocument(text, { strategy: 'semantic', size: 256, overlap: 20 });
    expect(a).toEqual(b);
  });

  it('produces the same grid regardless of which path calls it', () => {
    // The whole point of Phase 8: documents POST, sync, versions and reindex
    // must agree. They all call chunkDocument with the same config, so the
    // output must be identical for repeated calls with default config too.
    const text = 'المحتوى التجريبي للمستند. '.repeat(300);
    const first = chunkDocument(text);
    const second = chunkDocument(text);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(1);
  });

  it('never emits empty chunks', () => {
    const text = 'كلمة '.repeat(1000) + '\n\n\n' + 'كلمة '.repeat(1000);
    const out = chunkDocument(text, { size: 200, overlap: 10 });
    for (const c of out) {
      expect(c.trim().length).toBeGreaterThan(0);
    }
  });

  it('markdown strategy keeps headings with their sections', () => {
    const md = '# عنوان رئيسي\nمحتوى القسم الأول\n\n## قسم فرعي\nمحتوى القسم الثاني';
    const out = chunkDocument(md, { strategy: 'markdown', size: 4096 });
    expect(out.length).toBe(2);
    expect(out[0]).toContain('# عنوان رئيسي');
    expect(out[1]).toContain('## قسم فرعي');
  });

  it('markdown strategy sub-chunks oversized sections', () => {
    const bigSection = '## قسم كبير\n' + 'محتوى طويل. '.repeat(500);
    const out = chunkDocument(bigSection, { strategy: 'markdown', size: 200 });
    expect(out.length).toBeGreaterThan(1);
    // Every chunk must respect the character budget (with small tolerance for
    // boundary backoff never exceeding the hard limit).
    const geo = resolveChunkGeometry({ strategy: 'markdown', size: 200 });
    for (const c of out) {
      expect(c.length).toBeLessThanOrEqual(geo.charSize + 1);
    }
  });

  it('recursive strategy respects the size budget', () => {
    const text = Array.from({ length: 40 }, (_, i) => `الفقرة رقم ${i} تتحدث عن موضوع مختلف قليلا. `).join('\n\n');
    const geo = resolveChunkGeometry({ strategy: 'recursive', size: 200, overlap: 10 });
    const out = chunkDocument(text, { strategy: 'recursive', size: 200, overlap: 10 });
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(c.length).toBeLessThanOrEqual(geo.charSize + 1);
    }
  });

  it('semantic strategy covers the whole document (head and tail present)', () => {
    const head = 'بداية المستند الفريدة.';
    const tail = 'نهاية المستند الفريدة.';
    const text = `${head} ${'محتوى أوسط متكرر. '.repeat(400)} ${tail}`;
    const out = chunkDocument(text, { strategy: 'semantic', size: 256, overlap: 20 });
    expect(out[0]).toContain('بداية المستند');
    expect(out[out.length - 1]).toContain('نهاية المستند');
  });
});

describe('unified chunker — resolveChunkGeometry clamping', () => {
  it('applies defaults for missing config', () => {
    const geo = resolveChunkGeometry();
    expect(geo.strategy).toBe('semantic');
    expect(geo.tokenSize).toBe(512);
    expect(geo.overlapPercent).toBe(20);
    expect(geo.charSize).toBe(Math.floor(512 * CHARS_PER_TOKEN));
    expect(geo.step).toBeGreaterThan(0);
    expect(geo.step).toBeLessThan(geo.charSize);
  });

  it('clamps size below the minimum up to 128 tokens', () => {
    const geo = resolveChunkGeometry({ size: 10 });
    expect(geo.tokenSize).toBe(128);
  });

  it('clamps size above the maximum down to 4096 tokens', () => {
    const geo = resolveChunkGeometry({ size: 999999 });
    expect(geo.tokenSize).toBe(4096);
  });

  it('clamps overlap into [0, 50]', () => {
    expect(resolveChunkGeometry({ overlap: -5 }).overlapPercent).toBe(0);
    expect(resolveChunkGeometry({ overlap: 95 }).overlapPercent).toBe(50);
  });

  it('rejects unknown strategies and falls back to semantic', () => {
    const geo = resolveChunkGeometry({ strategy: 'bogus' as any });
    expect(geo.strategy).toBe('semantic');
  });

  it('ignores NaN / non-finite numeric config', () => {
    const geo = resolveChunkGeometry({ size: NaN, overlap: Infinity });
    expect(geo.tokenSize).toBe(512);
    expect(geo.overlapPercent).toBe(20);
  });

  it('always guarantees forward progress (step >= 1)', () => {
    // 50% overlap is the max; step must still advance.
    const geo = resolveChunkGeometry({ size: 128, overlap: 50 });
    expect(geo.step).toBeGreaterThanOrEqual(1);
    expect(geo.step).toBeLessThan(geo.charSize);
  });
});

describe('unified chunker — estimateTokenCount', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('returns at least 1 for non-empty text', () => {
    expect(estimateTokenCount('a')).toBeGreaterThanOrEqual(1);
  });

  it('scales roughly linearly with length', () => {
    const short = estimateTokenCount('كلمة '.repeat(10));
    const long = estimateTokenCount('كلمة '.repeat(100));
    expect(long).toBeGreaterThan(short);
  });
});
