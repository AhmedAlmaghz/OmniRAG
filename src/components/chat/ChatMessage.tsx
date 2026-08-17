'use client';

import React from 'react';
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

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, lang, onCitationClick, onViewInKnowledge }) => {
  const isAssistant = message.role === 'assistant';

  return (
    <div className={`flex gap-3 group animate-message-appear ${isAssistant ? 'justify-start' : 'justify-end'}`}>
      {isAssistant && (
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-md mt-0.5">
          <Bot className="w-4 h-4" />
        </div>
      )}

      <div
        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 text-sm leading-relaxed transition-all duration-200 ${
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

        {/* Citations Panel: show max 2, rest in dropdown */}
        {isAssistant && message.citations && message.citations.length > 0 && (
          <CitationsPanel
            citations={message.citations}
            lang={lang}
            onCitationClick={onCitationClick}
            onViewInKnowledge={onViewInKnowledge}
          />
        )}

        {/* Assistant Footer Info */}
        {isAssistant && message.modelUsed && (
          <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span className="flex items-center gap-1">
              <Cpu className="w-3 h-3 text-indigo-500" />
              {message.modelUsed}
            </span>
            {message.tokensUsed && <span>{message.tokensUsed.input + message.tokensUsed.output} tokens</span>}
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
