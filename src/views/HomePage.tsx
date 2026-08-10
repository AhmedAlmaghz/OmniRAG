import React, { useState } from 'react';
import { 
  Sparkles, 
  Server, 
  Monitor, 
  ArrowRight, 
  CheckCircle2, 
  Cpu, 
  Zap, 
  ShieldAlert, 
  Code2, 
  Play, 
  Loader2,
  ChevronRight,
  Layers
} from 'lucide-react';
import { NEXT_16_FEATURES } from '../data/next16Features';
import { CodeBlock } from '../components/ui/CodeBlock';
import { Language } from '../types';

interface HomePageProps {
  lang: Language;
}

export const HomePage: React.FC<HomePageProps> = ({ lang }) => {
  const [selectedFeatureId, setSelectedFeatureId] = useState(NEXT_16_FEATURES[0].id);
  const [activeTab, setActiveTab] = useState<'rsc' | 'actions' | 'ppr'>('rsc');
  
  // Interactive Server/Client visualizer state
  const [simulatedServerCount, setSimulatedServerCount] = useState(100);
  const [simulatedClientCount, setSimulatedClientCount] = useState(0);

  // AI Prompt Widget State
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const selectedFeature = NEXT_16_FEATURES.find((f) => f.id === selectedFeatureId) || NEXT_16_FEATURES[0];

  const handleAskAi = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiResult('');
    try {
      const res = await fetch('/api/genai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt, locale: lang }),
      });
      const data = await res.json();
      if (data.result) {
        setAiResult(data.result);
      } else {
        setAiResult(JSON.stringify(data, null, 2));
      }
    } catch (err: any) {
      setAiResult(`Error calling /api/genai: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-12">
      
      {/* Hero Banner Section */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 p-8 sm:p-12 shadow-2xl">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-4xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-semibold">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>{lang === 'ar' ? 'جيل Next.js v16 الجديد مع App Router' : 'Next.js v16 App Router Reference Standard'}</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black text-white leading-tight tracking-tight">
            {lang === 'ar' ? (
              <>
                بناء تطبيقات <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-violet-400 bg-clip-text text-transparent">Next.js v16 App Router</span> وفق معايير SDLC العالية
              </>
            ) : (
              <>
                Building <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-violet-400 bg-clip-text text-transparent">Next.js v16 App Router</span> Apps with SDLC Best Practices
              </>
            )}
          </h1>

          <p className="text-slate-300 text-base sm:text-lg leading-relaxed max-w-3xl">
            {lang === 'ar'
              ? 'تطبيق إرجاع مرجعي متكامل يشمل مكونات الخادم React 19 Server Components، إجراءات الخادم Server Actions، معالجات المسارات API Route Handlers، وتطبيقات الأمان المتقدمة المعتمدة على الذكاء الاصطناعي Gemini.'
              : 'Complete Next.js v16 enterprise reference application featuring React 19 Server Components, Server Actions, Route Handlers, and server-side Gemini AI integrations.'}
          </p>

          {/* Quick Metrics Bar */}
          <div className="pt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800">
              <div className="text-xs text-slate-400 mb-1">{lang === 'ar' ? 'إصدار Next.js' : 'Next.js Version'}</div>
              <div className="text-xl font-bold text-cyan-400">v16.0.0 (App)</div>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800">
              <div className="text-xs text-slate-400 mb-1">{lang === 'ar' ? 'نواة React' : 'React Kernel'}</div>
              <div className="text-xl font-bold text-indigo-400">React 19</div>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800">
              <div className="text-xs text-slate-400 mb-1">{lang === 'ar' ? 'مكتبة التنسيق' : 'Styling Engine'}</div>
              <div className="text-xl font-bold text-violet-400">Tailwind v4</div>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800">
              <div className="text-xs text-slate-400 mb-1">{lang === 'ar' ? 'حالة SDLC' : 'SDLC Compliance'}</div>
              <div className="text-xl font-bold text-emerald-400">100% Passed</div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Server vs Client Component Boundary Visualizer */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Server className="w-6 h-6 text-cyan-400" />
              <span>{lang === 'ar' ? 'محاكي حدود مكونات الخادم والعميل (RSC Boundary)' : 'Server vs Client Component Boundary Tester'}</span>
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              {lang === 'ar'
                ? 'شاهد كيف يقوم Next.js App Router بنقل المنطق المعقد الخادم لتقليل حجم حزمة JavaScript للمتصفح.'
                : 'See how Next.js App Router keeps bulk logic on the server to minimize client bundle footprint.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Server Component Side */}
          <div className="p-6 rounded-2xl bg-slate-900/90 border border-cyan-500/30 space-y-4 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-base">
                    {lang === 'ar' ? 'مكون الخادم (React Server Component)' : 'React Server Component (RSC)'}
                  </h3>
                  <span className="text-xs text-cyan-400 font-mono">app/page.tsx (Default Server)</span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                0 KB Bundle to Client
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {lang === 'ar'
                ? 'يتم تنفيذ الكود بالكامل على الخادم. يستطيع الاتصال المباشر بقواعد البيانات واستدعاء مفاتيح API السرية بشكل آمن دون إرسال كود المكون للمتصفح.'
                : 'Executes 100% on server container. Directly queries database and secret API endpoints without leaking code to the browser.'}
            </p>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 text-xs">
              <div className="flex items-center justify-between text-slate-300">
                <span>{lang === 'ar' ? 'البيانات المعالجة خادماً:' : 'Server Data Processed:'}</span>
                <span className="font-bold font-mono text-cyan-400">{simulatedServerCount} Records</span>
              </div>
              <button
                onClick={() => setSimulatedServerCount((c) => c + 50)}
                className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold transition-colors cursor-pointer"
              >
                {lang === 'ar' ? '+ معالجة 50 سجل إضافي على الخادم' : '+ Process 50 More Records Server-Side'}
              </button>
            </div>
          </div>

          {/* Client Component Side */}
          <div className="p-6 rounded-2xl bg-slate-900/90 border border-indigo-500/30 space-y-4 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                  <Monitor className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-base">
                    {lang === 'ar' ? 'مكون العميل (Client Component)' : 'Client Component ("use client")'}
                  </h3>
                  <span className="text-xs text-indigo-400 font-mono">components/InteractiveWidget.tsx</span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Interactive State
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {lang === 'ar'
                ? 'يستخدم فقط للحالات التفاعلية الشاغرة من العميل مثل الأحداث onClick، والخطافات useState، واستمعات أحداث المتصفح.'
                : 'Used selectively for interactive client state (useState, onClick, EventListeners, browser APIs).'}
            </p>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 text-xs">
              <div className="flex items-center justify-between text-slate-300">
                <span>{lang === 'ar' ? 'نقرات التفاعل للمستخدم:' : 'Client Interaction Clicks:'}</span>
                <span className="font-bold font-mono text-indigo-400">{simulatedClientCount} Clicks</span>
              </div>
              <button
                onClick={() => setSimulatedClientCount((c) => c + 1)}
                className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-colors cursor-pointer"
              >
                {lang === 'ar' ? 'تفاعل العميل ("use client" onClick)' : 'Trigger Client Event ("use client" onClick)'}
              </button>
            </div>
          </div>

        </div>
      </section>

      {/* Feature Showcase Grid */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Zap className="w-6 h-6 text-indigo-400" />
            <span>{lang === 'ar' ? 'استعراض ميزات Next.js v16 الرئيسية' : 'Next.js v16 Core Features Showcase'}</span>
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            {lang === 'ar'
              ? 'اختر ميزة لمعاينة الكود المرجعي والشرح الهندسي التفصيلي:'
              : 'Select a feature to inspect reference implementation code:'}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Feature List Selector (Left) */}
          <div className="lg:col-span-5 space-y-3">
            {NEXT_16_FEATURES.map((feature) => {
              const isSelected = feature.id === selectedFeatureId;
              return (
                <button
                  key={feature.id}
                  onClick={() => setSelectedFeatureId(feature.id)}
                  className={`w-full text-right p-4 rounded-2xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                    isSelected
                      ? 'bg-slate-900 border-indigo-500 shadow-md shadow-indigo-500/10'
                      : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-900/50 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100 text-sm">
                        {lang === 'ar' ? feature.titleAr : feature.titleEn}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2">
                      {lang === 'ar' ? feature.descriptionAr : feature.descriptionEn}
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300">
                        {feature.category}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        {feature.status}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className={`w-5 h-5 text-slate-500 shrink-0 mt-1 transition-transform ${isSelected ? 'rotate-90 text-indigo-400' : ''}`} />
                </button>
              );
            })}
          </div>

          {/* Feature Inspection Panel (Right) */}
          <div className="lg:col-span-7 p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {lang === 'ar' ? selectedFeature.titleAr : selectedFeature.titleEn}
                </h3>
                <span className="text-xs text-indigo-400 font-mono">{selectedFeature.category}</span>
              </div>
              <div className="flex items-center gap-2">
                {selectedFeature.tags.map((tag: string) => (
                  <span key={tag} className="px-2.5 py-1 rounded-md text-xs font-mono bg-slate-800 text-slate-300">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              {lang === 'ar' ? selectedFeature.descriptionAr : selectedFeature.descriptionEn}
            </p>

            <div>
              <CodeBlock code={selectedFeature.codeSnippet} language="typescript" title={`Example snippet: ${selectedFeature.id}`} />
            </div>
          </div>

        </div>
      </section>

      {/* AI Assistant Generator (Server-side Gemini GenAI) */}
      <section className="p-8 rounded-3xl bg-slate-900/90 border border-indigo-500/30 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 text-white">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">
              {lang === 'ar' ? 'مساعد Next.js v16 وتوليد الأكواد المعيارية (Gemini AI)' : 'Next.js v16 AI Boilerplate Generator'}
            </h2>
            <p className="text-xs text-slate-400">
              {lang === 'ar'
                ? 'استدعاء آمن ومضمون من الخادم Server-side لنموذج Gemini 2.5 لتوليد مكونات ومسارات Next.js 16.'
                : 'Server-side route handler invoking Gemini GenAI for Next.js 16 code snippets.'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder={
                lang === 'ar'
                  ? 'مثال: أنشئ مكون نموذج استمارة بريدية مع إجراءات الخادم Server Actions'
                  : 'e.g. Generate a contact form Server Action component in Next.js 16'
              }
              className="flex-1 px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <button
              onClick={handleAskAi}
              disabled={aiLoading}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 via-indigo-600 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-indigo-500/20 cursor-pointer disabled:opacity-50"
            >
              {aiLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{lang === 'ar' ? 'جاري توليد الكود...' : 'Generating Code...'}</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>{lang === 'ar' ? 'توليد الكود خادماً' : 'Generate Server-side'}</span>
                </>
              )}
            </button>
          </div>

          {aiResult && (
            <div className="mt-4">
              <CodeBlock code={aiResult} language="typescript" title="Generated Code Result" />
            </div>
          )}
        </div>
      </section>

    </div>
  );
};
