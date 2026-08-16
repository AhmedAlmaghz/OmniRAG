'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  Database,
  Layers,
  Cpu,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Server,
  Key,
  ShieldCheck,
  Terminal,
  Download,
  Copy,
  Check,
  ExternalLink,
  Zap,
  Globe,
  Clock,
  HardDrive,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';

interface DiagnosticUtilityProps {
  lang?: 'ar' | 'en';
  autoRunOnMount?: boolean;
}

export default function DiagnosticUtility({ lang = 'ar', autoRunOnMount = true }: DiagnosticUtilityProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [logs, setLogs] = useState<
    Array<{ id: string; timestamp: string; level: 'info' | 'success' | 'warn' | 'error'; message: string }>
  >([]);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'connections' | 'environment' | 'logs'>('connections');
  const [testingTarget, setTestingTarget] = useState<string | null>(null);

  const addLog = useCallback(
    (message: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') => {
      const timeStr = new Date().toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US', { hour12: false });
      // UI log-row id — must be unique. Use the Web Crypto UUID unconditionally;
      // an environment without `crypto.randomUUID` is broken/sandboxed and should
      // fail loudly rather than silently weaken the id (consistent with webRandom.ts).
      if (typeof globalThis.crypto?.randomUUID !== 'function') {
        throw new Error('crypto.randomUUID is unavailable in this environment.');
      }
      setLogs((prev) => [
        ...prev,
        {
          id: globalThis.crypto.randomUUID(),
          timestamp: timeStr,
          level,
          message,
        },
      ]);
    },
    [lang],
  );

  const runFullDiagnostics = useCallback(async () => {
    setIsRunning(true);
    addLog(lang === 'ar' ? 'بدء الفحص التشخيصي الكامل للنظام...' : 'Starting full system diagnostic suite...', 'info');

    try {
      addLog(
        lang === 'ar' ? 'اختبار الاتصال بقاعدة بيانات PostgreSQL...' : 'Testing PostgreSQL database connection...',
        'info',
      );
      addLog(
        lang === 'ar' ? 'اختبار محرك المتجهات Qdrant Vector Engine...' : 'Testing Qdrant vector cluster connection...',
        'info',
      );
      addLog(
        lang === 'ar'
          ? 'المصادقة مع واجهة Mistral Document AI API...'
          : 'Authenticating with Mistral Document AI API...',
        'info',
      );

      const res = await fetchWithAuth('/api/v1/diagnostics');
      if (res.ok) {
        const data = await res.json();
        setReport(data);
        setLastChecked(new Date().toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US'));

        // Log results
        const pg = data.diagnostics?.postgresql;
        if (pg?.status === 'connected') {
          addLog(
            lang === 'ar'
              ? `تم الاتصال بنجاح بـ PostgreSQL (${pg.latencyMs}ms) - الإصدار: ${pg.version} - الجداول النشطة: ${pg.activeTablesCount}`
              : `PostgreSQL connected successfully (${pg.latencyMs}ms) - Version: ${pg.version} - Tables: ${pg.activeTablesCount}`,
            'success',
          );
        } else {
          addLog(
            lang === 'ar'
              ? `فشل الاتصال بـ PostgreSQL: ${pg?.message || 'غير معروف'}`
              : `PostgreSQL connection issue: ${pg?.message || 'Unknown error'}`,
            'warn',
          );
        }

        const qd = data.diagnostics?.qdrant;
        if (qd?.status === 'connected') {
          addLog(
            lang === 'ar'
              ? `تم الاتصال بمحرك Qdrant (${qd.latencyMs}ms) - مجموعة البيانات: omnirag_chunks (${qd.collectionInfo?.pointsCount || 0} متجهات)`
              : `Qdrant cluster connected (${qd.latencyMs}ms) - Collection: omnirag_chunks (${qd.collectionInfo?.pointsCount || 0} vectors)`,
            'success',
          );
        } else {
          addLog(
            lang === 'ar'
              ? `تنبيه محرك المتجهات Qdrant: ${qd?.message || 'غير متصل'}`
              : `Qdrant vector engine alert: ${qd?.message || 'Disconnected'}`,
            'warn',
          );
        }

        const ms = data.diagnostics?.mistral;
        if (ms?.status === 'connected') {
          addLog(
            lang === 'ar'
              ? `تمت مصادقة Mistral API بنجاح (${ms.latencyMs}ms) - عدد النماذج المتاحة: ${ms.modelsCount}`
              : `Mistral API authenticated successfully (${ms.latencyMs}ms) - Models available: ${ms.modelsCount}`,
            'success',
          );
        } else {
          addLog(
            lang === 'ar'
              ? `تنبيه Mistral Document AI: ${ms?.message || 'فشل المصادقة'}`
              : `Mistral Document AI alert: ${ms?.message || 'Authentication failed'}`,
            'warn',
          );
        }

        addLog(
          lang === 'ar'
            ? `اكتمل الفحص التشخيصي بنجاح! نسبة الجاهزية للإنتاج: ${data.readinessScore}%`
            : `Diagnostics finished! Production Readiness Score: ${data.readinessScore}%`,
          'success',
        );
      } else {
        addLog(
          lang === 'ar' ? 'تعذر جلب تقرير التشخيص من الخادم' : 'Failed to retrieve diagnostic report from server',
          'error',
        );
      }
    } catch (err: any) {
      addLog(lang === 'ar' ? `خطأ أثناء التشخيص: ${err.message}` : `Diagnostic error: ${err.message}`, 'error');
    } finally {
      setIsRunning(false);
    }
  }, [addLog, lang]);

  const testSingleTarget = async (target: 'postgres' | 'qdrant' | 'mistral') => {
    setTestingTarget(target);
    const label = target === 'postgres' ? 'PostgreSQL' : target === 'qdrant' ? 'Qdrant' : 'Mistral API';
    addLog(lang === 'ar' ? `جاري اختبار اتصال ${label} منفصلاً...` : `Re-testing connection for ${label}...`, 'info');

    try {
      const res = await fetchWithAuth('/api/v1/diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });

      if (res.ok) {
        const data = await res.json();
        const singleResult = data.result?.[target === 'postgres' ? 'postgresql' : target];

        if (singleResult) {
          setReport((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              diagnostics: {
                ...prev.diagnostics,
                [target === 'postgres' ? 'postgresql' : target]: singleResult,
              },
            };
          });

          if (singleResult.status === 'connected') {
            addLog(
              lang === 'ar'
                ? `اختبار ${label} ناجح! زمن الاستجابة: ${singleResult.latencyMs}ms`
                : `${label} re-test succeeded! Latency: ${singleResult.latencyMs}ms`,
              'success',
            );
          } else {
            addLog(
              lang === 'ar'
                ? `فشل اختبار ${label}: ${singleResult.message}`
                : `${label} re-test failed: ${singleResult.message}`,
              'error',
            );
          }
        }
      }
    } catch (err: any) {
      addLog(
        lang === 'ar' ? `خطأ أثناء إعادة اختبار ${label}: ${err.message}` : `Error re-testing ${label}: ${err.message}`,
        'error',
      );
    } finally {
      setTestingTarget(null);
    }
  };

  useEffect(() => {
    if (autoRunOnMount) {
      runFullDiagnostics();
    }
  }, [autoRunOnMount, runFullDiagnostics]);

  const exportReportJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OmniRAG-Diagnostic-Report-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyLogText = () => {
    const text = logs.map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const t = {
    ar: {
      title: 'أداة التشخيص والتحقق من الخدمات',
      desc: 'فحص الاتصال الفعلي بقاعدة بيانات PostgreSQL، ومحرك المتجهات Qdrant، وواجهة Mistral API للتأكد من مطابقة البيئة الإنتاجية.',
      runButton: 'تشغيل الفحص التشخيصي',
      running: 'جاري إجراء الاتصالات...',
      exportReport: 'تصدير التقرير JSON',
      lastCheckedAt: 'آخر فحص:',
      readinessScore: 'نسبة جاهزية البيئة الإنتاجية',
      connectionsTab: 'الاتصالات والخدمات',
      environmentTab: 'تدقيق متغيرات البيئة',
      logsTab: 'سجل الفحص المباشر',
      postgresTitle: 'قاعدة بيانات PostgreSQL',
      qdrantTitle: 'محرك المتجهات Qdrant',
      mistralTitle: 'واجهة Mistral Document AI',
      statusConnected: 'متصل وجاهز',
      statusDisconnected: 'غير متصل',
      statusMissingConfig: 'غير مكون بملف البيئة',
      statusAuthFailed: 'خطأ في المصادقة',
      latency: 'زمن الاستجابة',
      databaseName: 'اسم قاعدة البيانات',
      activeTables: 'الجداول النشطة',
      vectorCollection: 'مجموعة المتجهات',
      pointsCount: 'عدد المتجهات',
      vectorDimensions: 'أبعاد المتجه',
      availableModels: 'النماذج المتاحة',
      maskedEndpoint: 'عنوان الخدمة المشفر',
      maskedApiKey: 'مفتاح الوصول المشفر',
      retest: 'إعادة الاختبار',
      envVarName: 'اسم المتغير',
      envCategory: 'التصنيف',
      envStatus: 'الحالة ببيئة التشغيل',
      envPreview: 'المعيار / القيمة المشفرة',
      envRequired: 'مطلوب للإنتاج',
    },
    en: {
      title: 'Production Connection Diagnostic Utility',
      desc: 'Live connection verification for PostgreSQL, Qdrant Vector DB, and Mistral Document AI API, ensuring production credentials are correctly read.',
      runButton: 'Run Full Diagnostics',
      running: 'Running Diagnostics...',
      exportReport: 'Export JSON Report',
      lastCheckedAt: 'Last checked:',
      readinessScore: 'Production Readiness Score',
      connectionsTab: 'Service Connections',
      environmentTab: 'Environment Audit',
      logsTab: 'Live Execution Stream',
      postgresTitle: 'PostgreSQL Database',
      qdrantTitle: 'Qdrant Vector Engine',
      mistralTitle: 'Mistral Document AI API',
      statusConnected: 'Connected & Healthy',
      statusDisconnected: 'Disconnected',
      statusMissingConfig: 'Missing Config',
      statusAuthFailed: 'Authentication Failed',
      latency: 'Latency',
      databaseName: 'Database Name',
      activeTables: 'Active Tables',
      vectorCollection: 'Vector Collection',
      pointsCount: 'Indexed Vectors',
      vectorDimensions: 'Vector Dimensions',
      availableModels: 'Available Models',
      maskedEndpoint: 'Masked Endpoint',
      maskedApiKey: 'Masked Credentials',
      retest: 'Re-test',
      envVarName: 'Variable Name',
      envCategory: 'Category',
      envStatus: 'Status',
      envPreview: 'Value Preview',
      envRequired: 'Required',
    },
  }[lang];

  const pg = report?.diagnostics?.postgresql;
  const qd = report?.diagnostics?.qdrant;
  const ms = report?.diagnostics?.mistral;
  const score = report?.readinessScore ?? 0;

  return (
    <div className={`space-y-6 ${lang === 'ar' ? 'font-arabic' : ''}`} id="diagnostic-utility-root">
      {/* Header Banner */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-white shadow-md relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-bold border border-indigo-500/20">
              <Activity className="w-3.5 h-3.5 animate-pulse text-indigo-400" />
              <span>{lang === 'ar' ? 'بيئة التشغيل والإنتاج' : 'Runtime Environment Health'}</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-2.5">
              <Server className="w-6 h-6 text-cyan-400" />
              {t.title}
            </h2>
            <p className="text-slate-300 text-xs leading-relaxed">{t.desc}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={runFullDiagnostics}
              disabled={isRunning}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition shadow-md cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
              {isRunning ? t.running : t.runButton}
            </button>

            {report && (
              <button
                onClick={exportReportJson}
                className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer"
              >
                <Download className="w-4 h-4" />
                {t.exportReport}
              </button>
            )}
          </div>
        </div>

        {/* Readiness Score Bar */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
          <div className="md:col-span-2 space-y-1.5">
            <div className="flex justify-between items-center text-xs font-bold">
              <span className="text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                {t.readinessScore}
              </span>
              <span className="text-cyan-400 font-mono text-sm">{score}%</span>
            </div>
            <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  score >= 85
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                    : score >= 50
                      ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                      : 'bg-gradient-to-r from-rose-600 to-rose-400'
                }`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <Clock className="w-4 h-4 text-slate-500 shrink-0" />
            <span>
              {t.lastCheckedAt} <strong className="text-slate-200">{lastChecked || '—'}</strong>
            </span>
          </div>

          <div className="flex justify-end">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold border inline-flex items-center gap-1.5 ${
                report?.overallStatus === 'healthy'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  report?.overallStatus === 'healthy' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              {report?.overallStatus === 'healthy'
                ? lang === 'ar'
                  ? 'البيئة تعمل بكفاءة'
                  : 'Operational & Ready'
                : lang === 'ar'
                  ? 'تحذير في إحدى الخدمات'
                  : 'Degraded State'}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('connections')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'connections'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
          }`}
        >
          <Database className="w-4 h-4" />
          {t.connectionsTab}
        </button>

        <button
          onClick={() => setActiveTab('environment')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'environment'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
          }`}
        >
          <Key className="w-4 h-4" />
          {t.environmentTab}
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'logs'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
          }`}
        >
          <Terminal className="w-4 h-4" />
          {t.logsTab}
          {logs.length > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full bg-indigo-800 text-white text-[10px] font-mono">
              {logs.length}
            </span>
          )}
        </button>
      </div>

      {/* TAB CONTENT: CONNECTIONS */}
      {activeTab === 'connections' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* PostgreSQL Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 rounded-xl bg-cyan-50 text-cyan-600 border border-cyan-100">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">{t.postgresTitle}</h3>
                    <p className="text-[11px] text-slate-500 font-mono">Lexical & Metadata Storage</p>
                  </div>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold border shrink-0 flex items-center gap-1 ${
                    pg?.status === 'connected'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : pg?.status === 'missing_config'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                  }`}
                >
                  {pg?.status === 'connected' ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 text-amber-600" />
                  )}
                  {pg?.status === 'connected'
                    ? t.statusConnected
                    : pg?.status === 'missing_config'
                      ? t.statusMissingConfig
                      : t.statusDisconnected}
                </span>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed min-h-[36px]">{pg?.message || '—'}</p>

              <div className="space-y-2 pt-2 border-t border-slate-100 text-xs font-mono">
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t.latency}:</span>
                  <span className="font-bold text-slate-800">{pg?.latencyMs ?? 0} ms</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t.databaseName}:</span>
                  <span className="font-bold text-slate-800">{pg?.databaseName || '—'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t.activeTables}:</span>
                  <span className="font-bold text-indigo-600">{pg?.activeTablesCount ?? 0}</span>
                </div>
                {pg?.maskedUrl && (
                  <div className="py-1">
                    <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">{t.maskedEndpoint}:</span>
                    <span className="text-[10px] bg-slate-50 p-1.5 rounded border border-slate-200 block truncate text-slate-600">
                      {pg.maskedUrl}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => testSingleTarget('postgres')}
              disabled={testingTarget === 'postgres'}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testingTarget === 'postgres' ? 'animate-spin' : ''}`} />
              {t.retest}
            </button>
          </div>

          {/* Qdrant Vector DB Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 rounded-xl bg-violet-50 text-violet-600 border border-violet-100">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">{t.qdrantTitle}</h3>
                    <p className="text-[11px] text-slate-500 font-mono">Vector Semantic Index</p>
                  </div>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold border shrink-0 flex items-center gap-1 ${
                    qd?.status === 'connected'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : qd?.status === 'missing_config'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                  }`}
                >
                  {qd?.status === 'connected' ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 text-amber-600" />
                  )}
                  {qd?.status === 'connected'
                    ? t.statusConnected
                    : qd?.status === 'missing_config'
                      ? t.statusMissingConfig
                      : t.statusDisconnected}
                </span>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed min-h-[36px]">{qd?.message || '—'}</p>

              <div className="space-y-2 pt-2 border-t border-slate-100 text-xs font-mono">
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t.latency}:</span>
                  <span className="font-bold text-slate-800">{qd?.latencyMs ?? 0} ms</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t.vectorCollection}:</span>
                  <span className="font-bold text-indigo-600">omnirag_chunks</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t.pointsCount}:</span>
                  <span className="font-bold text-slate-800">{qd?.collectionInfo?.pointsCount ?? 0}</span>
                </div>
                {qd?.maskedUrl && (
                  <div className="py-1">
                    <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">{t.maskedEndpoint}:</span>
                    <span className="text-[10px] bg-slate-50 p-1.5 rounded border border-slate-200 block truncate text-slate-600">
                      {qd.maskedUrl}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => testSingleTarget('qdrant')}
              disabled={testingTarget === 'qdrant'}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testingTarget === 'qdrant' ? 'animate-spin' : ''}`} />
              {t.retest}
            </button>
          </div>

          {/* Mistral API Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">{t.mistralTitle}</h3>
                    <p className="text-[11px] text-slate-500 font-mono">OCR & Document AI Parsing</p>
                  </div>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold border shrink-0 flex items-center gap-1 ${
                    ms?.status === 'connected'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : ms?.status === 'missing_config'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                  }`}
                >
                  {ms?.status === 'connected' ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 text-amber-600" />
                  )}
                  {ms?.status === 'connected'
                    ? t.statusConnected
                    : ms?.status === 'missing_config'
                      ? t.statusMissingConfig
                      : t.statusAuthFailed}
                </span>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed min-h-[36px]">{ms?.message || '—'}</p>

              <div className="space-y-2 pt-2 border-t border-slate-100 text-xs font-mono">
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t.latency}:</span>
                  <span className="font-bold text-slate-800">{ms?.latencyMs ?? 0} ms</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t.availableModels}:</span>
                  <span className="font-bold text-emerald-600">{ms?.modelsCount ?? 0} models</span>
                </div>
                {ms?.maskedApiKey && (
                  <div className="py-1">
                    <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">{t.maskedApiKey}:</span>
                    <span className="text-[10px] bg-slate-50 p-1.5 rounded border border-slate-200 block truncate text-slate-600">
                      {ms.maskedApiKey}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => testSingleTarget('mistral')}
              disabled={testingTarget === 'mistral'}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testingTarget === 'mistral' ? 'animate-spin' : ''}`} />
              {t.retest}
            </button>
          </div>
        </div>
      )}

      {/* TAB CONTENT: ENVIRONMENT AUDIT */}
      {activeTab === 'environment' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="w-5 h-5 text-indigo-600" />
              <h3 className="font-bold text-slate-900 text-sm">
                {lang === 'ar' ? 'تدقيق متغيرات البيئة بملف .env.example' : 'Environment Variables Audit Matrix'}
              </h3>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {report?.envAudit?.filter((e: any) => e.present).length || 0} / {report?.envAudit?.length || 0}{' '}
              {lang === 'ar' ? 'مكوّن ببيئة الخادم' : 'Configured'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left rtl:text-right text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/60 text-slate-500 font-bold">
                  <th className="py-3 px-4">{t.envVarName}</th>
                  <th className="py-3 px-4">{t.envCategory}</th>
                  <th className="py-3 px-4">{t.envStatus}</th>
                  <th className="py-3 px-4">{t.envPreview}</th>
                  <th className="py-3 px-4 text-center">{t.envRequired}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {report?.envAudit?.map((v: any) => (
                  <tr key={v.name} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-4 font-bold text-slate-900">{v.name}</td>
                    <td className="py-3 px-4 text-slate-600 font-sans">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">
                        {v.category}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          v.present
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {v.present ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            {lang === 'ar' ? 'موجود ومتوفر' : 'Configured'}
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3 text-rose-600" />
                            {lang === 'ar' ? 'غير معرف' : 'Missing'}
                          </>
                        )}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600 text-[11px] max-w-xs truncate">{v.preview}</td>
                    <td className="py-3 px-4 text-center">
                      {v.required ? (
                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 font-sans">
                          {lang === 'ar' ? 'إجباري' : 'Required'}
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-slate-400 font-sans">
                          {lang === 'ar' ? 'اختياري' : 'Optional'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT: LOGS */}
      {activeTab === 'logs' && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow-inner text-slate-200 font-mono text-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-slate-400">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-cyan-400" />
              <span className="font-bold text-slate-300">Live Diagnostic Terminal Stream</span>
            </div>
            <button
              onClick={copyLogText}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-sans flex items-center gap-1 transition cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy Logs'}
            </button>
          </div>

          <div className="h-64 overflow-y-auto space-y-1.5 pr-2 font-mono text-[11px]">
            {logs.length === 0 ? (
              <p className="text-slate-600 italic py-4 text-center">No diagnostic logs generated yet.</p>
            ) : (
              logs.map((l) => (
                <div key={l.id} className="flex items-start gap-2 leading-relaxed">
                  <span className="text-slate-500 shrink-0">[{l.timestamp}]</span>
                  <span
                    className={`font-bold shrink-0 uppercase text-[10px] px-1 rounded ${
                      l.level === 'success'
                        ? 'bg-emerald-900/60 text-emerald-400'
                        : l.level === 'error'
                          ? 'bg-rose-900/60 text-rose-400'
                          : l.level === 'warn'
                            ? 'bg-amber-900/60 text-amber-400'
                            : 'bg-indigo-900/60 text-indigo-300'
                    }`}
                  >
                    {l.level}
                  </span>
                  <span
                    className={
                      l.level === 'success'
                        ? 'text-emerald-300'
                        : l.level === 'error'
                          ? 'text-rose-300'
                          : l.level === 'warn'
                            ? 'text-amber-300'
                            : 'text-slate-300'
                    }
                  >
                    {l.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
