/**
 * QuestionNavigator — exchange pairing & preview text tests.
 *
 * The navigator rail renders one tick per user question and its hover card
 * shows that question plus a snippet of the assistant answer that follows it.
 * These tests pin down the pairing logic and the markdown-collapsing preview.
 */

import { describe, it, expect } from 'vitest';
import { buildExchanges, toPreviewText } from '@/components/chat/QuestionNavigator';
import type { Message } from '@/lib/types/omnirag';

function msg(id: string, role: 'user' | 'assistant', content: string): Message {
  return {
    id,
    tenantId: 'tenant_demo',
    conversationId: 'conv-test',
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

describe('buildExchanges — question/answer pairing', () => {
  it('pairs each user question with the assistant answer that follows it', () => {
    const exchanges = buildExchanges([
      msg('u1', 'user', 'ما هي خطة النشر؟'),
      msg('a1', 'assistant', 'خطة النشر تتضمن ثلاث مراحل.'),
      msg('u2', 'user', 'وما التكلفة؟'),
      msg('a2', 'assistant', 'التكلفة تعتمد على الخطة المختارة.'),
    ]);

    expect(exchanges).toHaveLength(2);
    expect(exchanges[0]).toMatchObject({
      id: 'u1',
      question: 'ما هي خطة النشر؟',
      answer: 'خطة النشر تتضمن ثلاث مراحل.',
    });
    expect(exchanges[1]).toMatchObject({
      id: 'u2',
      question: 'وما التكلفة؟',
      answer: 'التكلفة تعتمد على الخطة المختارة.',
    });
  });

  it('keeps a trailing unanswered question (answer stays null)', () => {
    const exchanges = buildExchanges([
      msg('u1', 'user', 'سؤال أول'),
      msg('a1', 'assistant', 'إجابة أولى'),
      msg('u2', 'user', 'سؤال بلا إجابة بعد'),
    ]);

    expect(exchanges).toHaveLength(2);
    expect(exchanges[1].answer).toBeNull();
  });

  it('ignores the synthetic welcome assistant bubble that precedes any question', () => {
    const exchanges = buildExchanges([
      msg('msg-welcome', 'assistant', 'مرحباً بك في OmniRAG!'),
      msg('u1', 'user', 'سؤال حقيقي'),
      msg('a1', 'assistant', 'إجابة'),
    ]);

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].id).toBe('u1');
  });

  it('does not leak an assistant message into the previous exchange after a new question', () => {
    const exchanges = buildExchanges([
      msg('u1', 'user', 'سؤال'),
      msg('u2', 'user', 'سؤال فور السؤال'),
      msg('a1', 'assistant', 'إجابة على الأخير فقط'),
    ]);

    expect(exchanges).toHaveLength(2);
    expect(exchanges[0].answer).toBeNull();
    expect(exchanges[1].answer).toBe('إجابة على الأخير فقط');
  });

  it('caps the concatenated answer preview at 400 characters', () => {
    const exchanges = buildExchanges([
      msg('u1', 'user', 'سؤال'),
      msg('a1', 'assistant', 'أ'.repeat(300)),
      msg('a2', 'assistant', 'ب'.repeat(300)),
    ]);

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].answer!.length).toBeLessThanOrEqual(400);
  });
});

describe('toPreviewText — markdown collapsing', () => {
  it('strips headings, bold, inline code and list markers', () => {
    const out = toPreviewText('## العنوان\n\n- **نقطة** `مهمة` ونص عادي');
    expect(out).toBe('العنوان نقطة مهمة ونص عادي');
  });

  it('drops fenced code blocks and keeps prose around them', () => {
    const out = toPreviewText('قبل\n```js\nconst x = 1;\n```\nبعد');
    expect(out).toBe('قبل بعد');
  });

  it('converts links to their label text', () => {
    const out = toPreviewText('راجع [الوثائق](https://example.com/docs) أولاً');
    expect(out).toBe('راجع الوثائق أولاً');
  });

  it('drops images and collapses table pipes to spaces', () => {
    const out = toPreviewText('![شعار](logo.png)\n| العمود | القيمة |');
    expect(out).toBe('العمود القيمة');
  });

  it('collapses repeated whitespace into single spaces', () => {
    const out = toPreviewText('نص   مع\n\nمسافات   متعددة');
    expect(out).toBe('نص مع مسافات متعددة');
  });
});
