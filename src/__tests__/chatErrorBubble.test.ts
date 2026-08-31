import { describe, it, expect } from 'vitest';

/**
 * Empty-bubble regression guard.
 *
 * Symptom this pins: when the provider fails (quota, timeout, provider error),
 * the stream emits an ERROR part with no text part — mapUiMessageToLegacy
 * previously concatenated only text parts, producing an empty assistant
 * bubble after minutes of retry backoff. The mapper must surface the error
 * text as the message content.
 */

import { mapUiMessagesToLegacy, getErrorText, type LegacyMapContext } from '../lib/chat/uiMessageMapper';
import type { UIMessage } from 'ai';

function ctx(): LegacyMapContext & { timestamps: LegacyMapContext['timestamps'] } {
  return { tenantId: 't1', conversationId: 'c1', timestamps: new Map() };
}

function ui(role: 'user' | 'assistant', parts: UIMessage['parts'], id = 'm1'): UIMessage {
  return { id, role, parts } as UIMessage;
}

describe('getErrorText', () => {
  it('extracts the error part text', () => {
    const msg = ui('assistant', [{ type: 'error', errorText: 'استُهلكت حصة المزود' }]);
    expect(getErrorText(msg)).toBe('استُهلكت حصة المزود');
  });

  it('returns undefined without an error part', () => {
    const msg = ui('assistant', [{ type: 'text', text: 'مرحبا' }]);
    expect(getErrorText(msg)).toBeUndefined();
  });

  it('ignores blank error text', () => {
    const msg = ui('assistant', [{ type: 'error', errorText: '   ' }]);
    expect(getErrorText(msg)).toBeUndefined();
  });
});

describe('mapUiMessagesToLegacy — provider failure must not render an empty bubble', () => {
  it('error-only message maps to visible error content', () => {
    const [mapped] = mapUiMessagesToLegacy(
      [ui('assistant', [{ type: 'error', errorText: 'استُهلكت حصة مزوّد الذكاء الاصطناعي مؤقتًا' }])],
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
    const [mapped] = mapUiMessagesToLegacy(
      [
        ui('assistant', [
          { type: 'text', text: 'إجابة جزئية وصلت قبل الفشل' },
          { type: 'error', errorText: 'انقطع التوليد' },
        ]),
      ],
      ctx(),
    );
    // Existing text wins — the error must not replace delivered content.
    expect(mapped!.content).toBe('إجابة جزئية وصلت قبل الفشل');
  });

  it('user messages pass through untouched', () => {
    const [mapped] = mapUiMessagesToLegacy([ui('user', [{ type: 'text', text: 'سؤالي' }])], ctx());
    expect(mapped!.content).toBe('سؤالي');
    expect(mapped!.role).toBe('user');
  });
});
