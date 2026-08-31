import { describe, it, expect } from 'vitest';

/**
 * Empty-bubble regression guard.
 *
 * Symptom this pins: when the provider fails (quota, timeout, provider error),
 * the turn may carry an error marker with NO text part — mapUiMessageToLegacy
 * previously concatenated only text parts, producing an empty assistant
 * bubble after minutes of retry backoff.
 *
 * Type note: AI SDK v7's UIMessagePart union has no 'error' member (the error
 * chunk surfaces via onError), but runtimes may append `{ type: 'error',
 * errorText }` parts — getErrorText() scans defensively for exactly that
 * shape, so the tests build parts through the same runtime cast.
 */

import { mapUiMessagesToLegacy, getErrorText, extractText, type LegacyMapContext } from '../lib/chat/uiMessageMapper';
import type { UIMessage } from 'ai';

function ctx(): LegacyMapContext {
  return { tenantId: 't1', conversationId: 'c1', timestamps: new Map() };
}

/** Runtime-cast builder — mirrors how an error part appears at runtime. */
function errorPart(errorText: string): UIMessage['parts'][number] {
  return { type: 'error', errorText } as unknown as UIMessage['parts'][number];
}

function ui(role: 'user' | 'assistant', parts: UIMessage['parts'], id = 'm1'): UIMessage {
  return { id, role, parts } as UIMessage;
}

describe('getErrorText', () => {
  it('extracts the runtime error part text', () => {
    const msg = ui('assistant', [errorPart('استُهلكت حصة المزود')]);
    expect(getErrorText(msg)).toBe('استُهلكت حصة المزود');
  });

  it('returns undefined without an error part', () => {
    const msg = ui('assistant', [{ type: 'text', text: 'مرحبا' }]);
    expect(getErrorText(msg)).toBeUndefined();
  });

  it('ignores blank error text', () => {
    const msg = ui('assistant', [errorPart('   ')]);
    expect(getErrorText(msg)).toBeUndefined();
  });
});

describe('mapUiMessagesToLegacy — provider failure must not render an empty bubble', () => {
  it('error-only message maps to visible error content', () => {
    const [mapped] = mapUiMessagesToLegacy(
      [ui('assistant', [errorPart('استُهلكت حصة مزوّد الذكاء الاصطناعي')])],
      ctx(),
    );
    expect(mapped).toBeTruthy();
    expect(mapped!.role).toBe('assistant');
    expect(mapped!.content).toContain('استُهلكت حصة مزوّد الذكاء الاصطناعي');
    expect(mapped!.content.startsWith('⚠️')).toBe(true);
  });

  it('normal text message is unchanged (no error marker)', () => {
    const [mapped] = mapUiMessagesToLegacy([ui('assistant', [{ type: 'text', text: 'إجابة طبيعية' }])], ctx());
    expect(mapped!.content).toBe('إجابة طبيعية');
  });

  it('partial answer + error keeps the streamed text first', () => {
    const msg = ui('assistant', [{ type: 'text', text: 'إجابة جزئية وصلت قبل الفشل' }, errorPart('انقطع التوليد')]);
    const [mapped] = mapUiMessagesToLegacy([msg], ctx());
    // Existing text wins — the error must not replace delivered content.
    expect(mapped!.content).toBe('إجابة جزئية وصلت قبل الفشل');
  });

  it('user messages pass through untouched', () => {
    const [mapped] = mapUiMessagesToLegacy([ui('user', [{ type: 'text', text: 'سؤالي' }])], ctx());
    expect(mapped!.content).toBe('سؤالي');
    expect(mapped!.role).toBe('user');
  });
});

describe('extractText — the pre-fix behavior baseline', () => {
  it('error-only message yields EMPTY text (why the mapper hook exists)', () => {
    const msg = ui('assistant', [errorPart('خطأ ما')]);
    expect(extractText(msg)).toBe('');
  });
});
