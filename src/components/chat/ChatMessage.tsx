'use client';

import React, { memo, useMemo } from 'react';
import { Bot, User, Cpu } from 'lucide-react';
import { Message, Citation } from '@/lib/types/omnirag';
import { RichMessageRenderer } from '@/components/chat/RichMessageRenderer';
import { CitationsPanel } from '@/components/chat/CitationsPanel';

interface ChatMessageProps {
  message: Message;
  lang: 'ar' | 'en';
  onCitationClick: (citation: Citation) => void;
  onViewInKnowledge?: () => void;
}

/** Compact HH:MM timestamp for the message footer. */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Dynamic bubble width. Widths are expressed as `min(percent, cap)` where the
 * percentage is relative to the chat panel container, so the bubble grows and
 * shrinks live as the user drags the panel resize handle or toggles fullscreen.
 * Rich content (code blocks, tables, diagrams) always gets the wide tier so it
 * has room to breathe.
 */
function pickBubbleWidth(content: string): string {
  const hasRichContent =
    /```/.test(content) || /\|.*\|/.test(content) || /\$\$/.test(content) || /mermaid/i.test(content);
  if (hasRichContent) return 'max-w-[min(94%,900px)]';

  const stripped = content.replace(/```[\s\S]*?```/g, '').trim();
  if (stripped.length < 40) return 'max-w-[min(45%,340px)]';
  if (stripped.length < 120) return 'max-w-[min(62%,500px)]';
  if (stripped.length < 400) return 'max-w-[min(80%,680px)]';
  return 'max-w-[min(92%,860px)]';
}

const ChatMessageInner: React.FC<ChatMessageProps> = ({ message, lang, onCitationClick, onViewInKnowledge }) => {
  const isAssistant = message.role === 'assistant';

  const bubbleWidth = useMemo(
    () => (isAssistant ? pickBubbleWidth(message.content) : 'max-w-[min(85%,640px)]'),
    [isAssistant, message.content],
  );

  return (
    <div className={`flex gap-3 group animate-message-appear ${isAssistant ? 'justify-start' : 'justify-end'}`}>
      {isAssistant && (
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-md mt-0.5">
          <Bot className="w-4 h-4" />
        </div>
      )}

      <div
        className={`${bubbleWidth} min-w-0 rounded-2xl p-4 text-sm leading-relaxed transition-all duration-200 ${
          isAssistant
            ? 'bg-white border border-slate-200/80 text-slate-800 shadow-sm hover:shadow-md'
            : 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white font-medium shadow-md hover:shadow-lg'
        }`}
      >
        <RichMessageRenderer
          content={message.content}
          role={message.role}
          lang={lang}
          citations={message.citations}
          onCitationClick={onCitationClick}
          onViewInKnowledge={onViewInKnowledge}
        />

        {/* Citations Panel: show max 3, rest in dropdown */}
        {isAssistant && message.citations && message.citations.length > 0 && (
          <CitationsPanel
            citations={message.citations}
            lang={lang}
            onCitationClick={onCitationClick}
            onViewInKnowledge={onViewInKnowledge}
          />
        )}

        {/* Footer: model + tokens + timestamp */}
        {isAssistant && message.modelUsed && (
          <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span className="flex items-center gap-1">
              <Cpu className="w-3 h-3 text-indigo-500" />
              {message.modelUsed}
            </span>
            <span className="flex items-center gap-2">
              {message.tokensUsed && <span>{message.tokensUsed.input + message.tokensUsed.output} tokens</span>}
              {message.createdAt && <span>{formatTime(message.createdAt)}</span>}
            </span>
          </div>
        )}
        {!isAssistant && message.createdAt && (
          <div className="mt-1.5 text-right text-[10px] text-indigo-200/80 font-mono">
            {formatTime(message.createdAt)}
          </div>
        )}
      </div>

      {!isAssistant && (
        <div className="w-8 h-8 rounded-xl bg-slate-800 text-white flex items-center justify-center shrink-0 shadow-md mt-0.5">
          <User className="w-4 h-4" />
        </div>
      )}
    </div>
  );
};

/**
 * Memoized so messages that haven't changed don't re-render when, e.g., the
 * chat scroll position or sidebar toggle updates parent state.
 */
export const ChatMessage = memo(ChatMessageInner, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.role === next.message.role &&
    prev.message.citations === next.message.citations &&
    prev.message.modelUsed === next.message.modelUsed &&
    prev.message.tokensUsed?.input === next.message.tokensUsed?.input &&
    prev.message.tokensUsed?.output === next.message.tokensUsed?.output &&
    prev.lang === next.lang &&
    prev.onCitationClick === next.onCitationClick &&
    prev.onViewInKnowledge === next.onViewInKnowledge
  );
});
