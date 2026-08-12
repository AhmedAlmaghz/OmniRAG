import React, { useState } from 'react';
import { Settings, ShieldCheck, Cpu, Key, Database, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Language } from '../types';
import DiagnosticUtility from '../components/diagnostics/DiagnosticUtility';

interface SettingsPageProps {
  lang: Language;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ lang }) => {
  const [turboEnabled, setTurboEnabled] = useState(true);
  const [compilerEnabled, setCompilerEnabled] = useState(true);
  const [pPrEnabled, setPPrEnabled] = useState(true);

  return (
    <div className="space-y-8">
      
      {/* Header Banner */}
      <div className="p-8 rounded-3xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-semibold border border-indigo-500/20">
          <Settings className="w-4 h-4" />
          <span>{lang === 'ar' ? 'إعدادات وبيئة التشغيل' : 'App Router Environment Configuration'}</span>
        </div>

        <h1 className="text-3xl font-black text-white">
          {lang === 'ar' ? 'إعدادات وتكوين Next.js v16' : 'Next.js v16 Framework & Runtime Settings'}
        </h1>

        <p className="text-slate-300 text-sm max-w-3xl leading-relaxed">
          {lang === 'ar'
            ? 'إدارة محرك TurboPack، مترجم React 19 Compiler، سياسات التخزين المؤقت، والتأكد من تكوين متغيرات البيئة.'
            : 'Inspect runtime container configuration, React 19 compiler optimizations, and environment key statuses.'}
        </p>
      </div>

      {/* Main Settings Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Compiler & Build Optimization Toggles */}
        <div className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-6">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Cpu className="w-5 h-5 text-cyan-400" />
            <span>{lang === 'ar' ? 'تحسينات محرك التجميع (Build & Compiler)' : 'Build Engine Optimizations'}</span>
          </h3>

          <div className="space-y-4">
            
            <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <div className="space-y-0.5">
                <div className="text-sm font-bold text-slate-100">TurboPack Engine</div>
                <div className="text-xs text-slate-400">
                  {lang === 'ar' ? 'تسريع بناء وتجميع الحزم بنسبة 10x' : 'Incremental bundler for Next.js v16'}
                </div>
              </div>
              <button
                onClick={() => setTurboEnabled(!turboEnabled)}
                className={`w-12 h-6 rounded-full p-1 transition-colors cursor-pointer ${
                  turboEnabled ? 'bg-indigo-600' : 'bg-slate-800'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${
                    turboEnabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <div className="space-y-0.5">
                <div className="text-sm font-bold text-slate-100">React 19 Auto-Memoization Compiler</div>
                <div className="text-xs text-slate-400">
                  {lang === 'ar' ? 'مترجم المكونات التلقائي للتخلص من useMemo' : 'Automatic memoization via React Compiler'}
                </div>
              </div>
              <button
                onClick={() => setCompilerEnabled(!compilerEnabled)}
                className={`w-12 h-6 rounded-full p-1 transition-colors cursor-pointer ${
                  compilerEnabled ? 'bg-indigo-600' : 'bg-slate-800'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${
                    compilerEnabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <div className="space-y-0.5">
                <div className="text-sm font-bold text-slate-100">Partial Prerendering (PPR)</div>
                <div className="text-xs text-slate-400">
                  {lang === 'ar' ? 'دمج التجميع الثابت مع الجلب الديناميكي' : 'Hybrid static shell + dynamic streaming'}
                </div>
              </div>
              <button
                onClick={() => setPPrEnabled(!pPrEnabled)}
                className={`w-12 h-6 rounded-full p-1 transition-colors cursor-pointer ${
                  pPrEnabled ? 'bg-indigo-600' : 'bg-slate-800'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${
                    pPrEnabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

          </div>
        </div>

        {/* Environment Secret Variables Status (Safe Inspection) */}
        <div className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-6">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Key className="w-5 h-5 text-emerald-400" />
            <span>{lang === 'ar' ? 'حالة متغيرات البيئة (.env.example)' : 'Environment Variables Status'}</span>
          </h3>

          <div className="space-y-3 font-mono text-xs">
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200">GEMINI_API_KEY</span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Server-side Secret
                </span>
              </div>
              <p className="text-slate-400 text-[11px] font-sans">
                {lang === 'ar'
                  ? 'تم تعريف المتغير بملف .env.example ويتم حقنه تلقائياً في بيئة الخادم بشكل آمن.'
                  : 'Declared in .env.example and securely injected server-side by AI Studio platform.'}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200">APP_URL</span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  Container Ingress
                </span>
              </div>
              <p className="text-slate-400 text-[11px] font-sans">
                {lang === 'ar'
                  ? 'رابط الحاوية المباشر المربوط بـ Cloud Run ومنفذ 3000.'
                  : 'Direct Cloud Run service container URL routed to port 3000.'}
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* Production Connection Diagnostics Component */}
      <div className="pt-4">
        <DiagnosticUtility lang={lang} autoRunOnMount={true} />
      </div>

    </div>
  );
};
