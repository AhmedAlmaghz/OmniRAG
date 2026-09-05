'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef, memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { PluggableList } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useToast } from '../ui/Toast';
import {
  Copy,
  Check,
  Volume2,
  VolumeX,
  Calculator,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Video as VideoIcon,
  Music as MusicIcon,
  Maximize2,
  FileText,
  Info,
  Lightbulb,
  ShieldAlert,
  TriangleAlert,
  OctagonAlert,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  BarChart3,
} from 'lucide-react';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { containsMathExpressions } from '@/lib/utils/arabicMath';
import rehypeKatexArabic from '@/lib/math/rehypeKatexArabic';
import { useUserPreferences } from '@/lib/preferences/userPreferences';
import { CitationInline } from '@/components/chat/CitationInline';
import { Citation } from '@/lib/types/omnirag';
import { normalizeChartSpec, toEChartsOption } from '@/lib/skills/charts';
import { t } from '@/lib/i18n';
import { sanitizeSvg } from '@/lib/security/svgSanitizer';

interface RichMessageRendererProps {
  content: string;
  role: 'user' | 'assistant' | 'system';
  lang?: 'ar' | 'en';
  onCitationClick?: (citation: Citation) => void;
  citations?: Citation[];
  onViewInKnowledge?: () => void;
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

/** Recursively extract plain text from a React node tree. */
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) return extractText((node.props as { children?: React.ReactNode })?.children);
  return '';
}

type AlertType = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

function matchAlertType(text: string): AlertType | null {
  const m = text.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
  return m ? (m[1].toUpperCase() as AlertType) : null;
}

const ALERT_META: Record<
  AlertType,
  { icon: React.ComponentType<{ className?: string }>; labelKey: string; cls: string; iconCls: string }
> = {
  NOTE: {
    icon: Info,
    labelKey: 'renderer.alertNote',
    cls: 'border-blue-200 bg-blue-50/70 text-blue-950',
    iconCls: 'text-blue-600',
  },
  TIP: {
    icon: Lightbulb,
    labelKey: 'renderer.alertTip',
    cls: 'border-emerald-200 bg-emerald-50/70 text-emerald-950',
    iconCls: 'text-emerald-600',
  },
  IMPORTANT: {
    icon: ShieldAlert,
    labelKey: 'renderer.alertImportant',
    cls: 'border-indigo-200 bg-indigo-50/70 text-indigo-950',
    iconCls: 'text-indigo-600',
  },
  WARNING: {
    icon: TriangleAlert,
    labelKey: 'renderer.alertWarning',
    cls: 'border-amber-300 bg-amber-50/80 text-amber-950',
    iconCls: 'text-amber-600',
  },
  CAUTION: {
    icon: OctagonAlert,
    labelKey: 'renderer.alertCaution',
    cls: 'border-rose-300 bg-rose-50/80 text-rose-950',
    iconCls: 'text-rose-600',
  },
};

/** Remove a leading `[!TYPE]` marker from the first string child of an element. */
function stripAlertMarker(el: React.ReactElement): React.ReactElement {
  const kids = React.Children.toArray((el.props as { children?: React.ReactNode }).children);
  let done = false;
  const next = kids.map((k) => {
    if (!done && typeof k === 'string') {
      const replaced = k.replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, '');
      if (replaced !== k) done = true;
      return replaced;
    }
    return k;
  });
  return React.cloneElement(el, {}, ...next);
}

/* ------------------------------------------------------------------ */
/* Mermaid diagram (lazy-loaded)                                       */
/* ------------------------------------------------------------------ */

const MermaidBlock: React.FC<{ code: string; lang: 'ar' | 'en' }> = ({ code, lang }) => {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'strict',
          fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-arabic') || 'sans-serif',
        });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) setSvg(sanitizeSvg(svg));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'mermaid render failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="my-3 rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-xs text-rose-700">
        <div className="flex items-center gap-1.5 font-bold mb-1">
          <FileText className="w-3.5 h-3.5" />
          {t(lang, 'renderer.mermaidError')}
        </div>
        <pre className="text-[11px] font-mono whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500 animate-pulse">
        {t(lang, 'renderer.mermaidRendering')}
      </div>
    );
  }

  return (
    <div
      className="my-3 rounded-xl border border-slate-200 bg-white p-3 overflow-x-auto shadow-xs mermaid-container"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

/* ------------------------------------------------------------------ */
/* Interactive ECharts chart (lazy-loaded) — ```chart fences           */
/* ------------------------------------------------------------------ */

const ChartBlock: React.FC<{ code: string; lang: 'ar' | 'en' }> = ({ code, lang }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  // The fence embeds the normalized ChartSpec JSON produced by the
  // create_chart skill; re-validate it through the same normalizer so malformed
  // or tampered specs fail with a readable error instead of a raw crash.
  const parsed = useMemo<{ option: Record<string, unknown> | null; error: string | null; title: string }>(() => {
    try {
      const raw = JSON.parse(code);
      const spec = normalizeChartSpec(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});
      return { option: toEChartsOption(spec), error: null, title: spec.title };
    } catch (e) {
      return { option: null, error: e instanceof Error ? e.message : String(e) || 'chart spec parse failed', title: '' };
    }
  }, [code]);

  useEffect(() => {
    if (!parsed.option) return;
    let disposed = false;
    let chart: { setOption: (o: unknown) => void; resize: () => void; dispose: () => void } | null = null;
    let observer: ResizeObserver | null = null;
    (async () => {
      try {
        const echarts = await import('echarts');
        const el = containerRef.current;
        if (!el || disposed) return;
        chart = echarts.init(el);
        chart.setOption(parsed.option);
        observer = new ResizeObserver(() => chart?.resize());
        observer.observe(el);
      } catch (e) {
        if (!disposed) setRuntimeError(e instanceof Error ? e.message : 'echarts init failed');
      }
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      chart?.dispose();
    };
  }, [parsed.option]);

  const error = parsed.error || runtimeError;
  if (error) {
    return (
      <div className="my-3 rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-xs text-rose-700">
        <div className="flex items-center gap-1.5 font-bold mb-1">
          <BarChart3 className="w-3.5 h-3.5" />
          {t(lang, 'renderer.chartError')}
        </div>
        <pre className="text-[11px] font-mono whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  return (
    <div className="my-3 rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-100 bg-slate-50/60">
        <BarChart3 className="w-3.5 h-3.5 text-indigo-500" />
        <span className="text-xs font-bold text-slate-700 truncate">
          {parsed.title || t(lang, 'renderer.chartTitle')}
        </span>
      </div>
      {/* LTR canvas keeps axis coordinates stable even for Arabic labels */}
      <div ref={containerRef} dir="ltr" className="w-full h-80 p-2" />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Sortable table                                                      */
/* ------------------------------------------------------------------ */

const SortableTable: React.FC<{ children: React.ReactNode; lang: 'ar' | 'en' }> = memo(({ children, lang }) => {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);

  const parsed = useMemo(() => {
    const kids = React.Children.toArray(children).filter(React.isValidElement) as React.ReactElement[];
    const thead = kids.find((k) => (k as any).type === 'thead');
    const tbody = kids.find((k) => (k as any).type === 'tbody');

    let headerCells: React.ReactNode[] = [];
    if (thead) {
      const tr = React.Children.toArray((thead.props as { children?: React.ReactNode }).children).filter(React.isValidElement)[0] as
        React.ReactElement | undefined;
      if (tr) {
        headerCells = React.Children.toArray((tr.props as { children?: React.ReactNode }).children)
          .filter(React.isValidElement)
          .map((th) => (th as React.ReactElement<{ children?: React.ReactNode }>).props.children);
      }
    }

    const rows: React.ReactElement[] = tbody
      ? (React.Children.toArray((tbody.props as { children?: React.ReactNode }).children).filter(React.isValidElement) as React.ReactElement[])
      : [];

    return { headerCells, rows };
  }, [children]);

  const sortedRows = useMemo(() => {
    if (!sort) return parsed.rows;
    const { col, dir } = sort;
    return [...parsed.rows].sort((a, b) => {
      const aCells = React.Children.toArray((a.props as { children?: React.ReactNode }).children).filter(
        React.isValidElement,
      ) as React.ReactElement<{ children?: React.ReactNode }>[];
      const bCells = React.Children.toArray((b.props as { children?: React.ReactNode }).children).filter(
        React.isValidElement,
      ) as React.ReactElement<{ children?: React.ReactNode }>[];
      const aText = extractText(aCells[col]?.props?.children ?? '');
      const bText = extractText(bCells[col]?.props?.children ?? '');
      const aNum = parseFloat(aText.replace(/[^\d.-]/g, ''));
      const bNum = parseFloat(bText.replace(/[^\d.-]/g, ''));
      if (!isNaN(aNum) && !isNaN(bNum)) return (aNum - bNum) * dir;
      return aText.localeCompare(bText, lang === 'ar' ? 'ar' : 'en', { numeric: true }) * dir;
    });
  }, [parsed.rows, sort, lang]);

  const toggleSort = useCallback((col: number) => {
    setSort((prev) => (prev?.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  }, []);

  return (
    <div className="my-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
      <table className="w-full text-right text-xs md:text-sm border-collapse">
        <thead className="bg-slate-100 text-slate-800 border-b-2 border-slate-200 font-bold">
          <tr>
            {parsed.headerCells.map((cell, i) => {
              const active = sort?.col === i;
              const SortIcon = !active ? ArrowUpDown : sort!.dir === 1 ? ArrowUp : ArrowDown;
              return (
                <th
                  key={i}
                  onClick={() => toggleSort(i)}
                  className={`p-2.5 font-semibold text-slate-900 text-right whitespace-nowrap cursor-pointer select-none transition-colors hover:bg-slate-200/70 ${
                    active ? 'bg-indigo-50 text-indigo-800' : ''
                  }`}
                  title={t(lang, 'renderer.clickToSort')}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span>{cell}</span>
                    <SortIcon className={`w-3 h-3 shrink-0 ${active ? 'text-indigo-600' : 'text-slate-400'}`} />
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sortedRows.map((row, ri) => (
            <tr key={ri} className="hover:bg-indigo-50/40 transition-colors">
              {React.Children.toArray((row.props as { children?: React.ReactNode }).children)
                .filter(React.isValidElement)
                .map((td, ci) => (
                  <td key={ci} className="p-2.5 text-slate-700 text-right align-top">
                    {(td as React.ReactElement<{ children?: React.ReactNode }>).props.children}
                  </td>
                ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
SortableTable.displayName = 'SortableTable';

/* ------------------------------------------------------------------ */
/* GFM alert box                                                       */
/* ------------------------------------------------------------------ */

const AlertBox: React.FC<{ type: AlertType; lang: 'ar' | 'en'; children: React.ReactNode }> = ({
  type,
  lang,
  children,
}) => {
  const meta = ALERT_META[type];
  const Icon = meta.icon;
  return (
    <div className={`my-3 rounded-xl border p-3.5 ${meta.cls}`}>
      <div className={`flex items-center gap-2 font-bold text-xs mb-1.5 ${meta.iconCls}`}>
        <Icon className="w-4 h-4 shrink-0" />
        <span>{t(lang, meta.labelKey)}</span>
      </div>
      <div className="text-xs md:text-sm leading-relaxed [&>p]:my-1">{children}</div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* RichMessageRenderer                                                 */
/* ------------------------------------------------------------------ */

export const RichMessageRenderer: React.FC<RichMessageRendererProps> = ({
  content,
  role,
  lang = 'ar',
  onCitationClick,
  citations = [],
  onViewInKnowledge,
}) => {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [fontSizeClass, setFontSizeClass] = useState<'text-xs' | 'text-sm' | 'text-base'>('text-sm');
  const { toast } = useToast();

  // Global user preferences (math engine, numerals) — applied automatically,
  // no per-message toggles. Managed in Settings → Appearance.
  const { preferences } = useUserPreferences();
  const { mathMode, mathArabicNumerals } = preferences;

  const hasMath = useMemo(() => containsMathExpressions(content), [content]);

  // Media URL detectors (stable across renders)
  const isImageUrl = useCallback((url: string) => /\.(jpeg|jpg|gif|png|svg|webp|avif)($|\?)/i.test(url), []);
  const isVideoUrl = useCallback(
    (url: string) => /\.(mp4|webm|ogg)($|\?)/i.test(url) || /youtube\.com|vimeo\.com|youtu\.be/i.test(url),
    [],
  );
  const isAudioUrl = useCallback((url: string) => /\.(mp3|wav|ogg|m4a)($|\?)/i.test(url), []);

  // Render a string, converting inline citation markers `[N]` into badges.
  const renderTextWithCitations = useCallback(
    (text: string): React.ReactNode[] => {
      const parts = text.split(/(\[\d+\])/g);
      return parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (match) {
          const num = parseInt(match[1], 10);
          const cit = citations.find((c) => c.index === num);
          return (
            <CitationInline
              key={`cit-${i}-${num}`}
              index={num}
              citation={cit}
              lang={lang}
              onViewInKnowledge={onViewInKnowledge}
              onCitationClick={onCitationClick}
            />
          );
        }
        return <span key={`txt-${i}`}>{part}</span>;
      });
    },
    [citations, lang, onViewInKnowledge, onCitationClick],
  );

  // Process arbitrary children, converting plain-string citation markers into badges.
  const processChildren = useCallback(
    (children: React.ReactNode): React.ReactNode => {
      if (typeof children === 'string') return renderTextWithCitations(children);
      if (Array.isArray(children)) {
        return children.map((child, i) =>
          typeof child === 'string' ? <React.Fragment key={i}>{renderTextWithCitations(child)}</React.Fragment> : child,
        );
      }
      return children;
    },
    [renderTextWithCitations],
  );

  const handleCopyText = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handleToggleSpeak = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast({
        title: t(lang, 'renderer.ttsNotSupported'),
        variant: 'warning',
      });
      return;
    }
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    const cleanText = content
      .replace(/[*_#`$~\[\]()]/g, ' ')
      .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, `$1 ${t(lang, 'renderer.fracSpoken')} $2`)
      .trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
    utterance.rate = 0.95;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  }, [content, isSpeaking, lang, toast]);

  const handleExportMarkdown = useCallback(() => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `omnirag-response-${Date.now()}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }, [content]);

  // Math is rendered automatically by the rehype pipeline below — standard
  // KaTeX or KaTeX4Arabic depending on the global user preference. No
  // content pre-processing is needed anymore.

  // Build the react-markdown `components` map once per relevant change.
  const components = useMemo<Components>(
    () => ({
      // Unwrap <pre> so CodeBlock owns its own container (avoids double scroll).
      pre({ children }) {
        return <>{children}</>;
      },

      // Code blocks + inline code
      code({ className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || '');
        const codeString = String(children).replace(/\n$/, '');

        if (match || codeString.includes('\n')) {
          const blockLang = match ? match[1] : 'typescript';
          if (blockLang === 'mermaid') {
            return <MermaidBlock code={codeString} lang={lang} />;
          }
          if (blockLang === 'chart') {
            return <ChartBlock code={codeString} lang={lang} />;
          }
          return <CodeBlock code={codeString} language={blockLang} title={blockLang.toUpperCase()} lang={lang} />;
        }

        return (
          <code
            className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200/80 text-indigo-700 font-mono text-[0.85em] dir-ltr inline-block"
            {...props}
          >
            {children}
          </code>
        );
      },

      // Sortable, responsive tables
      table({ children }) {
        return <SortableTable lang={lang}>{children}</SortableTable>;
      },

      // GFM alerts + styled blockquotes
      blockquote({ children }) {
        const kids = React.Children.toArray(children).filter(React.isValidElement) as React.ReactElement[];
        const firstP = kids.find((k) => k.type === 'p');
        if (firstP) {
          const alertType = matchAlertType(extractText((firstP.props as { children?: React.ReactNode }).children));
          if (alertType) {
            const stripped = stripAlertMarker(firstP);
            const rest = kids.filter((k) => k !== firstP);
            return (
              <AlertBox type={alertType} lang={lang}>
                {stripped}
                {rest}
              </AlertBox>
            );
          }
        }
        return (
          <blockquote className="my-2.5 border-r-4 border-indigo-500 bg-indigo-50/60 p-3 rounded-l-xl text-indigo-950 font-normal italic">
            {children}
          </blockquote>
        );
      },

      hr() {
        return <hr className="my-4 border-0 h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent" />;
      },

      // Links with media embed handling + security
      a({ href, children }) {
        if (!href) return <span>{children}</span>;

        if (isImageUrl(href)) {
          return (
            <span className="my-2.5 inline-block max-w-md rounded-xl overflow-hidden border border-slate-200 shadow-md align-middle">
              <img
                src={href}
                alt={extractText(children) || t(lang, 'renderer.embeddedImageAlt')}
                loading="lazy"
                className="w-full h-auto cursor-pointer hover:scale-102 transition-transform duration-200"
                onClick={() => setSelectedImage(href)}
              />
              <span className="bg-slate-900 text-white text-[11px] p-1.5 flex items-center justify-between">
                <span className="truncate flex items-center gap-1">
                  <ImageIcon className="w-3 h-3 text-cyan-400" />
                  <span>{extractText(children)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedImage(href)}
                  className="text-cyan-300 hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>{t(lang, 'renderer.zoom')}</span>
                </button>
              </span>
            </span>
          );
        }

        if (isVideoUrl(href)) {
          return (
            <span className="my-3 block rounded-xl overflow-hidden border border-slate-800 bg-slate-950 p-2 shadow-lg">
              <span className="flex items-center gap-1.5 text-xs text-amber-400 mb-2 font-semibold">
                <VideoIcon className="w-4 h-4" />
                <span>{t(lang, 'renderer.embeddedVideo')}</span>
              </span>
              {href.includes('youtube.com') || href.includes('youtu.be') ? (
                <span className="aspect-video w-full rounded-lg overflow-hidden block">
                  <iframe
                    src={href.replace('watch?v=', 'embed/').replace('youtu.be/', 'youtube.com/embed/')}
                    className="w-full h-full"
                    allowFullScreen
                    title="Embedded YouTube Video"
                  />
                </span>
              ) : (
                <video controls className="w-full h-auto rounded-lg bg-black max-h-80">
                  <source src={href} />
                  {t(lang, 'renderer.videoNotSupported')}
                </video>
              )}
            </span>
          );
        }

        if (isAudioUrl(href)) {
          return (
            <span className="my-2.5 block rounded-xl border border-indigo-200 bg-indigo-50/90 p-3 shadow-xs">
              <span className="flex items-center gap-2 text-xs font-semibold text-indigo-900 mb-1.5">
                <MusicIcon className="w-4 h-4 text-indigo-600 animate-pulse" />
                <span>{t(lang, 'renderer.embeddedAudio')}</span>
                <span className="truncate text-slate-600 font-normal">{href.split('/').pop()}</span>
              </span>
              <audio controls className="w-full h-9 rounded-md">
                <source src={href} />
                {t(lang, 'renderer.audioNotSupported')}
              </audio>
            </span>
          );
        }

        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={href}
            className="text-indigo-600 hover:text-indigo-800 underline font-semibold inline-flex items-center gap-0.5 mx-0.5"
          >
            <span className="truncate max-w-[280px]">{children}</span>
            <ExternalLink className="w-3 h-3 inline shrink-0" />
          </a>
        );
      },

      // Lists
      ul({ children }: any) {
        return (
          <ul className="my-2 list-disc list-inside space-y-1 text-slate-800 pr-2 marker:text-indigo-400">
            {children}
          </ul>
        );
      },
      ol({ children }) {
        return (
          <ol className="my-2 list-decimal list-inside space-y-1 text-slate-800 pr-2 marker:text-indigo-600 marker:font-bold">
            {children}
          </ol>
        );
      },
      li({ children }) {
        return <li className="leading-relaxed">{processChildren(children)}</li>;
      },

      // Task-list checkboxes (GFM)
      input({ type, checked, ...props }: any) {
        if (type === 'checkbox') {
          return (
            <input
              type="checkbox"
              checked={!!checked}
              readOnly
              {...props}
              className="mr-1.5 rtl:ml-1.5 rtl:mr-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 align-middle"
            />
          );
        }
        return <input type={type} {...props} />;
      },

      // Headings
      h1({ children }: any) {
        return (
          <h1 className="text-xl font-extrabold text-slate-900 mt-4 mb-2 pb-1 border-b border-slate-200">
            {processChildren(children)}
          </h1>
        );
      },
      h2({ children }: any) {
        return (
          <h2 className="text-lg font-bold text-slate-900 mt-3 mb-1.5 flex items-center gap-2 before:content-['##'] before:text-indigo-400 before:font-mono before:text-sm">
            {processChildren(children)}
          </h2>
        );
      },
      h3({ children }: any) {
        return (
          <h3 className="text-base font-bold text-slate-800 mt-2.5 mb-1 flex items-center gap-2 before:content-['###'] before:text-indigo-400 before:font-mono before:text-xs">
            {processChildren(children)}
          </h3>
        );
      },
      h4({ children }: any) {
        return <h4 className="text-sm font-bold text-slate-800 mt-2 mb-1">{processChildren(children)}</h4>;
      },

      // Emphasis / misc inline
      strong({ children }: any) {
        return <strong className="font-bold text-slate-900">{children}</strong>;
      },
      em({ children }: any) {
        return <em className="italic">{children}</em>;
      },
      del({ children }: any) {
        return <del className="line-through text-slate-400">{children}</del>;
      },
      kbd({ children }: any) {
        return (
          <kbd className="px-1.5 py-0.5 rounded-md border border-slate-300 bg-slate-100 text-slate-700 font-mono text-[0.8em] shadow-[0_1px_0_rgba(0,0,0,0.15)] dir-ltr inline-block">
            {children}
          </kbd>
        );
      },
      sub({ children }: any) {
        return <sub className="text-[0.75em]">{children}</sub>;
      },
      sup({ children }) {
        return <sup className="text-[0.75em]">{children}</sup>;
      },

      // Paragraphs with inline citation detection + bare image auto-embed
      p({ children, node }) {
        if (
          node?.children?.length === 1 &&
          node.children[0]?.type === 'text' &&
          isImageUrl(String(node.children[0].value))
        ) {
          const url = String(node.children[0].value);
          return (
            <span className="my-2.5 inline-block max-w-md rounded-xl overflow-hidden border border-slate-200 shadow-md">
              <img
                src={url}
                alt="embedded"
                loading="lazy"
                className="w-full h-auto cursor-pointer hover:scale-102 transition-transform duration-200"
                onClick={() => setSelectedImage(url)}
              />
            </span>
          );
        }
        return <p className="my-2 leading-relaxed">{processChildren(children)}</p>;
      },
    }),
    [lang, processChildren, isImageUrl, isVideoUrl, isAudioUrl],
  );

  // Select the math engine from the global preference. The plugin list is
  // memoized so ReactMarkdown doesn't re-run the whole pipeline on renders
  // unrelated to math settings.
  const rehypePlugins = useMemo<PluggableList>(
    () =>
      mathMode === 'arabic'
        ? [
            [
              rehypeKatexArabic,
              {
                numerals: mathArabicNumerals ? 'arabic' : 'latin',
                throwOnError: false,
                strict: false,
                errorColor: '#ef4444',
              },
            ],
          ]
        : [[rehypeKatex, { strict: false, throwOnError: false, errorColor: '#ef4444' }]],
    [mathMode, mathArabicNumerals],
  );

  // Memoize the rendered markdown tree so unchanged messages don't re-parse.
  const markdownTree = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={rehypePlugins}
        components={components as any}
      >
        {content}
      </ReactMarkdown>
    ),
    [content, rehypePlugins, components],
  );

  return (
    <div className={`space-y-3 ${role === 'user' ? 'text-slate-900' : 'text-slate-800'}`}>
      {/* Interactive toolbar for assistant responses */}
      {role === 'assistant' && (
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-200/80 text-xs text-slate-600 bg-slate-50/80 p-2 rounded-xl">
          <div className="flex flex-wrap items-center gap-1.5">
            {hasMath && (
              <div
                className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg text-amber-900 font-medium"
                title={t(lang, 'renderer.mathTooltip')}
              >
                <Calculator className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-[11px]">
                  {t(lang, mathMode === 'arabic' ? 'renderer.mathArabic' : 'renderer.mathStandard')}
                </span>
              </div>
            )}

            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 text-slate-600">
              <span className="text-[10px] px-1 font-semibold">{t(lang, 'renderer.sizeLabel')}</span>
              {(['text-xs', 'text-sm', 'text-base'] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setFontSizeClass(sz)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer ${
                    fontSizeClass === sz ? 'bg-slate-800 text-white font-bold' : 'hover:bg-slate-100'
                  }`}
                >
                  {sz === 'text-xs' ? 'A-' : sz === 'text-sm' ? 'A' : 'A+'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleToggleSpeak}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs cursor-pointer transition ${
                isSpeaking
                  ? 'bg-rose-50 text-rose-700 border-rose-300 animate-pulse font-bold'
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title={t(lang, 'renderer.readAloudTitle')}
            >
              {isSpeaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-indigo-600" />}
              <span>{t(lang, isSpeaking ? 'renderer.stopAudio' : 'renderer.readOut')}</span>
            </button>

            <button
              type="button"
              onClick={handleCopyText}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border bg-white hover:bg-slate-100 text-slate-700 border-slate-200 text-xs cursor-pointer transition"
              title={t(lang, 'renderer.copyFullTitle')}
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>{t(lang, copied ? 'renderer.copied' : 'renderer.copy')}</span>
            </button>

            <button
              type="button"
              onClick={handleExportMarkdown}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border bg-white hover:bg-slate-100 text-slate-700 border-slate-200 text-xs cursor-pointer transition"
              title={t(lang, 'renderer.exportMdTitle')}
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>{t(lang, 'renderer.exportMd')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Markdown Body */}
      <div
        className={`rich-markdown-body leading-relaxed ${fontSizeClass} ${
          role === 'user' ? 'text-slate-900 font-medium' : 'text-slate-800'
        }`}
      >
        {markdownTree}
      </div>

      {/* Image Lightbox Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-slate-900 rounded-2xl p-2 border border-slate-800 overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={selectedImage}
              alt="Large preview"
              className="w-full h-auto max-h-[85vh] object-contain rounded-xl"
            />
            <div className="p-3 bg-slate-950 flex items-center justify-between text-white text-xs gap-3">
              <span className="truncate text-slate-400 font-mono">{selectedImage}</span>
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-bold cursor-pointer shrink-0"
              >
                {t(lang, 'renderer.closePreview')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
