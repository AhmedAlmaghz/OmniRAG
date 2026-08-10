import React, { useState } from 'react';
import { 
  Activity, 
  Clock, 
  Database, 
  RefreshCw, 
  CheckCircle2, 
  Cpu, 
  Zap, 
  Server, 
  TrendingUp, 
  Flame,
  BarChart3
} from 'lucide-react';
import { SYSTEM_METRICS } from '../data/sdlcData';
import { Language } from '../types';

interface DashboardPageProps {
  lang: Language;
}

interface ServerActionLog {
  id: string;
  actionName: string;
  timestamp: string;
  durationMs: number;
  status: 'revalidated' | 'cached' | 'mutation_success';
  path: string;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ lang }) => {
  const [logs, setLogs] = useState<ServerActionLog[]>([
    {
      id: 'log-1',
      actionName: 'updateProjectTitle',
      timestamp: new Date().toLocaleTimeString(),
      durationMs: 14,
      status: 'revalidated',
      path: '/dashboard',
    },
    {
      id: 'log-2',
      actionName: 'fetchTelemetryMetrics',
      timestamp: new Date(Date.now() - 1000 * 30).toLocaleTimeString(),
      durationMs: 8,
      status: 'cached',
      path: '/api/health',
    },
  ]);

  const [cacheHits, setCacheHits] = useState(98.2);
  const [isSimulating, setIsSimulating] = useState(false);

  const handleTriggerServerAction = (actionType: string) => {
    setIsSimulating(true);
    setTimeout(() => {
      const newLog: ServerActionLog = {
        id: `log-${Date.now()}`,
        actionName: actionType,
        timestamp: new Date().toLocaleTimeString(),
        durationMs: Math.floor(Math.random() * 15) + 5,
        status: actionType.includes('revalidate') ? 'revalidated' : 'mutation_success',
        path: actionType.includes('sdlc') ? '/sdlc' : '/dashboard',
      };
      setLogs((prev) => [newLog, ...prev]);
      setCacheHits((c) => Math.min(99.9, +(c + 0.1).toFixed(1)));
      setIsSimulating(false);
    }, 400);
  };

  return (
    <div className="space-y-8">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-3xl bg-slate-900 border border-slate-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-3">
            <BarChart3 className="w-8 h-8 text-cyan-400" />
            <span>{lang === 'ar' ? 'لوحة قيادة النظام ومقاييس الأداء' : 'SDLC Metrics & System Dashboard'}</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {lang === 'ar'
              ? 'مراقبة أداء الخادم، استجابة المسارات البرمجية، وسجلات إجراءات الخادم (Server Actions).'
              : 'Monitor server container responsiveness, Next.js cache hits, and real-time Server Actions.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleTriggerServerAction('revalidatePath("/dashboard")')}
            disabled={isSimulating}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isSimulating ? 'animate-spin' : ''}`} />
            <span>{lang === 'ar' ? 'تحديث التخزين المؤقت (revalidatePath)' : 'Trigger revalidatePath()'}</span>
          </button>
        </div>
      </div>

      {/* Top Key Performance Indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {SYSTEM_METRICS.map((metric) => (
          <div key={metric.id} className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2 hover:border-slate-700 transition-colors">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>{lang === 'ar' ? metric.titleAr : metric.titleEn}</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-cyan-400 font-mono">
                {metric.category}
              </span>
            </div>

            <div className="text-2xl font-black text-white font-mono">
              {metric.value}
            </div>

            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>{metric.change}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Main Grid: Server Action Log & Cache Status */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Server Actions Live Activity Stream (Left 7 cols) */}
        <div className="lg:col-span-7 p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-5">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-400" />
              <h3 className="font-bold text-white text-base">
                {lang === 'ar' ? 'سجل إجراءات الخادم (Server Actions Log)' : 'Real-time Server Actions Activity Stream'}
              </h3>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              Live Stream
            </span>
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto dir-ltr text-left font-mono text-xs">
            {logs.map((log) => (
              <div
                key={log.id}
                className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">{log.actionName}</span>
                    <span className="text-slate-500 text-[10px]">{log.path}</span>
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    Status: <span className="text-emerald-400">{log.status}</span>
                  </div>
                </div>

                <div className="text-right space-y-1">
                  <div className="text-slate-200 font-bold">{log.durationMs} ms</div>
                  <div className="text-slate-500 text-[10px]">{log.timestamp}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={() => handleTriggerServerAction('revalidateTag("sdlc-cache")')}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono transition-colors cursor-pointer"
            >
              + revalidateTag("sdlc-cache")
            </button>
            <button
              onClick={() => handleTriggerServerAction('mutateUserPermissions()')}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono transition-colors cursor-pointer"
            >
              + mutateUserPermissions()
            </button>
          </div>
        </div>

        {/* Caching & Next.js 16 TurboPack Telemetry (Right 5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          
          <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-amber-400" />
              <h3 className="font-bold text-white text-base">
                {lang === 'ar' ? 'نسبة نجاح التخزين المؤقت (Cache Hit Ratio)' : 'Next.js App Router Cache Hit Ratio'}
              </h3>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs text-slate-300 font-mono">
                <span>Memory & Data Cache</span>
                <span className="font-bold text-emerald-400">{cacheHits}%</span>
              </div>
              <div className="w-full h-3 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
                  style={{ width: `${cacheHits}%` }}
                />
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              {lang === 'ar'
                ? 'نظام التخزين المتقدم في Next.js v16 يقلل من الضغط على قاعدة البيانات ويمكّن من استجابة فورية أقل من 20 مللي ثانية.'
                : 'Next.js 16 route cache minimizes database hits and provides sub-20ms TTFB globally.'}
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3 text-xs">
            <h4 className="font-bold text-white text-sm">
              {lang === 'ar' ? 'فحوصات البناء والجودة (SDLC Check)' : 'Production Build Checkpoints'}
            </h4>
            <div className="space-y-2 text-slate-300">
              <div className="flex items-center justify-between">
                <span>TypeScript Strict Compiler</span>
                <span className="text-emerald-400 font-bold">Passed</span>
              </div>
              <div className="flex items-center justify-between">
                <span>ESBuild CommonJS Server Bundle</span>
                <span className="text-emerald-400 font-bold">dist/server.cjs</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Tailwind CSS v4 Engine</span>
                <span className="text-emerald-400 font-bold">Active</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Server-side Secret Leak Audit</span>
                <span className="text-emerald-400 font-bold">0 Leaks</span>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};
