import { describe, it, expect } from 'vitest';

/**
 * Chat model-resolution contract: the streaming route resolves the model as
 * explicit body `model` > header `chatStreamModel` > cookie/defaults config,
 * and the fallback-swap metadata (fallbackFrom) survives the legacy message
 * mapping so the UI can surface a notice.
 *
 * The route's own resolution block is small enough to pin here through the
 * pure helpers it composes: parseModelConfigFromRequest (header/cookie/
 * defaults) plus the uiMessageMapper meta extraction.
 */

import { parseModelConfigFromRequest, DEFAULT_AI_MODELS } from '../lib/config/aiModels';
import { getChatMeta, mapUiMessageToLegacy } from '../lib/chat/uiMessageMapper';
import type { UIMessage } from 'ai';

function reqWith(cookieValue?: string, headerValue?: string): Request {
  const headers: Record<string, string> = {};
  if (headerValue) headers['x-ai-model-config'] = headerValue;
  if (cookieValue) headers['cookie'] = `omnirag_ai_model_config=${encodeURIComponent(cookieValue)}`;
  return new Request('https://omnirag.example/api/v1/chat/stream', { headers });
}

const FULL_COOKIE = {
  chatModel: 'fake-chat-model-xyz',
  chatStreamModel: 'fake-stream-model-xyz',
};

describe('chat model resolution (stream route contract)', () => {
  it('cookie config is honored when no header is present', () => {
    // ChatStudio sends the explicit `model` body field, so this cookie path
    // serves requests from other browsers/API consumers after a settings save.
    const parsed = parseModelConfigFromRequest(reqWith(JSON.stringify(FULL_COOKIE)));
    expect(parsed.chatModel).toBe('fake-chat-model-xyz');
    expect(parsed.chatStreamModel).toBe('fake-stream-model-xyz');
  });

  it('header replaces the whole config; non-overridden keys get DEFAULTS', () => {
    // The header is the full per-request config — it wins outright, and any
    // key it omits is normalized from DEFAULT_AI_MODELS (not the cookie).
    const header = JSON.stringify({ chatStreamModel: 'from-header' });
    const parsed = parseModelConfigFromRequest(reqWith(JSON.stringify(FULL_COOKIE), header));
    expect(parsed.chatStreamModel).toBe('from-header');
    expect(parsed.chatModel).toBe(DEFAULT_AI_MODELS.chatModel);
  });

  it('no header and no cookie resolves to defaults (never throws)', () => {
    const parsed = parseModelConfigFromRequest(reqWith());
    expect(parsed.chatStreamModel).toBe(DEFAULT_AI_MODELS.chatStreamModel);
    expect(parsed.chatModel).toBe(DEFAULT_AI_MODELS.chatModel);
  });

  it('malformed cookie falls back to defaults', () => {
    const parsed = parseModelConfigFromRequest(reqWith('not-json'));
    expect(parsed.chatModel).toBe(DEFAULT_AI_MODELS.chatModel);
  });
});

describe('fallback-swap metadata propagation (uiMessageMapper contract)', () => {
  const baseCtx = { tenantId: 't1', conversationId: 'conv-1', timestamps: new Map<string, string>() };

  function uiWithMeta(meta: object): UIMessage {
    return {
      id: 'msg-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'answer' },
        { type: 'data-meta', data: meta as unknown as UIMessage['parts'][number] extends never ? never : any },
      ],
    } as unknown as UIMessage;
  }

  it('fallbackFrom flows from data-meta into the legacy Message', () => {
    const ui = uiWithMeta({
      modelUsed: 'groq/llama-3.3-70b-versatile',
      tokensUsed: { input: 10, output: 20 },
      configured: true,
      fallbackFrom: 'gemini-3.7-flash',
    });
    const legacy = mapUiMessageToLegacy(ui, baseCtx);
    expect(legacy?.modelUsed).toBe('groq/llama-3.3-70b-versatile');
    expect(legacy?.fallbackFrom).toBe('gemini-3.7-flash');
    expect(legacy?.tokensUsed).toEqual({ input: 10, output: 20 });
  });

  it('no fallbackFrom in meta leaves the field unset on the message', () => {
    const ui = uiWithMeta({ modelUsed: 'gemini-3.7-flash', tokensUsed: { input: 1, output: 2 }, configured: true });
    const legacy = mapUiMessageToLegacy(ui, baseCtx);
    expect(legacy?.modelUsed).toBe('gemini-3.7-flash');
    expect(legacy?.fallbackFrom).toBeUndefined();
  });

  it('getChatMeta reads the LAST data-meta part', () => {
    const ui = uiWithMeta({ modelUsed: 'a' });
    (ui.parts as unknown[]).push({ type: 'data-meta', data: { modelUsed: 'b' } });
    expect(getChatMeta(ui)?.modelUsed).toBe('b');
  });
});
