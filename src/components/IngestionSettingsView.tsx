'use client';

import React, { useState, useEffect } from 'react';
import { FileText, HardDrive, Layers, RefreshCw, Server, Zap, RotateCcw } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  getIngestionSettings,
  saveIngestionSettings,
  DEFAULT_INGESTION_SETTINGS,
  IngestionSettings,
  IngestionChunkStrategy,
} from '@/lib/config/ingestionSettings';

interface IngestionSettingsViewProps {
  lang: 'ar' | 'en';
}

/**
 * Document ingestion settings — LIGHT theme, consistent with the app design
 * system (the previous version rendered a permanent dark slate-900 island
 * regardless of the user's theme). Every control shown here is REAL:
 * maxFileSizeMb/pagesPerChunk gate the upload+parse pipeline, and the chunk
 * defaults seed the Ingestion Studio's per-document config which is sent to
 * POST /v1/documents as `chunkingConfig`. Removed decorative fields
 * (default engine picker, concurrency workers, Gemini fallback toggle) had no
 * consumers anywhere in the codebase.
 */
export default function IngestionSettingsView({ lang }: IngestionSettingsViewProps) {
  const [settings, setSettings] = useState<IngestionSettings>(DEFAULT_INGESTION_SETTINGS);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  useEffect(() => {
    setSettings(getIngestionSettings());
  }, []);

  // localStorage writes are synchronous — an artificial "saving…" delay only
  // invited edits during a fake in-flight window. Feedback is instant and
  // honest.
  const handleSave = () => {
    saveIngestionSettings(settings);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const performReset = () => {
    setSettings(DEFAULT_INGESTION_SETTINGS);
    saveIngestionSettings(DEFAULT_INGESTION_SETTINGS);
    setIsResetConfirmOpen(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const isAr = lang === 'ar';

  return (
    <div className="space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="p-5 rounded-3xl bg-white border border-slate-200/80 shadow-3xs space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100">
              <HardDrive className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                {isAr ? 'إعدادات معالجة المستندات والتقطيع' : 'Document Ingestion & Chunking Settings'}
              </h2>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
                {isAr
                  ? 'حدود حجم الملفات، دفعات تقطيع الـ PDF، والقيم الافتراضية للتقطيع الدلالي التي يبدأ بها استوديو الاستيعاب — كلها تُطبَّق فعلياً على خط المعالجة.'
                  : 'File size limits, PDF page batching, and the default chunking values the Ingestion Studio starts from — all genuinely applied to the processing pipeline.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsResetConfirmOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
              title={isAr ? 'استعادة الإعدادات الافتراضية' : 'Reset to Defaults'}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{isAr ? 'افتراضي' : 'Reset'}</span>
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{isAr ? 'حفظ التغييرات' : 'Save Configuration'}</span>
            </button>
          </div>
        </div>

        {saveSuccess && (
          <div
            role="status"
            className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2 font-medium animate-fadeIn"
          >
            <Layers className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              {isAr
                ? 'تم تطبيق إعدادات الاستيعاب — تُستخدم في عملية الاستيعاب التالية مباشرة.'
                : 'Ingestion settings applied — they take effect on your next ingestion run.'}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Card 1: File Limits & Slicing (REAL: enforced at upload + parse) */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200/80 shadow-3xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
              <Server className="w-4 h-4 text-indigo-600" />
              <span>{isAr ? 'حدود الملفات وتقطيع الصفحات' : 'File Size & Slicing Limits'}</span>
            </div>
            <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 uppercase">
              {isAr ? 'مُطبَّق' : 'ENFORCED'}
            </span>
          </div>

          {/* Max File Size MB */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="ing-max-size" className="font-bold text-slate-700">
                {isAr ? 'الحد الأقصى لحجم الملف:' : 'Max Upload File Size:'}
              </label>
              <span className="font-mono font-bold text-indigo-700 text-sm bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100">
                {settings.maxFileSizeMb} MB
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-slate-400 font-medium">
                {isAr ? 'خيارات سريعة:' : 'Quick Presets:'}
              </span>
              {[10, 25, 50, 100, 150].map((mb) => (
                <button
                  key={mb}
                  type="button"
                  aria-pressed={settings.maxFileSizeMb === mb}
                  onClick={() => setSettings({ ...settings, maxFileSizeMb: mb })}
                  className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold transition border cursor-pointer ${
                    settings.maxFileSizeMb === mb
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700'
                  }`}
                >
                  {mb} MB
                </button>
              ))}
            </div>

            <input
              id="ing-max-size"
              type="range"
              min={5}
              max={150}
              step={5}
              value={settings.maxFileSizeMb}
              onChange={(e) => setSettings({ ...settings, maxFileSizeMb: Number(e.target.value) })}
              className="w-full accent-indigo-600 cursor-pointer"
            />
            <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
              {isAr
                ? 'يُفرض قبل الرفع في متصفح المستخدم وعلى الخادم ضمن سقف 50MB الصلب. تجاوز السقف الخادمي مستحيل بأي قيمة هنا.'
                : 'Enforced client-side before upload AND server-side within the hard 50MB ceiling — no local value can exceed that cap.'}
            </p>
          </div>

          {/* Pages per Chunk Batch */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="ing-pages" className="font-bold text-slate-700">
                {isAr ? 'عدد صفحات PDF لكل دفعة معالجة:' : 'PDF Pages Per Processing Batch:'}
              </label>
              <span className="font-mono font-bold text-indigo-700 text-sm bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100">
                {settings.pagesPerChunk} {isAr ? 'صفحة' : 'pages'}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-slate-400 font-medium">{isAr ? 'دفعات جاهزة:' : 'Batch Presets:'}</span>
              {[10, 25, 50, 100].map((pgs) => (
                <button
                  key={pgs}
                  type="button"
                  aria-pressed={settings.pagesPerChunk === pgs}
                  onClick={() => setSettings({ ...settings, pagesPerChunk: pgs })}
                  className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold transition border cursor-pointer ${
                    settings.pagesPerChunk === pgs
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700'
                  }`}
                >
                  {pgs} {isAr ? 'صفحة' : 'Pages'}
                </button>
              ))}
            </div>

            <input
              id="ing-pages"
              type="range"
              min={5}
              max={100}
              step={5}
              value={settings.pagesPerChunk}
              onChange={(e) => setSettings({ ...settings, pagesPerChunk: Number(e.target.value) })}
              className="w-full accent-indigo-600 cursor-pointer"
            />
            <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
              {isAr
                ? 'ملاحظة صدق: خط المعالجة يدمج تلقائياً أي ملف ≤30MB في طلب واحد بغض النظر عن هذه القيمة، ويخفض الدفعة للملفات الضخمة جداً — القيمة هنا حد أعلى وليس عدّاً حرفياً.'
                : 'Honest note: the pipeline auto-merges any file ≤30MB into ONE request regardless of this value, and lowers it for huge files — treat this as an upper bound.'}
            </p>
          </div>
        </div>

        {/* Card 2: Default chunking (REAL: seeds the Studio → documents POST) */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200/80 shadow-3xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
              <Zap className="w-4 h-4 text-amber-500" />
              <span>{isAr ? 'القيم الافتراضية للتقطيع الدلالي' : 'Default Chunking Defaults'}</span>
            </div>
            <span className="text-[10px] font-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 uppercase">
              {isAr ? 'افتراضيات الاستوديو' : 'STUDIO DEFAULTS'}
            </span>
          </div>

          {/* Chunking Strategy */}
          <div className="space-y-2">
            <label htmlFor="ing-strategy" className="text-xs font-bold text-slate-700 block">
              {isAr ? 'استراتيجية التقطيع الافتراضية:' : 'Default Chunking Strategy:'}
            </label>
            <select
              id="ing-strategy"
              value={settings.chunkStrategy}
              onChange={(e) => setSettings({ ...settings, chunkStrategy: e.target.value as IngestionChunkStrategy })}
              className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="semantic">
                {isAr ? 'تقطيع دلالي بحدود جمل وفقرات (Semantic)' : 'Semantic Boundaries'}
              </option>
              <option value="markdown">{isAr ? 'حسب ترويسات الماركدوان (Markdown)' : 'Markdown Headings'}</option>
              <option value="recursive">{isAr ? 'تقسيم تكراري بالفواصل (Recursive)' : 'Recursive Splitting'}</option>
            </select>
          </div>

          {/* Chunk Size & Overlap */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            <div>
              <label htmlFor="ing-chunk-size" className="text-xs font-bold text-slate-700 block mb-1">
                {isAr ? 'حجم المقطع (Tokens):' : 'Chunk Size (Tokens):'}
              </label>
              <input
                id="ing-chunk-size"
                type="number"
                min={128}
                max={4096}
                step={64}
                value={settings.chunkSize}
                onChange={(e) => setSettings({ ...settings, chunkSize: Number(e.target.value) })}
                className="w-full p-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="ing-overlap" className="text-xs font-bold text-slate-700 block mb-1">
                {isAr ? 'التداخل (Overlap %):' : 'Chunk Overlap (%):'}
              </label>
              <input
                id="ing-overlap"
                type="number"
                min={0}
                max={50}
                step={5}
                value={settings.chunkOverlap}
                onChange={(e) => setSettings({ ...settings, chunkOverlap: Number(e.target.value) })}
                className="w-full p-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
            {isAr
              ? 'تُعبَّأ بهذه القيم حقولاً التقطيع في استوديو الاستيعاب تلقائياً عند فتحه، وتُرسل مع كل مستند جديد إلى الخادم الذي يعيد التحقق وتثبيت الحدود (128–4096 رمزاً، تداخل 0–50%). يمكن تعديلها لكل مستند على حدة داخل الاستوديو.'
              : 'These pre-fill the Ingestion Studio chunk fields when it opens and are sent with every new document; the server re-validates and clamps them (128–4096 tokens, 0–50% overlap). Per-document overrides remain available inside the Studio.'}
          </p>

          <div className="flex items-start gap-2 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
            <span>
              {isAr
                ? 'ترتيب محركات استخراج PDF (الأصلي ← OCR سحابي ← Tesseract محلي) يُدار داخل خط المعالجة نفسه ولا يحتاج ضبطاً يدوياً.'
                : 'The PDF extraction waterfall (native → cloud OCR → local Tesseract) is managed by the pipeline itself and needs no manual setting.'}
            </span>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={isResetConfirmOpen}
        title={isAr ? 'استعادة الإعدادات الافتراضية' : 'Reset to defaults'}
        message={
          isAr
            ? 'هل تريد استعادة جميع إعدادات المعالجة والتقطيع إلى قيمها الافتراضية؟'
            : 'Reset all ingestion and chunking settings to their default values?'
        }
        confirmLabel={isAr ? 'استعادة' : 'Reset'}
        cancelLabel={isAr ? 'إلغاء' : 'Cancel'}
        variant="warning"
        onConfirm={performReset}
        onCancel={() => setIsResetConfirmOpen(false)}
      />
    </div>
  );
}
