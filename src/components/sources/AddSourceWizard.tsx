'use client';

import React, { useState, useEffect } from 'react';
import { Collection, SourceType } from '@/lib/types/omnirag';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import { useToast } from '../ui/Toast';
import {
  FileText,
  Globe,
  Rss,
  MonitorPlay,
  FolderGit2,
  BookOpen,
  Folder,
  Layers,
  MessageSquare,
  Mail,
  Database,
  Code,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Sliders,
  Play,
  Loader2,
  Sparkles,
  Zap,
  Search,
  Filter,
  ShieldCheck,
  Server,
  HelpCircle,
  AlertCircle,
  FileCode,
} from 'lucide-react';

interface AddSourceWizardProps {
  tenantId: string;
  collections: Collection[];
  lang: 'ar' | 'en';
  onCompleted: () => void;
  onCancel: () => void;
}

export function AddSourceWizard({ tenantId, collections, lang, onCompleted, onCancel }: AddSourceWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sourceTypes, setSourceTypes] = useState<any[]>([]);
  const [selectedType, setSelectedType] = useState<SourceType | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [catalogSearch, setCatalogSearch] = useState<string>('');

  const [name, setName] = useState('');
  const [syncSchedule, setSyncSchedule] = useState('0 */6 * * *');
  const [selectedColIds, setSelectedColIds] = useState<string[]>([]);
  const [fieldsState, setFieldsState] = useState<Record<string, any>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Connection Test & Diagnostics State
  const [isTesting, setIsTesting] = useState(false);
  const [testDiagnostics, setTestDiagnostics] = useState<{
    step: number;
    logs: string[];
    success?: boolean;
  } | null>(null);

  useEffect(() => {
    fetchWithAuth('/api/v1/sources/capabilities')
      .then((res) => res.json())
      .then((data) => {
        if (data.sourceTypes) {
          setSourceTypes(data.sourceTypes);
        }
      })
      .catch((err) => console.error('Failed to load source types catalog:', err));
  }, []);

  const currentTypeMeta = sourceTypes.find((st) => st.id === selectedType);

  const getIconComponent = (iconName: string) => {
    switch (iconName) {
      case 'FileText':
        return <FileText className="w-5 h-5" />;
      case 'Globe':
        return <Globe className="w-5 h-5" />;
      case 'Rss':
        return <Rss className="w-5 h-5" />;
      case 'Youtube':
        return <MonitorPlay className="w-5 h-5" />;
      case 'Github':
        return <FolderGit2 className="w-5 h-5" />;
      case 'BookOpen':
        return <BookOpen className="w-5 h-5" />;
      case 'Folder':
        return <Folder className="w-5 h-5" />;
      case 'Layers':
        return <Layers className="w-5 h-5" />;
      case 'MessageSquare':
        return <MessageSquare className="w-5 h-5" />;
      case 'Mail':
        return <Mail className="w-5 h-5" />;
      case 'Database':
        return <Database className="w-5 h-5" />;
      default:
        return <Code className="w-5 h-5" />;
    }
  };

  const handleSelectType = (typeMeta: any) => {
    setSelectedType(typeMeta.id);
    setName(lang === 'ar' ? typeMeta.nameAr : typeMeta.nameEn);
    setSyncSchedule(typeMeta.defaultSchedule || 'manual');

    // Set default field values
    const defaults: Record<string, any> = {};
    if (typeMeta.fields) {
      typeMeta.fields.forEach((f: any) => {
        if (f.default !== undefined) {
          defaults[f.key] = f.default;
        } else if (f.type === 'select' && f.options?.length) {
          defaults[f.key] = f.options[0].value;
        } else {
          defaults[f.key] = '';
        }
      });
    }
    setFieldsState(defaults);
    setTestDiagnostics(null);
    setStep(2);
  };

  const handleApplyPresetDemo = () => {
    if (!currentTypeMeta || !currentTypeMeta.presetDemo) return;
    const preset = currentTypeMeta.presetDemo;
    setName(preset.name || name);
    setFieldsState({ ...fieldsState, ...preset });
    setTestDiagnostics({
      step: 3,
      logs: [
        lang === 'ar' ? '✓ تم تحميل إعدادات النموذج التجريبي الجاهز' : '✓ Preset demo configuration loaded',
        lang === 'ar' ? 'جاهز للاختبار الفوري والتفعيل' : 'Ready for test & deployment',
      ],
      success: true,
    });
  };

  const handleTestConnection = async () => {
    if (selectedType === 'youtube') {
      const url = fieldsState.url || '';
      const ytRegExp = /^.*(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
      const match = url.trim().match(ytRegExp);
      const videoId = match && match[1] && match[1].length === 11 ? match[1] : null;

      if (!videoId) {
        setTestDiagnostics({
          step: 1,
          logs: [
            lang === 'ar'
              ? '❌ رابط يوتيوب غير صحيح. النسق المطلوب: https://www.youtube.com/watch?v=XXXXX'
              : '❌ Invalid YouTube URL. Required format: https://www.youtube.com/watch?v=XXXXX',
          ],
          success: false,
        });
        return;
      }
    } else if (selectedType === 'url' || selectedType === 'rss' || selectedType === 'web_file') {
      const url =
        selectedType === 'web_file' ? fieldsState.fileUrl || '' : fieldsState.url || fieldsState.feedUrl || '';
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        setTestDiagnostics({
          step: 1,
          logs: [
            lang === 'ar'
              ? '❌ رابط الويب غير صحيح. يجب أن يبدأ بـ http:// أو https://'
              : '❌ Invalid URL. Must start with http:// or https://',
          ],
          success: false,
        });
        return;
      }
    }

    setIsTesting(true);
    setTestDiagnostics({
      step: 1,
      logs: [
        lang === 'ar' ? '✓ صيغة المدخلات صحيحة (تحقق محلي)' : '✓ Input format valid (local validation)',
        lang === 'ar'
          ? 'جاري فحص جاهزية البنية التحتية للمعالجة...'
          : 'Checking processing infrastructure readiness...',
      ],
    });

    try {
      // REAL backend check: pings PostgreSQL / Qdrant / OCR services with
      // measured latencies. The previous "test" was two setTimeout calls that
      // printed a hardcoded "24ms" and "STATUS 200 OK" regardless of reality.
      const startedAt = Date.now();
      const res = await fetchWithAuth('/api/v1/diagnostics', { method: 'GET' });
      const data = await res.json().catch(() => ({}));
      const latency = Date.now() - startedAt;

      const logs: string[] = [
        lang === 'ar' ? '✓ صيغة المدخلات صحيحة (تحقق محلي)' : '✓ Input format valid (local validation)',
      ];

      let allHealthy = true;
      const services: Array<[string, any]> = Object.entries(data?.services || {});
      if (services.length > 0) {
        for (const [svcName, svc] of services) {
          const ok = (svc as any)?.status === 'connected';
          if (!ok) allHealthy = false;
          const label = ok ? '✓' : '⚠';
          logs.push(
            lang === 'ar'
              ? `${label} ${svcName}: ${(svc as any)?.status} (${(svc as any)?.latencyMs ?? '?'}ms)`
              : `${label} ${svcName}: ${(svc as any)?.status} (${(svc as any)?.latencyMs ?? '?'}ms)`,
          );
        }
      } else {
        // Diagnostics endpoint shape unexpected — report honestly instead of
        // pretending everything passed.
        allHealthy = res.ok;
        logs.push(
          res.ok
            ? lang === 'ar'
              ? `✓ استجابة الخادم سليمة (${latency}ms)`
              : `✓ Server responded healthily (${latency}ms)`
            : lang === 'ar'
              ? `❌ استجابة غير متوقعة من الخادم (${res.status})`
              : `❌ Unexpected server response (${res.status})`,
        );
      }

      logs.push(
        lang === 'ar'
          ? allHealthy
            ? 'البنية جاهزة — سيتم التحقق الفعلي من المصدر عند إنشاء المزامنة الأولى.'
            : 'توجد خدمات غير مهيأة — الاستيعاب قد يفشل حتى ضبطها.'
          : allHealthy
            ? 'Infrastructure ready — source itself is validated on first sync.'
            : 'Some services are unconfigured — ingestion may fail until resolved.',
      );

      setTestDiagnostics({ step: 3, logs, success: allHealthy });
    } catch {
      setTestDiagnostics({
        step: 3,
        logs: [
          lang === 'ar' ? '❌ تعذر الوصول لخادم الفحص. تحقق من الاتصال.' : '❌ Could not reach the diagnostics server.',
        ],
        success: false,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleFinish = async () => {
    if (!selectedType || !name) return;
    setIsSubmitting(true);

    try {
      const res = await fetchWithAuth('/api/v1/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          name,
          type: selectedType,
          config: fieldsState,
          syncSchedule,
          collectionIds: selectedColIds,
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.syncStarted) {
          // Ingestion runs after the response now (OCR/embedding can take
          // minutes) — tell the user instead of implying everything finished.
          toast({
            title:
              lang === 'ar'
                ? 'تم تفعيل الموصل — بدأت المزامنة والفهرسة في الخلفية'
                : 'Connector activated — syncing & indexing started in the background',
            variant: 'success',
          });
        }
        onCompleted();
      } else {
        const err = await res.json().catch(() => ({}));
        toast({
          title: err.error || (lang === 'ar' ? 'فشل إنشاء المصدر' : 'Failed to create source'),
          variant: 'error',
        });
      }
    } catch (error) {
      console.error('Error creating source:', error);
      toast({
        title:
          lang === 'ar'
            ? 'حدث خطأ غير متوقع أثناء إنشاء المصدر'
            : 'An unexpected error occurred while creating the source',
        variant: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const categories = [
    { id: 'all', nameAr: 'كافة الموصلات', nameEn: 'All Connectors' },
    { id: 'web', nameAr: 'ويب ومستخرجات', nameEn: 'Web & Crawlers' },
    { id: 'files', nameAr: 'ملفات وسحابة', nameEn: 'Files & Storage' },
    { id: 'code', nameAr: 'شفرات وريبوهات', nameEn: 'Code & Repos' },
    { id: 'databases', nameAr: 'قواعد بيانات', nameEn: 'Databases' },
    { id: 'media', nameAr: 'وسائط وتفريغ', nameEn: 'Media & Transcripts' },
    { id: 'apps', nameAr: 'تطبيقات ومستندات', nameEn: 'Apps & Docs' },
  ];

  const filteredCatalog = sourceTypes.filter((st) => {
    const matchCat = activeCategory === 'all' || st.category === activeCategory;
    const matchSearch =
      st.nameAr.toLowerCase().includes(catalogSearch.toLowerCase()) ||
      st.nameEn.toLowerCase().includes(catalogSearch.toLowerCase()) ||
      st.descriptionAr.toLowerCase().includes(catalogSearch.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-md space-y-6">
      {/* Header & Steps Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <span>
              {lang === 'ar'
                ? 'معالج موصلات البيانات الذكي (Enterprise Connector Wizard)'
                : 'Enterprise Connector Wizard'}
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'ar'
              ? 'ربط مصادر المعلومات الخارجية المباشرة، وقواعد البيانات، والمستودعات مع الفهرسة الدلالية'
              : 'Connect external knowledge bases, databases, and repos with semantic indexing'}
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 text-xs font-bold shrink-0">
          <div
            className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 ${
              step === 1 ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-500'
            }`}
          >
            <span>1</span>
            <span>{lang === 'ar' ? 'اختيار النوع' : 'Type'}</span>
          </div>
          <ArrowLeft className="w-3.5 h-3.5 text-slate-400 rtl:rotate-0 ltr:rotate-180" />
          <div
            className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 ${
              step === 2 ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-500'
            }`}
          >
            <span>2</span>
            <span>{lang === 'ar' ? 'تكوين المعايير' : 'Config'}</span>
          </div>
          <ArrowLeft className="w-3.5 h-3.5 text-slate-400 rtl:rotate-0 ltr:rotate-180" />
          <div
            className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 ${
              step === 3 ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-500'
            }`}
          >
            <span>3</span>
            <span>{lang === 'ar' ? 'التفعيل والفهرسة' : 'Deploy'}</span>
          </div>
        </div>
      </div>

      {/* STEP 1: CATALOG TYPE SELECTION */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 p-2.5 rounded-2xl border border-slate-200/80">
            {/* Category Filter Pills */}
            <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto py-0.5">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                    activeCategory === cat.id
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-200/70'
                  }`}
                >
                  {lang === 'ar' ? cat.nameAr : cat.nameEn}
                </button>
              ))}
            </div>

            {/* Catalog Search Input */}
            <div className="relative w-full sm:w-56 shrink-0">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder={lang === 'ar' ? 'بحث في الموصلات...' : 'Search connectors...'}
                className="w-full pl-8 pr-3 py-1.5 bg-white rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredCatalog.map((st) => (
              <div
                key={st.id}
                onClick={() => handleSelectType(st)}
                className="p-4 rounded-2xl bg-slate-50 hover:bg-indigo-50/70 border border-slate-200/80 hover:border-indigo-300 transition cursor-pointer group flex items-start gap-3.5 relative"
              >
                <div className="w-10 h-10 rounded-xl bg-white group-hover:bg-indigo-600 text-slate-700 group-hover:text-white flex items-center justify-center shrink-0 border border-slate-200/80 group-hover:border-indigo-600 transition shadow-2xs">
                  {getIconComponent(st.iconName)}
                </div>

                <div className="space-y-1 pr-2">
                  <h4 className="text-xs font-bold text-slate-900 group-hover:text-indigo-950 flex items-center gap-1.5 flex-wrap">
                    <span>{lang === 'ar' ? st.nameAr : st.nameEn}</span>
                    {/* Honest capability badge: which connectors have a REAL
                        live-sync pipeline today vs manual-only placeholders. */}
                    {st.liveSync === true && (
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase font-mono">
                        {lang === 'ar' ? 'مزامنة حية' : 'LIVE'}
                      </span>
                    )}
                    {st.liveSync === false && (
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 uppercase font-mono">
                        {lang === 'ar' ? 'قريباً' : 'SOON'}
                      </span>
                    )}
                  </h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">
                    {lang === 'ar' ? st.descriptionAr : st.descriptionEn}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="py-2.5 px-5 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
            >
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: CONNECTOR PARAMETERS & PRESETS */}
      {step === 2 && currentTypeMeta && (
        <div className="space-y-5">
          <div className="p-4 bg-indigo-50/80 border border-indigo-200/70 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                {getIconComponent(currentTypeMeta.iconName)}
              </div>
              <div>
                <h3 className="text-xs font-bold text-indigo-950">
                  {lang === 'ar' ? currentTypeMeta.nameAr : currentTypeMeta.nameEn}
                </h3>
                <p className="text-[11px] text-indigo-700 mt-0.5">
                  {lang === 'ar' ? currentTypeMeta.descriptionAr : currentTypeMeta.descriptionEn}
                </p>
              </div>
            </div>

            {/* Quick Preset Demo Button */}
            {currentTypeMeta.presetDemo && (
              <button
                type="button"
                onClick={handleApplyPresetDemo}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shrink-0 cursor-pointer shadow-xs"
              >
                <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                <span>{lang === 'ar' ? 'تعبئة نموذج تجريبي بضغطة واحدة' : 'Load Demo Preset'}</span>
              </button>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                {lang === 'ar' ? 'اسم الموصل المصدر:' : 'Connector Name:'}
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="اسم تمييزي للموصل"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Dynamic Form Fields from Catalog Schema */}
            {currentTypeMeta.fields &&
              currentTypeMeta.fields.map((field: any) => (
                <div key={field.key}>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    {lang === 'ar' ? field.labelAr : field.labelEn}
                    {field.required && <span className="text-rose-500 mr-1">*</span>}
                  </label>

                  {field.type === 'select' ? (
                    <select
                      value={fieldsState[field.key] || ''}
                      onChange={(e) => setFieldsState({ ...fieldsState, [field.key]: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                    >
                      {field.options?.map((opt: any) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      rows={3}
                      value={fieldsState[field.key] || ''}
                      onChange={(e) => setFieldsState({ ...fieldsState, [field.key]: e.target.value })}
                      placeholder={field.placeholder || ''}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  ) : (
                    <input
                      type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                      value={fieldsState[field.key] || ''}
                      onChange={(e) => setFieldsState({ ...fieldsState, [field.key]: e.target.value })}
                      placeholder={field.placeholder || ''}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                    />
                  )}
                </div>
              ))}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'جدول المزامنة التلقائية (Cron):' : 'Sync Schedule:'}
                </label>
                <select
                  value={syncSchedule}
                  onChange={(e) => setSyncSchedule(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                >
                  <option value="manual">{lang === 'ar' ? 'يدوي فقط (Manual Sync)' : 'Manual Only'}</option>
                  <option value="*/30 * * * *">{lang === 'ar' ? 'كل 30 دقيقة' : 'Every 30 mins'}</option>
                  <option value="0 */1 * * *">{lang === 'ar' ? 'كل ساعة' : 'Every hour'}</option>
                  <option value="0 */3 * * *">{lang === 'ar' ? 'كل 3 ساعات' : 'Every 3 hours'}</option>
                  <option value="0 */6 * * *">{lang === 'ar' ? 'كل 6 ساعات' : 'Every 6 hours'}</option>
                  <option value="0 0 * * *">{lang === 'ar' ? 'يومياً (Daily)' : 'Daily'}</option>
                </select>
              </div>

              {collections.length > 0 && (
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    {lang === 'ar' ? 'ربط المجموعات المستهدفة:' : 'Assign Collections:'}
                  </label>
                  <div className="border border-slate-300 rounded-xl p-2 max-h-28 overflow-y-auto space-y-1 bg-slate-50">
                    {collections.map((col) => {
                      const isChecked = selectedColIds.includes(col.id);
                      return (
                        <label
                          key={col.id}
                          className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer p-1 rounded hover:bg-white"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedColIds([...selectedColIds, col.id]);
                              } else {
                                setSelectedColIds(selectedColIds.filter((id) => id !== col.id));
                              }
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span>{col.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Test Connection Button & Diagnostic Box */}
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-2xs"
              >
                {isTesting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400" />
                )}
                <span>
                  {lang === 'ar' ? 'اختبار جودة الاتصال والمصادقة (Live Health Check)' : 'Test Connection & Auth'}
                </span>
              </button>

              {testDiagnostics && (
                <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-1">
                    <span>Diagnostic Log</span>
                    <span
                      className={testDiagnostics.success ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}
                    >
                      {testDiagnostics.success ? 'READY' : 'DEGRADED'}
                    </span>
                  </div>
                  {testDiagnostics.logs.map((log, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-500">&gt;</span>
                      <span
                        className={
                          idx === testDiagnostics.logs.length - 1 ? 'text-emerald-300 font-bold' : 'text-slate-300'
                        }
                      >
                        {log}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!name}
              className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition cursor-pointer flex items-center justify-center gap-2"
            >
              <span>{lang === 'ar' ? 'الانتقال إلى المراجعة والتفعيل' : 'Next Step'}</span>
              <ArrowLeft className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="py-2.5 px-5 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
            >
              {lang === 'ar' ? 'السابق' : 'Back'}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: REVIEW & CONFIRM */}
      {step === 3 && currentTypeMeta && (
        <div className="space-y-5">
          <div className="p-5 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-3 text-xs">
            <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <span>{lang === 'ar' ? 'ملخص مراجعة إعدادات الموصل والتفعيل' : 'Connector Setup Summary'}</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <span className="text-[11px] text-slate-400 block">
                  {lang === 'ar' ? 'اسم الموصل:' : 'Connector Name:'}
                </span>
                <span className="font-bold text-slate-900">{name}</span>
              </div>
              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <span className="text-[11px] text-slate-400 block">{lang === 'ar' ? 'نوع المصدر:' : 'Type:'}</span>
                <span className="font-bold text-slate-900">{currentTypeMeta.nameAr}</span>
              </div>
              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <span className="text-[11px] text-slate-400 block">
                  {lang === 'ar' ? 'جدولة المزامنة:' : 'Schedule:'}
                </span>
                <span className="font-mono font-bold text-slate-900">{syncSchedule}</span>
              </div>
              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <span className="text-[11px] text-slate-400 block">
                  {lang === 'ar' ? 'عزل بيانات المستأجر:' : 'Tenant Isolation:'}
                </span>
                <span className="font-bold text-emerald-600">Tenant Isolated ({tenantId})</span>
              </div>
            </div>
          </div>

          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-1">
            <span className="font-bold block">💡 {lang === 'ar' ? 'تفعيل الاستيعاب الفوري:' : 'Ingestion Note:'}</span>
            <p className="text-[11px]">
              {lang === 'ar'
                ? 'عند التفعيل، سيبدأ المحرك في جلب البيانات فوراً واستخراج المقاطع وتوليد المتجهات وفهرستها في Qdrant.'
                : 'Upon activation, OmniRAG triggers background parsing and Qdrant vector indexing.'}
            </p>
          </div>

          <div className="flex gap-2 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={handleFinish}
              disabled={isSubmitting}
              className="flex-1 py-3 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition cursor-pointer flex items-center justify-center gap-2 shadow-xs"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{lang === 'ar' ? 'جاري الاستيعاب والتجميع...' : 'Ingesting data...'}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{lang === 'ar' ? 'تفعيل الموصل وتشغيل الاستيعاب الان' : 'Activate & Ingest Now'}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="py-3 px-5 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
            >
              {lang === 'ar' ? 'السابق' : 'Back'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
