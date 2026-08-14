'use client';

import { fetchWithAuth } from "@/lib/auth/fetchWithAuth";
import React, { useState, useEffect } from 'react';
import {
  Cpu,
  BrainCircuit,
  FileText,
  Zap,
  Sparkles,
  Database,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Save,
  MessageSquare,
  Play,
  Loader2,
  Code2,
  Sliders,
  Radio,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import {
  AIModelConfig,
  getAiModelConfig,
  saveAiModelConfig,
  resetAiModelConfig,
  PRESET_MODELS,
  DEFAULT_AI_MODELS,
  MODEL_CONFIG_CHANGE_EVENT,
} from '@/lib/config/aiModels';

export default function ModelSettingsView() {
  const [config, setConfig] = useState<AIModelConfig>(getAiModelConfig());
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [customInputMode, setCustomInputMode] = useState<Record<string, boolean>>({});
  const [customModelNames, setCustomModelNames] = useState<Record<string, string>>({});

  // Test Playground State
  const [testOperation, setTestOperation] = useState<keyof AIModelConfig>('chatModel');
  const [testPrompt, setTestPrompt] = useState('اكتب ملخصاً في سطرين عن أهمية عزل المستأجرين في منصات RAG');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ text?: string; latencyMs?: number; error?: string } | null>(null);

  // Sync state with local storage
  useEffect(() => {
    setConfig(getAiModelConfig());

    const handleConfigChange = (e: Event) => {
      const customEvent = e as CustomEvent<AIModelConfig>;
      if (customEvent.detail) {
        setConfig(customEvent.detail);
      }
    };

    window.addEventListener(MODEL_CONFIG_CHANGE_EVENT, handleConfigChange);
    return () => {
      window.removeEventListener(MODEL_CONFIG_CHANGE_EVENT, handleConfigChange);
    };
  }, []);

  const handleSelectModel = (key: keyof AIModelConfig, modelName: string) => {
    if (modelName === 'CUSTOM') {
      setCustomInputMode((prev) => ({ ...prev, [key]: true }));
      setCustomModelNames((prev) => ({ ...prev, [key]: config[key] || '' }));
    } else {
      setCustomInputMode((prev) => ({ ...prev, [key]: false }));
      setConfig((prev) => ({ ...prev, [key]: modelName }));
    }
  };

  const handleCustomNameChange = (key: keyof AIModelConfig, value: string) => {
    setCustomModelNames((prev) => ({ ...prev, [key]: value }));
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const updated = saveAiModelConfig(config);
    setConfig(updated);

    // Also persist via server API endpoint
    try {
      await fetchWithAuth('/api/v1/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch (e) {
      console.warn('Could not sync model settings with server API:', e);
    }

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3500);
  };

  const handleReset = () => {
    if (confirm('هل أنت تأكد من إعادة ضبط كافة أسماء نماذج الذكاء الاصطناعي إلى الإعدادات الافتراضية؟')) {
      const reset = resetAiModelConfig();
      setConfig(reset);
      setCustomInputMode({});
      setCustomModelNames({});
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3500);
    }
  };

  const runTestModel = async () => {
    setIsTesting(true);
    setTestResult(null);
    const startTime = Date.now();

    try {
      const selectedModelName = config[testOperation];
      const res = await fetchWithAuth('/api/v1/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ai-model-config': JSON.stringify(config),
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: testPrompt }],
          mode: 'analysis',
          model: selectedModelName,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `خطأ استجابة السيرفر (${res.status})`);
      }

      const text = await res.text();
      const latencyMs = Date.now() - startTime;
      setTestResult({ text: text || 'تم استلام استجابة فارغة', latencyMs });
    } catch (err: any) {
      setTestResult({ error: err.message || 'فشل الاختبار العملي للنموذج' });
    } finally {
      setIsTesting(false);
    }
  };

  const operationsList: Array<{
    key: keyof AIModelConfig;
    titleAr: string;
    titleEn: string;
    descriptionAr: string;
    icon: React.ElementType;
    badge: string;
    typeFilter: 'general' | 'reasoning' | 'embedding';
    defaultVal: string;
  }> = [
    {
      key: 'chatModel',
      titleAr: '1. نموذج استوديو المحادثة الرئيسي (Agentic Chat & RAG)',
      titleEn: 'Agentic Chat & RAG Engine',
      descriptionAr: 'النموذج المعتمد لإجابات المحادثة التفاعلية واستدعاء أدوات MCP واستخلاص المراجع من المستندات.',
      icon: MessageSquare,
      badge: 'الأساسي في الشاشة الرئيسية',
      typeFilter: 'general',
      defaultVal: DEFAULT_AI_MODELS.chatModel,
    },
    {
      key: 'analysisModel',
      titleAr: '2. نموذج التحليل والتفكير المعقد (Deep Analysis & Reasoning)',
      titleEn: 'Deep Query Analysis',
      descriptionAr: 'يُستخدم للاستفسارات المركبة، مقارنة العقود والسياسات، والتحليلات الأمنية التي تتطلب منطقاً عميقاً.',
      icon: BrainCircuit,
      badge: 'Smart Query Router',
      typeFilter: 'reasoning',
      defaultVal: DEFAULT_AI_MODELS.analysisModel,
    },
    {
      key: 'hydeModel',
      titleAr: '3. نموذج التوسع الفرضي للاستعلام (HyDE Expansion)',
      titleEn: 'HyDE Document Generator',
      descriptionAr: 'يولّد إجابة فرضية مثالية قبل البحث المتجهي لمطابقة المعاني العميقة ودعم استرجاع أكثر دقة.',
      icon: Sparkles,
      badge: 'HyDE Generator',
      typeFilter: 'general',
      defaultVal: DEFAULT_AI_MODELS.hydeModel,
    },
    {
      key: 'documentParseModel',
      titleAr: '4. نموذج قراءة واستخراج المستندات (OCR & Document Parsing)',
      titleEn: 'Document OCR & Ingestion',
      descriptionAr: 'يُستخدم لاستخراج النصوص والجدول من ملفات PDF والصور والملفات الضخمة بعالية الدقة.',
      icon: FileText,
      badge: 'API /v1/documents/parse',
      typeFilter: 'general',
      defaultVal: DEFAULT_AI_MODELS.documentParseModel,
    },
    {
      key: 'chatStreamModel',
      titleAr: '5. نموذج البث المباشر المفتوح (Streaming Chat API)',
      titleEn: 'Streaming API Route',
      descriptionAr: 'يغذي مسار البث المباشر /api/v1/chat/stream لتقديم ردود سريعة وفورية للمستخدمين.',
      icon: Zap,
      badge: 'API /v1/chat/stream',
      typeFilter: 'general',
      defaultVal: DEFAULT_AI_MODELS.chatStreamModel,
    },
    {
      key: 'embeddingModel',
      titleAr: '6. نموذج المتجهات والبحث الدلالي (Vector Embeddings)',
      titleEn: 'Vector Embedding Engine',
      descriptionAr: 'النموذج المعتمد لتوليد متجهات النصوص المحفوظة في قاعدة Qdrant و Postgres للبحث الهجين.',
      icon: Database,
      badge: 'Vector Engine (3072d)',
      typeFilter: 'embedding',
      defaultVal: DEFAULT_AI_MODELS.embeddingModel,
    },
  ];

  return (
    <div className="bg-slate-950 text-slate-100 p-6 rounded-2xl space-y-8 shadow-xl border border-slate-800" dir="rtl">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-indigo-950/80 via-slate-900 to-slate-950 border border-indigo-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-indigo-600/20 rounded-xl border border-indigo-500/30 text-indigo-400">
                <Cpu className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight flex items-center gap-3">
                  إعدادات نماذج الذكاء الاصطناعي المركزية
                  <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                    Global AI Registry
                  </span>
                </h1>
                <p className="text-sm text-slate-400 mt-1">
                  شاشة تحكم واحدة لتحديد وتغيير أسماء نماذج Gemini ونماذج التضمين المتجهي لكل عملية في النظام دون التعديل في الكود.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleReset}
              className="px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-sm font-medium transition flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4 text-slate-400" />
              إعادة الضبط
            </button>

            <button
              onClick={handleSave}
              className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-lg shadow-indigo-600/30 flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              حفظ الإعدادات
            </button>
          </div>
        </div>

        {savedSuccess && (
          <div className="mt-4 p-3 bg-emerald-500/15 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm flex items-center gap-2 animate-fade-in">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <span>تم حفظ إعدادات نماذج الذكاء الاصطناعي وتطبيقها فورياً على جميع مكونات ومسارات النظام.</span>
          </div>
        )}
      </div>

      {/* Model Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {operationsList.map((op) => {
          const IconComp = op.icon;
          const isCustom = customInputMode[op.key] || (!PRESET_MODELS.some((m) => m.id === config[op.key]));
          const currentVal = config[op.key];

          const filteredPresets = PRESET_MODELS.filter(
            (m) => m.type === op.typeFilter || (m.recommendedFor && m.recommendedFor.includes(op.key))
          );

          return (
            <div
              key={op.key}
              className="bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-2xl p-6 space-y-5 transition shadow-lg flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-slate-800 rounded-xl text-indigo-400 border border-slate-700/60">
                      <IconComp className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white">{op.titleAr}</h3>
                      <p className="text-xs text-indigo-400/80 font-mono">{op.titleEn}</p>
                    </div>
                  </div>
                  <span className="text-[11px] px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-400 font-mono flex-shrink-0">
                    {op.badge}
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">{op.descriptionAr}</p>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-800/80">
                <label className="text-xs font-medium text-slate-300 block">
                  النموذج المعتمد لهذه العملية:
                </label>

                {/* Preset buttons */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {filteredPresets.map((preset) => {
                    const isSelected = !isCustom && currentVal === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectModel(op.key, preset.id)}
                        className={`px-3 py-2 rounded-xl text-xs text-right transition border flex flex-col justify-between ${
                          isSelected
                            ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200 font-semibold shadow-sm'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <span className="font-mono">{preset.name}</span>
                        {preset.type === 'reasoning' && (
                          <span className="text-[10px] text-amber-400 mt-1">تفكير عميق</span>
                        )}
                        {preset.type === 'embedding' && (
                          <span className="text-[10px] text-teal-400 mt-1">متجهات دلالية</span>
                        )}
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => handleSelectModel(op.key, 'CUSTOM')}
                    className={`px-3 py-2 rounded-xl text-xs transition border font-mono text-center flex items-center justify-center gap-1 ${
                      isCustom
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200 font-semibold'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    اسم مخصص...
                  </button>
                </div>

                {/* Custom Input Field */}
                {isCustom && (
                  <div className="mt-2 space-y-1">
                    <input
                      type="text"
                      value={customModelNames[op.key] ?? currentVal}
                      onChange={(e) => handleCustomNameChange(op.key, e.target.value)}
                      placeholder="أدخل اسم النموذج المخصص (مثلاً: gemini-3.6-flash)"
                      className="w-full bg-slate-950 border border-indigo-500/50 rounded-xl px-3.5 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <p className="text-[11px] text-slate-500">
                      سيتم تمرير اسم النموذج المعرف هنا مباشرةً لمستدعي Gemini API.
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span>الافتراضي: <code className="text-slate-400 font-mono">{op.defaultVal}</code></span>
                  <span className="text-indigo-400/90 font-mono font-semibold">المفعل: {currentVal}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Testing Playground */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400">
              <Play className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">منصة الاختبار السريع للنماذج المحددة</h2>
              <p className="text-xs text-slate-400">تأكد من عمل النموذج وتجاوبه السريع قبل اعتماده في العمليات الفعلية.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-2">العملية المراد اختبار نموذجها:</label>
              <select
                value={testOperation}
                onChange={(e) => setTestOperation(e.target.value as keyof AIModelConfig)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {operationsList.map((op) => (
                  <option key={op.key} value={op.key}>
                    {op.titleAr} ({config[op.key]})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-300 block mb-2">النص التجريبي للاستعلام:</label>
              <textarea
                rows={3}
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed"
              />
            </div>

            <button
              onClick={runTestModel}
              disabled={isTesting || !testPrompt.trim()}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري اختبار نموذج {config[testOperation]}...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  تشغيل استعلام تجريبي مباشر
                </>
              )}
            </button>
          </div>

          <div className="lg:col-span-7 bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3 min-h-[220px]">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs border-b border-slate-800/80 pb-2">
                <span className="text-slate-400 font-medium">مخرجات استجابة النموذج التجريبي</span>
                {testResult?.latencyMs && (
                  <span className="text-emerald-400 font-mono text-[11px]">
                    الزمن: {testResult.latencyMs}ms
                  </span>
                )}
              </div>

              {testResult?.error ? (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold mb-1">تعذر تشغيل النموذج:</p>
                    <p className="font-mono text-[11px] leading-relaxed">{testResult.error}</p>
                  </div>
                </div>
              ) : testResult?.text ? (
                <div className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap font-sans max-h-60 overflow-y-auto p-2 bg-slate-900/60 rounded-lg border border-slate-800">
                  {testResult.text}
                </div>
              ) : (
                <div className="text-xs text-slate-500 italic py-8 text-center">
                  اضغط على زر &quot;تشغيل استعلام تجريبي&quot; لاختبار النموذج المفعل واستعراض الاستجابة مباشرة.
                </div>
              )}
            </div>

            <div className="text-[11px] text-slate-500 flex items-center gap-2 font-mono border-t border-slate-800/60 pt-2">
              <Code2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>النموذج المستخدم في الاختبار: <strong className="text-indigo-300">{config[testOperation]}</strong></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
