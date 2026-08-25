import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Provider-package transcription contract (AI SDK v7):
 * 1. transcribeWithGroqWhisper runs through `transcribe()` + @ai-sdk/groq
 *    (`whisper-large-v3`) instead of a hand-rolled multipart fetch.
 * 2. transcribeWithMistralVoxtral runs through `transcribe()` +
 *    @ai-sdk/mistral (`voxtral-mini-latest`) as an independent second vendor.
 * 3. Missing keys / empty output surface as honest success:false.
 */

async function loadService(opts: { groqKey?: string; mistralKey?: string } = {}) {
  vi.resetModules();
  vi.doMock('@/lib/ai/providers', () => ({
    resolveGroqApiKey: () => opts.groqKey ?? '',
    resolveMistralApiKey: () => opts.mistralKey ?? '',
    groqTranscriptionModel: (modelId?: string) => ({ provider: 'groq', modelId: modelId || 'whisper-large-v3' }),
    mistralTranscriptionModel: () => ({ provider: 'mistral', modelId: 'voxtral-mini-latest' }),
  }));
  return import('../lib/services/unstructuredService');
}

describe('transcribeWithGroqWhisper (AI SDK)', () => {
  let transcribeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    transcribeMock = vi.fn();
    vi.doMock('ai', () => ({
      generateText: vi.fn(),
      uploadFile: vi.fn(),
      transcribe: transcribeMock,
    }));
  });

  afterEach(() => {
    vi.doUnmock('@/lib/ai/providers');
    vi.doUnmock('ai');
    vi.resetModules();
  });

  it('returns the transcription via AI SDK + groq transcription model', async () => {
    transcribeMock.mockResolvedValue({ text: 'hello from whisper' });
    const { transcribeWithGroqWhisper } = await loadService({ groqKey: 'k' });

    const result = await transcribeWithGroqWhisper(Buffer.from('audio'), 'clip.m4a', 'audio/mp4', 'k');

    expect(result.success).toBe(true);
    expect(result.text).toBe('hello from whisper');
    expect(result.engineUsed).toContain('Whisper');
    const call = transcribeMock.mock.calls[0][0];
    expect(call.model.modelId).toBe('whisper-large-v3');
    expect(call.model.provider).toBe('groq');
  });

  it('surfaces an honest failure when GROQ_API_KEY is missing', async () => {
    const { transcribeWithGroqWhisper } = await loadService({});
    const result = await transcribeWithGroqWhisper(Buffer.from('audio'), 'clip.m4a', 'audio/mp4');

    expect(result.success).toBe(false);
    expect(result.metadata?.error).toContain('GROQ_API_KEY');
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('reports empty output as an honest failure', async () => {
    transcribeMock.mockResolvedValue({ text: '' });
    const { transcribeWithGroqWhisper } = await loadService({ groqKey: 'k' });
    const result = await transcribeWithGroqWhisper(Buffer.from('silence'), 'clip.m4a', 'audio/mp4', 'k');

    expect(result.success).toBe(false);
  });
});

describe('transcribeWithMistralVoxtral (AI SDK)', () => {
  let transcribeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    transcribeMock = vi.fn();
    vi.doMock('ai', () => ({
      generateText: vi.fn(),
      uploadFile: vi.fn(),
      transcribe: transcribeMock,
    }));
  });

  afterEach(() => {
    vi.doUnmock('@/lib/ai/providers');
    vi.doUnmock('ai');
    vi.resetModules();
  });

  it('returns the transcription via AI SDK + mistral voxtral model', async () => {
    transcribeMock.mockResolvedValue({ text: 'نص من فوكسترال' });
    const { transcribeWithMistralVoxtral } = await loadService({ mistralKey: 'k' });

    const result = await transcribeWithMistralVoxtral(Buffer.from('audio'), 'clip.m4a', 'audio/mp4');

    expect(result.success).toBe(true);
    expect(result.text).toBe('نص من فوكسترال');
    const call = transcribeMock.mock.calls[0][0];
    expect(call.model.modelId).toBe('voxtral-mini-latest');
    expect(call.model.provider).toBe('mistral');
  });

  it('surfaces an honest failure when MISTRAL_API_KEY is missing', async () => {
    const { transcribeWithMistralVoxtral } = await loadService({});
    const result = await transcribeWithMistralVoxtral(Buffer.from('audio'), 'clip.m4a', 'audio/mp4');

    expect(result.success).toBe(false);
    expect(result.metadata?.error).toContain('MISTRAL_API_KEY');
    expect(transcribeMock).not.toHaveBeenCalled();
  });
});
