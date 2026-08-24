'use client';

import React from 'react';
import { SyncLogEntry, SourceConnector } from '@/lib/types/omnirag';
import { CheckCircle2, AlertTriangle, XCircle, Clock, Database, RefreshCw } from 'lucide-react';
import { Modal, ModalCloseButton } from '@/components/ui/Modal';

interface SyncLogModalProps {
  source: SourceConnector;
  logs: SyncLogEntry[];
  lang: 'ar' | 'en';
  onClose: () => void;
  onSyncNow: () => void;
}

export function SyncLogModal({ source, logs, lang, onClose, onSyncNow }: SyncLogModalProps) {
  const sourceLogs = logs.filter((l) => l.sourceId === source.id);
  const isRtl = lang === 'ar';

  return (
    <Modal open onClose={onClose} maxWidthClass="max-w-2xl" ariaLabelledBy="sync-log-modal-title">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 p-6 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h3 id="sync-log-modal-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
              {isRtl ? `سجل المزامنة والاستيعاب: ${source.name}` : `Sync History: ${source.name}`}
            </h3>
            <p className="text-xs text-slate-500 font-mono">
              Schedule: {source.syncSchedule} | Documents: {source.documentCount}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onSyncNow}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isRtl ? 'تشغيل المزامنة الآن' : 'Sync Now'}</span>
          </button>
          <ModalCloseButton onClose={onClose} label={isRtl ? 'إغلاق' : 'Close'} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1 p-6 pt-4">
        {sourceLogs.length > 0 ? (
          sourceLogs.map((log) => (
            <div
              key={log.id}
              className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 flex items-start gap-3.5 text-xs"
            >
              <div className="shrink-0 mt-0.5">
                {log.status === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                {log.status === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500" />}
                {log.status === 'failed' && <XCircle className="w-5 h-5 text-rose-500" />}
              </div>

              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 dark:text-slate-100">{log.message}</span>
                  <span className="text-[11px] text-slate-400 font-mono shrink-0">
                    {new Date(log.timestamp).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-[11px] text-slate-500 pt-1 font-mono">
                  <span className="flex items-center gap-1">
                    <Database className="w-3 h-3 text-indigo-500" />
                    {log.itemsProcessed} {isRtl ? 'سجل/مستند' : 'records'}
                  </span>
                  <span>{isRtl ? `استغرق ${log.durationMs} م.ث` : `Duration: ${log.durationMs}ms`}</span>
                  <span
                    className={`uppercase font-bold px-1.5 py-0.5 rounded text-[10px] ${
                      log.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {log.status}
                  </span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-dashed border-slate-200">
            {isRtl ? 'لا توجد سجلات مزامنة سابقة لهذا المصدر.' : 'No sync logs available for this source yet.'}
          </div>
        )}
      </div>

      <div className="p-6 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="py-2 px-5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
        >
          {isRtl ? 'إغلاق' : 'Close'}
        </button>
      </div>
    </Modal>
  );
}
