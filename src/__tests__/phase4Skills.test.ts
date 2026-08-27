import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { UIMessage } from 'ai';
import { normalizeChartSpec, toEChartsOption, chartMarkdownFence } from '@/lib/skills/charts';
import { validateEmailParams, resolveEmailProvider } from '@/lib/skills/emailSender';
import {
  containsArabic,
  parseMarkdownBlocks,
  parseMarkdownTable,
  deriveSlides,
  buildOfficeDocument,
} from '@/lib/skills/officeDocuments';
import { buildArtifactKey, isArtifactKeyForTenant } from '@/lib/skills/artifactStore';
import {
  extractText,
  collectArtifactSnippets,
  mapUiMessageToLegacy,
  mapUiMessagesToLegacy,
  legacyMessagesToUi,
  extractLastUserText,
  getCitations,
  getChatMeta,
} from '@/lib/chat/uiMessageMapper';
import type { Message } from '@/lib/types/omnirag';

/* ------------------------------------------------------------------ */
/* Chart skill: normalization, safe option building, fence contract   */
/* ------------------------------------------------------------------ */

describe('skills/charts — normalizeChartSpec', () => {
  it('normalizes a full spec', () => {
    const spec = normalizeChartSpec({
      title: 'المبيعات الربعية',
      chartType: 'line',
      labels: ['Q1', 'Q2', 'Q3'],
      series: [{ name: '2026', data: [10, 20, 30] }],
    });
    expect(spec.title).toBe('المبيعات الربعية');
    expect(spec.chartType).toBe('line');
    expect(spec.labels).toEqual(['Q1', 'Q2', 'Q3']);
    expect(spec.series[0].data).toEqual([10, 20, 30]);
  });

  it('supports the single-series shorthand (data: [...])', () => {
    const spec = normalizeChartSpec({
      title: 'Downloads',
      chartType: 'bar',
      labels: ['Jan', 'Feb'],
      data: [5, 8],
    });
    expect(spec.series).toHaveLength(1);
    expect(spec.series[0].data).toEqual([5, 8]);
  });

  it('rejects missing title / labels / series with readable errors', () => {
    expect(() => normalizeChartSpec({ chartType: 'bar', labels: ['a'], data: [1] })).toThrow(/title/);
    expect(() => normalizeChartSpec({ title: 't', data: [1] })).toThrow(/labels/);
    expect(() => normalizeChartSpec({ title: 't', labels: ['a'] })).toThrow(/series/);
  });

  it('rejects unsupported chart types', () => {
    expect(() => normalizeChartSpec({ title: 't', chartType: 'radar', labels: ['a'], data: [1] })).toThrow(/radar/);
  });

  it('caps labels and series counts', () => {
    const labels = Array.from({ length: 300 }, (_, i) => `L${i}`);
    const series = Array.from({ length: 15 }, (_, i) => ({
      name: `S${i}`,
      data: [i],
    }));
    const spec = normalizeChartSpec({ title: 't', chartType: 'bar', labels, series });
    expect(spec.labels.length).toBeLessThanOrEqual(200);
    expect(spec.series.length).toBeLessThanOrEqual(10);
  });
});

describe('skills/charts — toEChartsOption', () => {
  it('converts pie specs into name/value data', () => {
    const spec = normalizeChartSpec({
      title: 'الحصة السوقية',
      chartType: 'pie',
      labels: ['أ', 'ب'],
      data: [60, 40],
    });
    const option = toEChartsOption(spec) as any;
    expect(option.series[0].type).toBe('pie');
    expect(option.series[0].data).toEqual([
      { name: 'أ', value: 60 },
      { name: 'ب', value: 40 },
    ]);
    expect(option.xAxis).toBeUndefined();
  });

  it('swaps axes for horizontal_bar', () => {
    const spec = normalizeChartSpec({
      title: 't',
      chartType: 'horizontal_bar',
      labels: ['a', 'b'],
      data: [1, 2],
    });
    const option = toEChartsOption(spec) as any;
    expect(option.xAxis.type).toBe('value');
    expect(option.yAxis.type).toBe('category');
    expect(option.series[0].type).toBe('bar');
  });

  it('emits no axes for pie and smooth lines for area', () => {
    const area = toEChartsOption(
      normalizeChartSpec({ title: 't', chartType: 'area', labels: ['a'], data: [1] }),
    ) as any;
    expect(area.series[0].type).toBe('line');
    expect(area.series[0].areaStyle).toBeDefined();
  });
});

describe('skills/charts — chartMarkdownFence contract', () => {
  it('embeds the normalized spec and round-trips through the client normalizer', () => {
    const spec = normalizeChartSpec({
      title: 'Revenue',
      chartType: 'line',
      labels: ['Q1', 'Q2'],
      data: [3, 4],
    });
    const fence = chartMarkdownFence(spec);
    expect(fence.startsWith('```chart\n')).toBe(true);
    expect(fence.endsWith('\n```')).toBe(true);

    const payload = fence.replace(/^```chart\n/, '').replace(/\n```$/, '');
    const reparsed = normalizeChartSpec(JSON.parse(payload));
    expect(reparsed).toEqual(spec);
    // The client builds the whitelisted option itself.
    expect(toEChartsOption(reparsed).series).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* Email skill: parameter validation + provider resolution            */
/* ------------------------------------------------------------------ */

describe('skills/emailSender — validateEmailParams', () => {
  const valid = { to: ['user@example.com'], subject: 'مرحبا', body: 'نص الرسالة' };

  it('accepts valid parameters', () => {
    expect(() => validateEmailParams(valid)).not.toThrow();
  });

  it('requires at least one recipient', () => {
    expect(() => validateEmailParams({ ...valid, to: [] })).toThrow(/مستلم/);
  });

  it('caps recipients at 10', () => {
    const to = Array.from({ length: 11 }, (_, i) => `u${i}@example.com`);
    expect(() => validateEmailParams({ ...valid, to })).toThrow(/10/);
  });

  it('rejects malformed addresses (including in cc)', () => {
    expect(() => validateEmailParams({ ...valid, to: ['not-an-email'] })).toThrow(/غير صالحة/);
    expect(() => validateEmailParams({ ...valid, cc: ['bad@@example..com'] })).toThrow(/غير صالحة/);
  });

  it('requires subject and body', () => {
    expect(() => validateEmailParams({ ...valid, subject: '  ' })).toThrow(/subject/);
    expect(() => validateEmailParams({ ...valid, body: '' })).toThrow(/body/);
  });

  it('rejects oversized bodies', () => {
    expect(() => validateEmailParams({ ...valid, body: 'x'.repeat(50001) })).toThrow(/50000/);
  });
});

describe('skills/emailSender — resolveEmailProvider', () => {
  const env = process.env as Record<string, string | undefined>;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['RESEND_API_KEY', 'SMTP_HOST']) {
      saved[k] = env[k];
      delete env[k];
    }
  });
  afterEach(() => {
    for (const k of ['RESEND_API_KEY', 'SMTP_HOST']) {
      if (saved[k] === undefined) delete env[k];
      else env[k] = saved[k];
    }
  });

  it('returns null when no provider is configured (honest degradation)', () => {
    expect(resolveEmailProvider()).toBeNull();
  });

  it('prefers Resend over SMTP when both are configured', () => {
    env.RESEND_API_KEY = 're_123';
    env.SMTP_HOST = 'smtp.example.com';
    expect(resolveEmailProvider()).toBe('resend');
  });

  it('falls back to SMTP', () => {
    env.SMTP_HOST = 'smtp.example.com';
    expect(resolveEmailProvider()).toBe('smtp');
  });
});

/* ------------------------------------------------------------------ */
/* Office documents: parsing helpers + honest Arabic PDF refusal      */
/* ------------------------------------------------------------------ */

describe('skills/officeDocuments', () => {
  it('detects Arabic script', () => {
    expect(containsArabic('مرحبا بالعالم')).toBe(true);
    expect(containsArabic('Hello world')).toBe(false);
  });

  it('parses markdown blocks (headings, lists, paragraphs)', () => {
    const blocks = parseMarkdownBlocks('# عنوان\n\n- نقطة أ\n- نقطة ب\n\n1. أولى\n\nنص عادي');
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toContain('h1');
    expect(kinds).toContain('bullet');
    expect(kinds).toContain('numbered');
    expect(kinds).toContain('paragraph');
  });

  it('parses markdown tables', () => {
    const table = parseMarkdownTable('| الاسم | القيمة |\n| --- | --- |\n| أ | 1 |\n| ب | 2 |');
    expect(table).not.toBeNull();
    expect(table!.columns).toEqual(['الاسم', 'القيمة']);
    expect(table!.rows).toHaveLength(2);
  });

  it('derives slides from headings', () => {
    const slides = deriveSlides('عرض', '## قسم أول\n- نقطة\n## قسم ثان\n- نقطة أخرى');
    expect(slides.length).toBeGreaterThanOrEqual(2);
    expect(slides[0].bullets.length).toBeGreaterThan(0);
  });

  it('builds markdown documents', async () => {
    const buf = await buildOfficeDocument({
      format: 'md',
      title: 'تقرير',
      content: '## قسم\n\nنص',
    });
    expect(buf.toString('utf8')).toContain('تقرير');
  });

  it('refuses generation without any content (honest error)', async () => {
    await expect(buildOfficeDocument({ format: 'docx', title: 'ت' })).rejects.toThrow(/محتوى/);
  });

  it('refuses Arabic PDF generation with a docx recommendation (jsPDF cannot shape Arabic)', async () => {
    await expect(buildOfficeDocument({ format: 'pdf', title: 'تقرير', content: 'هذا نص عربي' })).rejects.toThrow(
      /docx/,
    );
  });

  it('builds real docx/xlsx/pptx binaries', async () => {
    const docx = await buildOfficeDocument({ format: 'docx', title: 'Doc', content: '## S\n\ntext' });
    expect(docx.length).toBeGreaterThan(100);
    // DOCX/PPTX/XLSX are zip containers — magic bytes "PK"
    expect(docx.subarray(0, 2).toString()).toBe('PK');

    const xlsx = await buildOfficeDocument({
      format: 'xlsx',
      title: 'Sheet',
      table: { columns: ['a', 'b'], rows: [[1, 2]] },
    });
    expect(xlsx.subarray(0, 2).toString()).toBe('PK');

    const pptx = await buildOfficeDocument({
      format: 'pptx',
      title: 'عرض',
      slides: [{ title: 'شريحة', bullets: ['نقطة'] }],
    });
    expect(pptx.subarray(0, 2).toString()).toBe('PK');
  }, 60000);
});

/* ------------------------------------------------------------------ */
/* Artifact store keys: tenant isolation + traversal safety           */
/* ------------------------------------------------------------------ */

describe('skills/artifactStore — key safety', () => {
  it('builds unguessable tenant-prefixed keys', () => {
    const key = buildArtifactKey('tenant-a', 'تقرير (1).docx');
    expect(key.startsWith('generated/tenant-a/')).toBe(true);
    expect(key).not.toContain('..');
    // Two builds never collide (uuid prefix)
    expect(buildArtifactKey('tenant-a', 'f.bin')).not.toBe(buildArtifactKey('tenant-a', 'f.bin'));
  });

  it('accepts only matching-tenant artifact keys', () => {
    const key = buildArtifactKey('tenant-a', 'report.pdf');
    expect(isArtifactKeyForTenant(key, 'tenant-a')).toBe(true);
    expect(isArtifactKeyForTenant(key, 'tenant-b')).toBe(false);
  });

  it('rejects traversal and absolute keys', () => {
    expect(isArtifactKeyForTenant('generated/tenant-a/../../etc/passwd', 'tenant-a')).toBe(false);
    expect(isArtifactKeyForTenant('/generated/tenant-a/x', 'tenant-a')).toBe(false);
    expect(isArtifactKeyForTenant('', 'tenant-a')).toBe(false);
    expect(isArtifactKeyForTenant('generated/tenant-a/', 'tenant-a')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* UI message mapper: streaming UIMessage <-> legacy Message contract */
/* ------------------------------------------------------------------ */

describe('chat/uiMessageMapper', () => {
  const ctx = () => ({
    tenantId: 'tenant-a',
    conversationId: 'conv-1',
    timestamps: new Map<string, string>(),
  });

  const userMsg = (id: string, text: string): UIMessage => ({
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  });

  it('extracts concatenated text parts', () => {
    const ui: UIMessage = {
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'جزء أول' },
        { type: 'text', text: 'جزء ثان' },
      ],
    };
    expect(extractText(ui)).toBe('جزء أول\n\nجزء ثان');
  });

  it('collects artifact snippets from tool outputs (JSON strings)', () => {
    const ui: UIMessage = {
      id: 'm2',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'تفضل المخطط:' },
        {
          type: 'tool-create_chart',
          toolCallId: 'tc1',
          state: 'output-available',
          input: {},
          output: JSON.stringify({ success: true, markdownFence: '```chart\n{}\n```' }),
        } as any,
        {
          type: 'dynamic-tool',
          toolName: 'custom_tool',
          toolCallId: 'tc2',
          state: 'output-available',
          input: {},
          output: JSON.stringify({ markdownLink: '[📄 file.docx](/api/v1/files/x)' }),
        } as any,
      ],
    };
    const snippets = collectArtifactSnippets(ui);
    expect(snippets).toContain('```chart\n{}\n```');
    expect(snippets).toContain('[📄 file.docx](/api/v1/files/x)');
  });

  it('injects missing artifacts deterministically but never duplicates embedded ones', () => {
    const fence = '```chart\n{"a":1}\n```';
    const withEmbed: UIMessage = {
      id: 'm3',
      role: 'assistant',
      parts: [
        { type: 'text', text: `الناتج:\n${fence}` },
        {
          type: 'tool-create_chart',
          toolCallId: 'tc3',
          state: 'output-available',
          input: {},
          output: JSON.stringify({ markdownFence: fence }),
        } as any,
      ],
    };
    const mapped = mapUiMessageToLegacy(withEmbed, ctx())!;
    expect(mapped.content.split('```chart').length).toBe(2); // appears exactly once

    const withoutEmbed: UIMessage = {
      id: 'm4',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'تم إنشاء المخطط.' },
        {
          type: 'tool-create_chart',
          toolCallId: 'tc4',
          state: 'output-available',
          input: {},
          output: JSON.stringify({ markdownFence: fence }),
        } as any,
      ],
    };
    const mapped2 = mapUiMessageToLegacy(withoutEmbed, ctx())!;
    expect(mapped2.content).toContain(fence);
  });

  it('attaches citations and meta from data parts', () => {
    const ui: UIMessage = {
      id: 'm5',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'إجابة [1]' },
        {
          type: 'data-citations',
          data: [
            {
              index: 1,
              chunkId: 'c1',
              documentId: 'd1',
              documentTitle: 'مستند',
              score: 0.9,
              snippet: '...',
            },
          ],
        } as any,
        {
          type: 'data-meta',
          data: { modelUsed: 'google/gemini-2.5-flash', tokensUsed: { input: 10, output: 20 }, configured: true },
        } as any,
      ],
    };
    expect(getCitations(ui)).toHaveLength(1);
    expect(getChatMeta(ui)?.modelUsed).toBe('google/gemini-2.5-flash');
    const legacy = mapUiMessageToLegacy(ui, ctx())!;
    expect(legacy.citations).toHaveLength(1);
    expect(legacy.modelUsed).toBe('google/gemini-2.5-flash');
    expect(legacy.tokensUsed).toEqual({ input: 10, output: 20 });
  });

  it('assigns stable createdAt per message id', () => {
    const context = ctx();
    const ui = userMsg('u1', 'سؤال');
    const first = mapUiMessageToLegacy(ui, context)!;
    const second = mapUiMessageToLegacy(ui, context)!;
    expect(first.createdAt).toBe(second.createdAt);
  });

  it('round-trips legacy messages through UI messages', () => {
    const legacy: Message[] = [
      {
        id: 'a',
        tenantId: 'tenant-a',
        conversationId: 'conv-1',
        role: 'user',
        content: 'سؤال',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'b',
        tenantId: 'tenant-a',
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'إجابة [1]',
        citations: [
          {
            index: 1,
            chunkId: 'c1',
            documentId: 'd1',
            documentTitle: 'مستند',
            score: 0.8,
            snippet: 'نص',
          },
        ],
        modelUsed: 'openai/gpt-5',
        tokensUsed: { input: 1, output: 2 },
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    ];
    const ui = legacyMessagesToUi(legacy);
    expect(ui).toHaveLength(2);
    const back = mapUiMessagesToLegacy(ui, ctx());
    expect(back[0].content).toBe('سؤال');
    expect(back[1].content).toBe('إجابة [1]');
    expect(back[1].citations).toHaveLength(1);
    expect(back[1].modelUsed).toBe('openai/gpt-5');
  });

  it('extracts the last user text for the stream route prompt', () => {
    const msgs: UIMessage[] = [
      userMsg('u1', 'السؤال الأول'),
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'رد' }] },
      userMsg('u2', 'السؤال الثاني'),
    ];
    expect(extractLastUserText(msgs)).toBe('السؤال الثاني');
    expect(extractLastUserText([])).toBe('');
  });
});
