import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unstructured Transform MCP tool contract:
 * 1. `unstructured_parse_document` delegates to the SHARED dispatchFile
 *    pipeline (no duplicated engine code) and returns real Markdown.
 * 2. `knowledge_ingest_document` accepts uploaded file content, registers a
 *    SourceConnector (storage in Sources), and indexes chunks into knowledge.
 * 3. Failures surface as honest success:false results, never fabricated text.
 */

function makeDbMock() {
  return {
    getMcpServers: vi.fn(async () => []),
    addSource: vi.fn(async () => {}),
    updateSource: vi.fn(async () => {}),
    addDocument: vi.fn(async () => {}),
    addChunks: vi.fn(async () => ({ indexed: 1, failed: 0, total: 1, errors: [], success: true })),
    addAuditLog: vi.fn(async () => {}),
  };
}

const CTX = { tenantId: 'tenant-acme-01', userId: 'user-1' };

// A minimal valid PDF header so detectFileType classifies by extension anyway.
const SAMPLE_PDF_BASE64 = Buffer.from('%PDF-1.4 fake pdf body for mcp test').toString('base64');

async function loadTools(dbMock: any, serviceMock: any) {
  vi.doMock('@/lib/storage/db', () => ({ db: dbMock }));
  vi.doMock('@/lib/services/unstructuredService', () => ({
    dispatchFile: serviceMock.dispatchFile,
    mistralOcr: serviceMock.mistralOcr ?? vi.fn(),
    normalizeMimeType: (_name: string, mime = 'application/octet-stream') => mime,
    detectFileType: () => ({ isPdf: true }),
  }));
  // Avoid pulling the real YouTube parser network path in these tests.
  vi.doMock('@/lib/youtube/transcriptParser', () => ({
    processYoutubeTranscript: serviceMock.processYoutubeTranscript ?? vi.fn(),
  }));
  return import('../lib/mcp/registry/tools');
}

describe('Unstructured Transform MCP tools', () => {
  let dbMock: any;
  let serviceMock: any;

  beforeEach(() => {
    dbMock = makeDbMock();
    serviceMock = {};
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/storage/db');
    vi.doUnmock('@/lib/services/unstructuredService');
    vi.doUnmock('@/lib/youtube/transcriptParser');
    vi.resetModules();
  });

  it('parses an uploaded file via the shared pipeline and returns Markdown', async () => {
    serviceMock.dispatchFile = vi.fn(async () => ({
      success: true,
      engineUsed: 'Local Mammoth DOCX Parser',
      text: '# Contract\n\nClause one content.',
    }));
    const { getToolDefinition } = await loadTools(dbMock, serviceMock);

    const outcome = await getToolDefinition('unstructured_parse_document')!.execute(
      {
        documentUrl: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${SAMPLE_PDF_BASE64}`,
        fileName: 'contract.docx',
      },
      CTX,
    );

    expect(serviceMock.dispatchFile).toHaveBeenCalledTimes(1);
    const [bufferArg, nameArg] = serviceMock.dispatchFile.mock.calls[0];
    expect(Buffer.isBuffer(bufferArg)).toBe(true);
    expect(nameArg).toBe('contract.docx');

    expect(outcome.success).toBe(true);
    expect(outcome.simulated).toBe(false);
    expect(outcome.markdown).toContain('# Contract');
    expect(outcome.engineUsed).toBe('Local Mammoth DOCX Parser');
  });

  it('returns an honest failure when the pipeline extracts nothing', async () => {
    serviceMock.dispatchFile = vi.fn(async () => ({
      success: false,
      engineUsed: 'Gemini Fallback',
      text: '',
    }));
    const { getToolDefinition } = await loadTools(dbMock, serviceMock);

    const outcome = await getToolDefinition('unstructured_parse_document')!.execute(
      { documentUrl: SAMPLE_PDF_BASE64, fileName: 'empty.pdf' },
      CTX,
    );

    expect(outcome.success).toBe(false);
    expect(outcome.simulated).toBe(false);
    expect(outcome.error).toMatch(/لم يتم استخراج/);
  });

  it('ingests a uploaded file into Sources + knowledge with chunk indexing', async () => {
    serviceMock.dispatchFile = vi.fn(async () => ({
      success: true,
      engineUsed: 'Mistral OCR',
      text: 'محتوى عربي كافٍ للفهرسة عبر أداة MCP في اختبار التكامل الكامل للمصادر.',
    }));
    const { getToolDefinition } = await loadTools(dbMock, serviceMock);

    const outcome = await getToolDefinition('knowledge_ingest_document')!.execute(
      { fileData: SAMPLE_PDF_BASE64, fileName: 'policy.pdf', title: 'سياسة أمنية' },
      CTX,
    );

    // Source connector registered → appears in Sources dashboard.
    expect(dbMock.addSource).toHaveBeenCalledTimes(1);
    const sourceRecord = dbMock.addSource.mock.calls[0][0];
    expect(sourceRecord.tenantId).toBe(CTX.tenantId);
    expect(sourceRecord.type).toBe('file');
    expect(sourceRecord.name).toBe('سياسة أمنية');

    // Document + chunk grid persisted against that source.
    expect(dbMock.addDocument).toHaveBeenCalledTimes(1);
    const docRecord = dbMock.addDocument.mock.calls[0][0];
    expect(docRecord.metadata.sourceId).toBe(sourceRecord.id);
    expect(docRecord.status).toBe('indexed');
    expect(dbMock.addChunks).toHaveBeenCalledTimes(1);
    expect(outcome.success).toBe(true);
    expect(outcome.sourceId).toBe(sourceRecord.id);
    expect(outcome.chunksIndexed).toBeGreaterThan(0);
  });

  it('reports youtube transcript results in markdown-ready shape', async () => {
    serviceMock.processYoutubeTranscript = vi.fn(async () => ({
      success: true,
      videoId: 'abc123',
      title: 'فيديو تعريفي',
      channel: 'قناة OmniRAG',
      duration: '10:24',
      thumbnail: '',
      videoUrl: 'https://www.youtube.com/watch?v=abc123',
      transcript: 'مرحباً بكم في هذا الفيديو...',
      wordCount: 6,
      extractionMethod: 'captions',
      extractedAt: new Date().toISOString(),
    }));
    const { getToolDefinition } = await loadTools(dbMock, serviceMock);

    const outcome = await getToolDefinition('youtube_fetch_transcript')!.execute(
      { url: 'https://www.youtube.com/watch?v=abc123' },
      CTX,
    );

    expect(outcome.success).toBe(true);
    expect(outcome.simulated).toBe(false);
    expect(outcome.title).toBe('فيديو تعريفي');
    expect(outcome.markdown).toContain('# فيديو تعريفي');
    expect(outcome.markdown).toContain('مرحباً بكم');
  });
});
