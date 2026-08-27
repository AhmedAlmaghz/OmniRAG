'use client';

import React from 'react';
import { Sparkles, ArrowUpLeft } from 'lucide-react';
import { t } from '@/lib/i18n';

interface FollowUpSuggestionsProps {
  suggestions: string[];
  lang: 'ar' | 'en';
  onSuggestionClick: (query: string) => void;
  isLoading?: boolean;
}

export const FollowUpSuggestions: React.FC<FollowUpSuggestionsProps> = ({
  suggestions,
  lang,
  onSuggestionClick,
  isLoading = false,
}) => {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="flex items-start gap-2 overflow-x-auto no-scrollbar pb-1" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <span className="text-[11px] font-bold text-slate-500 shrink-0 flex items-center gap-1 bg-white px-2 py-1 rounded-md border border-slate-200 shadow-xs mt-0.5">
        <Sparkles className={`w-3 h-3 text-indigo-600 ${isLoading ? 'animate-pulse' : ''}`} />
        <span>{t(lang, 'chat.tryAsking')}</span>
      </span>
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {suggestions.map((suggestion, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onSuggestionClick(suggestion)}
            className="px-3 py-1 rounded-lg bg-white border border-slate-200/90 hover:border-indigo-500 hover:bg-indigo-50/90 text-indigo-800 text-xs font-medium whitespace-nowrap transition-all duration-200 shadow-xs hover:shadow-sm cursor-pointer shrink-0 flex items-center gap-1.5 active:scale-[0.97] group"
          >
            <span className="truncate max-w-[240px]">{suggestion}</span>
            <ArrowUpLeft
              className={`w-3 h-3 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ${
                lang === 'ar' ? 'rtl:-scale-x-100' : ''
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
};
