import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Gemini speech-to-text transcriber contract (AI SDK v7 implementation):
 * 1. Small media goes inline ({type:'data'}) — no Files API round-trip.
 * 2. Media above the inline limit is uploaded through the Gemini Files API,
 *    referenced by URL part, and ALWAYS deleted again afterwards.
 * 3. Missing API key or empty output surfaces as an honest success:false.
 * 4. YouTube URLs are passed directly as a url file part (no download).
 */

async function loadService(mocks: { generateText: ReturnType<typeof vi.fn>; uploadFile?: ReturnType<typeof vi.fn> }) {
  vi.resetModules();
  vi.doMock('@/lib/rag/googleProvider', () => ({
    resolveGeminiApiKey: () => 'test-gemini-key',
    google: (modelId: string) => ({ modelId }),
    getGoogleProvider: () => ({ id: 'google-provider' }),
  }));
  // Multi-provider resolution — returns a {modelId} stub so assertions on
  // call.model.modelId keep working, and reports the provider as configured.
  vi.doMock('@/lib/ai/registry/resolve', () => ({
    resolveLanguageModel: async (modelId: string) => ({ modelId }),
    isModelRefConfigured: async () => true,
  }));
  // Minimal config stubs so the model chain doesn't depend on defaults.
  vi.doMock('@/lib/config/aiModels', () => ({
    getAiModel: () => 'test-primary-model',
    getFallbackModels: () => [],
  }));
  vi.doMock('ai', () => ({
    generateText: mocks.generateText,
    uploadFile: mocks.uploadFile ?? vi.fn(),
  }));
  return import('../lib/services/unstructuredService');
}

describe('transcribeWithGemini', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/rag/googleProvider');
    vi.doUnmock('@/lib/ai/registry/resolve');
    vi.doUnmock('@/lib/config/aiModels');
    vi.doUnmock('ai');
    vi.resetModules();
  });

  it('returns honest failure when no Gemini key is configured', async () => {
    vi.resetModules();
    vi.doMock('@/lib/rag/googleProvider', () => ({
      resolveGeminiApiKey: () => '',
      google: vi.fn(),
      getGoogleProvider: () => ({}),
    }));
    vi.doMock('@/lib/ai/registry/resolve', () => ({
      resolveLanguageModel: async (modelId: string) => ({ modelId }),
      isModelRefConfigured: async () => false,
    }));
    vi.doMock('@/lib/config/aiModels', () => ({
      getAiModel: () => 'm',
      getFallbackModels: () => [],
    }));
    vi.doMock('ai', () => ({ generateText: vi.fn() }));
    const { transcribeWithGemini } = await import('../lib/services/unstructuredService');
    const result = await transcribeWithGemini(Buffer.from('audio'), 'clip.m4a', 'audio/mp4');

    expect(result.success).toBe(false);
    expect(result.metadata?.error).toContain('GEMINI_API_KEY');
  });

  it('sends small audio inline without touching the Files API', async () => {
    const uploadFileMock = vi.fn();
    const generateMock = vi.fn(async (_params: any) => ({ text: 'نص مفرغ من الصوت' }));
    const { transcribeWithGemini } = await loadService({ generateText: generateMock, uploadFile: uploadFileMock });

    const result = await transcribeWithGemini(Buffer.from('small-audio'), 'clip.m4a', 'audio/mp4');

    expect(result.success).toBe(true);
    expect(result.text).toBe('نص مفرغ من الصوت');
    const call = generateMock.mock.calls[0][0];
    expect(call.model.modelId).toBe('test-primary-model');
    const mediaPart = call.messages[0].content[0];
    expect(mediaPart.type).toBe('file');
    expect(mediaPart.data.type).toBe('data');
    expect(mediaPart.mediaType).toBe('audio/mp4');
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('uploads large audio via AI SDK uploadFile and references it by provider reference', async () => {
    const providerReference = { provider: 'google', ref: 'files/test-upload' };
    const uploadFileMock = vi.fn(async (_opts: any) => ({ providerReference, warnings: [] }));
    const generateMock = vi.fn(async (_params: any) => ({ text: 'long video transcript' }));
    const { transcribeWithGemini } = await loadService({ generateText: generateMock, uploadFile: uploadFileMock });

    const largeBuffer = Buffer.alloc(14 * 1024 * 1024 + 1); // just over the inline limit
    const result = await transcribeWithGemini(largeBuffer, 'long.m4a', 'audio/mp4');

    expect(result.success).toBe(true);
    expect(result.text).toBe('long video transcript');
    expect(uploadFileMock).toHaveBeenCalledTimes(1);
    expect(uploadFileMock.mock.calls[0][0].filename).toBe('long.m4a');
    const mediaPart = generateMock.mock.calls[0][0].messages[0].content[0];
    expect(mediaPart.data.type).toBe('reference');
    expect(mediaPart.data.reference).toBe(providerReference);
  });

  it('surfaces an honest failure when the Files API upload fails', async () => {
    const uploadFileMock = vi.fn(async () => {
      throw new Error('upload rejected: quota exceeded');
    });
    const generateMock = vi.fn(async (_params: any) => ({ text: '' }));
    const { transcribeWithGemini } = await loadService({ generateText: generateMock, uploadFile: uploadFileMock });

    const largeBuffer = Buffer.alloc(14 * 1024 * 1024 + 1);
    const result = await transcribeWithGemini(largeBuffer, 'long.m4a', 'audio/mp4');

    expect(result.success).toBe(false);
    expect(result.metadata?.error).toContain('quota exceeded');
    expect(generateMock).not.toHaveBeenCalled();
  });
});

describe('transcribeYoutubeUrlWithGemini', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/rag/googleProvider');
    vi.doUnmock('@/lib/ai/registry/resolve');
    vi.doUnmock('@/lib/config/aiModels');
    vi.doUnmock('ai');
    vi.resetModules();
  });

  it('falls through the fallback chain and reports the last error honestly', async () => {
    const generateMock = vi.fn(async (params: any) => {
      if (params.model.modelId === 'test-primary-model') throw new Error('503 overloaded');
      if (params.model.modelId === 'fallback-a') throw new Error('quota exceeded');
      return { text: '' }; // last model answers empty
    });
    vi.resetModules();
    vi.doMock('@/lib/rag/googleProvider', () => ({
      resolveGeminiApiKey: () => 'k',
      google: (modelId: string) => ({ modelId }),
    }));
    vi.doMock('@/lib/ai/registry/resolve', () => ({
      resolveLanguageModel: async (modelId: string) => ({ modelId }),
      isModelRefConfigured: async () => true,
    }));
    vi.doMock('@/lib/config/aiModels', () => ({
      getAiModel: () => 'test-primary-model',
      getFallbackModels: () => ['fallback-a'],
    }));
    vi.doMock('ai', () => ({ generateText: generateMock }));
    const { transcribeYoutubeUrlWithGemini } = await import('../lib/services/unstructuredService');

    const result = await transcribeYoutubeUrlWithGemini('https://www.youtube.com/watch?v=x');

    expect(result.success).toBe(false);
    expect(generateMock).toHaveBeenCalledTimes(2); // primary + one fallback
    expect(result.metadata?.error).toContain('fallback-a');
  });
});
