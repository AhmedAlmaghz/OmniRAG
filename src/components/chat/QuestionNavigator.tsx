'use client';

import React, { useState } from 'react';
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

/**
 * A slim side navigation cluster for the chat stream:
 *   [ scroll-to-top ]
 *   [ minimap rail — one tick per user question ]
 *   [ scroll-to-bottom ]
 *
 * Hovering a tick previews the question text; clicking it scrolls the stream
 * to that exchange. Kept deliberately tiny and unobtrusive for long chats.
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

  const questions = messages.filter((m) => m.role === 'user');
  const hasRail = questions.length > 0;
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
          {questions.map((q, i) => (
            <div key={q.id} className="relative flex items-center justify-center">
              {/* Hover preview bubble — opens toward the chat content. The
                  logical insetInlineEnd places it on the content side in both
                  RTL (rail on the left) and LTR (rail on the right). */}
              {hoveredId === q.id && (
                <div
                  className={`absolute top-1/2 -translate-y-1/2 z-30 w-52 p-2 rounded-lg bg-slate-900 text-white text-[11px] leading-snug shadow-xl pointer-events-none animate-fadeIn ${
                    lang === 'ar' ? 'text-right' : 'text-left'
                  }`}
                  style={{ insetInlineEnd: 'calc(100% + 0.5rem)' }}
                >
                  <span className="block text-[9px] font-bold text-indigo-300 mb-0.5">
                    {t(lang, 'chatNav.questionN', { n: i + 1 })}
                  </span>
                  <span className="line-clamp-3">{q.content}</span>
                </div>
              )}

              <button
                type="button"
                onClick={() => onJumpToMessage(q.id)}
                onMouseEnter={() => setHoveredId(q.id)}
                onMouseLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(q.id)}
                onBlur={() => setHoveredId(null)}
                className="w-3.5 h-[5px] rounded-full bg-slate-400/70 hover:bg-indigo-500 hover:w-4 hover:h-[7px] transition-all duration-150 cursor-pointer"
                title={t(lang, 'chatNav.questionN', { n: i + 1 })}
                aria-label={t(lang, 'chatNav.questionAria', { n: i + 1, preview: q.content.slice(0, 60) })}
              />
            </div>
          ))}
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
