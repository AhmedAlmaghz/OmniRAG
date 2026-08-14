'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText,
  Sliders,
  HardDrive,
  Layers,
  Sparkles,
  CheckCircle2,
  RefreshCw,
  Cpu,
  Server,
  Zap,
  Info,
  ShieldCheck,
  RotateCcw
} from 'lucide-react';
import {
  getIngestionSettings,
  saveIngestionSettings,
  DEFAULT_INGESTION_SETTINGS,
  IngestionSettings
} from '@/lib/config/ingestionSettings';

interface IngestionSettingsViewProps {
  lang: 'ar' | 'en';
}

export default function IngestionSettingsView({ lang }: IngestionSettingsViewProps) {
  const [settings, setSettings] = useState<IngestionSettings>(DEFAULT_INGESTION_SETTINGS);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    setSettings(getIngestionSettings());
  }, []);

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      saveIngestionSettings(settings);
      setIsSaving(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3500);
    }, 400);
  };

  const handleReset = () => {
    setSettings(DEFAULT_INGESTION_SETTINGS);
    saveIngestionSettings(DEFAULT_INGESTION_SETTINGS);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3500);
  };

  const isAr = lang === 'ar';

  return (
    <div className="space-y-6 text-slate-100">
      {/* Header Banner */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <HardDrive className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">
                {isAr ? 'إعدادات معالجة المستندات والبنية التحتية' : 'Document Ingestion & Infrastructure Settings'}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                {isAr
                  ? 'تخصيص حدود حجم الملفات، تقطيع صفحات الـ PDF، محركات الاستخراج البصري، واستراتيجيات التقطيع حسب قدرات البنية التحتية الخاصة بك.'
                  : 'Customize maximum file sizes, PDF page slicing limits, OCR extraction engines, and chunking parameters based on your infrastructure capabilities.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              title={isAr ? 'استعادة الإعدادات الافتراضية' : 'Reset to Defaults'}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{isAr ? 'افتراضي' : 'Reset'}</span>
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer disabled:opacity-50 shadow-md shadow-indigo-600/20"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{isAr ? 'جاري الحفظ...' : 'Saving...'}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isAr ? 'حفظ التغييرات' : 'Save Configuration'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {showSuccess && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs flex items-center gap-2 font-medium"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                {isAr
                  ? 'تم تطبيق وتحديث إعدادات استيراد المستندات والبنية التحتية بنجاح!'
                  : 'Document ingestion & infrastructure settings updated successfully!'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: File Limits & Slicing */}
        <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
              <Server className="w-4 h-4" />
              <span>{isAr ? 'حدود الملفات وتقطيع الصفحات' : 'File Size & Slicing Limits'}</span>
            </div>
            <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800">
              Infrastructure
            </span>
          </div>

          {/* Max File Size MB */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <label className="font-bold text-slate-200 flex items-center gap-1.5">
                <span>{isAr ? 'الحد الأقصى لحجم الملف (Max File Size):' : 'Max Upload File Size:'}</span>
              </label>
              <span className="font-mono font-bold text-cyan-400 text-sm bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                {settings.maxFileSizeMb} MB
              </span>
            </div>

            {/* Quick Toggle Presets */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-slate-400 font-medium">{isAr ? 'خيارات سريعة:' : 'Quick Presets:'}</span>
              {[10, 25, 50, 100, 150].map((mb) => (
                <button
                  key={mb}
                  type="button"
                  onClick={() => setSettings({ ...settings, maxFileSizeMb: mb })}
                  className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold transition border cursor-pointer ${
                    settings.maxFileSizeMb === mb
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/60 shadow-xs'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  {mb} MB
                </button>
              ))}
            </div>

            <input
              type="range"
              min={5}
              max={150}
              step={5}
              value={settings.maxFileSizeMb}
              onChange={(e) => setSettings({ ...settings, maxFileSizeMb: Number(e.target.value) })}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>5 MB</span>
              <span>25 MB</span>
              <span className="text-cyan-400 font-bold">50 MB (Default)</span>
              <span>100 MB</span>
              <span>150 MB</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
              {isAr
                ? 'يحدد أقصى حجم مسموح به لكل ملف مستند أو صورة يتم رفعها إلى النظام. يتم حفظ هذا الخيار في localStorage ويتم تطبيقه على كود معالجة الـ OCR للتحقق قبل الرفع.'
                : 'Defines maximum allowed size per uploaded file. Saved in localStorage and passed to OCR processing logic to enforce upload limits.'}
            </p>
          </div>

          {/* Pages per Chunk Batch */}
          <div className="space-y-3 pt-3 border-t border-slate-800/60">
            <div className="flex items-center justify-between text-xs">
              <label className="font-bold text-slate-200 flex items-center gap-1.5">
                <span>{isAr ? 'حجم تقطيع الصفحات (Document Chunk Size / Pages Per Batch):' : 'Document Chunk Size (Pages Per Batch):'}</span>
              </label>
              <span className="font-mono font-bold text-indigo-400 text-sm bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                {settings.pagesPerChunk} {isAr ? 'صفحة' : 'pages'}
              </span>
            </div>

            {/* Quick Toggle Presets */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-slate-400 font-medium">{isAr ? 'دفعات جاهزة:' : 'Batch Presets:'}</span>
              {[10, 25, 50, 100].map((pgs) => (
                <button
                  key={pgs}
                  type="button"
                  onClick={() => setSettings({ ...settings, pagesPerChunk: pgs })}
                  className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold transition border cursor-pointer ${
                    settings.pagesPerChunk === pgs
                      ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/60 shadow-xs'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  {pgs} {isAr ? 'صفحة' : 'Pages'}
                </button>
              ))}
            </div>

            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={settings.pagesPerChunk}
              onChange={(e) => setSettings({ ...settings, pagesPerChunk: Number(e.target.value) })}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>5 {isAr ? 'صفحات' : 'pages'}</span>
              <span className="text-indigo-400 font-bold">25 (Default)</span>
              <span>50</span>
              <span>100 {isAr ? 'صفحة' : 'pages'}</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
              {isAr
                ? 'يتم تقسيم ملفات PDF الضخمة إلى دفعات متتالية بهذا العدد من الصفحات للتحليل عبر الـ OCR. تضمن هذه الإعدادات عدم تجاوز مهلة المعالجة وتوفير أفضل دقة استخراج.'
                : 'Large PDFs are sliced into sequential page chunks based on this preference. Controls OCR batch sizes and prevents extraction timeouts.'}
            </p>
          </div>

          {/* Concurrency Workers */}
          <div className="space-y-2 pt-2 border-t border-slate-800/60">
            <div className="flex items-center justify-between text-xs">
              <label className="font-bold text-slate-200">
                {isAr ? 'عدد مسارات المعالجة المتوازية (Concurrency Workers):' : 'Batch Concurrency Workers:'}
              </label>
              <span className="font-mono font-bold text-emerald-400 text-sm bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                {settings.concurrencyWorkers} Workers
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4, 6, 8].map((num) => (
                <button
                  key={num}
                  onClick={() => setSettings({ ...settings, concurrencyWorkers: num })}
                  className={`py-1.5 rounded-lg font-mono text-xs font-bold border transition cursor-pointer ${
                    settings.concurrencyWorkers === num
                      ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/50'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  {num} Worker{num > 1 ? 's' : ''}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Card 2: Extraction Engine & Strategy */}
        <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>{isAr ? 'محرك الاستخراج واستراتيجية التقطيع' : 'Default Engine & Chunking Strategy'}</span>
            </div>
            <span className="text-[10px] font-mono text-amber-400 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800">
              AI OCR & RAG
            </span>
          </div>

          {/* Default Engine */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-200 block">
              {isAr ? 'محرك استخراج الملفات المفضل:' : 'Preferred Extraction Engine:'}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { id: 'mistral_ocr', labelAr: 'Mistral Document AI (OCR)', labelEn: 'Mistral Document AI', icon: Sparkles },
                { id: 'unstructured_mcp', labelAr: 'Unstructured API / MCP', labelEn: 'Unstructured.io MCP', icon: Cpu },
                { id: 'pdf_layout', labelAr: 'Native PDF High-Speed', labelEn: 'Native PDF High-Speed', icon: FileText },
                { id: 'gemini_vision', labelAr: 'Gemini Multimodal OCR', labelEn: 'Gemini Multimodal OCR', icon: Zap },
              ].map((engine) => {
                const IconComp = engine.icon;
                const isSelected = settings.defaultEngine === engine.id;
                return (
                  <button
                    key={engine.id}
                    onClick={() => setSettings({ ...settings, defaultEngine: engine.id as any })}
                    className={`p-2.5 rounded-xl border text-right font-medium text-xs flex items-center gap-2 transition cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-xs'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800/60'
                    }`}
                  >
                    <IconComp className={`w-4 h-4 shrink-0 ${isSelected ? 'text-indigo-400' : 'text-slate-500'}`} />
                    <span className="truncate">{isAr ? engine.labelAr : engine.labelEn}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chunking Strategy */}
          <div className="space-y-2 pt-2 border-t border-slate-800/60">
            <label className="text-xs font-bold text-slate-200 block">
              {isAr ? 'استراتيجية التقطيع الدلالي الافتراضية:' : 'Default Chunking Strategy:'}
            </label>
            <select
              value={settings.chunkStrategy}
              onChange={(e) => setSettings({ ...settings, chunkStrategy: e.target.value as any })}
              className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="semantic">{isAr ? 'تقطيع دلالي ذكي (Semantic Boundary)' : 'Semantic Boundary'}</option>
              <option value="markdown">{isAr ? 'حسب ترويسات وهيكل الماركدوان (Markdown)' : 'Markdown Headings'}</option>
              <option value="code">{isAr ? 'تحليل هيكل البرمجيات (Code AST Structure)' : 'Code AST Structure'}</option>
              <option value="sliding">{isAr ? 'نافذة متداخلة متقدمة (Sliding Window)' : 'Sliding Window'}</option>
            </select>
          </div>

          {/* Chunk Size & Overlap */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/60">
            <div>
              <label className="text-xs font-bold text-slate-200 block mb-1">
                {isAr ? 'حجم المقطع (Tokens):' : 'Chunk Size (Tokens):'}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={128}
                  max={4096}
                  step={64}
                  value={settings.chunkSize}
                  onChange={(e) => setSettings({ ...settings, chunkSize: Number(e.target.value) })}
                  className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-200 block mb-1">
                {isAr ? 'التداخل (Overlap %):' : 'Chunk Overlap (%):'}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={5}
                  value={settings.chunkOverlap}
                  onChange={(e) => setSettings({ ...settings, chunkOverlap: Number(e.target.value) })}
                  className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Gemini Fallback Toggle */}
          <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div>
              <span className="text-xs font-bold text-slate-200 block">
                {isAr ? 'إعادة المحاولة التلقائية عبر Gemini Vision' : 'Gemini Vision Auto-Fallback'}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {isAr
                  ? 'تفعيل الاستجابة الاحتياطية باستخدام موديل Gemini عند وجود صور جودة منخفضة.'
                  : 'Automatically fallback to Gemini Multimodal vision when native parsing yields empty text.'}
              </span>
            </div>
            <button
              onClick={() => setSettings({ ...settings, geminiFallback: !settings.geminiFallback })}
              className={`w-11 h-6 rounded-full p-1 transition cursor-pointer shrink-0 ${
                settings.geminiFallback ? 'bg-indigo-600' : 'bg-slate-800'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  settings.geminiFallback ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
