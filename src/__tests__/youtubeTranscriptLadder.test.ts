import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * YouTube transcript extraction ladder contract:
 * 1. When captions exist, they are used directly and NO audio is downloaded.
 * 2. When captions are missing, the downloaded audio goes to Groq Whisper
 *    first (if configured) and then to Gemini multimodal transcription.
 * 3. Gemini speech-to-text over the real audio is a valid success path.
 * 4. When nothing yields text, the function throws TRANSCRIPT_UNAVAILABLE —
 *    it never fabricates a transcript.
 */

/**
 * Fake ytdl stream: emits its events only AFTER the consumer has attached its
 * listeners (transcriptParser calls ytdl() several awaits after the mock is
 * created, so eager emission would be lost).
 */
function makeFakeYtdlStream(options: { data?: Buffer; error?: Error }): any {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  let scheduled = false;
  const stream = {
    on(event: string, cb: (...args: any[]) => void) {
      (handlers[event] ||= []).push(cb);
      if (!scheduled) {
        scheduled = true;
        process.nextTick(() => {
          if (options.error) {
            (handlers['error'] || []).forEach((h) => h(options.error));
            return;
          }
          (handlers['data'] || []).forEach((h) => h(options.data));
          (handlers['end'] || []).forEach((h) => h());
        });
      }
      return stream;
    },
    destroy: vi.fn(),
  };
  return stream;
}

async function loadParser(mocks: {
  fetchTranscript: ReturnType<typeof vi.fn>;
  getSubtitles: ReturnType<typeof vi.fn>;
  ytdl: ReturnType<typeof vi.fn>;
  groq: ReturnType<typeof vi.fn>;
  gemini: ReturnType<typeof vi.fn>;
  geminiUrl: ReturnType<typeof vi.fn>;
  voxtral: ReturnType<typeof vi.fn>;
}) {
  vi.doMock('youtube-transcript', () => ({
    YoutubeTranscript: { fetchTranscript: mocks.fetchTranscript },
  }));
  vi.doMock('youtube-captions-scraper', () => ({ getSubtitles: mocks.getSubtitles }));
  vi.doMock('@distube/ytdl-core', () => ({ default: mocks.ytdl }));
  vi.doMock('@/lib/services/unstructuredService', () => ({
    transcribeWithGroqWhisper: mocks.groq,
    transcribeWithMistralVoxtral: mocks.voxtral,
    transcribeWithGemini: mocks.gemini,
    transcribeYoutubeUrlWithGemini: mocks.geminiUrl,
  }));
  // Key presence is driven by env vars so tests can toggle vendors.
  vi.doMock('@/lib/ai/providers', () => ({
    resolveGroqApiKey: () => process.env.GROQ_API_KEY || '',
    resolveMistralApiKey: () => process.env.MISTRAL_API_KEY || '',
    groqTranscriptionModel: (m?: string) => ({ provider: 'groq', modelId: m }),
    mistralTranscriptionModel: () => ({ provider: 'mistral', modelId: 'voxtral-mini-latest' }),
  }));
  // Key presence is driven by GEMINI_API_KEY so tests can toggle it.
  vi.doMock('@/lib/rag/googleProvider', () => ({
    resolveGeminiApiKey: () => process.env.GEMINI_API_KEY || '',
  }));
  return import('../lib/youtube/transcriptParser');
}

describe('YouTube transcript extraction ladder', () => {
  let fetchTranscript: ReturnType<typeof vi.fn>;
  let getSubtitles: ReturnType<typeof vi.fn>;
  let ytdl: ReturnType<typeof vi.fn>;
  let groq: ReturnType<typeof vi.fn>;
  let gemini: ReturnType<typeof vi.fn>;
  let geminiUrl: ReturnType<typeof vi.fn>;
  let voxtral: ReturnType<typeof vi.fn>;
  let savedGroqKey: string | undefined;
  let savedGeminiKey: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    fetchTranscript = vi.fn();
    getSubtitles = vi.fn();
    ytdl = vi.fn();
    groq = vi.fn();
    gemini = vi.fn();
    geminiUrl = vi.fn();
    voxtral = vi.fn();
    savedGroqKey = process.env.GROQ_API_KEY;
    savedGeminiKey = process.env.GEMINI_API_KEY;

    // A caption-less YouTube page: metadata only, no caption tracks.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => '<html><head><title>Test Video - YouTube</title></head><body></body></html>',
      })),
    );
  });

  afterEach(() => {
    if (savedGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = savedGroqKey;
    if (savedGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedGeminiKey;
    delete process.env.MISTRAL_API_KEY;
    vi.unstubAllGlobals();
    vi.doUnmock('youtube-transcript');
    vi.doUnmock('youtube-captions-scraper');
    vi.doUnmock('@distube/ytdl-core');
    vi.doUnmock('@/lib/services/unstructuredService');
    vi.resetModules();
  });

  it('uses available captions and never downloads audio', async () => {
    fetchTranscript.mockResolvedValue([{ offset: 5000, text: 'مرحبا بكم' }]);
    const { processYoutubeTranscript } = await loadParser({
      fetchTranscript,
      getSubtitles,
      ytdl,
      groq,
      gemini,
      geminiUrl,
      voxtral,
    });

    const result = await processYoutubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'ar');

    expect(result.success).toBe(true);
    expect(result.transcript).toContain('مرحبا بكم');
    expect(result.extractionMethod).toContain('youtube-transcript');
    expect(ytdl).not.toHaveBeenCalled();
    expect(groq).not.toHaveBeenCalled();
    expect(gemini).not.toHaveBeenCalled();
  });

  it('falls back to Gemini speech-to-text when captions are missing and Groq fails', async () => {
    process.env.GROQ_API_KEY = 'groq-test-key';
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    fetchTranscript.mockRejectedValue(new Error('Transcript not found'));
    getSubtitles.mockRejectedValue(new Error('Could not get subtitles'));
    ytdl.mockImplementation(() => makeFakeYtdlStream({ data: Buffer.from('fake-audio-bytes') }));
    groq.mockResolvedValue({ text: '', engineUsed: 'groq', success: false });
    gemini.mockResolvedValue({
      text: 'تفريغ حقيقي من صوت الفيديو',
      engineUsed: 'Gemini Audio Speech-to-Text Transcription Engine',
      success: true,
    });

    const { processYoutubeTranscript } = await loadParser({
      fetchTranscript,
      getSubtitles,
      ytdl,
      groq,
      gemini,
      geminiUrl,
      voxtral,
    });
    const result = await processYoutubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'ar');

    expect(result.success).toBe(true);
    expect(result.transcript).toBe('تفريغ حقيقي من صوت الفيديو');
    expect(result.extractionMethod).toBe('Gemini Audio Speech-to-Text Transcription Engine');
    expect(ytdl).toHaveBeenCalledTimes(1);
    expect(groq).toHaveBeenCalledTimes(1);
    expect(gemini).toHaveBeenCalledTimes(1);
  });

  it('uses Groq Whisper when it succeeds and skips Gemini', async () => {
    process.env.GROQ_API_KEY = 'groq-test-key';
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    fetchTranscript.mockRejectedValue(new Error('Transcript not found'));
    getSubtitles.mockRejectedValue(new Error('Could not get subtitles'));
    ytdl.mockImplementation(() => makeFakeYtdlStream({ data: Buffer.from('fake-audio-bytes') }));
    groq.mockResolvedValue({ text: 'groq transcript', engineUsed: 'groq', success: true });

    const { processYoutubeTranscript } = await loadParser({
      fetchTranscript,
      getSubtitles,
      ytdl,
      groq,
      gemini,
      geminiUrl,
      voxtral,
    });
    const result = await processYoutubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'ar');

    expect(result.transcript).toBe('groq transcript');
    expect(result.extractionMethod).toContain('Groq Whisper');
    expect(gemini).not.toHaveBeenCalled();
  });

  it('uses Gemini directly when only GEMINI_API_KEY is configured', async () => {
    delete process.env.GROQ_API_KEY;
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    fetchTranscript.mockRejectedValue(new Error('Transcript not found'));
    getSubtitles.mockRejectedValue(new Error('Could not get subtitles'));
    ytdl.mockImplementation(() => makeFakeYtdlStream({ data: Buffer.from('fake-audio-bytes') }));
    gemini.mockResolvedValue({
      text: 'gemini transcript',
      engineUsed: 'Gemini Audio Speech-to-Text Transcription Engine',
      success: true,
    });

    const { processYoutubeTranscript } = await loadParser({
      fetchTranscript,
      getSubtitles,
      ytdl,
      groq,
      gemini,
      geminiUrl,
      voxtral,
    });
    const result = await processYoutubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'ar');

    expect(result.transcript).toBe('gemini transcript');
    expect(groq).not.toHaveBeenCalled();
    expect(gemini).toHaveBeenCalledTimes(1);
  });

  it('throws TRANSCRIPT_UNAVAILABLE when no captions and no transcription engine is configured', async () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    fetchTranscript.mockRejectedValue(new Error('Transcript not found'));
    getSubtitles.mockRejectedValue(new Error('Could not get subtitles'));

    const { processYoutubeTranscript, TranscriptExtractionError } = await loadParser({
      fetchTranscript,
      getSubtitles,
      ytdl,
      groq,
      gemini,
      geminiUrl,
      voxtral,
    });

    await expect(processYoutubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'ar')).rejects.toMatchObject({
      name: 'TranscriptExtractionError',
      code: 'TRANSCRIPT_UNAVAILABLE',
    });
    // No download attempt without any transcription engine, no fabrication.
    expect(ytdl).not.toHaveBeenCalled();
    expect(TranscriptExtractionError).toBeDefined();
  });

  it('uses Mistral Voxtral as the second vendor when Groq is unavailable', async () => {
    process.env.GROQ_API_KEY = '';
    process.env.MISTRAL_API_KEY = 'mistral-test-key';
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    fetchTranscript.mockRejectedValue(new Error('Transcript not found'));
    getSubtitles.mockRejectedValue(new Error('Could not get subtitles'));
    ytdl.mockImplementation(() => makeFakeYtdlStream({ data: Buffer.from('fake-audio-bytes') }));
    voxtral.mockResolvedValue({
      text: 'voxtral transcript',
      engineUsed: 'Mistral Voxtral (voxtral-mini-latest) ⚡',
      success: true,
    });

    const { processYoutubeTranscript } = await loadParser({
      fetchTranscript,
      getSubtitles,
      ytdl,
      groq,
      gemini,
      geminiUrl,
      voxtral,
    });

    const result = await processYoutubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'ar');

    expect(result.success).toBe(true);
    expect(result.transcript).toBe('voxtral transcript');
    expect(result.extractionMethod).toContain('Voxtral');
    expect(voxtral).toHaveBeenCalledTimes(1);
    expect(gemini).not.toHaveBeenCalled();
    expect(geminiUrl).not.toHaveBeenCalled();
  });

  it('falls back to Gemini DIRECT video-URL transcription when the audio download is blocked', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    fetchTranscript.mockRejectedValue(new Error('Transcript not found'));
    getSubtitles.mockRejectedValue(new Error('Could not get subtitles'));
    ytdl.mockImplementation(() => makeFakeYtdlStream({ error: new Error('Failed to find any playable formats') }));
    geminiUrl.mockResolvedValue({
      text: 'transcript straight from the video URL',
      engineUsed: 'Gemini Direct YouTube Video Transcription',
      success: true,
    });

    const { processYoutubeTranscript } = await loadParser({
      fetchTranscript,
      getSubtitles,
      ytdl,
      groq,
      gemini,
      geminiUrl,
      voxtral,
    });

    const result = await processYoutubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'ar');

    expect(result.success).toBe(true);
    expect(result.transcript).toBe('transcript straight from the video URL');
    expect(result.extractionMethod).toContain('Gemini Direct YouTube');
    // The buffer-based engines were never reached because the download failed.
    expect(groq).not.toHaveBeenCalled();
    expect(gemini).not.toHaveBeenCalled();
    expect(geminiUrl).toHaveBeenCalledTimes(1);
  });

  it('throws TRANSCRIPT_UNAVAILABLE listing real causes when every path fails', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    fetchTranscript.mockRejectedValue(new Error('Transcript not found'));
    getSubtitles.mockRejectedValue(new Error('Could not get subtitles'));
    ytdl.mockImplementation(() => makeFakeYtdlStream({ error: new Error('bot detection') }));
    geminiUrl.mockResolvedValue({
      text: '',
      engineUsed: 'Gemini Direct YouTube Video Transcription',
      success: false,
      metadata: { error: 'model: unsupported url' },
    });

    const { processYoutubeTranscript } = await loadParser({
      fetchTranscript,
      getSubtitles,
      ytdl,
      groq,
      gemini,
      geminiUrl,
      voxtral,
    });

    await expect(processYoutubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'ar')).rejects.toMatchObject({
      code: 'TRANSCRIPT_UNAVAILABLE',
    });
    expect(gemini).not.toHaveBeenCalled();

    // Capture the thrown error and verify it names the REAL causes.
    let message = '';
    try {
      await processYoutubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'ar');
    } catch (e: any) {
      message = e.message;
    }
    expect(message).toContain('bot detection');
    expect(message).toContain('unsupported url');
  });
});
