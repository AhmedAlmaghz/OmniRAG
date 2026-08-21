'use client';

import React from 'react';
import { Document } from '@/lib/types/omnirag';
import {
  FileText,
  FileCode,
  Globe,
  MonitorPlay,
  FolderGit2,
  Database,
  FolderPlus,
  Layers,
  Sparkles,
  Eye,
  Trash2,
  RefreshCw,
  Folder,
  Calendar,
  Tag,
  Clock,
  HardDrive,
  Hash,
  History,
  GitBranch,
  Image as ImageIcon,
  FileSpreadsheet,
  Presentation,
  Music,
  Video,
} from 'lucide-react';

interface DocumentCardProps {
  document: Document;
  collectionName?: string;
  lang: 'ar' | 'en';
  isSelected?: boolean;
  onSelect?: () => void;
  onPreview?: () => void;
  onInspectChunks?: () => void;
  onViewHistory?: () => void;
  onReindex?: () => void;
  onDelete?: () => void;
  isReindexing?: boolean;
}

export function DocumentCard({
  document,
  collectionName,
  lang,
  isSelected = false,
  onSelect,
  onPreview,
  onInspectChunks,
  onViewHistory,
  onReindex,
  onDelete,
  isReindexing = false,
}: DocumentCardProps) {
  const isRtl = lang === 'ar';
  const srcType = document.metadata?.connectorType || document.sourceType || 'file';

  const getSourceIconAndColor = () => {
    switch (srcType) {
      case 'youtube':
        return {
          icon: <MonitorPlay className="w-4 h-4 text-rose-600" />,
          bg: 'bg-rose-50 border-rose-100',
          badgeText: 'YOUTUBE',
          badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
        };
      case 'url':
        return {
          icon: <Globe className="w-4 h-4 text-blue-600" />,
          bg: 'bg-blue-50 border-blue-100',
          badgeText: 'WEB URL',
          badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
        };
      case 'github':
        return {
          icon: <FolderGit2 className="w-4 h-4 text-slate-800" />,
          bg: 'bg-slate-100 border-slate-200',
          badgeText: 'GITHUB',
          badgeClass: 'bg-slate-100 text-slate-800 border-slate-200',
        };
      case 'database':
        return {
          icon: <Database className="w-4 h-4 text-amber-600" />,
          bg: 'bg-amber-50 border-amber-100',
          badgeText: 'DATABASE',
          badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
        };
      case 'gdrive':
        return {
          icon: <FolderPlus className="w-4 h-4 text-emerald-600" />,
          bg: 'bg-emerald-50 border-emerald-100',
          badgeText: 'G-DRIVE',
          badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        };
      default: {
        const titleLower = document.title.toLowerCase();

        // 1. PDF
        if (titleLower.endsWith('.pdf')) {
          return {
            icon: <FileText className="w-4 h-4 text-rose-500" />,
            bg: 'bg-rose-50/60 border-rose-100',
            badgeText: lang === 'ar' ? 'ملف PDF' : 'PDF DOC',
            badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
          };
        }

        // 2. Word (DOCX / DOC)
        if (titleLower.endsWith('.docx') || titleLower.endsWith('.doc')) {
          return {
            icon: <FileText className="w-4 h-4 text-blue-500" />,
            bg: 'bg-blue-50/60 border-blue-100',
            badgeText: lang === 'ar' ? 'مستند وورد' : 'WORD DOC',
            badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
          };
        }

        // 3. PowerPoint (PPTX / PPT)
        if (titleLower.endsWith('.pptx') || titleLower.endsWith('.ppt')) {
          return {
            icon: <Presentation className="w-4 h-4 text-amber-500" />,
            bg: 'bg-amber-50/60 border-amber-100',
            badgeText: lang === 'ar' ? 'عرض تقدمي' : 'PPT SLIDES',
            badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
          };
        }

        // 4. Excel (XLSX / XLS / CSV)
        if (titleLower.endsWith('.xlsx') || titleLower.endsWith('.xls') || titleLower.endsWith('.csv')) {
          return {
            icon: <FileSpreadsheet className="w-4 h-4 text-emerald-500" />,
            bg: 'bg-emerald-50/60 border-emerald-100',
            badgeText: lang === 'ar' ? 'جدول بيانات' : 'EXCEL SHEET',
            badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          };
        }

        // 5. Images (PNG / JPG / JPEG / WEBP / GIF / BMP)
        if (
          titleLower.endsWith('.png') ||
          titleLower.endsWith('.jpg') ||
          titleLower.endsWith('.jpeg') ||
          titleLower.endsWith('.webp') ||
          titleLower.endsWith('.gif') ||
          titleLower.endsWith('.bmp')
        ) {
          return {
            icon: <ImageIcon className="w-4 h-4 text-cyan-500" />,
            bg: 'bg-cyan-50/60 border-cyan-100',
            badgeText: lang === 'ar' ? 'صورة' : 'IMAGE OCR',
            badgeClass: 'bg-cyan-50 text-cyan-700 border-cyan-200',
          };
        }

        // 6. Audio (MP3 / WAV / FLAC / AAC / OGG / M4A)
        if (
          titleLower.endsWith('.mp3') ||
          titleLower.endsWith('.wav') ||
          titleLower.endsWith('.flac') ||
          titleLower.endsWith('.aac') ||
          titleLower.endsWith('.ogg') ||
          titleLower.endsWith('.m4a')
        ) {
          return {
            icon: <Music className="w-4 h-4 text-violet-500" />,
            bg: 'bg-violet-50/60 border-violet-100',
            badgeText: lang === 'ar' ? 'ملف صوتي' : 'AUDIO CAST',
            badgeClass: 'bg-violet-50 text-violet-700 border-violet-200',
          };
        }

        // 7. Video (MP4 / MOV / AVI / WEBM)
        if (
          titleLower.endsWith('.mp4') ||
          titleLower.endsWith('.mov') ||
          titleLower.endsWith('.avi') ||
          titleLower.endsWith('.webm')
        ) {
          return {
            icon: <Video className="w-4 h-4 text-purple-500" />,
            bg: 'bg-purple-50/60 border-purple-100',
            badgeText: lang === 'ar' ? 'فيديو' : 'VIDEO CAST',
            badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
          };
        }

        // 8. Markdown / Code / Text
        if (
          titleLower.endsWith('.md') ||
          titleLower.endsWith('.txt') ||
          titleLower.endsWith('.json') ||
          titleLower.endsWith('.yaml') ||
          titleLower.endsWith('.yml') ||
          titleLower.endsWith('.py') ||
          titleLower.endsWith('.js') ||
          titleLower.endsWith('.ts')
        ) {
          return {
            icon: <FileCode className="w-4 h-4 text-indigo-600" />,
            bg: 'bg-indigo-50 border-indigo-100',
            badgeText: lang === 'ar' ? 'ملف نصي' : 'DOC/CODE',
            badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
          };
        }

        // 9. Generic Fallback
        return {
          icon: <FileText className="w-4 h-4 text-indigo-600" />,
          bg: 'bg-indigo-50 border-indigo-100',
          badgeText: lang === 'ar' ? 'ملف' : 'FILE',
          badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        };
      }
    }
  };

  const { icon, bg, badgeText, badgeClass } = getSourceIconAndColor();

  const getStatusBadge = () => {
    switch (document.status as string) {
      case 'indexed':
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60 shadow-3xs uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {isRtl ? 'مفهرس' : 'Indexed'}
          </span>
        );
      case 'processing':
      case 'indexing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/60 shadow-3xs uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            {isRtl ? 'جاري الفهرسة' : 'Indexing'}
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-200/60 shadow-3xs uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            {isRtl ? 'معلق' : 'Pending'}
          </span>
        );
      case 'failed':
      case 'error':
        return (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full bg-rose-50 text-rose-700 border border-rose-200/60 shadow-3xs uppercase tracking-wide"
            title={indexErrors?.join('؛ ')}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            {isRtl ? 'فشل' : 'Failed'}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full bg-slate-50 text-slate-700 border border-slate-200 uppercase">
            {document.status || 'INDEXED'}
          </span>
        );
    }
  };

  const estimatedTokens = Math.round((document.content?.length || 0) / 4);
  // Only show a size when we actually have content to measure — the previous
  // fallback rendered a fabricated "24 KB" for every content-less document.
  const sizeEstimate = document.content ? (new Blob([document.content]).size / 1024).toFixed(1) + ' KB' : null;
  // Indexing failure reasons (persisted by the ingestion pipeline) surfaced as
  // a tooltip on the failed badge so users know WHY and can reindex.
  const indexErrors: string[] | undefined = Array.isArray(document.metadata?.indexErrors)
    ? document.metadata.indexErrors
    : undefined;

  return (
    <div
      onClick={onSelect}
      className={`group rounded-2xl border transition-all duration-200 flex flex-col justify-between p-4.5 space-y-3 cursor-pointer bg-white relative ${
        isSelected
          ? 'border-indigo-500 shadow-md ring-2 ring-indigo-100 bg-indigo-50/20'
          : 'border-slate-200/80 hover:border-indigo-200 hover:shadow-sm hover:bg-slate-50/40'
      }`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Top Row: Icon + Source Badge + Version + Collection + Status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center border shrink-0 ${bg}`}>{icon}</div>
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase font-mono shrink-0 ${badgeClass}`}
            >
              {badgeText}
            </span>
            <span
              className="text-[9px] font-bold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200/80 font-mono shrink-0 flex items-center gap-0.5"
              title={isRtl ? `إصدار المستند: v${document.version || 1}` : `Document Version: v${document.version || 1}`}
            >
              <GitBranch className="w-2.5 h-2.5" />
              <span>v{document.version || 1}</span>
            </span>
            {collectionName && (
              <span className="text-[9px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 flex items-center gap-1 truncate max-w-[110px]">
                <Folder className="w-2.5 h-2.5 shrink-0 text-slate-500" />
                <span className="truncate">{collectionName}</span>
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0">{getStatusBadge()}</div>
      </div>

      {/* Document Title & Content Excerpt */}
      <div className="space-y-1">
        <h4
          className="text-xs font-extrabold text-slate-900 leading-snug group-hover:text-indigo-900 transition-colors line-clamp-2 break-all"
          title={document.title}
        >
          {document.title}
        </h4>
        {document.content && (
          <p className="text-[11px] text-slate-500 leading-normal line-clamp-2 font-sans font-normal">
            {document.content.replace(/[#*`_\[\]]/g, '').slice(0, 140)}...
          </p>
        )}
      </div>

      {/* Metrics Row: Chunks, Tokens, Size, Lang */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[10px] text-slate-500 font-mono">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="flex items-center gap-1 font-bold text-indigo-700 bg-indigo-50/80 px-1.5 py-0.5 rounded border border-indigo-100">
            <Layers className="w-3 h-3 text-indigo-500" />
            <span>
              {document.chunkCount || 0} {isRtl ? 'مقطع' : 'chunks'}
            </span>
          </span>
          <span className="flex items-center gap-1 text-slate-600">
            <Sparkles className="w-3 h-3 text-amber-500" />
            <span>~{estimatedTokens} tok</span>
          </span>
          {sizeEstimate && (
            <span className="flex items-center gap-1 text-slate-400">
              <HardDrive className="w-3 h-3 text-slate-400" />
              <span>{sizeEstimate}</span>
            </span>
          )}
        </div>

        <span className="text-slate-400 font-sans text-[9px] shrink-0">
          {/* ar-EG (Gregorian) instead of ar-SA, which renders Hijri-calendar
              dates in several browsers and confused the document timeline. */}
          {new Date(document.createdAt).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </div>

      {/* Interactive Action Footer */}
      <div className="pt-1.5 flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1 flex-wrap">
          {onViewHistory && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewHistory();
              }}
              className="px-2 py-1 bg-slate-100 hover:bg-violet-50 text-slate-700 hover:text-violet-700 rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer border border-slate-200 hover:border-violet-200"
              title={isRtl ? 'سجل وتاريخ الإصدارات والتراجع' : 'Version History & Revert'}
            >
              <History className="w-3 h-3 text-violet-600" />
              <span>{isRtl ? 'الإصدارات' : 'History'}</span>
            </button>
          )}

          {onInspectChunks && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onInspectChunks();
              }}
              className="px-2 py-1 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer border border-slate-200 hover:border-indigo-200"
              title={isRtl ? 'فحص المقاطع والمتجهات' : 'Inspect Chunks'}
            >
              <Layers className="w-3 h-3" />
              <span>{isRtl ? 'المقاطع' : 'Vectors'}</span>
            </button>
          )}

          {onPreview && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPreview();
              }}
              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer border border-slate-200"
              title={isRtl ? 'قراءة المحتوى' : 'Preview Content'}
            >
              <Eye className="w-3 h-3 text-slate-500" />
              <span>{isRtl ? 'معاينة' : 'Preview'}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {onReindex && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReindex();
              }}
              disabled={isReindexing}
              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
              title={isRtl ? 'إعادة الفهرسة والتضمين' : 'Re-index Document'}
              aria-label={isRtl ? `إعادة فهرسة ${document.title}` : `Re-index ${document.title}`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isReindexing ? 'animate-spin text-indigo-600' : ''}`} />
            </button>
          )}

          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
              title={isRtl ? 'حذف المستند نهائيا' : 'Delete Document'}
              aria-label={isRtl ? `حذف ${document.title}` : `Delete ${document.title}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
