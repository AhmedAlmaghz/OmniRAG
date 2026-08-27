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
import { t } from '@/lib/i18n';

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
    addLog(t(lang, 'diag.logStarting'), 'info');

    try {
      addLog(t(lang, 'diag.logTestPg'), 'info');
      addLog(t(lang, 'diag.logTestQd'), 'info');
      addLog(t(lang, 'diag.logTestMs'), 'info');

      const res = await fetchWithAuth('/api/v1/diagnostics');
      if (res.ok) {
        const data = await res.json();
        setReport(data);
        setLastChecked(new Date().toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US'));

        // Log results
        const pg = data.diagnostics?.postgresql;
        if (pg?.status === 'connected') {
          addLog(
            t(lang, 'diag.logPgConnected', {
              latency: pg.latencyMs,
              version: pg.version,
              tables: pg.activeTablesCount,
            }),
            'success',
          );
        } else {
          addLog(t(lang, 'diag.logPgIssue', { message: pg?.message || t(lang, 'diag.unknownError') }), 'warn');
        }

        const qd = data.diagnostics?.qdrant;
        if (qd?.status === 'connected') {
          addLog(
            t(lang, 'diag.logQdConnected', { latency: qd.latencyMs, points: qd.collectionInfo?.pointsCount || 0 }),
            'success',
          );
        } else {
          addLog(t(lang, 'diag.logQdAlert', { message: qd?.message || t(lang, 'diag.disconnected') }), 'warn');
        }

        const ms = data.diagnostics?.mistral;
        if (ms?.status === 'connected') {
          addLog(t(lang, 'diag.logMsAuthenticated', { latency: ms.latencyMs, models: ms.modelsCount }), 'success');
        } else {
          addLog(t(lang, 'diag.logMsAlert', { message: ms?.message || t(lang, 'diag.authFailed') }), 'warn');
        }

        addLog(t(lang, 'diag.logFinished', { score: data.readinessScore }), 'success');
      } else {
        addLog(t(lang, 'diag.logFetchFailed'), 'error');
      }
    } catch (err: any) {
      addLog(t(lang, 'diag.logError', { error: err.message }), 'error');
    } finally {
      setIsRunning(false);
    }
  }, [addLog, lang]);

  const testSingleTarget = async (target: 'postgres' | 'qdrant' | 'mistral') => {
    setTestingTarget(target);
    const label = target === 'postgres' ? 'PostgreSQL' : target === 'qdrant' ? 'Qdrant' : 'Mistral API';
    addLog(t(lang, 'diag.logRetesting', { label }), 'info');

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
            addLog(t(lang, 'diag.logRetestOk', { label, latency: singleResult.latencyMs }), 'success');
          } else {
            addLog(t(lang, 'diag.logRetestFailed', { label, message: singleResult.message }), 'error');
          }
        }
      }
    } catch (err: any) {
      addLog(t(lang, 'diag.logRetestError', { label, error: err.message }), 'error');
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
              <span>{t(lang, 'diag.badgeTitle')}</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-2.5">
              <Server className="w-6 h-6 text-cyan-400" />
              {t(lang, 'diag.title')}
            </h2>
            <p className="text-slate-300 text-xs leading-relaxed">{t(lang, 'diag.desc')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={runFullDiagnostics}
              disabled={isRunning}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition shadow-md cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
              {t(lang, isRunning ? 'diag.running' : 'diag.runButton')}
            </button>

            {report && (
              <button
                onClick={exportReportJson}
                className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer"
              >
                <Download className="w-4 h-4" />
                {t(lang, 'diag.exportReport')}
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
                {t(lang, 'diag.readinessScore')}
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
              {t(lang, 'diag.lastCheckedAt')} <strong className="text-slate-200">{lastChecked || '—'}</strong>
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
              {t(lang, report?.overallStatus === 'healthy' ? 'diag.opReady' : 'diag.degradedState')}
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
          {t(lang, 'diag.connectionsTab')}
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
          {t(lang, 'diag.environmentTab')}
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
          {t(lang, 'diag.logsTab')}
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
                    <h3 className="font-bold text-slate-900 text-sm">{t(lang, 'diag.postgresTitle')}</h3>
                    <p className="text-[11px] text-slate-500 font-mono">{t(lang, 'diag.pgSubtitle')}</p>
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
                    ? t(lang, 'diag.statusConnected')
                    : pg?.status === 'missing_config'
                      ? t(lang, 'diag.statusMissingConfig')
                      : t(lang, 'diag.statusDisconnected')}
                </span>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed min-h-[36px]">{pg?.message || '—'}</p>

              <div className="space-y-2 pt-2 border-t border-slate-100 text-xs font-mono">
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t(lang, 'diag.latency')}:</span>
                  <span className="font-bold text-slate-800">{pg?.latencyMs ?? 0} ms</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t(lang, 'diag.databaseName')}:</span>
                  <span className="font-bold text-slate-800">{pg?.databaseName || '—'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t(lang, 'diag.activeTables')}:</span>
                  <span className="font-bold text-indigo-600">{pg?.activeTablesCount ?? 0}</span>
                </div>
                {pg?.maskedUrl && (
                  <div className="py-1">
                    <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">
                      {t(lang, 'diag.maskedEndpoint')}:
                    </span>
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
              {t(lang, 'diag.retest')}
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
                    <h3 className="font-bold text-slate-900 text-sm">{t(lang, 'diag.qdrantTitle')}</h3>
                    <p className="text-[11px] text-slate-500 font-mono">{t(lang, 'diag.qdSubtitle')}</p>
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
                    ? t(lang, 'diag.statusConnected')
                    : qd?.status === 'missing_config'
                      ? t(lang, 'diag.statusMissingConfig')
                      : t(lang, 'diag.statusDisconnected')}
                </span>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed min-h-[36px]">{qd?.message || '—'}</p>

              <div className="space-y-2 pt-2 border-t border-slate-100 text-xs font-mono">
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t(lang, 'diag.latency')}:</span>
                  <span className="font-bold text-slate-800">{qd?.latencyMs ?? 0} ms</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t(lang, 'diag.vectorCollection')}:</span>
                  <span className="font-bold text-indigo-600">omnirag_chunks</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t(lang, 'diag.pointsCount')}:</span>
                  <span className="font-bold text-slate-800">{qd?.collectionInfo?.pointsCount ?? 0}</span>
                </div>
                {qd?.maskedUrl && (
                  <div className="py-1">
                    <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">
                      {t(lang, 'diag.maskedEndpoint')}:
                    </span>
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
              {t(lang, 'diag.retest')}
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
                    <h3 className="font-bold text-slate-900 text-sm">{t(lang, 'diag.mistralTitle')}</h3>
                    <p className="text-[11px] text-slate-500 font-mono">{t(lang, 'diag.msSubtitle')}</p>
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
                    ? t(lang, 'diag.statusConnected')
                    : ms?.status === 'missing_config'
                      ? t(lang, 'diag.statusMissingConfig')
                      : t(lang, 'diag.statusAuthFailed')}
                </span>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed min-h-[36px]">{ms?.message || '—'}</p>

              <div className="space-y-2 pt-2 border-t border-slate-100 text-xs font-mono">
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t(lang, 'diag.latency')}:</span>
                  <span className="font-bold text-slate-800">{ms?.latencyMs ?? 0} ms</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50 text-slate-600">
                  <span className="text-slate-400 font-sans">{t(lang, 'diag.availableModels')}:</span>
                  <span className="font-bold text-emerald-600">
                    {t(lang, 'diag.modelsCount', { count: ms?.modelsCount ?? 0 })}
                  </span>
                </div>
                {ms?.maskedApiKey && (
                  <div className="py-1">
                    <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">
                      {t(lang, 'diag.maskedApiKey')}:
                    </span>
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
              {t(lang, 'diag.retest')}
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
              <h3 className="font-bold text-slate-900 text-sm">{t(lang, 'diag.envAuditTitle')}</h3>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {report?.envAudit?.filter((e: any) => e.present).length || 0} / {report?.envAudit?.length || 0}{' '}
              {t(lang, 'diag.envConfiguredWord')}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left rtl:text-right text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/60 text-slate-500 font-bold">
                  <th className="py-3 px-4">{t(lang, 'diag.envVarName')}</th>
                  <th className="py-3 px-4">{t(lang, 'diag.envCategory')}</th>
                  <th className="py-3 px-4">{t(lang, 'diag.envStatus')}</th>
                  <th className="py-3 px-4">{t(lang, 'diag.envPreview')}</th>
                  <th className="py-3 px-4 text-center">{t(lang, 'diag.envRequired')}</th>
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
                            {t(lang, 'diag.envPresent')}
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3 text-rose-600" />
                            {t(lang, 'diag.envMissing')}
                          </>
                        )}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600 text-[11px] max-w-xs truncate">{v.preview}</td>
                    <td className="py-3 px-4 text-center">
                      {v.required ? (
                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 font-sans">
                          {t(lang, 'diag.envRequiredYes')}
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-slate-400 font-sans">
                          {t(lang, 'diag.envOptional')}
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
              <span className="font-bold text-slate-300">{t(lang, 'diag.logStreamTitle')}</span>
            </div>
            <button
              onClick={copyLogText}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-sans flex items-center gap-1 transition cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {t(lang, copied ? 'diag.copiedLogs' : 'diag.copyLogsBtn')}
            </button>
          </div>

          <div className="h-64 overflow-y-auto space-y-1.5 pr-2 font-mono text-[11px]">
            {logs.length === 0 ? (
              <p className="text-slate-600 italic py-4 text-center">{t(lang, 'diag.noLogsYet')}</p>
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
