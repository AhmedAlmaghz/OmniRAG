'use client';

import React, { useMemo, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { Message } from '@/lib/types/omnirag';
import { t } from '@/lib/i18n';

interface QuestionNavigatorProps {
  messages: Message[];
  lang: 'ar' | 'en';
  /** Scroll the message stream so the given message id is visible. */
  onJumpToMessage: (messageId: string) => void;
  /** Scroll-to-top / scroll-to-bottom controls rendered above & below the rail. */
  showScrollTop?: boolean;
  showScrollBottom?: boolean;
  onScrollToTop?: () => void;
  onScrollToBottom?: () => void;
}

/** One navigable exchange: the user question plus a preview of its answer. */
interface QuestionExchange {
  id: string;
  question: string;
  answer: string | null;
}

/**
 * Collapse markdown syntax to plain readable text so the hover card preview
 * stays a clean prose snippet (no ###, **, ``` fences or table pipes).
 */
export function toPreviewText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/(\*\*|__|\*|~~)/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pair each user question with the assistant answer that follows it in the
 * message list (the answer may still be streaming — a partial preview is fine).
 */
export function buildExchanges(messages: Message[]): QuestionExchange[] {
  const exchanges: QuestionExchange[] = [];
  let pending: QuestionExchange | null = null;
  for (const msg of messages) {
    if (msg.role === 'user') {
      if (pending) exchanges.push(pending);
      pending = { id: msg.id, question: toPreviewText(msg.content), answer: null };
    } else if (msg.role === 'assistant' && pending) {
      const text = toPreviewText(msg.content);
      if (text) {
        pending.answer = pending.answer ? `${pending.answer} ${text}`.slice(0, 400) : text.slice(0, 400);
      }
    }
  }
  if (pending) exchanges.push(pending);
  return exchanges;
}

/**
 * A slim side navigation cluster for the chat stream:
 *   [ scroll-to-top ]
 *   [ minimap rail — one tick per user question ]
 *   [ scroll-to-bottom ]
 *
 * Hovering a tick shows a card titled with part of the user's question and a
 * snippet of the answer, so the user can tell where each tick leads before
 * clicking. Clicking scrolls the stream to that exchange.
 */
export const QuestionNavigator: React.FC<QuestionNavigatorProps> = ({
  messages,
  lang,
  onJumpToMessage,
  showScrollTop = false,
  showScrollBottom = false,
  onScrollToTop,
  onScrollToBottom,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const exchanges = useMemo(() => buildExchanges(messages), [messages]);
  const hasRail = exchanges.length > 0;
  const hasScrollButtons = showScrollTop || showScrollBottom;
  if (!hasRail && !hasScrollButtons) return null;

  const navButtonCls =
    'w-7 h-7 rounded-full bg-white/95 backdrop-blur-sm border border-slate-200 shadow-md hover:bg-indigo-600 hover:border-indigo-600 hover:text-white text-slate-500 flex items-center justify-center transition-all duration-150 cursor-pointer animate-fadeIn';

  return (
    <div
      className="no-print absolute top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1.5"
      style={{ insetInlineEnd: '0.375rem' }}
      aria-label={t(lang, 'chatNav.ariaLabel')}
    >
      {/* Scroll to top — sits above the rail */}
      {showScrollTop && onScrollToTop && (
        <button
          type="button"
          onClick={onScrollToTop}
          className={navButtonCls}
          title={t(lang, 'chatNav.jumpToTop')}
          aria-label={t(lang, 'chatNav.jumpToTop')}
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Minimap rail — one tick per user question */}
      {hasRail && (
        <div className="flex flex-col items-center justify-center gap-[3px] max-h-[34vh] overflow-y-auto no-scrollbar rounded-full bg-slate-100/80 backdrop-blur-sm border border-slate-200/70 px-[3px] py-1.5 shadow-xs">
          {exchanges.map((ex, i) => {
            const isHovered = hoveredId === ex.id;
            return (
              <div key={ex.id} className="relative flex items-center justify-center">
                {/* Hover preview card — opens toward the chat content. The
                    logical insetInlineEnd places it on the content side in both
                    RTL (rail on the left) and LTR (rail on the right). */}
                {isHovered && (
                  <div
                    role="tooltip"
                    className={`absolute top-1/2 -translate-y-1/2 z-30 w-60 p-2.5 rounded-xl bg-white border border-slate-200 shadow-2xl pointer-events-none animate-fadeIn ${
                      lang === 'ar' ? 'text-right' : 'text-left'
                    }`}
                    style={{ insetInlineEnd: 'calc(100% + 0.5rem)' }}
                  >
                    <span className="block text-[9px] font-bold text-indigo-600 mb-1">
                      {t(lang, 'chatNav.questionN', { n: i + 1 })}
                    </span>
                    <p className="text-[11px] font-bold text-slate-800 leading-snug line-clamp-2 break-words">
                      {ex.question || t(lang, 'chatNav.emptyQuestion')}
                    </p>
                    {ex.answer && (
                      <p className="mt-1.5 pt-1.5 border-t border-slate-100 text-[10px] text-slate-500 leading-relaxed line-clamp-3 break-words">
                        {ex.answer}
                      </p>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => onJumpToMessage(ex.id)}
                  onMouseEnter={() => setHoveredId(ex.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(ex.id)}
                  onBlur={() => setHoveredId(null)}
                  className={`w-3.5 rounded-full transition-all duration-150 cursor-pointer ${
                    isHovered ? 'bg-indigo-500 w-4 h-[7px]' : 'bg-slate-400/70 h-[5px] hover:bg-indigo-400'
                  }`}
                  title={t(lang, 'chatNav.questionN', { n: i + 1 })}
                  aria-label={t(lang, 'chatNav.questionAria', { n: i + 1, preview: ex.question.slice(0, 60) })}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Scroll to bottom — sits below the rail */}
      {showScrollBottom && onScrollToBottom && (
        <button
          type="button"
          onClick={onScrollToBottom}
          className={navButtonCls}
          title={t(lang, 'chatNav.jumpToBottom')}
          aria-label={t(lang, 'chatNav.jumpToBottom')}
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
