'use client';

import React, { useState } from 'react';
import { Document } from '@/lib/types/omnirag';
import {
  X,
  FileText,
  Copy,
  Check,
  Calendar,
  Layers,
  Sparkles,
  FileCheck,
  Folder,
  Tag,
  Cpu,
  Globe,
  Youtube,
  Github,
  Database,
  FolderPlus
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface DocumentPreviewModalProps {
  document: Document;
  collectionName?: string;
  lang: 'ar' | 'en';
  onClose: () => void;
  onInspectChunks?: () => void;
}

export function DocumentPreviewModal({
  document,
  collectionName,
  lang,
  onClose,
  onInspectChunks,
}: DocumentPreviewModalProps) {
  const isRtl = lang === 'ar';
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(document.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getSourceIcon = () => {
    const type = document.metadata?.connectorType || document.sourceType;
    switch (type) {
      case 'youtube': return <Youtube className="w-5 h-5 text-rose-600" />;
      case 'url': return <Globe className="w-5 h-5 text-blue-600" />;
      case 'github': return <Github className="w-5 h-5 text-slate-800" />;
      case 'database': return <Database className="w-5 h-5 text-amber-600" />;
      case 'gdrive': return <FolderPlus className="w-5 h-5 text-emerald-600" />;
      default: return <FileText className="w-5 h-5 text-indigo-600" />;
    }
  };

  const wordCount = document.content ? document.content.trim().split(/\s+/).length : 0;
  const estimatedTokens = Math.round((document.content?.length || 0) / 4);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 overflow-hidden" dir={isRtl ? 'rtl' : 'ltr'}>
        {/* Header */}
        <div className="p-5 border-b border-slate-150 flex items-center justify-between gap-4 bg-slate-50/70">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center border border-indigo-100/60 shrink-0">
              {getSourceIcon()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-indigo-100/70 text-indigo-800 font-mono">
                  {document.sourceType || 'FILE'}
                </span>
                {collectionName && (
                  <span className="text-[10px] font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-md border border-violet-200 flex items-center gap-1">
                    <Folder className="w-3 h-3" />
                    <span>{collectionName}</span>
                  </span>
                )}
                <span className="text-[10px] font-mono text-slate-500 font-bold bg-slate-200/60 px-1.5 py-0.5 rounded uppercase">
                  {document.language || 'AR'}
                </span>
              </div>
              <h3 className="text-sm font-extrabold text-slate-900 truncate mt-0.5">
                {document.title}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onInspectChunks && (
              <button
                onClick={onInspectChunks}
                className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{isRtl ? 'فحص المتجهات' : 'Inspect Vectors'}</span>
              </button>
            )}

            <button
              onClick={handleCopy}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-600">{isRtl ? 'تم النسخ' : 'Copied'}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  <span>{isRtl ? 'نسخ النص' : 'Copy Text'}</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Metadata Chips Bar */}
        <div className="px-5 py-2.5 bg-slate-100/60 border-b border-slate-200 flex items-center justify-between gap-4 flex-wrap text-xs text-slate-600">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
              <span>{isRtl ? 'المقاطع:' : 'Chunks:'}</span>
              <strong className="font-mono text-slate-800">{document.chunkCount || 0}</strong>
            </span>
            <span className="flex items-center gap-1">
              <FileCheck className="w-3.5 h-3.5 text-indigo-600" />
              <span>{isRtl ? 'عدد الكلمات:' : 'Words:'}</span>
              <strong className="font-mono text-slate-800">{wordCount.toLocaleString()}</strong>
            </span>
            <span className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>{isRtl ? 'الرموز:' : 'Tokens:'}</span>
              <strong className="font-mono text-slate-800">~{estimatedTokens.toLocaleString()}</strong>
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-indigo-600" />
              <span>{isRtl ? 'تاريخ الفهرسة:' : 'Indexed:'}</span>
              <strong className="font-mono text-slate-800">{new Date(document.createdAt).toLocaleDateString()}</strong>
            </span>
          </div>

          {document.metadata?.ocrEngine && (
            <span className="text-[10px] font-mono text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
              OCR: {document.metadata.ocrEngine}
            </span>
          )}
        </div>

        {/* Body Rendered in Markdown */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4 font-sans bg-white">
          <div className="prose prose-slate max-w-none text-slate-800 leading-relaxed text-sm">
            <Markdown remarkPlugins={[remarkGfm]}>
              {document.content || (isRtl ? '*لا يوجد نص محفوظ.*' : '*No content available.*')}
            </Markdown>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-150 bg-slate-50/70 flex items-center justify-between text-xs text-slate-500">
          <span className="font-mono text-[11px]">
            Doc ID: <strong className="text-slate-800">{document.id}</strong>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition cursor-pointer"
          >
            {isRtl ? 'إغلاق المعاينة' : 'Close Preview'}
          </button>
        </div>
      </div>
    </div>
  );
}
