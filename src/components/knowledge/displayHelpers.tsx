'use client';

import React from 'react';
import { Globe, MonitorPlay, FolderGit2, Database, Server, Rss, Mail, FileText, HardDrive, Plug } from 'lucide-react';
import { SourceStatus, SourceType } from '@/lib/types/omnirag';

/**
 * Shared display mappings for knowledge-source UI.
 *
 * Source-type→icon and connector-status→pill styling were re-implemented five
 * times across KnowledgeBase, SourcesDashboard (deleted), DocumentCard and the
 * preview modal — each drifting in color/label. This module is now the single
 * source of truth.
 */

export function getSourceTypeIcon(type: SourceType | string): { Icon: React.ElementType; className: string } {
  switch (type) {
    case 'youtube':
      return { Icon: MonitorPlay, className: 'text-rose-600' };
    case 'url':
      return { Icon: Globe, className: 'text-blue-600' };
    case 'github':
      return { Icon: FolderGit2, className: 'text-slate-800' };
    case 'database':
      return { Icon: Database, className: 'text-amber-600' };
    case 'rss':
      return { Icon: Rss, className: 'text-orange-500' };
    case 'email':
      return { Icon: Mail, className: 'text-cyan-600' };
    case 'file':
      return { Icon: FileText, className: 'text-indigo-600' };
    case 'gdrive':
    case 'notion':
    case 'confluence':
      return { Icon: HardDrive, className: 'text-emerald-600' };
    default:
      return { Icon: Server, className: 'text-violet-600' };
  }
}

const CONNECTOR_STATUS_STYLES: Record<string, { style: string; labelAr: string; labelEn: string; pulse?: boolean }> = {
  healthy: { style: 'bg-emerald-50 text-emerald-700 border-emerald-200', labelAr: 'سليم', labelEn: 'HEALTHY' },
  syncing: {
    style: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    labelAr: 'يزامن',
    labelEn: 'SYNCING',
    pulse: true,
  },
  degraded: { style: 'bg-amber-50 text-amber-700 border-amber-200', labelAr: 'متدهور', labelEn: 'DEGRADED' },
  error: { style: 'bg-rose-50 text-rose-700 border-rose-200', labelAr: 'خطأ', labelEn: 'ERROR' },
  paused: { style: 'bg-slate-100 text-slate-600 border-slate-200', labelAr: 'متوقف', labelEn: 'PAUSED' },
};

/** Status pill reflecting the REAL connector state (healthy/syncing/degraded/error/paused). */
export function ConnectorStatusPill({ status, isRtl }: { status: SourceStatus | string; isRtl: boolean }) {
  const key = status || 'healthy';
  const conf = CONNECTOR_STATUS_STYLES[key] ?? CONNECTOR_STATUS_STYLES.paused;
  return (
    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase font-mono ${conf.style}`}>
      {conf.pulse && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse mr-1 align-middle" />
      )}
      {isRtl ? conf.labelAr : conf.labelEn}
    </span>
  );
}

/** Fallback plug glyph used when a source type has no dedicated icon. */
export const UnknownSourceIcon = Plug;
