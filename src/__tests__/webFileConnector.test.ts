import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Web-file connector contract (source type `web_file`):
 * 1. Downloads a file from a public URL through the SSRF-guarded fetcher and
 *    processes it via the SHARED upload-studio pipeline (processFileBuffer).
 * 2. The user-selected engine (auto | mistral | unstructured) is passed
 *    through untouched; unknown values fall back to 'auto'.
 * 3. Failures (missing URL, failed download, empty extraction) surface as
 *    honest errors — nothing fabricated is ever indexed.
 */

async function loadConnectors(mocks: {
  safeFetchBinary: ReturnType<typeof vi.fn>;
  processFileBuffer: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  vi.doMock('@/lib/mcp/net', () => ({
    safeFetchText: vi.fn(),
    safeFetchBinary: mocks.safeFetchBinary,
    htmlToText: (html: string) => html,
  }));
  vi.doMock('@/lib/services/unstructuredService', () => ({
    processFileBuffer: mocks.processFileBuffer,
  }));
  return import('../lib/connectors/liveConnectors');
}

describe('extractFromWebFile', () => {
  let safeFetchBinary: ReturnType<typeof vi.fn>;
  let processFileBuffer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    safeFetchBinary = vi.fn();
    processFileBuffer = vi.fn();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/mcp/net');
    vi.doUnmock('@/lib/services/unstructuredService');
    vi.resetModules();
  });

  it('downloads the file and returns pipeline output ready for indexing', async () => {
    safeFetchBinary.mockResolvedValue({
      ok: true,
      status: 200,
      contentType: 'application/pdf; charset=binary',
      bytes: Buffer.from('%PDF-1.4 fake'),
      truncated: false,
    });
    processFileBuffer.mockResolvedValue({
      text: 'محتوى المستند المستخرج',
      engineUsed: 'Mistral Document AI',
      totalPages: 3,
      chunksProcessed: 1,
    });

    const { extractFromWebFile } = await loadConnectors({ safeFetchBinary, processFileBuffer });
    const result = await extractFromWebFile({
      fileUrl: 'https://example.com/reports/annual-2026.pdf',
    });

    expect(safeFetchBinary).toHaveBeenCalledWith(
      'https://example.com/reports/annual-2026.pdf',
      expect.objectContaining({ maxBytes: 50 * 1024 * 1024 }),
    );
    // Default engine is auto; file name inferred from the URL path.
    expect(processFileBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'annual-2026.pdf', 'application/pdf', {
      preferredEngine: 'auto',
    });
    expect(result.title).toContain('annual-2026.pdf');
    expect(result.content).toContain('محتوى المستند المستخرج');
    expect(result.content).toContain('https://example.com/reports/annual-2026.pdf');
    expect(result.sourceUrl).toBe('https://example.com/reports/annual-2026.pdf');
    expect(result.itemsProcessed).toBe(1);
  });

  it('passes the user-selected engine through and honors an explicit fileName', async () => {
    safeFetchBinary.mockResolvedValue({
      ok: true,
      status: 200,
      contentType: 'application/octet-stream',
      bytes: Buffer.from('data'),
      truncated: false,
    });
    processFileBuffer.mockResolvedValue({
      text: 'text',
      engineUsed: 'Unstructured Transform',
      totalPages: 1,
      chunksProcessed: 1,
    });

    const { extractFromWebFile } = await loadConnectors({ safeFetchBinary, processFileBuffer });
    await extractFromWebFile({
      fileUrl: 'https://cdn.example.com/download?id=42',
      engine: 'mistral',
      fileName: 'report.docx',
    });

    expect(processFileBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'report.docx', 'application/octet-stream', {
      preferredEngine: 'mistral',
    });
  });

  it('falls back to auto for unknown engine values', async () => {
    safeFetchBinary.mockResolvedValue({
      ok: true,
      status: 200,
      contentType: 'text/plain',
      bytes: Buffer.from('hello'),
      truncated: false,
    });
    processFileBuffer.mockResolvedValue({
      text: 'hello',
      engineUsed: 'Direct UTF-8 Text Reader',
      totalPages: 1,
      chunksProcessed: 1,
    });

    const { extractFromWebFile } = await loadConnectors({ safeFetchBinary, processFileBuffer });
    await extractFromWebFile({ fileUrl: 'https://example.com/notes.txt', engine: 'bogus-engine' });

    expect(processFileBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'notes.txt', 'text/plain', {
      preferredEngine: 'auto',
    });
  });

  it('throws an honest error when fileUrl is missing', async () => {
    const { extractFromWebFile } = await loadConnectors({ safeFetchBinary, processFileBuffer });
    await expect(extractFromWebFile({})).rejects.toThrow(/fileUrl/);
    expect(safeFetchBinary).not.toHaveBeenCalled();
  });

  it('throws when the download fails', async () => {
    safeFetchBinary.mockResolvedValue({
      ok: false,
      status: 404,
      contentType: '',
      bytes: Buffer.alloc(0),
      truncated: false,
      error: 'HTTP 404: Not Found',
    });

    const { extractFromWebFile } = await loadConnectors({ safeFetchBinary, processFileBuffer });
    await expect(extractFromWebFile({ fileUrl: 'https://example.com/gone.pdf' })).rejects.toThrow(/404/);
    expect(processFileBuffer).not.toHaveBeenCalled();
  });

  it('throws when the pipeline extracts no text (never fabricates content)', async () => {
    safeFetchBinary.mockResolvedValue({
      ok: true,
      status: 200,
      contentType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4 encrypted'),
      truncated: false,
    });
    processFileBuffer.mockResolvedValue({
      text: '',
      engineUsed: 'Mistral Document AI',
      totalPages: 0,
      chunksProcessed: 0,
    });

    const { extractFromWebFile } = await loadConnectors({ safeFetchBinary, processFileBuffer });
    await expect(extractFromWebFile({ fileUrl: 'https://example.com/locked.pdf' })).rejects.toThrow(
      /Mistral Document AI/,
    );
  });
});

describe('fileNameFromUrl', () => {
  it('extracts, decodes and validates file names', async () => {
    const { fileNameFromUrl } = await loadConnectors({ safeFetchBinary: vi.fn(), processFileBuffer: vi.fn() });
    expect(fileNameFromUrl('https://example.com/a/b/report%20final.pdf')).toBe('report final.pdf');
    expect(fileNameFromUrl('https://example.com/download?id=42')).toBe('downloaded-file');
    expect(fileNameFromUrl('https://example.com/')).toBe('downloaded-file');
    expect(fileNameFromUrl('not a url')).toBe('downloaded-file');
  });
});

describe('web_file connector dispatch', () => {
  it('is registered as a live-sync connector and routes through extractFromWebFile', async () => {
    const safeFetchBinary = vi.fn(async () => ({
      ok: true,
      status: 200,
      contentType: 'text/plain',
      bytes: Buffer.from('remote text'),
      truncated: false,
    }));
    const processFileBuffer = vi.fn(async () => ({
      text: 'remote text',
      engineUsed: 'Direct UTF-8 Text Reader',
      totalPages: 1,
      chunksProcessed: 1,
    }));

    const { supportsLiveSync, extractConnectorContent } = await loadConnectors({ safeFetchBinary, processFileBuffer });

    expect(supportsLiveSync('web_file')).toBe(true);
    const extraction = await extractConnectorContent('web_file', { fileUrl: 'https://example.com/notes.txt' });
    expect(extraction?.content).toContain('remote text');
    expect(safeFetchBinary).toHaveBeenCalledTimes(1);
  });
});
