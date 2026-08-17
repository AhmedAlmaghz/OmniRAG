'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, BookOpen, ExternalLink } from 'lucide-react';
import { Citation } from '@/lib/types/omnirag';

interface CitationsPanelProps {
  citations: Citation[];
  lang?: 'ar' | 'en';
  onCitationClick?: (citation: Citation) => void;
  onViewInKnowledge?: () => void;
}

const VISIBLE_COUNT = 2;

export const CitationsPanel: React.FC<CitationsPanelProps> = ({
  citations,
  lang = 'ar',
  onCitationClick,
  onViewInKnowledge,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!citations || citations.length === 0) return null;

  const visibleCitations = citations.slice(0, VISIBLE_COUNT);
  const hiddenCitations = citations.slice(VISIBLE_COUNT);
  const hasMore = hiddenCitations.length > 0;

  return (
    <div className="mt-3 space-y-2" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap gap-2">
        {visibleCitations.map((cit) => (
          <button
            key={cit.index}
            type="button"
            onClick={() => onCitationClick?.(cit)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-indigo-100 hover:border-indigo-400 hover:bg-indigo-50 text-indigo-700 text-xs font-medium shadow-xs transition-all duration-200 cursor-pointer group"
          >
            <BookOpen className="w-3 h-3 text-indigo-500 group-hover:text-indigo-600 transition" />
            <span className="font-mono font-bold">[{cit.index}]</span>
            <span className="truncate max-w-[180px]">{cit.documentTitle}</span>
          </button>
        ))}

        {hasMore && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-xs font-medium shadow-xs transition-all duration-200 cursor-pointer"
            >
              <span>
                {lang === 'ar' ? `+${hiddenCitations.length} مصادر إضافية` : `+${hiddenCitations.length} more`}
              </span>
              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {isExpanded && (
              <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden animate-citation-dropdown">
                <div className="bg-slate-50 px-3 py-2 border-b border-slate-200">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    {lang === 'ar' ? 'المصادر الإضافية' : 'Additional Sources'}
                  </span>
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                  {hiddenCitations.map((cit) => (
                    <button
                      key={cit.index}
                      type="button"
                      onClick={() => {
                        onCitationClick?.(cit);
                        setIsExpanded(false);
                      }}
                      className="w-full text-right px-3 py-2.5 hover:bg-indigo-50 transition cursor-pointer flex items-start gap-2"
                    >
                      <span className="flex items-center justify-center w-5 h-5 min-w-[20px] rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold mt-0.5">
                        {cit.index}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{cit.documentTitle}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-slate-400 font-mono">{Math.round(cit.score * 100)}%</span>
                          {cit.pageNumber && (
                            <span className="text-[10px] text-slate-400">
                              {lang === 'ar' ? `ص.${cit.pageNumber}` : `p.${cit.pageNumber}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {onViewInKnowledge && (
        <button
          type="button"
          onClick={onViewInKnowledge}
          className="flex items-center gap-1.5 text-[11px] text-indigo-600 hover:text-indigo-800 font-medium transition cursor-pointer"
        >
          <ExternalLink className="w-3 h-3" />
          <span>{lang === 'ar' ? 'عرض الكل في مستودع المعرفة' : 'View all in Knowledge Base'}</span>
        </button>
      )}
    </div>
  );
};
