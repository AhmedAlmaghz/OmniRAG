'use client';

import React, { useState } from 'react';
import { ListOrdered } from 'lucide-react';
import type { Message } from '@/lib/types/omnirag';

interface QuestionNavigatorProps {
  messages: Message[];
  lang: 'ar' | 'en';
  /** Scroll the message stream so the given message id is visible. */
  onJumpToMessage: (messageId: string) => void;
}

/**
 * A slim floating rail shown beside the chat stream. It draws one tick per
 * user question in the current conversation; hovering a tick previews the
 * question text, and clicking it scrolls the stream to that exchange.
 * Designed for fast navigation in long conversations.
 */
export const QuestionNavigator: React.FC<QuestionNavigatorProps> = ({ messages, lang, onJumpToMessage }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const questions = messages.filter((m) => m.role === 'user');
  if (questions.length === 0) return null;

  return (
    <div
      className="no-print absolute top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1.5"
      style={{ insetInlineEnd: '0.375rem' }}
      aria-label={lang === 'ar' ? 'التنقل بين الأسئلة' : 'Question navigation'}
    >
      <span
        className="flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-600/10 border border-indigo-200/60 text-indigo-600 mb-0.5"
        title={
          lang === 'ar' ? `${questions.length} أسئلة في هذه المحادثة` : `${questions.length} questions in this chat`
        }
      >
        <ListOrdered className="w-3.5 h-3.5" />
      </span>

      <div className="flex flex-col items-center gap-1 max-h-[55vh] overflow-y-auto no-scrollbar py-1">
        {questions.map((q, i) => (
          <div key={q.id} className="relative flex items-center">
            {/* Hover preview bubble — opens toward the chat content. The
                logical insetInlineEnd places it on the content side in both
                RTL (rail on the left) and LTR (rail on the right). */}
            {hoveredId === q.id && (
              <div
                className={`absolute top-1/2 -translate-y-1/2 z-30 w-56 p-2 rounded-lg bg-slate-900 text-white text-[11px] leading-snug shadow-xl pointer-events-none animate-fadeIn ${
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
              className="group flex items-center justify-center w-6 h-6 rounded-md border border-slate-200 bg-white/90 backdrop-blur-sm hover:bg-indigo-600 hover:border-indigo-600 hover:text-white text-slate-500 text-[10px] font-bold transition-all duration-150 cursor-pointer shadow-xs hover:shadow-md"
              title={lang === 'ar' ? 'الانتقال إلى هذا السؤال' : 'Jump to this question'}
              aria-label={lang === 'ar' ? `سؤال ${i + 1}: ${q.content.slice(0, 60)}` : `Question ${i + 1}`}
            >
              {i + 1}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
