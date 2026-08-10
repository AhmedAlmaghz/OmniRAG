'use client';

import React, { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  Copy,
  Check,
  Volume2,
  VolumeX,
  Languages,
  Calculator,
  Download,
  ExternalLink,
  Play,
  Pause,
  Image as ImageIcon,
  Video as VideoIcon,
  Music as MusicIcon,
  Maximize2,
  FileText,
  Sparkles,
  RefreshCw,
  Code2,
} from 'lucide-react';
import { CodeBlock } from '@/components/ui/CodeBlock';
import {
  convertTeXToArabicMath,
  containsMathExpressions,
  convertNumeralsToArabic,
} from '@/lib/utils/arabicMath';

interface RichMessageRendererProps {
  content: string;
  role: 'user' | 'assistant' | 'system';
  lang?: 'ar' | 'en';
  onCitationClick?: (citation: any) => void;
}

export const RichMessageRenderer: React.FC<RichMessageRendererProps> = ({
  content,
  role,
  lang = 'ar',
  onCitationClick,
}) => {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [mathDisplayMode, setMathDisplayMode] = useState<'standard' | 'arabic'>('standard');
  const [useArabicNumerals, setUseArabicNumerals] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [fontSizeClass, setFontSizeClass] = useState<'text-xs' | 'text-sm' | 'text-base'>('text-sm');

  const hasMath = containsMathExpressions(content);

  // Copy whole response to clipboard
  const handleCopyText = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Text-To-Speech (TTS)
  const handleToggleSpeak = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      alert(lang === 'ar' ? 'متصفحك لا يدعم قراءة النصوص صوتياً' : 'Text-to-Speech not supported in browser');
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    // Clean markdown symbols for speech synthesis
    const cleanText = content
      .replace(/[*_#`$~\[\]()]/g, ' ')
      .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 على $2')
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
    utterance.rate = 0.95;

    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };

  // Export as Markdown File
  const handleExportMarkdown = () => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `omnirag-response-${Date.now()}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Pre-process text if Arabic Math Mode is enabled
  const processedContent = React.useMemo(() => {
    if (!hasMath || mathDisplayMode === 'standard') {
      return content;
    }

    // Replace TeX blocks ($...$ or $$...$$) with Arabic Math notation equivalents
    return content.replace(/(\$\$[\s\S]+?\$\$|\$[^\$]+?\$)/g, (match) => {
      const rawTex = match.replace(/^\$\$?|\$\$?$/g, '');
      const converted = convertTeXToArabicMath(rawTex, { useArabicNumerals });
      return `\n\n> 🧮 **[معادلة رياضية بالعربية - MathJax4Arabic]:**\n> \`${converted}\`\n\n`;
    });
  }, [content, hasMath, mathDisplayMode, useArabicNumerals]);

  // Helper to detect URL media formats
  const isImageUrl = (url: string) => /\.(jpeg|jpg|gif|png|svg|webp)($|\?)/i.test(url);
  const isVideoUrl = (url: string) => /\.(mp4|webm|ogg)($|\?)/i.test(url) || /youtube\.com|vimeo\.com|youtu\.be/i.test(url);
  const isAudioUrl = (url: string) => /\.(mp3|wav|ogg|m4a)($|\?)/i.test(url);

  return (
    <div className={`space-y-3 ${role === 'user' ? 'text-slate-900' : 'text-slate-800'}`}>
      {/* Quick Interactive ToolBar for Assistant Responses */}
      {role === 'assistant' && (
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-200/80 text-xs text-slate-600 bg-slate-50/80 p-2 rounded-xl">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* MathJax / Arabic Math Toggle */}
            {hasMath && (
              <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg text-amber-900 font-medium">
                <Calculator className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-[11px]">{lang === 'ar' ? 'عرض الرياضيات:' : 'Math Mode:'}</span>
                <button
                  type="button"
                  onClick={() => setMathDisplayMode('standard')}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                    mathDisplayMode === 'standard' ? 'bg-amber-600 text-white' : 'hover:bg-amber-100 text-amber-800'
                  }`}
                >
                  MathJax (English)
                </button>
                <button
                  type="button"
                  onClick={() => setMathDisplayMode('arabic')}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                    mathDisplayMode === 'arabic' ? 'bg-amber-600 text-white' : 'hover:bg-amber-100 text-amber-800'
                  }`}
                  title="عرض المعادلات بالرموز والمصطلحات العربية (MathJax4Arabic)"
                >
                  MathJax4Arabic (عربي)
                </button>

                {mathDisplayMode === 'arabic' && (
                  <button
                    type="button"
                    onClick={() => setUseArabicNumerals(!useArabicNumerals)}
                    className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer transition ${
                      useArabicNumerals ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300'
                    }`}
                    title="تحويل الأرقام إلى الأرقام العربية (٠-٩)"
                  >
                    {useArabicNumerals ? 'أرقام (٠-٩)' : 'أرقام (0-9)'}
                  </button>
                )}
              </div>
            )}

            {/* Font Size Adjuster */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 text-slate-600">
              <span className="text-[10px] px-1 font-semibold">{lang === 'ar' ? 'الحجم:' : 'Size:'}</span>
              <button
                type="button"
                onClick={() => setFontSizeClass('text-xs')}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer ${fontSizeClass === 'text-xs' ? 'bg-slate-800 text-white font-bold' : 'hover:bg-slate-100'}`}
              >
                A-
              </button>
              <button
                type="button"
                onClick={() => setFontSizeClass('text-sm')}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer ${fontSizeClass === 'text-sm' ? 'bg-slate-800 text-white font-bold' : 'hover:bg-slate-100'}`}
              >
                A
              </button>
              <button
                type="button"
                onClick={() => setFontSizeClass('text-base')}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer ${fontSizeClass === 'text-base' ? 'bg-slate-800 text-white font-bold' : 'hover:bg-slate-100'}`}
              >
                A+
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Speech Button */}
            <button
              type="button"
              onClick={handleToggleSpeak}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs cursor-pointer transition ${
                isSpeaking
                  ? 'bg-rose-50 text-rose-700 border-rose-300 animate-pulse font-bold'
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title="قراءة النص صوتياً"
            >
              {isSpeaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-indigo-600" />}
              <span>{isSpeaking ? (lang === 'ar' ? 'إيقاف الصوتي' : 'Stop Audio') : (lang === 'ar' ? 'قراءة ناطقة' : 'Read Out')}</span>
            </button>

            {/* Copy Button */}
            <button
              type="button"
              onClick={handleCopyText}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border bg-white hover:bg-slate-100 text-slate-700 border-slate-200 text-xs cursor-pointer transition"
              title="نسخ الإجابة الكاملة"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
              <span>{copied ? (lang === 'ar' ? 'تم النسخ' : 'Copied') : (lang === 'ar' ? 'نسخ' : 'Copy')}</span>
            </button>

            {/* Export Markdown */}
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border bg-white hover:bg-slate-100 text-slate-700 border-slate-200 text-xs cursor-pointer transition"
              title="تصدير كملف ماركداون"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>{lang === 'ar' ? 'تصدير .md' : 'Export'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Markdown Body */}
      <div className={`rich-markdown-body leading-relaxed ${fontSizeClass} ${role === 'user' ? 'text-slate-900 font-medium' : 'text-slate-800'}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            // Code Blocks Override
            code({ node, inline, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || '');
              const codeString = String(children).replace(/\n$/, '');

              if (!inline && (match || codeString.includes('\n'))) {
                return (
                  <CodeBlock
                    code={codeString}
                    language={match ? match[1] : 'typescript'}
                    title={match ? match[1].toUpperCase() : 'كود برمجي'}
                  />
                );
              }

              return (
                <code
                  className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200/80 text-indigo-700 font-mono text-xs dir-ltr inline-block"
                  {...props}
                >
                  {children}
                </code>
              );
            },

            // Styled Responsive Tables
            table({ children }) {
              return (
                <div className="my-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
                  <table className="w-full text-right text-xs md:text-sm border-collapse">{children}</table>
                </div>
              );
            },
            thead({ children }) {
              return <thead className="bg-slate-100 text-slate-800 border-b border-slate-200 font-bold">{children}</thead>;
            },
            tbody({ children }) {
              return <tbody className="divide-y divide-slate-100">{children}</tbody>;
            },
            tr({ children }) {
              return <tr className="hover:bg-slate-50/80 transition-colors">{children}</tr>;
            },
            th({ children }) {
              return <th className="p-2.5 font-semibold text-slate-900 text-right">{children}</th>;
            },
            td({ children }) {
              return <td className="p-2.5 text-slate-700 text-right">{children}</td>;
            },

            // Blockquotes
            blockquote({ children }) {
              return (
                <blockquote className="my-2.5 border-r-4 border-indigo-500 bg-indigo-50/60 p-3 rounded-l-xl text-indigo-950 font-normal italic">
                  {children}
                </blockquote>
              );
            },

            // Links with media handling & Security target_blank
            a({ href, children }) {
              if (!href) return <span>{children}</span>;

              // Image link auto-embed
              if (isImageUrl(href)) {
                return (
                  <div className="my-2.5 inline-block max-w-md rounded-xl overflow-hidden border border-slate-200 shadow-md">
                    <img
                      src={href}
                      alt={String(children) || 'صورة مدمجة'}
                      className="w-full h-auto cursor-pointer hover:scale-102 transition-transform duration-200"
                      onClick={() => setSelectedImage(href)}
                    />
                    <div className="bg-slate-900 text-white text-[11px] p-1.5 flex items-center justify-between">
                      <span className="truncate flex items-center gap-1">
                        <ImageIcon className="w-3 h-3 text-cyan-400" />
                        <span>{String(children)}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedImage(href)}
                        className="text-cyan-300 hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Maximize2 className="w-3 h-3" />
                        <span>{lang === 'ar' ? 'تكبير' : 'Zoom'}</span>
                      </button>
                    </div>
                  </div>
                );
              }

              // Video link auto-embed
              if (isVideoUrl(href)) {
                return (
                  <div className="my-3 rounded-xl overflow-hidden border border-slate-800 bg-slate-950 p-2 shadow-lg">
                    <div className="flex items-center gap-1.5 text-xs text-amber-400 mb-2 font-semibold">
                      <VideoIcon className="w-4 h-4" />
                      <span>{lang === 'ar' ? 'مشغل فيديو مدمج:' : 'Embedded Video Player:'}</span>
                    </div>
                    {href.includes('youtube.com') || href.includes('youtu.be') ? (
                      <div className="aspect-video w-full rounded-lg overflow-hidden">
                        <iframe
                          src={href.replace('watch?v=', 'embed/').replace('youtu.be/', 'youtube.com/embed/')}
                          className="w-full h-full"
                          allowFullScreen
                          title="Embedded YouTube Video"
                        />
                      </div>
                    ) : (
                      <video controls className="w-full h-auto rounded-lg bg-black max-h-80">
                        <source src={href} />
                        {lang === 'ar' ? 'متصفحك لا يدعم تشغيل الفيديو المباشر.' : 'Your browser does not support HTML5 video.'}
                      </video>
                    )}
                  </div>
                );
              }

              // Audio link auto-embed
              if (isAudioUrl(href)) {
                return (
                  <div className="my-2.5 rounded-xl border border-indigo-200 bg-indigo-50/90 p-3 shadow-xs">
                    <div className="flex items-center gap-2 text-xs font-semibold text-indigo-900 mb-1.5">
                      <MusicIcon className="w-4 h-4 text-indigo-600 animate-pulse" />
                      <span>{lang === 'ar' ? 'ملف صوتي مدمج:' : 'Embedded Audio:'}</span>
                      <span className="truncate text-slate-600 font-normal">{href.split('/').pop()}</span>
                    </div>
                    <audio controls className="w-full h-9 rounded-md">
                      <source src={href} />
                      {lang === 'ar' ? 'متصفحك لا يدعم التشغيل الصوتي المباشر.' : 'Audio playback not supported.'}
                    </audio>
                  </div>
                );
              }

              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-800 underline font-semibold inline-flex items-center gap-0.5 mx-1"
                >
                  <span>{children}</span>
                  <ExternalLink className="w-3 h-3 inline shrink-0" />
                </a>
              );
            },

            // Lists
            ul({ children }) {
              return <ul className="my-2 list-disc list-inside space-y-1 text-slate-800 pr-2">{children}</ul>;
            },
            ol({ children }) {
              return <ol className="my-2 list-decimal list-inside space-y-1 text-slate-800 pr-2">{children}</ol>;
            },
            li({ children }) {
              return <li className="leading-relaxed">{children}</li>;
            },

            // Headers
            h1({ children }) {
              return <h1 className="text-xl font-extrabold text-slate-900 mt-4 mb-2 pb-1 border-b border-slate-200">{children}</h1>;
            },
            h2({ children }) {
              return <h2 className="text-lg font-bold text-slate-900 mt-3 mb-1.5">{children}</h2>;
            },
            h3({ children }) {
              return <h3 className="text-base font-bold text-slate-800 mt-2.5 mb-1">{children}</h3>;
            },
          }}
        >
          {processedContent}
        </ReactMarkdown>
      </div>

      {/* Image Lightbox Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-4xl w-full bg-slate-900 rounded-2xl p-2 border border-slate-800 overflow-hidden shadow-2xl">
            <img src={selectedImage} alt="Large preview" className="w-full h-auto max-h-[85vh] object-contain rounded-xl" />
            <div className="p-3 bg-slate-950 flex items-center justify-between text-white text-xs">
              <span className="truncate text-slate-400 font-mono">{selectedImage}</span>
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-bold cursor-pointer"
              >
                {lang === 'ar' ? 'إغلاق المعاينة' : 'Close Preview'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
