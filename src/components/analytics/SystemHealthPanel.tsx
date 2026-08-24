'use client';

import React, { useState, useEffect } from 'react';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import { Activity, RefreshCw, ShieldCheck, AlertTriangle, XCircle, Database, Boxes, FileSearch } from 'lucide-react';

interface ServiceDiagnostic {
  service: string;
  name: string;
  status: 'connected' | 'disconnected' | 'missing_config' | 'auth_failed' | string;
  latencyMs: number;
  configured: boolean;
  maskedUrl?: string | null;
  message: string;
}

interface DiagnosticsResponse {
  overallStatus: 'healthy' | 'degraded' | 'critical';
  readinessScore: number;
  diagnostics: {
    postgresql: ServiceDiagnostic;
    qdrant: ServiceDiagnostic;
    mistral: ServiceDiagnostic;
  };
}

interface SystemHealthPanelProps {
  lang: 'ar' | 'en';
}

/**
 * Live infrastructure health from the REAL /api/v1/diagnostics endpoint
 * (actual Postgres ping, Qdrant collection check, Mistral auth check).
 * Replaces the previously disabled panel that showed no metrics at all —
 * every number here is measured, never fabricated.
 */
export default function SystemHealthPanel({ lang }: SystemHealthPanelProps) {
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDiagnostics = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/v1/diagnostics');
      if (!res.ok) {
        throw new Error(lang === 'ar' ? 'فشل فحص التشخيصات' : 'Diagnostics request failed');
      }
      const payload = await res.json();
      setData(payload);
    } catch (e: any) {
      setError(e?.message || (lang === 'ar' ? 'خطأ غير متوقع' : 'Unexpected error'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
  }, []);

  const statusStyles = (status: string) => {
    if (status === 'connected')
      return { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: ShieldCheck };
    if (status === 'missing_config')
      return { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', Icon: AlertTriangle };
    return { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200', Icon: XCircle };
  };

  const serviceIcon = (service: string) => {
    if (service === 'postgresql') return Database;
    if (service === 'qdrant') return Boxes;
    return FileSearch;
  };

  const statusLabel = (status: string) => {
    if (lang === 'ar') {
      return status === 'connected'
        ? 'متصل'
        : status === 'missing_config'
          ? 'غير مهيأ'
          : status === 'auth_failed'
            ? 'فشل المصادقة'
            : 'منقطع';
    }
    return status;
  };

  const overallBadge = data
    ? data.overallStatus === 'healthy'
      ? { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', text: lang === 'ar' ? 'سليمة' : 'Healthy' }
      : data.overallStatus === 'degraded'
        ? { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', text: lang === 'ar' ? 'متدهورة' : 'Degraded' }
        : { cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30', text: lang === 'ar' ? 'حرجة' : 'Critical' }
    : null;

  const services = data ? Object.values(data.diagnostics) : [];

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-600" />
          <span>{lang === 'ar' ? 'صحة البنية التحتية (قياس فعلي)' : 'Infrastructure Health (measured)'}</span>
          {overallBadge && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${overallBadge.cls}`}>
              {overallBadge.text}
            </span>
          )}
        </h3>
        <button
          onClick={fetchDiagnostics}
          disabled={isLoading}
          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-800 transition flex items-center gap-1 text-xs cursor-pointer select-none"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>{lang === 'ar' ? 'إعادة الفحص' : 'Re-check'}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
          {error}
        </div>
      )}

      {/* Readiness score bar */}
      {data && (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] font-medium text-slate-600">
            <span>{lang === 'ar' ? 'درجة الجهوزية الإنتاجية' : 'Production Readiness Score'}</span>
            <span className="font-mono font-bold text-slate-900">{data.readinessScore}/100</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                data.readinessScore >= 85
                  ? 'bg-emerald-500'
                  : data.readinessScore >= 50
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
              }`}
              style={{ width: `${Math.max(4, data.readinessScore)}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        {isLoading && !data
          ? [0, 1, 2].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-slate-50 border border-slate-100 animate-pulse" />
            ))
          : services.map((svc) => {
              const style = statusStyles(svc.status);
              const SvcIcon = serviceIcon(svc.service);
              return (
                <div
                  key={svc.service}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50/60 border border-slate-100"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0`}
                    >
                      <SvcIcon className="w-4 h-4 text-slate-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900 truncate">{svc.name}</span>
                        <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${style.chip}`}>
                          {statusLabel(svc.status)}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 truncate max-w-md" title={svc.message}>
                        {svc.message}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <div className="font-mono text-[11px] font-bold text-slate-800">
                      {svc.status === 'connected' ? `${svc.latencyMs} ms` : '—'}
                    </div>
                    {svc.maskedUrl && <div className="font-mono text-[9px] text-slate-400">{svc.maskedUrl}</div>}
                  </div>
                </div>
              );
            })}
      </div>

      <p className="text-[10px] text-slate-400 leading-relaxed">
        {lang === 'ar'
          ? 'كل الأرقام أعلاه مقاسة فعلياً عبر /api/v1/diagnostics: اتصال PostgreSQL حقيقي، فحص مجموعة Qdrant، والتحقق من مفتاح Mistral. لا توجد بيانات محاكاة.'
          : 'All numbers above are measured live via /api/v1/diagnostics: real Postgres round-trip, Qdrant collection probe, Mistral key verification. No simulated data.'}
      </p>
    </div>
  );
}
