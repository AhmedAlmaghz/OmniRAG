'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import {
  X,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ShieldCheck,
  Database,
  Cpu,
  RefreshCw,
  Sparkles,
  Layers,
  Search,
} from 'lucide-react';

interface HealthDiagnosticsModalProps {
  tenantId: string;
  totalDocs: number;
  totalChunks: number;
  lang: 'ar' | 'en';
  onClose: () => void;
}

/**
 * Real health diagnostics modal.
 *
 * The previous version was pure theater: a 600ms interval marked five canned
 * steps "passed" with prewritten details and ALWAYS reported "100% Optimal",
 * without ever contacting the backend. It now calls the real
 * GET /api/v1/diagnostics endpoint, which pings PostgreSQL, Qdrant, and
 * Mistral with measured latencies, and renders their ACTUAL status — including
 * failures and missing configuration.
 */

type ServiceStatus = 'connected' | 'disconnected' | 'missing_config' | 'auth_failed';

interface ServiceDiagnostic {
  service: string;
  name: string;
  status: ServiceStatus;
  latencyMs: number;
  configured: boolean;
  maskedUrl?: string | null;
  maskedApiKey?: string | null;
  message?: string;
  details?: Record<string, any>;
  version?: string;
  databaseName?: string;
  collectionInfo?: { pointsCount?: number; vectorSize?: number; distance?: string; status?: string } | null;
  modelsCount?: number;
}

interface DiagnosticsPayload {
  timestamp: string;
  environment: string;
  overallStatus: 'healthy' | 'degraded' | 'critical';
  readinessScore: number;
  diagnostics: {
    postgresql: ServiceDiagnostic;
    qdrant: ServiceDiagnostic;
    mistral: ServiceDiagnostic;
  };
}

export function HealthDiagnosticsModal({
  tenantId,
  totalDocs,
  totalChunks,
  lang,
  onClose,
}: HealthDiagnosticsModalProps) {
  const isRtl = lang === 'ar';
  const [isRunning, setIsRunning] = useState(true);
  const [data, setData] = useState<DiagnosticsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const runDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setLoadError(null);
    try {
      const res = await fetchWithAuth('/api/v1/diagnostics');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = (await res.json()) as DiagnosticsPayload;
      setData(payload);
    } catch (err) {
      console.error('Diagnostics fetch failed:', err);
      setLoadError(isRtl ? 'تعذر الوصول إلى خدمة التشخيصات على الخادم' : 'Could not reach the diagnostics service');
    } finally {
      setIsRunning(false);
    }
  }, [isRtl]);

  useEffect(() => {
    runDiagnostics();
  }, [runDiagnostics]);

  // Escape closes the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const statusConfig = (status: ServiceStatus) => {
    switch (status) {
      case 'connected':
        return {
          icon: CheckCircle2,
          wrap: 'bg-emerald-50/40 border-emerald-200/80',
          iconColor: 'text-emerald-600',
          label: isRtl ? 'متصل' : 'Connected',
          badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        };
      case 'missing_config':
        return {
          icon: AlertTriangle,
          wrap: 'bg-amber-50/40 border-amber-200/80',
          iconColor: 'text-amber-600',
          label: isRtl ? 'غير مهيأ' : 'Not configured',
          badge: 'bg-amber-50 text-amber-700 border-amber-200',
        };
      case 'auth_failed':
        return {
          icon: XCircle,
          wrap: 'bg-rose-50/40 border-rose-200/80',
          iconColor: 'text-rose-600',
          label: isRtl ? 'فشل المصادقة' : 'Auth failed',
          badge: 'bg-rose-50 text-rose-700 border-rose-200',
        };
      default:
        return {
          icon: XCircle,
          wrap: 'bg-rose-50/40 border-rose-200/80',
          iconColor: 'text-rose-600',
          label: isRtl ? 'غير متصل' : 'Disconnected',
          badge: 'bg-rose-50 text-rose-700 border-rose-200',
        };
    }
  };

  const overall = data?.overallStatus;
  const overallBadge =
    overall === 'healthy'
      ? { text: isRtl ? 'سليم' : 'Healthy', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
      : overall === 'degraded'
        ? { text: isRtl ? 'متدهور' : 'Degraded', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
        : { text: isRtl ? 'حرج' : 'Critical', cls: 'bg-rose-50 text-rose-700 border-rose-200' };

  const renderServiceCard = (diag: ServiceDiagnostic | undefined, icon: React.ElementType, title: string) => {
    if (!diag) return null;
    const cfg = statusConfig(diag.status);
    const Icon = cfg.icon;
    const ServiceIcon = icon;

    return (
      <div
        className={`p-4 rounded-2xl border transition-all duration-200 flex items-start justify-between gap-4 ${cfg.wrap}`}
      >
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <ServiceIcon className={`w-4 h-4 ${cfg.iconColor}`} aria-hidden="true" />
            <h4 className="text-xs font-bold text-slate-900">{title}</h4>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border font-mono ${cfg.badge}`}>
              {cfg.label}
            </span>
            {diag.configured && diag.latencyMs > 0 && (
              <span className="text-[9px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">
                {diag.latencyMs}ms
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 leading-normal">{diag.message}</p>
          {diag.maskedUrl && (
            <p className="text-[10px] font-mono text-slate-400 truncate" dir="ltr">
              {diag.maskedUrl}
            </p>
          )}
          {diag.collectionInfo?.pointsCount !== undefined && (
            <p className="text-[10px] font-mono text-slate-500">
              {isRtl ? 'نقاط متجهية:' : 'Vector points:'} {diag.collectionInfo.pointsCount} •{' '}
              {diag.collectionInfo.vectorSize}d {diag.collectionInfo.distance}
            </p>
          )}
        </div>
        <div className="shrink-0 pt-0.5">
          <Icon className={`w-5 h-5 ${cfg.iconColor}`} aria-hidden="true" />
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={isRtl ? 'فحص صحة قاعدة المعرفة' : 'Knowledge base health diagnostic'}
        className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-150 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100/60">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <span>{isRtl ? 'فحص صحة البنية التحتية للمعرفة' : 'Knowledge Infrastructure Health Diagnostic'}</span>
                {isRunning ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 animate-pulse">
                    {isRtl ? 'جاري الفحص...' : 'Scanning...'}
                  </span>
                ) : data ? (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${overallBadge.cls}`}>
                    {overallBadge.text} • {data.readinessScore}/100
                  </span>
                ) : null}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isRtl
                  ? `فحص حقيقي لاتصالات PostgreSQL و Qdrant و Mistral لحساب ${tenantId}`
                  : `Live connectivity check of PostgreSQL, Qdrant and Mistral for ${tenantId}`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label={isRtl ? 'إغلاق' : 'Close'}
            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="p-6 space-y-3.5 max-h-[480px] overflow-y-auto">
          {isRunning && (
            <div className="py-10 flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="w-7 h-7 text-indigo-600 animate-spin" />
              <p className="text-xs font-bold">
                {isRtl ? 'يتم فحص الخدمات فعلياً الآن...' : 'Probing services now...'}
              </p>
            </div>
          )}

          {!isRunning && loadError && (
            <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50/40 flex items-center gap-3">
              <XCircle className="w-5 h-5 text-rose-600 shrink-0" aria-hidden="true" />
              <p className="text-xs font-bold text-rose-800">{loadError}</p>
            </div>
          )}

          {!isRunning && data && (
            <>
              {renderServiceCard(
                data.diagnostics.postgresql,
                Database,
                isRtl ? 'قاعدة PostgreSQL (البيانات والفهرس اللفظي)' : 'PostgreSQL (metadata & lexical index)',
              )}
              {renderServiceCard(
                data.diagnostics.qdrant,
                Layers,
                isRtl ? 'محرك Qdrant (الفضاء المتجهي)' : 'Qdrant (vector space)',
              )}
              {renderServiceCard(
                data.diagnostics.mistral,
                Sparkles,
                isRtl ? 'Mistral Document AI (OCR والاستخراج)' : 'Mistral Document AI (OCR & extraction)',
              )}

              {/* Knowledge corpus summary — computed from real document counts */}
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-indigo-600" aria-hidden="true" />
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">
                      {isRtl ? 'حالة corpus المعرفة' : 'Knowledge corpus state'}
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {isRtl
                        ? `${totalDocs} مستند • ${totalChunks} مقطع دلالي`
                        : `${totalDocs} documents • ${totalChunks} semantic chunks`}
                    </p>
                  </div>
                </div>
                <span className="text-[9px] font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                  {data.environment.toUpperCase()}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-150 bg-slate-50/70 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <ShieldCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            <span className="font-medium">
              {isRtl ? 'عزل المستأجرين مفروض على مستوى الاستعلامات' : 'Tenant isolation enforced at query level'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={runDiagnostics}
              disabled={isRunning}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{isRtl ? 'إعادة الفحص' : 'Re-run'}</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition cursor-pointer"
            >
              {isRtl ? 'إغلاق' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
