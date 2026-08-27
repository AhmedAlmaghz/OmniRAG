import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExtractionContext } from '../lib/services/extraction/types';
import type { FileTypeClassification } from '../lib/services/unstructuredService';

/**
 * Extraction-engine registry contracts (Phase 3). The registry replaces the
 * legacy hard-coded dispatchFile waterfall with an ordered, self-describing
 * chain. These tests pin:
 *  - priority ordering matches the legacy step sequence;
 *  - engine gating (API keys / file category / preferred engine) is correct;
 *  - the chain is honest: when no engine can produce text it reports failure
 *    rather than fabricating content.
 *
 * The Gemini fallback engine lazy-imports the model layer, so we mock it to
 * drive the chain's success and exhaustion paths without network calls.
 */

function classification(overrides: Partial<FileTypeClassification> = {}): FileTypeClassification {
  return {
    isText: false,
    isAudio: false,
    isVideo: false,
    isImage: false,
    isSpreadsheet: false,
    isWord: false,
    isPowerPoint: false,
    isPdf: false,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    fileBuffer: Buffer.from('data'),
    fileName: 'report.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    rawMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    classification: classification({ isSpreadsheet: true }),
    enginePref: 'auto',
    options: {},
    mistralKey: '',
    unstructuredKey: '',
    ...overrides,
  };
}

async function loadRegistry(mocks: { generateTextResilient: ReturnType<typeof vi.fn> }) {
  vi.resetModules();
  vi.doMock('@/lib/ai/resilientGenerate', () => ({
    generateTextResilient: mocks.generateTextResilient,
  }));
  vi.doMock('@/lib/config/aiModels', () => ({
    getAiModel: () => 'dummy-model',
  }));
  return import('../lib/services/extraction/registry');
}

describe('extraction engine registry', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.doUnmock('@/lib/ai/resilientGenerate');
    vi.doUnmock('@/lib/config/aiModels');
    vi.resetModules();
  });

  it('orders engines by descending priority with unique ids', async () => {
    const { listExtractionEngines } = await loadRegistry({ generateTextResilient: vi.fn() });
    const engines = listExtractionEngines();
    const ids = engines.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const priorities = engines.map((e) => e.priority);
    expect([...priorities]).toEqual([...priorities].sort((a, b) => b - a));
  });

  it('preserves the legacy waterfall step order', async () => {
    const { listExtractionEngines } = await loadRegistry({ generateTextResilient: vi.fn() });
    const order = listExtractionEngines().map((e) => e.id);
    expect(order).toEqual([
      'local_pptx',
      'mammoth_docx',
      'local_only',
      'audio_video',
      'plain_text',
      'mistral_ocr',
      'unstructured',
      'gemini',
      'tesseract',
      'pptx_slide_ocr',
    ]);
  });

  it('exposes a client-safe catalog (no functions leak)', async () => {
    const { toExtractionEngineCatalog } = await loadRegistry({ generateTextResilient: vi.fn() });
    for (const entry of toExtractionEngineCatalog()) {
      for (const [k, v] of Object.entries(entry)) {
        expect(typeof v, `catalog field ${k} must be serializable`).not.toBe('function');
      }
      expect(entry.id).toBeTruthy();
      expect(Array.isArray(entry.supportedCategories)).toBe(true);
    }
  });

  it('gates mistral/unstructured on API key + category + preference', async () => {
    const { getExtractionEngine } = await loadRegistry({ generateTextResilient: vi.fn() });
    const mistral = getExtractionEngine('mistral_ocr')!;
    const unstructured = getExtractionEngine('unstructured')!;

    const pdf = makeCtx({
      fileName: 'd.pdf',
      mimeType: 'application/pdf',
      classification: classification({ isPdf: true }),
    });
    // No key → not handled.
    expect(mistral.canHandle(pdf)).toBe(false);
    expect(unstructured.canHandle(pdf)).toBe(false);
    // With key + auto → handled.
    expect(mistral.canHandle({ ...pdf, mistralKey: 'k' })).toBe(true);
    expect(unstructured.canHandle({ ...pdf, unstructuredKey: 'k' })).toBe(true);
    // With key but a non-matching preference → skipped.
    expect(mistral.canHandle({ ...pdf, mistralKey: 'k', enginePref: 'unstructured' })).toBe(false);
    expect(unstructured.canHandle({ ...pdf, unstructuredKey: 'k', enginePref: 'mistral' })).toBe(false);
    // Non-matching category (audio) → skipped even with key.
    const audio = makeCtx({ classification: classification({ isAudio: true }) });
    expect(mistral.canHandle({ ...audio, mistralKey: 'k' })).toBe(false);
  });

  it('gates local_only on the local preference and audio_video on media', async () => {
    const { getExtractionEngine } = await loadRegistry({ generateTextResilient: vi.fn() });
    const localOnly = getExtractionEngine('local_only')!;
    const audioVideo = getExtractionEngine('audio_video')!;

    expect(localOnly.canHandle(makeCtx())).toBe(false);
    expect(localOnly.canHandle(makeCtx({ enginePref: 'local' }))).toBe(true);

    expect(audioVideo.canHandle(makeCtx())).toBe(false);
    expect(audioVideo.canHandle(makeCtx({ classification: classification({ isVideo: true }) }))).toBe(true);
  });
});

describe('runExtractionChain honesty', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.doUnmock('@/lib/ai/resilientGenerate');
    vi.doUnmock('@/lib/config/aiModels');
    vi.resetModules();
  });

  it('claims the file with the Gemini label when the fallback produces text', async () => {
    const generateTextResilient = vi.fn(async () => ({ text: 'جدول مستخرج' }));
    const { runExtractionChain } = await loadRegistry({ generateTextResilient });
    const result = await runExtractionChain(makeCtx());
    expect(result.success).toBe(true);
    expect(result.text).toBe('جدول مستخرج');
    expect(result.engineUsed).toBe('Gemini Excel-to-Markdown Tabular Parser');
  });

  it('reports honest failure (never fabricates) when no engine yields text', async () => {
    const generateTextResilient = vi.fn(async () => ({ text: '' }));
    const { runExtractionChain } = await loadRegistry({ generateTextResilient });
    const result = await runExtractionChain(makeCtx());
    expect(result.success).toBe(false);
    expect(result.text).toBe('');
    expect(result.engineUsed).toBe('None');
  });
});
