import { describe, it, expect, vi } from 'vitest';
import { isAggregativeQuery, buildContextBlock, buildCitations, findNamedDocumentInQuery } from '../lib/rag/engine';
import { DocumentChunk } from '../lib/types/omnirag';

/**
 * Aggregative-query routing + single-document context map.
 *
 * The bug this pins: "ما هي الدروس والوحدات في كتاب الرياضيات؟" went through
 * plain top-k semantic retrieval, which anchored to the tail of the book and
 * the model answered from the last chapter only. Such queries must be detected
 * and routed through multi-view retrieval, and a single-document pool must
 * carry a reading-order map so the model walks the WHOLE document.
 */

// Named-document matching needs db.getDocuments — mock at module level.
vi.mock('../lib/storage/db', () => ({
  db: {
    getDocuments: vi.fn(async () => [
      {
        id: 'doc-physics-3rd',
        title: 'كتاب الفيزياء ثالث ثانوي اليمن',
        createdAt: '2026-08-20T00:00:00Z',
      },
      {
        id: 'doc-physics-1st',
        title: 'كتاب الفيزياء أول ثانوي اليمن',
        createdAt: '2026-08-01T00:00:00Z',
      },
      {
        id: 'doc-math-3rd',
        title: 'كتاب الرياضيات ثالث ثانوي اليمن',
        createdAt: '2026-08-25T00:00:00Z',
      },
    ]),
  },
}));

function fakeChunk(overrides: Partial<DocumentChunk>): DocumentChunk {
  return {
    id: 'chunk-x',
    tenantId: 'tenant-acme-01',
    documentId: 'doc-x',
    documentTitle: 'كتاب الرياضيات',
    content: 'نص تجريبي',
    chunkIndex: 0,
    pageNumber: 1,
    language: 'ar',
    metadata: {},
    ...overrides,
  } as DocumentChunk;
}

describe('isAggregativeQuery — aggregative question detection', () => {
  it('detects the exact user-reported question shape (Arabic lessons/units)', () => {
    expect(isAggregativeQuery('ماهي الدروس والوحدات التي في كتاب الرياضيات')).toBe(true);
    expect(isAggregativeQuery('ما هي الدروس التي في كتاب الرياضيات للصف الثالث الثانوي؟')).toBe(true);
    expect(isAggregativeQuery('اذكر كل الفصول الموجودة في المنهج')).toBe(true);
    expect(isAggregativeQuery('أريد فهرس محتويات الكتاب')).toBe(true);
  });

  it('detects the v0.12.3 user-reported EXACT phrasing (no ال, واو عطف, ماهي fused)', () => {
    // This is the regression the lexicon rebuild fixes: the v0.12.2 phrase
    // detector required "الدروس/الوحدات" with the definite article and missed
    // this question entirely, so no coverage machinery ran at all.
    expect(isAggregativeQuery('ماهي وحدات ودروس كتاب الفيزياء ثالث ثانوي اليمن بالتفصيل الممل')).toBe(true);
    expect(isAggregativeQuery('ماهي وحدات كتاب الفيزياء؟')).toBe(true);
    expect(isAggregativeQuery('دروس ومحاور كتاب الرياضيات')).toBe(true);
    expect(isAggregativeQuery('عناوين الأقسام في المرجع')).toBe(true);
  });

  it('exhaustiveness markers alone trigger aggregative mode', () => {
    expect(isAggregativeQuery('اشرح لي هذا الموضوع بشكل شامل من كل الجوانب')).toBe(true);
    expect(isAggregativeQuery('أريد كل شيء عن الموضوع')).toBe(true);
  });

  it('matches with Arabic orthography variants (hamza/alef/taa-marbuta)', () => {
    // The detector normalizes via normalizeArabicForSearch before matching.
    expect(isAggregativeQuery('ماهى الوحدات الموجوده في الكتاب؟')).toBe(true);
    expect(isAggregativeQuery('استعرض محتويات الكتاب كاملة')).toBe(true);
  });

  it('detects English enumerations', () => {
    expect(isAggregativeQuery('list all chapters in the math book')).toBe(true);
    expect(isAggregativeQuery('what are the units in this book?')).toBe(true);
    expect(isAggregativeQuery('show me the table of contents')).toBe(true);
  });

  it('does NOT flag point queries (fact lookups)', () => {
    expect(isAggregativeQuery('ما هو قانون الاشتقاق في حساب النسب؟')).toBe(false);
    expect(isAggregativeQuery('اشرح لي نظرية فيثاغورس')).toBe(false);
    expect(isAggregativeQuery('حل التمرين الثالث في صفحة 45')).toBe(false);
    expect(isAggregativeQuery('hello')).toBe(false);
    expect(isAggregativeQuery('')).toBe(false);
  });
});

describe('buildContextBlock — single-document reading-order map', () => {
  const singleDocChunks: DocumentChunk[] = [
    fakeChunk({ id: 'c3', pageNumber: 210, chunkIndex: 42, content: 'الفصل الأخير: التمارين العامة' }),
    fakeChunk({ id: 'c1', pageNumber: 5, chunkIndex: 0, content: 'مقدمة الكتاب' }),
    fakeChunk({ id: 'c2', pageNumber: 96, chunkIndex: 20, content: 'الفصل الثاني: النسب والتناسب' }),
  ];

  it('emits a coverage map with natural book order for a one-document pool', () => {
    const text = buildContextBlock(singleDocChunks);
    expect(text).toContain('[المصدر 1');
    expect(text).toContain('خريطة ترتيب مستند "كتاب الرياضيات"');
    // Coverage span uses min/max pages across the pool (5 → 210), NOT array order.
    expect(text).toContain('من صفحة 5 إلى صفحة 210');
    // The map lists chunks in BOOK order: source [2] (page 5) before [3] (page 96) before [1] (page 210).
    const mapStart = text.indexOf('مرتبة حسب موضعها');
    const pos2 = text.indexOf('- المصدر [2]: صفحة 5', mapStart);
    const pos3 = text.indexOf('- المصدر [3]: صفحة 96', mapStart);
    const pos1 = text.indexOf('- المصدر [1]: صفحة 210', mapStart);
    expect(pos2).toBeGreaterThan(-1);
    expect(pos3).toBeGreaterThan(pos2);
    expect(pos1).toBeGreaterThan(pos3);
    // Instructs the model to cover the full span, not one fragment.
    expect(text).toContain('لا تقتصر على مقطع واحد');
  });

  it('keeps the plain numbered format for multi-document pools (no map)', () => {
    const multiDocChunks: DocumentChunk[] = [
      fakeChunk({ id: 'a1', documentId: 'doc-a', documentTitle: 'كتاب الرياضيات' }),
      fakeChunk({ id: 'b1', documentId: 'doc-b', documentTitle: 'كتاب الفيزياء' }),
    ];
    const text = buildContextBlock(multiDocChunks);
    expect(text).toContain('[المصدر 1 - كتاب الرياضيات');
    expect(text).toContain('[المصدر 2 - كتاب الفيزياء');
    expect(text).not.toContain('خريطة ترتيب');
  });

  it('returns empty string for an empty pool', () => {
    expect(buildContextBlock([])).toBe('');
  });
});

describe('citation integrity after the context changes', () => {
  it('keips citation numbering aligned with the context source order', () => {
    const chunks: DocumentChunk[] = [fakeChunk({ id: 'c1', pageNumber: 5 }), fakeChunk({ id: 'c2', pageNumber: 96 })];
    const citations = buildCitations(chunks);
    expect(citations[0].index).toBe(1);
    expect(citations[0].chunkId).toBe('c1');
    expect(citations[1].index).toBe(2);
    expect(citations[1].chunkId).toBe('c2');
  });
});

describe('findNamedDocumentInQuery — named-source anchoring', () => {
  // Mocked corpus: physics 3rd-secondary Yemen, physics 1st-secondary Yemen,
  // math 3rd-secondary Yemen (grade words are DISCRIMINATORS, not stopwords).
  it('finds the EXACT book when grade/region words are present (not stopworded)', async () => {
    const match = await findNamedDocumentInQuery(
      'ماهي وحدات ودروس كتاب الفيزياء ثالث ثانوي اليمن بالتفصيل الممل',
      'tenant-acme-01',
    );
    // ثالث/ثانوي/اليمن distinguish the 3rd-secondary physics book from the
    // 1st-secondary one — the v0.12.4 stopword mistake removed them and left
    // every same-subject book tied.
    expect(match?.documentId).toBe('doc-physics-3rd');
    expect(match?.overlap).toBeGreaterThan(0.3);
  });

  it('distinguishes same-grade books by SUBJECT word (فيزياء vs رياضيات)', async () => {
    const match = await findNamedDocumentInQuery('ماهي وحدات كتاب الرياضيات ثالث ثانوي اليمن', 'tenant-acme-01');
    expect(match?.documentId).toBe('doc-math-3rd');
  });

  it('breaks subject ties toward the newest document when the query omits the grade', async () => {
    // "وحدات كتاب الفيزياء" matches BOTH physics books; overlap ties at the
    // subject word — the tie-breaker (more absolute content hits, then newer)
    // must pick deterministically, not return the wrong physics book.
    const match = await findNamedDocumentInQuery('وحدات كتاب الفيزياء', 'tenant-acme-01');
    expect(match).toBeDefined();
    expect(match?.documentId).toBe('doc-physics-3rd');
  });

  it('returns undefined when no document title shares the query vocabulary', async () => {
    const match = await findNamedDocumentInQuery('ماهي وحدات الكيمياء العضوية', 'tenant-acme-01');
    expect(match).toBeUndefined();
  });
});
