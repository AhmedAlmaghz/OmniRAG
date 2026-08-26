import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Web-file fetch studio feature contract:
 *
 * 1. `validateWebFileUrl` (client helper) mirrors the server SSRF policy:
 *    only public http(s) URLs pass; localhost/private ranges/other schemes
 *    are rejected with localized errors before any request is made.
 * 2. `fileNameFromContentDisposition` parses RFC 6266/5987 headers with the
 *    extended (filename*) form winning over the plain quoted form.
 * 3. `dispatchFile` with preferredEngine='local' NEVER calls a cloud engine:
 *    PDFs route into the batched pipeline in local-only mode, images go
 *    straight to offline Tesseract, text stays a direct UTF-8 read, and
 *    audio/video/spreadsheets fail honestly instead of billing an API.
 */

import { validateWebFileUrl } from '../components/sources/documentIngestionHelpers';
import { fileNameFromContentDisposition, fileNameFromUrl } from '../lib/connectors/liveConnectors';

describe('validateWebFileUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(validateWebFileUrl('https://example.com/files/report.pdf').isValid).toBe(true);
    expect(validateWebFileUrl('  http://cdn.example.org/data/dataset.json ').isValid).toBe(true);
  });

  it('rejects empty or malformed input', () => {
    expect(validateWebFileUrl('').isValid).toBe(false);
    expect(validateWebFileUrl('   ').isValid).toBe(false);
    expect(validateWebFileUrl('not-a-url').isValid).toBe(false);
  });

  it('rejects non-http schemes (ftp, file, javascript)', () => {
    expect(validateWebFileUrl('ftp://example.com/file.pdf').isValid).toBe(false);
    expect(validateWebFileUrl('file:///etc/passwd').isValid).toBe(false);
    expect(validateWebFileUrl('javascript:alert(1)').isValid).toBe(false);
  });

  it('rejects localhost and private-range hosts (SSRF surface)', () => {
    expect(validateWebFileUrl('http://localhost/secret.pdf').isValid).toBe(false);
    expect(validateWebFileUrl('http://127.0.0.1:8080/file.pdf').isValid).toBe(false);
    expect(validateWebFileUrl('http://192.168.1.10/file.pdf').isValid).toBe(false);
    expect(validateWebFileUrl('http://10.0.0.5/file.pdf').isValid).toBe(false);
    expect(validateWebFileUrl('http://172.16.3.9/file.pdf').isValid).toBe(false);
    expect(validateWebFileUrl('http://169.254.169.254/latest/meta-data').isValid).toBe(false);
  });
});

describe('fileNameFromContentDisposition', () => {
  it('returns empty for missing header', () => {
    expect(fileNameFromContentDisposition(null)).toBe('');
    expect(fileNameFromContentDisposition('')).toBe('');
  });

  it('parses plain quoted filenames', () => {
    expect(fileNameFromContentDisposition('attachment; filename="report.pdf"')).toBe('report.pdf');
    expect(fileNameFromContentDisposition('inline; filename=notes.txt')).toBe('notes.txt');
  });

  it('prefers RFC 5987 extended form and decodes UTF-8 names', () => {
    const arabic = encodeURIComponent('تقرير') + '.pdf';
    expect(fileNameFromContentDisposition(`attachment; filename*=UTF-8''${arabic}`)).toBe('تقرير.pdf');
  });

  it('extended form wins when both are present', () => {
    const arabic = encodeURIComponent('وثيقة') + '.docx';
    expect(fileNameFromContentDisposition(`attachment; filename="fallback.docx"; filename*=UTF-8''${arabic}`)).toBe(
      'وثيقة.docx',
    );
  });

  it('never throws on malformed headers', () => {
    expect(fileNameFromContentDisposition('attachment; filename*=%E0%A4%%')).not.toBeUndefined();
  });
});

describe('fileNameFromUrl fallback chain', () => {
  it('extracts the last path segment and falls back cleanly', () => {
    expect(fileNameFromUrl('https://example.com/a/b/report.pdf')).toBe('report.pdf');
    expect(fileNameFromUrl('https://example.com/no-extension')).toBe('downloaded-file');
    expect(fileNameFromUrl('https://example.com/')).toBe('downloaded-file');
  });
});

// ---------------------------------------------------------------------------
// dispatchFile preferredEngine='local' routing (cloud-free guarantee)
// ---------------------------------------------------------------------------

async function loadDispatch(mocks: {
  ocrImageBuffer?: ReturnType<typeof vi.fn>;
  processPdfWithBatchedPipeline?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  // Static deps of unstructuredService — stubbed to keep the module import
  // free of provider/network side effects (same pattern as geminiTranscriber).
  vi.doMock('@/lib/rag/googleProvider', () => ({
    resolveGeminiApiKey: () => '',
    google: vi.fn(),
    getGoogleProvider: () => ({}),
  }));
  vi.doMock('@/lib/config/aiModels', () => ({
    getAiModel: () => 'test-model',
    getFallbackModels: () => [],
  }));
  vi.doMock('@/lib/ai/resilientGenerate', () => ({
    generateTextResilient: vi.fn().mockResolvedValue({ text: '' }),
  }));
  vi.doMock('@/lib/ai/providers', () => ({
    groqTranscriptionModel: vi.fn(),
    mistralTranscriptionModel: vi.fn(),
    resolveGroqApiKey: () => '',
    resolveMistralApiKey: () => '',
  }));

  // Dynamic-import targets exercised by the 'local' branch.
  if (mocks.ocrImageBuffer) {
    vi.doMock('@/lib/services/localOcr', () => ({ ocrImageBuffer: mocks.ocrImageBuffer }));
  }
  if (mocks.processPdfWithBatchedPipeline) {
    vi.doMock('@/lib/pdf/pdfChunker', () => ({
      processPdfWithBatchedPipeline: mocks.processPdfWithBatchedPipeline,
    }));
  }

  return import('../lib/services/unstructuredService');
}

describe("dispatchFile preferredEngine='local'", () => {
  afterEach(() => {
    [
      '@/lib/rag/googleProvider',
      '@/lib/config/aiModels',
      '@/lib/ai/resilientGenerate',
      '@/lib/ai/providers',
      '@/lib/services/localOcr',
      '@/lib/pdf/pdfChunker',
    ].forEach((m) => vi.doUnmock(m));
    vi.resetModules();
  });

  it('routes images straight to offline Tesseract on success', async () => {
    const ocrImageBuffer = vi.fn().mockResolvedValue('نص مستخرج من الصورة محلياً');
    const { dispatchFile } = await loadDispatch({ ocrImageBuffer });

    const result = await dispatchFile(Buffer.from('fake-png-bytes'), 'scan.png', 'image/png', {
      preferredEngine: 'local',
    });

    expect(ocrImageBuffer).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.engineUsed).toContain('Tesseract');
  });

  it('fails honestly when local OCR yields nothing — no cloud fallback', async () => {
    const ocrImageBuffer = vi.fn().mockResolvedValue('');
    const { dispatchFile } = await loadDispatch({ ocrImageBuffer });

    const result = await dispatchFile(Buffer.from('blank-image'), 'blank.png', 'image/png', {
      preferredEngine: 'local',
    });

    expect(result.success).toBe(false);
    expect(result.text).toBe('');
    expect(String(result.metadata?.error || '')).toContain('محلي');
  });

  it('refuses audio transcription instead of silently calling cloud STT', async () => {
    const { dispatchFile } = await loadDispatch({});
    const result = await dispatchFile(Buffer.from('mp3-bytes'), 'speech.mp3', 'audio/mpeg', {
      preferredEngine: 'local',
    });

    expect(result.success).toBe(false);
    expect(result.engineUsed).toContain('Local Libraries Only');
  });

  it('reads plain text directly without any OCR or network call', async () => {
    const { dispatchFile } = await loadDispatch({});
    const result = await dispatchFile(Buffer.from('مرحبا بالعالم'), 'notes.txt', 'text/plain', {
      preferredEngine: 'local',
    });

    expect(result.success).toBe(true);
    expect(result.engineUsed).toContain('Direct UTF-8 Text Reader');
    expect(result.text).toBe('مرحبا بالعالم');
  });

  it('delegates PDFs to the batched pipeline in local-only mode', async () => {
    const processPdfWithBatchedPipeline = vi.fn().mockResolvedValue({
      text: 'نص من طبقة الـ PDF المحلية',
      engineUsed: 'Native High-Speed PDF Parser',
      totalPages: 4,
      chunksProcessed: 1,
    });
    const { dispatchFile } = await loadDispatch({ processPdfWithBatchedPipeline });

    const result = await dispatchFile(Buffer.from('%PDF-1.4 fake'), 'doc.pdf', 'application/pdf', {
      preferredEngine: 'local',
    });

    expect(processPdfWithBatchedPipeline).toHaveBeenCalledWith(expect.any(Buffer), { preferredEngine: 'local' });
    expect(result.success).toBe(true);
    expect(result.engineUsed).toBe('Native High-Speed PDF Parser');
  });
});
