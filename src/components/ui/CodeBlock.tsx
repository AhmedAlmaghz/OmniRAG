'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Code2, ChevronDown, ChevronUp, WrapText, Hash } from 'lucide-react';
import { t } from '@/lib/i18n';

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  lang?: 'ar' | 'en';
}

/* ------------------------------------------------------------------ */
/* Shiki highlighter singleton — created once, shared by all blocks   */
/* ------------------------------------------------------------------ */

type HighlighterLike = {
  codeToHtml: (code: string, opts: { lang: string; theme: string }) => string;
};

let highlighterPromise: Promise<HighlighterLike> | null = null;
const highlightCache = new Map<string, string>();

const FALLBACK_LANGS = new Set(['plaintext', 'text', 'txt', '']);

async function getHighlighter(): Promise<HighlighterLike> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((shiki) =>
      shiki.createHighlighter({
        themes: ['github-dark-default'],
        langs: [
          'typescript',
          'tsx',
          'javascript',
          'jsx',
          'json',
          'bash',
          'shell',
          'python',
          'sql',
          'html',
          'css',
          'markdown',
          'yaml',
          'java',
          'c',
          'cpp',
          'csharp',
          'go',
          'rust',
          'php',
          'ruby',
          'swift',
          'kotlin',
          'dockerfile',
          'diff',
          'xml',
        ],
      }),
    );
  }
  return highlighterPromise;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Professional code block with Shiki syntax highlighting, line numbers,
 * collapsible body, word-wrap toggle, and copy-to-clipboard.
 * Highlighting is async and cached — plain pre-rendered content shows instantly
 * while the highlighted HTML replaces it when ready.
 */
export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language = 'typescript', title, lang = 'ar' }) => {
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  const cacheKey = useMemo(() => `${language}::${code}`, [language, code]);
  const lineCount = useMemo(() => code.split('\n').length, [code]);

  useEffect(() => {
    const cached = highlightCache.get(cacheKey);
    if (cached) {
      setHighlightedHtml(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const hl = await getHighlighter();
        const shikiLang = FALLBACK_LANGS.has(language) ? 'text' : language;
        const html = hl.codeToHtml(code, { lang: shikiLang, theme: 'github-dark-default' });
        if (!cancelled) {
          highlightCache.set(cacheKey, html);
          setHighlightedHtml(html);
        }
      } catch {
        // Unknown language or load failure — keep plain rendering below.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, language, code]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Extract the inner <pre> styles from Shiki html (background color etc.)
  const extractPre = (html: string) => {
    const match = html.match(/<pre[^>]*style="([^"]*)"[^>]*>([\s\S]*)<\/pre>/);
    if (!match) return { style: '', inner: html };
    return { style: match[1], inner: match[2] };
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/95 overflow-hidden shadow-lg my-3 font-mono text-xs md:text-sm group/code">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 text-slate-400 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
          </span>
          <Code2 className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="font-semibold text-slate-200 truncate text-xs">
            {title && title !== language.toUpperCase() ? title : language}
          </span>
          <span className="text-[9px] text-slate-500 font-mono shrink-0 hidden sm:inline">
            {t(lang, 'codeBlock.lineCount', { count: lineCount })}
          </span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {/* Line numbers toggle */}
          <button
            type="button"
            onClick={() => setShowLineNumbers((v) => !v)}
            className={`p-1.5 rounded-md transition cursor-pointer ${
              showLineNumbers ? 'text-cyan-400 bg-slate-800/60' : 'text-slate-500 hover:bg-slate-800'
            }`}
            title={t(lang, 'codeBlock.lineNumbersTitle')}
          >
            <Hash className="w-3.5 h-3.5" />
          </button>
          {/* Word wrap toggle */}
          <button
            type="button"
            onClick={() => setWordWrap((v) => !v)}
            className={`p-1.5 rounded-md transition cursor-pointer ${
              wordWrap ? 'text-cyan-400 bg-slate-800/60' : 'text-slate-500 hover:bg-slate-800'
            }`}
            title={t(lang, 'codeBlock.wordWrapTitle')}
          >
            <WrapText className="w-3.5 h-3.5" />
          </button>
          {/* Collapse toggle */}
          <button
            type="button"
            onClick={() => setIsCollapsed((v) => !v)}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition cursor-pointer"
            title={t(lang, isCollapsed ? 'codeBlock.expandTitle' : 'codeBlock.collapseTitle')}
          >
            {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          {/* Copy */}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer text-xs"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">{t(lang, 'codeBlock.copied')}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>{t(lang, 'codeBlock.copy')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code body */}
      {!isCollapsed && (
        <div
          className={`overflow-x-auto text-slate-200 leading-relaxed dir-ltr text-left font-mono ${
            wordWrap ? 'whitespace-pre-wrap break-words' : ''
          }`}
          style={highlightedHtml ? { backgroundColor: '#0d1117' } : undefined}
        >
          {highlightedHtml ? (
            showLineNumbers ? (
              <div className="flex">
                <div
                  className="select-none text-right text-slate-600 py-3 pl-3 pr-2 border-r border-slate-800/70 sticky left-0 bg-[#0d1117] shrink-0"
                  aria-hidden="true"
                >
                  {code.split('\n').map((_, i) => (
                    <div key={i} className="text-[11px] leading-[1.6]">
                      {i + 1}
                    </div>
                  ))}
                </div>
                <pre
                  className="py-3 pr-4 pl-3 m-0 flex-1"
                  style={{ margin: 0 }}
                  dangerouslySetInnerHTML={{ __html: extractPre(highlightedHtml).inner }}
                />
              </div>
            ) : (
              <div dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
            )
          ) : (
            <pre className="p-4 m-0 whitespace-pre">
              <code>{escapeHtml(code)}</code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
};
