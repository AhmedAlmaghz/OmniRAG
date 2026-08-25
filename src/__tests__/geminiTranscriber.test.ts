import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Gemini speech-to-text transcriber contract:
 * 1. Small media goes inline (base64) — no Files API round-trip.
 * 2. Media above the inline limit is uploaded through the Gemini Files API,
 *    referenced by URI, and ALWAYS deleted again afterwards (even on failure).
 * 3. Missing API key or empty output surfaces as an honest success:false.
 */

function makeAiMock(overrides: { fileStates?: string[] } = {}) {
  const states = overrides.fileStates && overrides.fileStates.length > 0 ? overrides.fileStates : ['ACTIVE'];
  let getCalls = 0;
  return {
    files: {
      upload: vi.fn(async () => ({
        name: 'files/test-upload',
        uri: 'https://generativelanguage.googleapis.com/files/test-upload',
      })),
      get: vi.fn(async () => {
        const state = states[Math.min(getCalls, states.length - 1)];
        getCalls += 1;
        return { state, uri: 'https://generativelanguage.googleapis.com/files/test-upload' };
      }),
      delete: vi.fn(async () => ({})),
    },
  };
}

async function loadService(aiMock: any, generateMock: ReturnType<typeof vi.fn>) {
  vi.doMock('@/lib/gemini/resilientGemini', () => ({
    getResilientAiClient: () => aiMock,
    generateContentWithResilience: generateMock,
  }));
  return import('../lib/services/unstructuredService');
}

describe('transcribeWithGemini', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/gemini/resilientGemini');
    vi.resetModules();
  });

  it('returns honest failure when no Gemini client is configured', async () => {
    const { transcribeWithGemini } = await loadService(null, vi.fn());
    const result = await transcribeWithGemini(Buffer.from('audio'), 'clip.m4a', 'audio/mp4');

    expect(result.success).toBe(false);
    expect(result.metadata?.error).toContain('GEMINI_API_KEY');
  });

  it('sends small audio inline without touching the Files API', async () => {
    const aiMock = makeAiMock();
    const generateMock = vi.fn(async (_params: any) => ({ text: 'نص مفرغ من الصوت' }));
    const { transcribeWithGemini } = await loadService(aiMock, generateMock);

    const result = await transcribeWithGemini(Buffer.from('small-audio'), 'clip.m4a', 'audio/mp4');

    expect(result.success).toBe(true);
    expect(result.text).toBe('نص مفرغ من الصوت');
    const contents = generateMock.mock.calls[0][0].contents;
    expect(contents[0].inlineData).toBeDefined();
    expect(contents[0].fileData).toBeUndefined();
    expect(aiMock.files.upload).not.toHaveBeenCalled();
    expect(aiMock.files.delete).not.toHaveBeenCalled();
  });

  it('uploads large audio via the Files API, waits for ACTIVE, then cleans up', async () => {
    const aiMock = makeAiMock({ fileStates: ['PROCESSING', 'ACTIVE'] });
    const generateMock = vi.fn(async (_params: any) => ({ text: 'long video transcript' }));
    const { transcribeWithGemini } = await loadService(aiMock, generateMock);

    const largeBuffer = Buffer.alloc(14 * 1024 * 1024 + 1); // just over the inline limit
    const result = await transcribeWithGemini(largeBuffer, 'long.m4a', 'audio/mp4');

    expect(result.success).toBe(true);
    expect(result.text).toBe('long video transcript');
    expect(aiMock.files.upload).toHaveBeenCalledTimes(1);
    expect(aiMock.files.get).toHaveBeenCalledTimes(2); // PROCESSING then ACTIVE
    const contents = generateMock.mock.calls[0][0].contents;
    expect(contents[0].fileData?.fileUri).toContain('files/test-upload');
    expect(contents[0].inlineData).toBeUndefined();
    expect(aiMock.files.delete).toHaveBeenCalledWith({ name: 'files/test-upload' });
  });

  it('deletes the uploaded file even when generation fails', async () => {
    const aiMock = makeAiMock();
    const generateMock = vi.fn(async (_params: any) => null); // all models failed
    const { transcribeWithGemini } = await loadService(aiMock, generateMock);

    const largeBuffer = Buffer.alloc(14 * 1024 * 1024 + 1);
    const result = await transcribeWithGemini(largeBuffer, 'long.m4a', 'audio/mp4');

    expect(result.success).toBe(false);
    expect(aiMock.files.delete).toHaveBeenCalledWith({ name: 'files/test-upload' });
  });
});
