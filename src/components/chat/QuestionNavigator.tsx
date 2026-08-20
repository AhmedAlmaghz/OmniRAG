'use client';

import React, { useState } from 'react';
import type { Message } from '@/lib/types/omnirag';

interface QuestionNavigatorProps {
  messages: Message[];
  lang: 'ar' | 'en';
  /** Scroll the message stream so the given message id is visible. */
  onJumpToMessage: (messageId: string) => void;
}

/**
 * A slim minimap-style rail shown beside the chat stream — one small tick
 * per user question in the current conversation. Hovering a tick previews
 * the question text; clicking it scrolls the stream to that exchange.
 * Kept deliberately tiny and unobtrusive for long conversations.
 */
export const QuestionNavigator: React.FC<QuestionNavigatorProps> = ({ messages, lang, onJumpToMessage }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const questions = messages.filter((m) => m.role === 'user');
  if (questions.length === 0) return null;

  return (
    <div
      className="no-print absolute top-1/2 -translate-y-1/2 z-20 flex flex-col items-center"
      style={{ insetInlineEnd: '0.25rem' }}
      aria-label={lang === 'ar' ? 'التنقل بين الأسئلة' : 'Question navigation'}
    >
      <div className="flex flex-col items-center justify-center gap-[3px] max-h-[38vh] overflow-y-auto no-scrollbar rounded-full bg-slate-100/80 backdrop-blur-sm border border-slate-200/70 px-[3px] py-1.5 shadow-xs">
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
                  {lang === 'ar' ? `سؤال ${i + 1}` : `Question ${i + 1}`}
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
              title={lang === 'ar' ? `سؤال ${i + 1}` : `Question ${i + 1}`}
              aria-label={lang === 'ar' ? `سؤال ${i + 1}: ${q.content.slice(0, 60)}` : `Question ${i + 1}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
