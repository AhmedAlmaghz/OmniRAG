'use client';

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  ShieldCheck,
  Key,
  Database,
  Cpu,
  CheckCircle2,
  X,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  Activity,
  Terminal,
  ExternalLink,
  Copy,
  Check,
  Zap,
  Sliders,
  AlertTriangle,
  RefreshCw,
  Info,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';

interface FirstLaunchEnvModalProps {
  lang: 'ar' | 'en';
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

interface EnvVarItem {
  key: string;
  category: 'ai' | 'database' | 'vector' | 'docai' | 'ingress';
  categoryTitleAr: string;
  categoryTitleEn: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  required: boolean;
  isConfigured: boolean;
  isInjectedBySystem: boolean;
  maskedPreview: string;
  docsUrl: string;
}

export default function FirstLaunchEnvModal({
  lang,
  isOpen,
  onClose,
  onComplete,
}: FirstLaunchEnvModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [envList, setEnvList] = useState<EnvVarItem[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [testingKeys, setTestingKeys] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; latencyMs?: number }>>({});
  const [readinessScore, setReadinessScore] = useState(100);
  const [copiedEnv, setCopiedEnv] = useState(false);

  // Fetch current environment status from API
  const loadEnvStatus = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/v1/env-config');
      if (res.ok) {
        const data = await res.json();
        setEnvList(data.envList || []);
        setReadinessScore(data.readinessPercentage || 100);

        // Initialize local form values
        const initialVals: Record<string, string> = {};
        (data.envList || []).forEach((item: EnvVarItem) => {
          if (typeof window !== 'undefined') {
            const savedLocal = localStorage.getItem(`omnirag_env_${item.key}`);
            if (savedLocal && !savedLocal.includes('•')) {
              initialVals[item.key] = savedLocal;
            } else {
              initialVals[item.key] = '';
            }
          }
        });
        setFormValues(initialVals);
      }
    } catch (err) {
      console.error('Failed to load env status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadEnvStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleInputChange = (key: string, val: string) => {
    setFormValues((prev) => ({ ...prev, [key]: val }));
    if (typeof window !== 'undefined') {
      if (!val.includes('•')) {
        localStorage.setItem(`omnirag_env_${key}`, val);
      }
    }
  };

  const toggleVisibility = (key: string) => {
    setVisibleKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const testSingleKey = async (key: string) => {
    setTestingKeys((prev) => ({ ...prev, [key]: true }));
    try {
      const val = formValues[key];
      const cleanVal = val && !val.includes('•') ? val.trim() : '';
      const res = await fetchWithAuth('/api/v1/env-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          key,
          value: cleanVal,
        }),
      });

      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [key]: {
          success: data.success,
          message: data.message,
          latencyMs: data.latencyMs,
        },
      }));
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [key]: {
          success: false,
          message: `خطأ في الاتصال: ${err.message}`,
        },
      }));
    } finally {
      setTestingKeys((prev) => ({ ...prev, [key]: false }));
    }
  };

  const testAllKeys = async () => {
    const keysToTest = ['DATABASE_URL', 'QDRANT_URL', 'MISTRAL_API_KEY', 'GEMINI_API_KEY'];
    for (const k of keysToTest) {
      await testSingleKey(k);
    }
  };

  const handleFinishOnboarding = async () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('omnirag_env_first_launch_done', 'true');
    }

    const envsToSave: Record<string, string> = {};
    Object.entries(formValues).forEach(([k, v]) => {
      if (v && !v.includes('•') && v.trim() !== '') {
        envsToSave[k] = v.trim();
        if (typeof window !== 'undefined') {
          localStorage.setItem(`omnirag_env_${k}`, v.trim());
        }
      }
    });

    try {
      await fetchWithAuth('/api/v1/env-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          envs: envsToSave,
        }),
      });
    } catch (e) {}

    if (onComplete) onComplete();
    onClose();
  };

  const copyDotEnvTemplate = () => {
    const lines = envList.map((item) => {
      const val = formValues[item.key] || '';
      return `${item.key}="${val.replace(/"/g, '\\"')}"`;
    });
    const fullText = `# OmniRAG Production Environment Configuration\n${lines.join('\n')}`;
    navigator.clipboard.writeText(fullText);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] my-auto relative">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-6 sm:p-8 flex items-start justify-between relative overflow-hidden shrink-0">
          <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -left-12 -top-12 w-64 h-64 bg-emerald-600/20 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 space-y-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-bold font-mono flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                <span>{lang === 'ar' ? 'معالج التشغيل الأول (First Launch Wizard)' : 'First Launch Setup Wizard'}</span>
              </span>
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold font-mono">
                v0.3.5 Production
              </span>
            </div>

            <h2 className="text-lg sm:text-2xl font-bold tracking-tight text-white">
              {lang === 'ar'
                ? 'تهيئة متغيرات البيئة ومحركات النظام'
                : 'Configure System Environment Variables'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {lang === 'ar'
                ? 'مرحباً بك في منصة OmniRAG. قم بمراجعة وإدخال مفاتيح وعناوين الاتصال بقواعد البيانات والذكاء الاصطناعي لضمان الجاهزية التشغيلية القصوى.'
                : 'Welcome to OmniRAG. Review and configure API keys and database endpoints to ensure full system readiness.'}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="relative z-10 p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
            title={lang === 'ar' ? 'إغلاق' : 'Close'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Stepper Tabs */}
        <div className="bg-slate-100 dark:bg-slate-800/60 px-6 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 sm:gap-6 text-xs font-bold">
            <button
              type="button"
              onClick={() => setStep(1)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition cursor-pointer ${
                step === 1
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-mono">
                1
              </span>
              <span>{lang === 'ar' ? 'المعمارية والترحيب' : 'Architecture'}</span>
            </button>

            <button
              type="button"
              onClick={() => setStep(2)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition cursor-pointer ${
                step === 2
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-mono">
                2
              </span>
              <span>{lang === 'ar' ? 'إدخال المتغيرات' : 'Configure Env'}</span>
            </button>

            <button
              type="button"
              onClick={() => setStep(3)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition cursor-pointer ${
                step === 3
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-mono">
                3
              </span>
              <span>{lang === 'ar' ? 'الفحص والتفعيل' : 'Test & Verify'}</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 font-mono text-xs">
            <span className="text-slate-500">{lang === 'ar' ? 'نسبة الجاهزية:' : 'Readiness:'}</span>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-bold">
              {readinessScore}%
            </span>
          </div>
        </div>

        {/* Step Body Content */}
        <div className="p-6 sm:p-8 overflow-y-auto space-y-6 flex-1">
          {loading ? (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
              <p className="text-xs text-slate-500 font-bold">
                {lang === 'ar' ? 'جاري فحص متغيرات البيئة والحالة الحالية...' : 'Auditing system environment variables...'}
              </p>
            </div>
          ) : (
            <>
              {/* STEP 1: Overview & Architecture */}
              {step === 1 && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-5 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/50 rounded-2xl space-y-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                        <Cpu className="w-5 h-5" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        {lang === 'ar' ? '1. محرك الذكاء والـ RAG' : '1. Gemini AI & RAG Engine'}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {lang === 'ar'
                          ? 'يعتمد النظام على Google Gemini Pro للتحليل والتوليد الذكي. يتم إيقان المفتاح تلقائياً من خادم Cloud Run.'
                          : 'Powered by Gemini 2.5 Pro & Flash. Keys are injected securely on Cloud Run server side.'}
                      </p>
                    </div>

                    <div className="p-5 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl space-y-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                        <Database className="w-5 h-5" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        {lang === 'ar' ? '2. قواعد البيانات الهجينة' : '2. Hybrid Storage Architecture'}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {lang === 'ar'
                          ? 'استعلامات هجينة تجمع بين PostgreSQL للبحث اللفظي (Lexical) و Qdrant Vector للبحث الدلالي (Dense Semantic).'
                          : 'Combines PostgreSQL for relational metadata and Qdrant Vector database for dense semantic embeddings.'}
                      </p>
                    </div>

                    <div className="p-5 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl space-y-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-600 text-white flex items-center justify-center">
                        <Zap className="w-5 h-5" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        {lang === 'ar' ? '3. معالجة الـ OCR والـ MCP' : '3. Mistral OCR & MCP Connectors'}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {lang === 'ar'
                          ? 'دعم متكامل لـ Mistral Document AI لقراءة المخططات والـ PDF باللغة العربية مع موصلات بروتوكول MCP.'
                          : 'Integrated with Mistral OCR for document layout analysis and Model Context Protocol integrations.'}
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 space-y-3 font-mono text-xs">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="flex items-center gap-2 text-indigo-400 font-bold">
                        <Terminal className="w-4 h-4" />
                        <span>{lang === 'ar' ? 'ملخص حالة الاتصال الحالية:' : 'Current Live Audit Summary:'}</span>
                      </span>
                      <span className="text-emerald-400 font-bold">Readiness: {readinessScore}%</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-300">
                      {envList.map((item) => (
                        <div key={item.key} className="flex items-center justify-between p-2 bg-slate-800/60 rounded-lg">
                          <span className="text-slate-400 font-bold">{item.key}:</span>
                          <span
                            className={`font-mono font-bold ${
                              item.isConfigured ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {item.isConfigured ? (lang === 'ar' ? 'مكوّن ✅' : 'Configured ✅') : (lang === 'ar' ? 'مفقود ⚠️' : 'Missing ⚠️')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-2 transition cursor-pointer shadow-lg shadow-indigo-600/20"
                    >
                      <span>{lang === 'ar' ? 'الانتقال لتهيئة المتغيرات' : 'Proceed to Env Configuration'}</span>
                      <ArrowLeft className={`w-4 h-4 ${lang === 'en' ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: Input Environment Variables */}
              {step === 2 && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-950/40 p-4 rounded-2xl border border-indigo-200 dark:border-indigo-900/60">
                    <div className="flex items-center gap-3">
                      <Sliders className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      <p className="text-xs text-indigo-950 dark:text-indigo-200 leading-relaxed font-medium">
                        {lang === 'ar'
                          ? 'ملاحظة: المتغيرات المدخلة تجري حفظها بأمان في الجلسة المحلية وتحقن في الخادم للاتصالات المباشرة.'
                          : 'Note: Entered values are stored securely in local app configuration and injected into active backend clients.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={copyDotEnvTemplate}
                      className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-indigo-100 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl border border-indigo-200 dark:border-indigo-800 flex items-center gap-1.5 shrink-0 transition cursor-pointer"
                    >
                      {copiedEnv ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedEnv ? (lang === 'ar' ? 'تم النسخ!' : 'Copied!') : (lang === 'ar' ? 'نسخ .env' : 'Copy .env')}</span>
                    </button>
                  </div>

                  <div className="space-y-4">
                    {envList.map((item) => {
                      const isVisible = visibleKeys[item.key];
                      const isTesting = testingKeys[item.key];
                      const testRes = testResults[item.key];
                      const val = formValues[item.key] || '';

                      return (
                        <div
                          key={item.key}
                          className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                                  {item.key}
                                </span>
                                {item.required ? (
                                  <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                                    {lang === 'ar' ? 'مطلوب' : 'Required'}
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold">
                                    {lang === 'ar' ? 'اختياري' : 'Optional'}
                                  </span>
                                )}

                                {item.isInjectedBySystem && (
                                  <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold">
                                    {lang === 'ar' ? 'محقون تلقائياً' : 'System Injected'}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                {lang === 'ar' ? item.descAr : item.descEn}
                              </p>
                            </div>

                            <a
                              href={item.docsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-semibold shrink-0"
                            >
                              <span>{lang === 'ar' ? 'جلب المفتاح' : 'Get Key'}</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>

                          {/* Input field row */}
                          <div className="flex gap-2 items-center">
                            <div className="relative flex-1">
                              <input
                                type={isVisible ? 'text' : 'password'}
                                value={val}
                                onChange={(e) => handleInputChange(item.key, e.target.value)}
                                placeholder={
                                  item.isConfigured
                                    ? item.maskedPreview
                                    : item.key.includes('URL')
                                    ? 'https://...'
                                    : 'ey...'
                                }
                                className="w-full pl-3 pr-10 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono focus:outline-none focus:border-indigo-500"
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
                              className="px-3 py-2 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0 disabled:opacity-50"
                            >
                              {isTesting ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                              )}
                              <span>{lang === 'ar' ? 'فحص الاتصال' : 'Test'}</span>
                            </button>
                          </div>

                          {/* Test Feedback Notice */}
                          {testRes && (
                            <div
                              className={`p-2.5 rounded-xl border text-xs flex items-center justify-between font-mono ${
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

                  <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs font-bold transition cursor-pointer"
                    >
                      {lang === 'ar' ? 'السابق' : 'Back'}
                    </button>

                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-md shadow-indigo-600/20"
                    >
                      <span>{lang === 'ar' ? 'متابعة لاختبار الجاهزية' : 'Continue to Verification'}</span>
                      <ArrowLeft className={`w-4 h-4 ${lang === 'en' ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: Verification & Launch */}
              {step === 3 && (
                <div className="space-y-6 text-center py-4">
                  <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-xl">
                    <ShieldCheck className="w-10 h-10 animate-bounce" />
                  </div>

                  <div className="max-w-md mx-auto space-y-2">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                      {lang === 'ar' ? 'النظام جاهز للتشغيل بنجاح!' : 'System Fully Ready for Launch!'}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {lang === 'ar'
                        ? 'تم التحقق من إعدادات ومتغيرات البيئة الأساسية. يمكنك الوصول والتعديل على هذه المتغيرات في أي وقت من تبويب الإعدادات.'
                        : 'Environment variables configured. You can inspect or update these values anytime from the Settings tab.'}
                    </p>
                  </div>

                  <div className="p-4 bg-slate-900 text-white rounded-2xl max-w-lg mx-auto space-y-3 font-mono text-xs">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-slate-400">{lang === 'ar' ? 'مؤشر الجاهزية التشغيلية:' : 'Readiness Index:'}</span>
                      <span className="text-emerald-400 font-bold">{readinessScore}%</span>
                    </div>

                    <button
                      type="button"
                      onClick={testAllKeys}
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition cursor-pointer text-xs"
                    >
                      <Activity className="w-4 h-4" />
                      <span>{lang === 'ar' ? 'إعادة فحص واختبار جميع الاتصالات المباشرة' : 'Run Full Connection Healthcheck'}</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-center gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs font-bold transition cursor-pointer"
                    >
                      {lang === 'ar' ? 'مراجعة المتغيرات' : 'Review Variables'}
                    </button>

                    <button
                      type="button"
                      onClick={handleFinishOnboarding}
                      className="px-8 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-lg shadow-emerald-600/20 hover:scale-[1.02]"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{lang === 'ar' ? 'إكمال الإعداد والانطلاق للتطبيق' : 'Complete Setup & Enter App'}</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
