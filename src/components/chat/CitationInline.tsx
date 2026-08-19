'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FileText, ExternalLink, X, Link2 } from 'lucide-react';
import { Citation } from '@/lib/types/omnirag';

interface CitationInlineProps {
  index: number;
  citation?: Citation;
  lang?: 'ar' | 'en';
  onViewInKnowledge?: () => void;
  /** Optional inspector sync — called when the details popover opens. */
  onCitationClick?: (citation: Citation) => void;
}

/** In-app deep links (e.g. `/?tab=knowledge&doc=...`) should navigate client-side. */
const isInAppLink = (url?: string) => !!url && url.startsWith('/');

/**
 * Inline superscript citation badge. The number itself is a link to the source:
 * - External `sourceUrl` → opens the original page in a new tab.
 * - In-app deep link → switches to the Knowledge Base tab client-side.
 * - No citation data → falls back to the inspector popover.
 * Hovering/focusing the badge previews the source details in a popover.
 */
export const CitationInline: React.FC<CitationInlineProps> = ({
  index,
  citation,
  lang = 'ar',
  onViewInKnowledge,
  onCitationClick,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  const sourceUrl = citation?.sourceUrl;
  const external = sourceUrl && !isInAppLink(sourceUrl);
  const tooltip = citation
    ? `${citation.documentTitle}${sourceUrl && external ? ` — ${sourceUrl}` : ''}`
    : `${lang === 'ar' ? 'مصدر' : 'Source'} ${index}`;

  const showPopover = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setIsOpen(true);
      if (citation) onCitationClick?.(citation);
    }, 250);
  }, [citation, onCitationClick]);

  const hidePopover = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setIsOpen(false), 200);
  }, []);

  /** Navigate to the source: external links open a new tab, in-app links switch tabs. */
  const goToSource = useCallback(
    (e: React.MouseEvent) => {
      if (!sourceUrl) {
        // No URL at all — toggle the details popover instead.
        e.preventDefault();
        setIsOpen((v) => {
          const next = !v;
          if (next && citation) onCitationClick?.(citation);
          return next;
        });
        return;
      }
      if (isInAppLink(sourceUrl)) {
        e.preventDefault();
        setIsOpen(false);
        onViewInKnowledge?.();
      }
      // External URLs fall through to the anchor's default target=_blank behavior.
    },
    [sourceUrl, onViewInKnowledge, onCitationClick, citation],
  );

  const badgeClasses =
    'inline-flex items-center justify-center w-5 h-5 min-w-[20px] rounded-full bg-indigo-100 hover:bg-indigo-600 hover:text-white text-indigo-700 text-[11px] font-bold transition-all duration-200 hover:scale-110 hover:shadow-sm align-super mx-0.5 cursor-pointer no-underline';

  return (
    <span
      className="relative inline-flex items-center"
      ref={popoverRef}
      onMouseEnter={showPopover}
      onMouseLeave={hidePopover}
    >
      <a
        href={sourceUrl || `#citation-${index}`}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        onClick={goToSource}
        onFocus={showPopover}
        onBlur={hidePopover}
        className={badgeClasses}
        title={tooltip}
        aria-label={tooltip}
      >
        {index}
      </a>

      {isOpen && citation && (
        <div
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 sm:w-96 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden animate-citation-pop"
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
          onMouseEnter={() => {
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
          }}
          onMouseLeave={hidePopover}
        >
          <div className="bg-gradient-to-l from-indigo-600 to-indigo-700 px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-200" />
              <span className="text-white text-xs font-bold">
                {lang === 'ar' ? `المصدر [${index}]` : `Source [${index}]`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] bg-white/20 text-indigo-100 px-2 py-0.5 rounded-full font-mono font-bold">
                {Math.round(citation.score * 100)}%
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                }}
                className="p-0.5 hover:bg-white/20 rounded-full transition cursor-pointer"
              >
                <X className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>

          <div className="p-3 space-y-2.5">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                {lang === 'ar' ? 'عنوان المستند' : 'Document'}
              </span>
              <h4 className="text-xs font-bold text-slate-800 leading-relaxed">{citation.documentTitle}</h4>
            </div>

            <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
              {citation.pageNumber && (
                <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                  {lang === 'ar' ? `صفحة ${citation.pageNumber}` : `Page ${citation.pageNumber}`}
                </span>
              )}
            </div>

            <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 block mb-1">
                {lang === 'ar' ? 'مقتطف من النص الأصلي' : 'Original Snippet'}
              </span>
              <p className="text-[11px] text-slate-600 leading-relaxed font-mono whitespace-pre-wrap line-clamp-4">
                &ldquo;{citation.snippet}&rdquo;
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              {sourceUrl &&
                (external ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer"
                  >
                    <Link2 className="w-3 h-3" />
                    <span>{lang === 'ar' ? 'فتح المصدر الأصلي' : 'Open Original Source'}</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsOpen(false);
                      onViewInKnowledge?.();
                    }}
                    className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer"
                  >
                    <Link2 className="w-3 h-3" />
                    <span>{lang === 'ar' ? 'فتح المستند في قاعدة المعرفة' : 'Open Document in Knowledge Base'}</span>
                  </button>
                ))}
              {onViewInKnowledge && external && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewInKnowledge();
                    setIsOpen(false);
                  }}
                  className="w-full py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer border border-indigo-200/80"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>{lang === 'ar' ? 'عرض في مستودع المعرفة' : 'View in Knowledge Base'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </span>
  );
};
