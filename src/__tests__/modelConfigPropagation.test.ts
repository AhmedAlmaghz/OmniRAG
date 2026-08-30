import { describe, it, expect } from 'vitest';

/**
 * Model-config propagation contract: the four newly wrapped routes
 * (documents POST, sources sync, reindex, versions) bind the client's
 * per-request model choices via parseModelConfigFromRequest →
 * runWithModelConfig. This pins the exact guarantee those wrappers rely on:
 * inside the bound context, EVERY getAiModel key resolves to the header's
 * value, and outside it falls back — no ambient leakage between requests.
 */

import { parseModelConfigFromRequest, getAiModel, DEFAULT_AI_MODELS } from '../lib/config/aiModels';
import { runWithModelConfig } from '../lib/config/aiModelsServer';

function reqWithHeader(cfg: unknown): Request {
  return new Request('https://omnirag.example/api/v1/documents', {
    headers: { 'x-ai-model-config': JSON.stringify(cfg) },
  });
}

const CUSTOM = {
  chatModel: 'fake-chat-model-xyz',
  analysisModel: 'gemini-3.1-pro-preview',
  hydeModel: 'gemini-3.7-flash',
  documentParseModel: 'gemini-3.7-flash',
  chatStreamModel: 'gemini-3.7-flash',
  embeddingModel: 'gemini-embedding-2-preview',
  whisperModel: 'whisper-large-v3',
  ocrModel: 'mistral-ocr-latest',
};

describe('model config propagation (route wrapper contract)', () => {
  it('header config reaches getAiModel inside runWithModelConfig', async () => {
    const parsed = parseModelConfigFromRequest(reqWithHeader(CUSTOM));
    expect(parsed.chatModel).toBe('fake-chat-model-xyz');
    expect(parsed.embeddingModel).toBe('gemini-embedding-2-preview');

    const inner = await runWithModelConfig(parsed, async () => ({
      chat: getAiModel('chatModel'),
      embedding: getAiModel('embeddingModel'),
      whisper: getAiModel('whisperModel'),
      ocr: getAiModel('ocrModel'),
      stream: getAiModel('chatStreamModel'),
      parse: getAiModel('documentParseModel'),
    }));

    // Every operation key resolves to the header's choice — this is what the
    // ingestion pipeline (embedding) and sync pipeline (ocr/whisper) rely on.
    expect(inner.chat).toBe('fake-chat-model-xyz');
    expect(inner.embedding).toBe('gemini-embedding-2-preview');
    expect(inner.whisper).toBe('whisper-large-v3');
    expect(inner.ocr).toBe('mistral-ocr-latest');
    expect(inner.stream).toBe('gemini-3.7-flash');
    expect(inner.parse).toBe('gemini-3.7-flash');
  });

  it('config does NOT leak outside the wrapped context', async () => {
    const parsed = parseModelConfigFromRequest(reqWithHeader(CUSTOM));
    await runWithModelConfig(parsed, async () => {
      expect(getAiModel('chatModel')).toBe('fake-chat-model-xyz');
    });
    // Back outside: defaults again — a later request without the header must
    // never inherit the previous request's models.
    expect(getAiModel('chatModel')).toBe(DEFAULT_AI_MODELS.chatModel);
  });

  it('runWithModelConfig returns the callback value', async () => {
    const parsed = parseModelConfigFromRequest(reqWithHeader(CUSTOM));
    const out = await runWithModelConfig(parsed, async () => 'ok');
    expect(out).toBe('ok');
  });

  it('malformed header falls back to defaults, not an exception', () => {
    const bad = new Request('https://x.example', { headers: { 'x-ai-model-config': '{not-json' } });
    const parsed = parseModelConfigFromRequest(bad);
    expect(parsed.chatModel).toBe(DEFAULT_AI_MODELS.chatModel);
  });

  it('partial header fills missing keys from defaults', () => {
    const partial = reqWithHeader({ embeddingModel: 'gemini-embedding-2-preview' });
    const parsed = parseModelConfigFromRequest(partial);
    expect(parsed.embeddingModel).toBe('gemini-embedding-2-preview');
    expect(parsed.chatModel).toBe(DEFAULT_AI_MODELS.chatModel);
  });
});
