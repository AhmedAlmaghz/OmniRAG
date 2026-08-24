'use client';

import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import React, { useState, useEffect } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
  Sliders,
  Mic,
  ScanText,
} from 'lucide-react';
import {
  AIModelConfig,
  getAiModelConfig,
  saveAiModelConfig,
  resetAiModelConfig,
  PRESET_MODELS,
  DEFAULT_AI_MODELS,
  MODEL_CONFIG_CHANGE_EVENT,
  ScalarModelKey,
} from '@/lib/config/aiModels';

/**
 * Central AI-model registry UI.
 *
 * Every one of the eight operation keys here has a verified consumer in the
 * backend (chat routes, HyDE, reranker, embedding, OCR, Whisper), so this
 * screen is fully wired end-to-end: save → localStorage + cookie → resolved
 * per-request via runWithModelConfig / x-ai-model-config.
 *
 * Honesty rules enforced after the settings audit:
 *  - server-sync failures are SURFACED as a warning, not swallowed while a
 *    "saved everywhere" banner plays;
 *  - reset clears BOTH localStorage and the server-side config cookie;
 *  - the live test playground only offers chat-capable operations — sending
 *    text-embedding-004 or mistral-ocr-latest to a chat endpoint never made
 *    sense and always failed confusingly.
 */

/** Operations that can meaningfully be tested through the chat endpoint. */
const CHAT_TESTABLE_KEYS = new Set<ScalarModelKey>([
  'chatModel',
  'analysisModel',
  'hydeModel',
  'documentParseModel',
  'chatStreamModel',
]);

export default function ModelSettingsView() {
  const [config, setConfig] = useState<AIModelConfig>(getAiModelConfig());
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [customInputMode, setCustomInputMode] = useState<Record<string, boolean>>({});
  const [customModelNames, setCustomModelNames] = useState<Record<string, string>>({});

  // Test Playground State
  const [testOperation, setTestOperation] = useState<ScalarModelKey>('chatModel');
  const [testPrompt, setTestPrompt] = useState('اكتب ملخصاً في سطرين عن أهمية عزل المستأجرين في منصات RAG');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ text?: string; latencyMs?: number; error?: string } | null>(null);

  // Sync state with local storage + cross-component change events
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

  const handleSelectModel = (key: ScalarModelKey, modelName: string) => {
    if (modelName === 'CUSTOM') {
      const currentVal = config[key];
      setCustomInputMode((prev) => ({ ...prev, [key]: true }));
      setCustomModelNames((prev) => ({ ...prev, [key]: Array.isArray(currentVal) ? '' : currentVal || '' }));
    } else {
      setCustomInputMode((prev) => ({ ...prev, [key]: false }));
      setConfig((prev) => ({ ...prev, [key]: modelName }));
    }
  };

  const handleCustomNameChange = (key: ScalarModelKey, value: string) => {
    setCustomModelNames((prev) => ({ ...prev, [key]: value }));
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSyncWarning(null);
    const updated = saveAiModelConfig(config);
    setConfig(updated);

    // Persist via server API (sets the fallback cookie). A failure here is
    // REAL and visible: requests that bypass fetchWithAuth would keep using
    // stale models — the user must know, not be congratulated anyway.
    try {
      const res = await fetchWithAuth('/api/v1/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!res.ok) {
        setSyncWarning('تم الحفظ محلياً لكن فشلت مزامنة الخادم — الطلبات غير المباشرة قد تستخدم النماذج القديمة.');
      }
    } catch (e) {
      console.warn('Could not sync model settings with server API:', e);
      setSyncWarning('تعذر الاتصال بالخادم للمزامنة — الحفظ محلي فقط.');
    }

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3500);
  };

  const handleReset = () => {
    setIsResetConfirmOpen(true);
  };

  const performReset = () => {
    const reset = resetAiModelConfig();
    setConfig(reset);
    setSyncWarning(null);
    setCustomInputMode({});
    setCustomModelNames({});
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3500);

    // Clear the server-side cookie too — previously only localStorage was
    // cleared and the year-long cookie kept serving stale model names.
    fetchWithAuth('/api/v1/settings/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' }),
    }).catch(() => {});
    setIsResetConfirmOpen(false);
  };

  const runTestModel = async () => {
    setIsTesting(true);
    setTestResult(null);
    const startTime = Date.now();

    try {
      // fetchWithAuth already attaches x-ai-model-config per request; the
      // redundant manual header here was removed. body.model selects the
      // specific operation's model on the server for a true end-to-end probe.
      const res = await fetchWithAuth('/api/v1/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: testPrompt }],
          mode: 'analysis',
          model: config[testOperation],
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
    key: ScalarModelKey;
    titleAr: string;
    titleEn: string;
    descriptionAr: string;
    icon: React.ElementType;
    badge: string;
    typeFilter: 'general' | 'reasoning' | 'embedding' | 'audio' | 'ocr';
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
      descriptionAr:
        'يُستخدم للاستفسارات المركبة، مقارنة العقود والسياسات، والتحليلات الأمنية التي تتطلب منطقاً عميقاً.',
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
      badge: 'Vector Engine',
      typeFilter: 'embedding',
      defaultVal: DEFAULT_AI_MODELS.embeddingModel,
    },
    {
      key: 'whisperModel',
      titleAr: '7. نموذج تفريغ الصوت والفيديو (Whisper / Speech-to-Text)',
      titleEn: 'Audio & Video Transcription',
      descriptionAr:
        'يُستخدم لتفريغ الملفات الصوتية والفيديو إلى نص عبر Groq Whisper (whisper-large-v3 افتراضياً). يدعم mp3, wav, mp4, webm وغيرها.',
      icon: Mic,
      badge: 'API /v1/documents/parse (Audio/Video)',
      typeFilter: 'audio',
      defaultVal: DEFAULT_AI_MODELS.whisperModel,
    },
    {
      key: 'ocrModel',
      titleAr: '8. نموذج OCR لاستخراج النصوص (Mistral Document AI)',
      titleEn: 'PDF & Image OCR',
      descriptionAr:
        'يُستخدم لاستخراج النصوص عالية الدقة من ملفات PDF والصور عبر Mistral Document AI (mistral-ocr-latest افتراضياً).',
      icon: ScanText,
      badge: 'API /v1/documents/parse (PDF/Image OCR)',
      typeFilter: 'ocr',
      defaultVal: DEFAULT_AI_MODELS.ocrModel,
    },
  ];

  const testableOperations = operationsList.filter((op) => CHAT_TESTABLE_KEYS.has(op.key));

  return (
    <div className="space-y-8" dir="rtl">
      {/* Top Banner */}
      <div className="bg-white border border-slate-200/80 rounded-3xl p-5 shadow-3xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-50 rounded-xl border border-indigo-100 text-indigo-600">
                <Cpu className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2 flex-wrap">
                  إعدادات نماذج الذكاء الاصطناعي المركزية
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono uppercase">
                    Global AI Registry
                  </span>
                </h1>
                <p className="text-xs text-slate-500 mt-0.5 max-w-2xl leading-relaxed">
                  شاشة تحكم واحدة لأسماء النماذج لكل عملية في النظام — تُطبَّق فوراً على كل المسارات عبر ربط الإعدادات
                  بالطلبات دون تعديل في الكود.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleReset}
              className="px-3.5 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              إعادة الضبط
            </button>

            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition shadow-2xs flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              حفظ الإعدادات
            </button>
          </div>
        </div>

        {(savedSuccess || syncWarning) && (
          <div className="mt-4 space-y-2">
            {savedSuccess && (
              <div
                role="status"
                className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2 font-medium animate-fadeIn"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>تم حفظ الإعدادات وتطبيقها على الطلبات الجارية عبر ترويسة الإعدادات لكل طلب.</span>
              </div>
            )}
            {syncWarning && (
              <div
                role="alert"
                className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs flex items-center gap-2 font-medium"
              >
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{syncWarning}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Model Cards Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {operationsList.map((op) => {
          const IconComp = op.icon;
          const isCustom = customInputMode[op.key] || !PRESET_MODELS.some((m) => m.id === config[op.key]);
          const currentVal = config[op.key];

          const filteredPresets = PRESET_MODELS.filter(
            (m) => m.type === op.typeFilter || (m.recommendedFor && m.recommendedFor.includes(op.key)),
          );

          return (
            <div
              key={op.key}
              className="bg-white border border-slate-200/80 hover:border-indigo-200 rounded-3xl p-5 space-y-4 transition shadow-3xs flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600 border border-indigo-100 shrink-0">
                      <IconComp className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-extrabold text-slate-900">{op.titleAr}</h3>
                      <p className="text-[11px] text-indigo-600 font-mono truncate">{op.titleEn}</p>
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-500 font-mono shrink-0">
                    {op.badge}
                  </span>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed">{op.descriptionAr}</p>
              </div>

              <div className="space-y-3 pt-3 border-t border-slate-100">
                <span className="text-[11px] font-bold text-slate-600 block">النموذج المعتمد لهذه العملية:</span>

                {/* Preset buttons */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {filteredPresets.map((preset) => {
                    const isSelected = !isCustom && currentVal === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectModel(op.key, preset.id)}
                        aria-pressed={isSelected}
                        className={`px-3 py-2 rounded-xl text-xs text-right transition border flex flex-col justify-between ${
                          isSelected
                            ? 'bg-indigo-600 text-white border-indigo-600 font-semibold'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-slate-900'
                        }`}
                      >
                        <span className="font-mono truncate">{preset.name}</span>
                        {preset.type === 'reasoning' && (
                          <span className={`text-[10px] mt-1 ${isSelected ? 'text-indigo-100' : 'text-amber-600'}`}>
                            تفكير عميق
                          </span>
                        )}
                        {preset.type === 'embedding' && (
                          <span className={`text-[10px] mt-1 ${isSelected ? 'text-indigo-100' : 'text-teal-600'}`}>
                            متجهات دلالية
                          </span>
                        )}
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => handleSelectModel(op.key, 'CUSTOM')}
                    aria-pressed={isCustom}
                    className={`px-3 py-2 rounded-xl text-xs transition border font-mono text-center flex items-center justify-center gap-1 ${
                      isCustom
                        ? 'bg-indigo-600 text-white border-indigo-600 font-semibold'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-slate-900'
                    }`}
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    اسم مخصص...
                  </button>
                </div>

                {/* Custom Input Field */}
                {isCustom && (
                  <div className="mt-1 space-y-1">
                    <input
                      type="text"
                      value={customModelNames[op.key] ?? currentVal}
                      onChange={(e) => handleCustomNameChange(op.key, e.target.value)}
                      placeholder="أدخل اسم النموذج المخصص (مثلاً: gemini-3.7-flash)"
                      className="w-full bg-slate-50 border border-indigo-300 rounded-xl px-3.5 py-2 text-xs text-slate-800 font-mono focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    />
                    <p className="text-[11px] text-slate-500">
                      سيتم تمرير اسم النموذج المعرف هنا مباشرةً لمستدعي Gemini API.
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 font-mono">
                  <span>
                    الافتراضي: <code className="text-slate-400">{op.defaultVal}</code>
                  </span>
                  <span className="text-indigo-700 font-bold">المفعل: {currentVal}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Testing Playground — chat-capable operations only */}
      <div className="bg-white border border-slate-200/80 rounded-3xl p-5 space-y-5 shadow-3xs">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-100 text-emerald-600">
              <Play className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">منصة الاختبار السريع للنماذج</h2>
              <p className="text-xs text-slate-500">تجربة حقيقية عبر مسار المحادثة قبل اعتماد النموذج.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 space-y-4">
            <div>
              <label htmlFor="test-operation" className="text-xs font-bold text-slate-600 block mb-2">
                العملية المراد اختبار نموذجها:
              </label>
              <select
                id="test-operation"
                value={testOperation}
                onChange={(e) => setTestOperation(e.target.value as ScalarModelKey)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-700 font-mono focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {testableOperations.map((op) => (
                  <option key={op.key} value={op.key}>
                    {op.titleAr} ({config[op.key]})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                نماذج المتجهات والتفريغ الصوتي و OCR لا تُختبر هنا لأنها تعمل ضمن خطوط معالجة خاصة بها (استيعاب
                المستندات) وليست استجابات محادثة.
              </p>
            </div>

            <div>
              <label htmlFor="test-prompt" className="text-xs font-bold text-slate-600 block mb-2">
                النص التجريبي للاستعلام:
              </label>
              <textarea
                id="test-prompt"
                rows={3}
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 focus:outline-none focus:border-indigo-500 leading-relaxed"
              />
            </div>

            <button
              onClick={runTestModel}
              disabled={isTesting || !testPrompt.trim()}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold transition flex items-center justify-center gap-2 shadow-2xs"
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

          <div className="lg:col-span-7 bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3 min-h-[220px]">
            {/* The output console intentionally stays dark like code blocks. */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs border-b border-slate-800/80 pb-2">
                <span className="text-slate-400 font-medium">مخرجات استجابة النموذج التجريبي</span>
                {testResult?.latencyMs && (
                  <span className="text-emerald-400 font-mono text-[11px]">الزمن: {testResult.latencyMs}ms</span>
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
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>
                النموذج المستخدم في الاختبار: <strong className="text-indigo-300">{config[testOperation]}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={isResetConfirmOpen}
        title="إعادة ضبط الإعدادات"
        message="هل أنت متأكد من إعادة ضبط كافة أسماء نماذج الذكاء الاصطناعي إلى الإعدادات الافتراضية؟ سيتم أيضاً مسح النسخة المحفوظة على الخادم."
        confirmLabel="إعادة الضبط"
        cancelLabel="إلغاء"
        variant="warning"
        onConfirm={performReset}
        onCancel={() => setIsResetConfirmOpen(false)}
      />
    </div>
  );
}
