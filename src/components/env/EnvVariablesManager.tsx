'use client';

import React, { useState, useEffect } from 'react';
import {
  Key,
  ShieldCheck,
  Eye,
  EyeOff,
  Activity,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Database,
  Cpu,
  Zap,
  Terminal,
  Search,
  Sparkles,
  Lock,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import {
  loadEnvStatus as loadEnvStatusApi,
  persistFormValue,
  testEnvKey,
  saveEnvsToServer,
  copyDotEnvTemplate,
  EnvVarItem,
} from './envShared';

interface EnvVariablesManagerProps {
  lang: 'ar' | 'en';
  onOpenWizard?: () => void;
}

export default function EnvVariablesManager({ lang, onOpenWizard }: EnvVariablesManagerProps) {
  const [loading, setLoading] = useState(true);
  const [envList, setEnvList] = useState<EnvVarItem[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [testingKeys, setTestingKeys] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string; latencyMs?: number }>
  >({});
  const [readinessScore, setReadinessScore] = useState(100);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [saveNotice, setSaveNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Filter state
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const loadEnvStatus = async () => {
    setLoading(true);
    const payload = await loadEnvStatusApi();
    if (payload) {
      setEnvList(payload.envList);
      setReadinessScore(payload.readinessScore);
      setFormValues(payload.formValues);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadEnvStatus();
  }, []);

  const handleInputChange = (key: string, val: string) => {
    setFormValues((prev) => ({ ...prev, [key]: val }));
    persistFormValue(key, val);
  };

  const toggleVisibility = (key: string) => {
    setVisibleKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const testSingleKey = async (key: string) => {
    setTestingKeys((prev) => ({ ...prev, [key]: true }));
    const result = await testEnvKey(key, formValues[key]);
    setTestResults((prev) => ({ ...prev, [key]: result }));
    setTestingKeys((prev) => ({ ...prev, [key]: false }));
  };

  // Honest outcome: production can BLOCK env writes - the old version
  // swallowed that and always showed a success banner.
  const handleSaveAll = async () => {
    const ok = await saveEnvsToServer(formValues);
    setSaveNotice(
      ok
        ? {
            ok: true,
            text:
              lang === 'ar'
                ? 'تم حفظ متغيرات البيئة ومزامنتها مع بيئة الخادم بنجاح.'
                : 'Environment variables saved and synced to the server runtime.',
          }
        : {
            ok: false,
            text:
              lang === 'ar'
                ? 'فشل الحفظ على الخادم (قد تكون الكتابة معطّلة في الإنتاج). بقيت القيم محفوظة محلياً في هذا المتصفح.'
                : 'Server save failed (writes may be blocked in production). Values remain saved locally in this browser.',
          },
    );
    setTimeout(() => setSaveNotice(null), 5000);
    loadEnvStatus();
  };

  const handleCopyTemplate = async () => {
    const ok = await copyDotEnvTemplate(envList, formValues);
    if (!ok) return;
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 2500);
  };

  const filteredList = envList.filter((item) => {
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    const matchesSearch =
      item.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.descAr.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.descEn.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 sm:p-8 relative overflow-hidden shadow-xl border border-slate-800">
        <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -left-10 -top-10 w-64 h-64 bg-emerald-600/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-bold font-mono flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{lang === 'ar' ? 'إدارة متغيرات البيئة والاتصالات' : 'Environment Variables Manager'}</span>
                </span>
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold font-mono">
                  {readinessScore}% {lang === 'ar' ? 'جاهزية النظام' : 'Ready'}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                {lang === 'ar' ? 'متغيرات بيئة التشغيل ومفاتيح API' : 'System Environment Variables & API Keys'}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {onOpenWizard && (
                <button
                  type="button"
                  onClick={onOpenWizard}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-md shadow-indigo-600/20"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{lang === 'ar' ? 'معالج التشغيل الأول' : 'Launch Setup Wizard'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCopyTemplate}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-2 border border-slate-700 transition cursor-pointer"
              >
                {copiedEnv ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>
                  {copiedEnv ? (lang === 'ar' ? 'تم النسخ!' : 'Copied!') : lang === 'ar' ? 'نسخ .env' : 'Copy .env'}
                </span>
              </button>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
            {lang === 'ar'
              ? 'تتيح لك هذه الشاشة مراجعة وإدخال واختبار كافة متغيرات البيئة الأساسية للنظام (مثل قواعد البيانات PostgreSQL و Vector DB ومفاتيح Gemini Pro و Mistral AI).'
              : 'Inspect, edit, and test all production environment variables including PostgreSQL, Qdrant Vector DB, Gemini AI, and Mistral AI API keys.'}
          </p>

          {/* Readiness Bar */}
          <div className="space-y-1.5 pt-2">
            <div className="flex justify-between text-[11px] font-mono text-slate-400">
              <span>{lang === 'ar' ? 'مشر جاهزية النظام للإنتاج:' : 'System Production Readiness Score:'}</span>
              <span className="text-emerald-400 font-bold">{readinessScore}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 via-emerald-400 to-emerald-500 transition-all duration-500"
                style={{ width: `${readinessScore}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {saveNotice && (
        <div
          role={saveNotice.ok ? 'status' : 'alert'}
          className={`p-4 rounded-2xl border text-xs font-semibold flex items-center gap-2 animate-fadeIn ${
            saveNotice.ok
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
          }`}
        >
          {saveNotice.ok ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{saveNotice.text}</span>
        </div>
      )}

      {/* Toolbar: Category Chips & Search Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* Category Filters */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1 overflow-x-auto">
          {[
            { id: 'all', nameAr: 'الكل', nameEn: 'All' },
            { id: 'ai', nameAr: 'الذكاء الاصطناعي', nameEn: 'AI Reasoning' },
            { id: 'database', nameAr: 'قواعد البيانات', nameEn: 'Databases' },
            { id: 'vector', nameAr: 'المتجهات Qdrant', nameEn: 'Vector DB' },
            { id: 'docai', nameAr: 'مستندات OCR', nameEn: 'Document AI' },
            { id: 'ingress', nameAr: 'بوابات الدخول', nameEn: 'Ingress' },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                selectedCategory === cat.id
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {lang === 'ar' ? cat.nameAr : cat.nameEn}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 rtl:left-auto rtl:right-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={lang === 'ar' ? 'ابحث باسم المتغير أو الوصف...' : 'Search by variable key or description...'}
            className="w-full pl-9 pr-4 rtl:pl-4 rtl:pr-9 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-xs focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Environment Variable Cards */}
      {loading ? (
        <div className="py-12 text-center space-y-2">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-bold">
            {lang === 'ar' ? 'جاري التحقق من متغيرات البيئة...' : 'Auditing environment parameters...'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredList.map((item) => {
            const isVisible = visibleKeys[item.key];
            const isTesting = testingKeys[item.key];
            const testRes = testResults[item.key];
            const val = formValues[item.key] || '';

            return (
              <div
                key={item.key}
                className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4 hover:border-indigo-200 dark:hover:border-indigo-900 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">{item.key}</span>

                      {item.required ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                          {lang === 'ar' ? 'مطلوب' : 'Required'}
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-bold">
                          {lang === 'ar' ? 'اختياري' : 'Optional'}
                        </span>
                      )}

                      {item.isConfigured ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>{lang === 'ar' ? 'مكوّن - Configured' : 'Configured'}</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          <span>{lang === 'ar' ? 'غير مكوّن' : 'Missing'}</span>
                        </span>
                      )}

                      {item.isInjectedBySystem && (
                        <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold">
                          {lang === 'ar' ? 'محقون تلقائياً بالسيرفر' : 'Cloud Injected'}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed pt-1">
                      {lang === 'ar' ? item.descAr : item.descEn}
                    </p>
                  </div>

                  <a
                    href={item.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-semibold shrink-0"
                  >
                    <span>{lang === 'ar' ? 'مزود الخدمة' : 'Provider Docs'}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Input & Action Row */}
                <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
                  <div className="relative flex-1">
                    <input
                      type={isVisible ? 'text' : 'password'}
                      value={val}
                      onChange={(e) => handleInputChange(item.key, e.target.value)}
                      placeholder={
                        item.isConfigured ? item.maskedPreview : item.key.includes('URL') ? 'https://...' : 'ey...'
                      }
                      className="w-full pl-3 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => toggleVisibility(item.key)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => testSingleKey(item.key)}
                    disabled={isTesting}
                    className="px-4 py-2.5 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    {isTesting ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Activity className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span>{lang === 'ar' ? 'فحص الاتصال' : 'Test Connection'}</span>
                  </button>
                </div>

                {/* Test Feedback Notice */}
                {testRes && (
                  <div
                    className={`p-3 rounded-xl border text-xs flex items-center justify-between font-mono ${
                      testRes.success
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {testRes.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      )}
                      <span>{testRes.message}</span>
                    </span>
                    {testRes.latencyMs !== undefined && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-200/50 text-emerald-900 dark:text-emerald-100">
                        {testRes.latencyMs}ms
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Global Save Button */}
      <div className="flex justify-end pt-4">
        <button
          type="button"
          onClick={handleSaveAll}
          className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-2 transition cursor-pointer shadow-lg shadow-indigo-600/20 hover:scale-[1.01]"
        >
          <ShieldCheck className="w-4 h-4" />
          <span>{lang === 'ar' ? 'تأكيد وحفظ تهيئة متغيرات البيئة' : 'Save Environment Configuration'}</span>
        </button>
      </div>
    </div>
  );
}
