'use client';

import React, { useState, useEffect } from 'react';
import { Document, DocumentVersion } from '@/lib/types/omnirag';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  History,
  GitBranch,
  GitCommit,
  RotateCcw,
  Plus,
  CheckCircle2,
  AlertCircle,
  FileText,
  Layers,
  Clock,
  User,
  ArrowRight,
  ArrowLeft,
  Copy,
  Check,
  Sparkles,
  X,
  FileDiff,
  Eye,
  Edit3,
  Calendar,
} from 'lucide-react';

interface DocumentVersionHistoryModalProps {
  document: Document;
  tenantId: string;
  lang: 'ar' | 'en';
  onClose: () => void;
  onReverted: (updatedDoc: Document) => void;
}

export function DocumentVersionHistoryModal({
  document: initialDoc,
  tenantId,
  lang,
  onClose,
  onReverted,
}: DocumentVersionHistoryModalProps) {
  const isRtl = lang === 'ar';
  const [doc, setDoc] = useState<Document>(initialDoc);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [selectedVersionNum, setSelectedVersionNum] = useState<number>(doc.version || 1);
  const [compareWithCurrent, setCompareWithCurrent] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<'diff' | 'content' | 'new_version'>('diff');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isReverting, setIsReverting] = useState<boolean>(false);
  const [pendingRevertVersion, setPendingRevertVersion] = useState<DocumentVersion | null>(null);
  const [isSavingNewVer, setIsSavingNewVer] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New Version Form State
  const [newTitle, setNewTitle] = useState<string>(doc.title);
  const [newContent, setNewContent] = useState<string>(doc.content);
  const [changeSummary, setChangeSummary] = useState<string>('');
  const [authorName, setAuthorName] = useState<string>('OmniRAG Admin');

  // Load versions
  const fetchVersions = async () => {
    setIsLoading(true);
    try {
      const res = await fetchWithAuth(`/api/v1/documents/versions?documentId=${doc.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.versions && data.versions.length > 0) {
          const sorted = [...data.versions].sort((a, b) => b.versionNumber - a.versionNumber);
          setVersions(sorted);
          if (!selectedVersionNum || !sorted.some((v) => v.versionNumber === selectedVersionNum)) {
            setSelectedVersionNum(sorted[0].versionNumber);
          }
        }
      } else {
        // Fallback to local versions from doc object
        if (doc.versions && doc.versions.length > 0) {
          setVersions([...doc.versions].sort((a, b) => b.versionNumber - a.versionNumber));
        } else {
          setVersions([
            {
              id: `ver-${doc.id}-v1`,
              documentId: doc.id,
              versionNumber: doc.version || 1,
              title: doc.title,
              content: doc.content,
              chunkCount: doc.chunkCount || 0,
              createdAt: doc.createdAt,
              createdBy: 'Ingestion Engine',
              changeSummary: isRtl ? 'الإصدار الأولي المستوعب' : 'Initial Ingested Version',
            },
          ]);
        }
      }
    } catch (e) {
      console.error('Failed to fetch versions:', e);
      if (doc.versions && doc.versions.length > 0) {
        setVersions([...doc.versions].sort((a, b) => b.versionNumber - a.versionNumber));
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVersions();
  }, [doc.id]);

  const selectedVersion = versions.find((v) => v.versionNumber === selectedVersionNum) || versions[0];
  const currentActiveVersion = versions.find((v) => v.versionNumber === (doc.version || 1)) || versions[0];
  const isSelectedCurrent = selectedVersion?.versionNumber === (doc.version || 1);

  // Handle Revert — the ConfirmDialog gates the destructive action; the
  // actual API call happens in performRevert after the user confirms.
  const requestRevert = (targetVer: DocumentVersion) => {
    if (!targetVer || targetVer.versionNumber === doc.version) return;
    setPendingRevertVersion(targetVer);
  };

  const performRevert = async (targetVer: DocumentVersion) => {
    setIsReverting(true);
    setStatusMessage(null);

    try {
      const res = await fetchWithAuth('/api/v1/documents/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revert',
          documentId: doc.id,
          versionNumber: targetVer.versionNumber,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setDoc(data.document);
        setSelectedVersionNum(targetVer.versionNumber);
        if (data.versions) {
          setVersions(
            [...data.versions].sort((a: DocumentVersion, b: DocumentVersion) => b.versionNumber - a.versionNumber),
          );
        }
        setStatusMessage({
          type: 'success',
          text: isRtl
            ? `تم استرجاع المستند إلى الإصدار v${targetVer.versionNumber} بنجاح`
            : `Successfully restored to version v${targetVer.versionNumber}`,
        });
        onReverted(data.document);
      } else {
        setStatusMessage({
          type: 'error',
          text: data.error || (isRtl ? 'فشل استرجاع الإصدار' : 'Failed to revert version'),
        });
      }
    } catch (e: any) {
      console.error('Revert error:', e);
      setStatusMessage({
        type: 'error',
        text: e.message || (isRtl ? 'حدث خطأ أثناء الاسترجاع' : 'Error during revert'),
      });
    } finally {
      setIsReverting(false);
      setPendingRevertVersion(null);
    }
  };

  // Handle Create New Version
  const handleCreateNewVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) {
      setStatusMessage({
        type: 'error',
        text: isRtl ? 'محتوى المستند لا يمكن أن يكون فارغاً' : 'Document content cannot be empty',
      });
      return;
    }

    setIsSavingNewVer(true);
    setStatusMessage(null);

    try {
      const res = await fetchWithAuth('/api/v1/documents/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          documentId: doc.id,
          title: newTitle.trim() || doc.title,
          content: newContent,
          changeSummary:
            changeSummary.trim() || (isRtl ? 'تعديل محتوى وفهرسة جديدة' : 'Content update and re-indexing'),
          createdBy: authorName.trim() || 'Admin User',
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setDoc(data.document);
        setSelectedVersionNum(data.version.versionNumber);
        if (data.versions) {
          setVersions(
            [...data.versions].sort((a: DocumentVersion, b: DocumentVersion) => b.versionNumber - a.versionNumber),
          );
        }
        setViewMode('diff');
        setStatusMessage({
          type: 'success',
          text: isRtl
            ? `تم حفظ وفهرسة الإصدار v${data.version.versionNumber} بنجاح!`
            : `Version v${data.version.versionNumber} created and indexed successfully!`,
        });
        onReverted(data.document);
      } else {
        setStatusMessage({
          type: 'error',
          text: data.error || (isRtl ? 'فشل حفظ الإصدار الجديد' : 'Failed to save new version'),
        });
      }
    } catch (e: any) {
      console.error('Create version error:', e);
      setStatusMessage({
        type: 'error',
        text: e.message || (isRtl ? 'حدث خطأ أثناء حفظ الإصدار' : 'Error during version creation'),
      });
    } finally {
      setIsSavingNewVer(false);
    }
  };

  // Copy helper
  const handleCopyContent = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Diff Generator (Line by Line)
  const computeDiff = (oldText: string, newText: string) => {
    const oldLines = oldText ? oldText.split('\n') : [];
    const newLines = newText ? newText.split('\n') : [];

    const maxLen = Math.max(oldLines.length, newLines.length);
    const diffRows: Array<{
      type: 'added' | 'removed' | 'unchanged' | 'modified';
      oldLine?: string;
      newLine?: string;
      oldLineNum?: number;
      newLineNum?: number;
    }> = [];

    let addedCount = 0;
    let removedCount = 0;
    let unchangedCount = 0;

    let oIdx = 0;
    let nIdx = 0;

    while (oIdx < oldLines.length || nIdx < newLines.length) {
      const o = oldLines[oIdx];
      const n = newLines[nIdx];

      if (o === n) {
        diffRows.push({
          type: 'unchanged',
          oldLine: o,
          newLine: n,
          oldLineNum: oIdx + 1,
          newLineNum: nIdx + 1,
        });
        unchangedCount++;
        oIdx++;
        nIdx++;
      } else if (o !== undefined && n !== undefined) {
        // Line modified
        diffRows.push({
          type: 'modified',
          oldLine: o,
          newLine: n,
          oldLineNum: oIdx + 1,
          newLineNum: nIdx + 1,
        });
        removedCount++;
        addedCount++;
        oIdx++;
        nIdx++;
      } else if (o !== undefined && n === undefined) {
        diffRows.push({
          type: 'removed',
          oldLine: o,
          oldLineNum: oIdx + 1,
        });
        removedCount++;
        oIdx++;
      } else if (o === undefined && n !== undefined) {
        diffRows.push({
          type: 'added',
          newLine: n,
          newLineNum: nIdx + 1,
        });
        addedCount++;
        nIdx++;
      }
    }

    return { diffRows, addedCount, removedCount, unchangedCount };
  };

  const diffResult =
    selectedVersion && currentActiveVersion
      ? computeDiff(selectedVersion.content || '', currentActiveVersion.content || '')
      : { diffRows: [], addedCount: 0, removedCount: 0, unchangedCount: 0 };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="bg-white rounded-3xl border border-slate-200/80 shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden text-slate-900"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* MODAL HEADER */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-4 bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center border border-violet-100 shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-extrabold text-slate-950 truncate max-w-md">{doc.title}</h3>
                <span className="text-[10px] font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full border border-violet-200 font-mono">
                  {isRtl ? `الإصدار النشط v${doc.version || 1}` : `Active v${doc.version || 1}`}
                </span>
                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200 font-mono">
                  {versions.length} {isRtl ? 'إصدارات' : 'versions'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isRtl
                  ? 'تتبع التعديلات، مقارنة الفروقات الدقيقة، واسترجاع الإصدارات السابقة مع إعادة فهرسة المتجهات تلقائياً.'
                  : 'Track changes, inspect unified diffs, and revert to previous versions with automated vector re-indexing.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setNewTitle(doc.title);
                setNewContent(doc.content);
                setViewMode('new_version');
              }}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isRtl ? 'إصدار جديد' : 'New Version'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* STATUS BANNER */}
        {statusMessage && (
          <div
            className={`px-5 py-2.5 text-xs font-bold flex items-center justify-between gap-2 border-b shrink-0 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
            <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-slate-600 text-xs">
              ✕
            </button>
          </div>
        )}

        {/* MODAL MAIN CONTENT: SPLIT VIEW */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {/* LEFT/RIGHT SIDEBAR: VERSION TIMELINE (1/3 width) */}
          <div className="w-full md:w-80 border-b md:border-b-0 md:border-r border-slate-100 bg-slate-50/40 p-4 overflow-y-auto space-y-3 shrink-0">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
              <span className="text-[11px] font-extrabold uppercase text-slate-500 tracking-wider">
                {isRtl ? 'الخط الزمني للإصدارات' : 'Version History Timeline'}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {versions.length} {isRtl ? 'إصدار' : 'records'}
              </span>
            </div>

            {isLoading ? (
              <div className="space-y-2 py-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-3 bg-white rounded-xl border border-slate-200 animate-pulse space-y-2">
                    <div className="h-4 bg-slate-200 rounded w-1/2" />
                    <div className="h-3 bg-slate-100 rounded w-3/4" />
                  </div>
                ))}
              </div>
            ) : versions.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs">
                {isRtl ? 'لا توجد إصدارات مسجلة لهذا المستند.' : 'No version history recorded.'}
              </div>
            ) : (
              <div className="space-y-2">
                {versions.map((ver, idx) => {
                  const isCurrent = ver.versionNumber === (doc.version || 1);
                  const isSelected = ver.versionNumber === selectedVersionNum;

                  return (
                    <div
                      key={ver.id || `ver-${ver.versionNumber}`}
                      onClick={() => {
                        setSelectedVersionNum(ver.versionNumber);
                        if (viewMode === 'new_version') setViewMode('diff');
                      }}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer text-xs space-y-2 relative ${
                        isSelected
                          ? 'bg-white border-violet-500 shadow-sm ring-2 ring-violet-100'
                          : 'bg-white/80 hover:bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {/* Version Top Badge */}
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono flex items-center gap-1 ${
                              isCurrent
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}
                          >
                            <GitBranch className="w-3 h-3" />
                            <span>v{ver.versionNumber}</span>
                          </span>

                          {isCurrent && (
                            <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                              {isRtl ? 'الحالي' : 'Current'}
                            </span>
                          )}
                        </div>

                        <span className="text-[10px] text-slate-400 font-sans">
                          {new Date(ver.createdAt).toLocaleDateString(isRtl ? 'ar-SA' : 'en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>

                      {/* Change Summary */}
                      <p className="text-[11px] font-bold text-slate-800 line-clamp-2 leading-snug">
                        {ver.changeSummary || ver.title}
                      </p>

                      {/* Metadata row: author + chunk count */}
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                        <span className="flex items-center gap-1 truncate max-w-[140px]">
                          <User className="w-3 h-3 text-slate-400" />
                          <span className="truncate">{ver.createdBy || 'Admin'}</span>
                        </span>

                        <span className="flex items-center gap-1 font-mono text-indigo-600 font-bold">
                          <Layers className="w-2.5 h-2.5" />
                          <span>
                            {ver.chunkCount || 0} {isRtl ? 'مقطع' : 'chunks'}
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT/LEFT MAIN AREA: CONTENT / DIFF / NEW VERSION (2/3 width) */}
          <div className="flex-1 min-h-0 flex flex-col bg-white overflow-hidden">
            {/* View Mode Navigation Bar */}
            <div className="p-3 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setViewMode('diff')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'diff'
                      ? 'bg-white text-indigo-700 shadow-3xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <FileDiff className="w-3.5 h-3.5 text-indigo-600" />
                  <span>{isRtl ? 'مقارنة الفروقات (Diff)' : 'Diff Viewer'}</span>
                </button>

                <button
                  onClick={() => setViewMode('content')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'content'
                      ? 'bg-white text-indigo-700 shadow-3xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 text-slate-500" />
                  <span>{isRtl ? 'المحتوى التاريخي' : 'Snapshot Content'}</span>
                </button>

                <button
                  onClick={() => setViewMode('new_version')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'new_version'
                      ? 'bg-white text-indigo-700 shadow-3xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                  <span>{isRtl ? 'تحرير وإنشاء إصدار' : 'Editor'}</span>
                </button>
              </div>

              {/* Version Revert Action Header Button */}
              {selectedVersion && !isSelectedCurrent && viewMode !== 'new_version' && (
                <button
                  onClick={() => requestRevert(selectedVersion)}
                  disabled={isReverting}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isReverting ? 'animate-spin' : ''}`} />
                  <span>
                    {isRtl
                      ? `استرجاع إلى v${selectedVersion.versionNumber}`
                      : `Revert to v${selectedVersion.versionNumber}`}
                  </span>
                </button>
              )}
            </div>

            {/* VIEW MODE 1: DIFF VIEWER */}
            {viewMode === 'diff' && selectedVersion && (
              <div className="flex-1 overflow-y-auto p-5 space-y-4 font-mono text-xs">
                {/* Diff Summary Header Bar */}
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between gap-4 font-sans">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 font-medium">{isRtl ? 'مقارنة بين:' : 'Comparing:'}</span>
                    <span className="px-2 py-0.5 rounded-md bg-violet-100 text-violet-800 font-bold font-mono">
                      v{selectedVersion.versionNumber} ({selectedVersion.createdBy || 'Author'})
                    </span>
                    <span>⟷</span>
                    <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold font-mono">
                      v{doc.version || 1} ({isRtl ? 'النشط حالياً' : 'Active Current'})
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded border border-emerald-200 font-bold">
                      +{diffResult.addedCount} {isRtl ? 'إضافات' : 'added'}
                    </span>
                    <span className="px-2 py-0.5 bg-rose-50 text-rose-700 rounded border border-rose-200 font-bold">
                      -{diffResult.removedCount} {isRtl ? 'محذوفات' : 'removed'}
                    </span>
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200">
                      {diffResult.unchangedCount} {isRtl ? 'مطابق' : 'unchanged'}
                    </span>
                  </div>
                </div>

                {/* Diff Content Lines */}
                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-900 text-slate-100">
                  <div className="p-2.5 bg-slate-950 border-b border-slate-800 text-[11px] text-slate-400 flex items-center justify-between font-mono">
                    <span>{isRtl ? 'فروقات الأسطر والرموز (Unified Line Diff)' : 'Unified Line Diff'}</span>
                    <span>{selectedVersion.title}</span>
                  </div>

                  <div className="p-3 space-y-0.5 font-mono text-[11px] overflow-x-auto max-h-[50vh]">
                    {diffResult.diffRows.length === 0 ? (
                      <div className="py-8 text-center text-slate-400">
                        {isRtl ? 'لا توجد فروقات بين هذين الإصدارين.' : 'No text differences between these versions.'}
                      </div>
                    ) : (
                      diffResult.diffRows.map((row, idx) => {
                        if (row.type === 'unchanged') {
                          return (
                            <div
                              key={idx}
                              className="flex items-start gap-3 py-0.5 text-slate-400 hover:bg-slate-800/40 px-2 rounded"
                            >
                              <span className="w-8 text-slate-600 select-none text-right shrink-0">
                                {row.oldLineNum}
                              </span>
                              <span className="w-4 select-none text-slate-600 shrink-0"> </span>
                              <span className="break-all whitespace-pre-wrap">{row.oldLine}</span>
                            </div>
                          );
                        }

                        if (row.type === 'added') {
                          return (
                            <div
                              key={idx}
                              className="flex items-start gap-3 py-0.5 bg-emerald-950/50 text-emerald-300 border-l-2 border-emerald-500 px-2 rounded"
                            >
                              <span className="w-8 text-emerald-600 select-none text-right shrink-0">
                                {row.newLineNum}
                              </span>
                              <span className="w-4 select-none text-emerald-400 font-bold shrink-0">+</span>
                              <span className="break-all whitespace-pre-wrap">{row.newLine}</span>
                            </div>
                          );
                        }

                        if (row.type === 'removed') {
                          return (
                            <div
                              key={idx}
                              className="flex items-start gap-3 py-0.5 bg-rose-950/50 text-rose-300 border-l-2 border-rose-500 px-2 rounded"
                            >
                              <span className="w-8 text-rose-600 select-none text-right shrink-0">
                                {row.oldLineNum}
                              </span>
                              <span className="w-4 select-none text-rose-400 font-bold shrink-0">-</span>
                              <span className="break-all whitespace-pre-wrap line-through opacity-80">
                                {row.oldLine}
                              </span>
                            </div>
                          );
                        }

                        if (row.type === 'modified') {
                          return (
                            <React.Fragment key={idx}>
                              <div className="flex items-start gap-3 py-0.5 bg-rose-950/50 text-rose-300 border-l-2 border-rose-500 px-2 rounded">
                                <span className="w-8 text-rose-600 select-none text-right shrink-0">
                                  {row.oldLineNum}
                                </span>
                                <span className="w-4 select-none text-rose-400 font-bold shrink-0">-</span>
                                <span className="break-all whitespace-pre-wrap line-through opacity-80">
                                  {row.oldLine}
                                </span>
                              </div>
                              <div className="flex items-start gap-3 py-0.5 bg-emerald-950/50 text-emerald-300 border-l-2 border-emerald-500 px-2 rounded">
                                <span className="w-8 text-emerald-600 select-none text-right shrink-0">
                                  {row.newLineNum}
                                </span>
                                <span className="w-4 select-none text-emerald-400 font-bold shrink-0">+</span>
                                <span className="break-all whitespace-pre-wrap">{row.newLine}</span>
                              </div>
                            </React.Fragment>
                          );
                        }

                        return null;
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* VIEW MODE 2: SNAPSHOT CONTENT VIEWER */}
            {viewMode === 'content' && selectedVersion && (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">{selectedVersion.title}</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {isRtl
                        ? `تم الحفظ في: ${new Date(selectedVersion.createdAt).toLocaleString()}`
                        : `Saved at: ${new Date(selectedVersion.createdAt).toLocaleString()}`}
                    </p>
                  </div>

                  <button
                    onClick={() => handleCopyContent(selectedVersion.content)}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? (isRtl ? 'تم النسخ' : 'Copied') : isRtl ? 'نسخ النص' : 'Copy Text'}</span>
                  </button>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-slate-200 text-xs font-sans leading-relaxed text-slate-800 whitespace-pre-wrap shadow-3xs">
                  {selectedVersion.content}
                </div>
              </div>
            )}

            {/* VIEW MODE 3: NEW VERSION EDITOR FORM */}
            {viewMode === 'new_version' && (
              <form onSubmit={handleCreateNewVersion} className="flex-1 overflow-y-auto p-5 space-y-4">
                <div className="p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100 flex items-center gap-3 text-xs text-indigo-900">
                  <Sparkles className="w-5 h-5 text-indigo-600 shrink-0" />
                  <p>
                    {isRtl
                      ? `سيتم حفظ التعديلات كإصدار جديد (v${(doc.version || 1) + 1})، مع الحفاظ على كافة الإصدارات السابقة وتحديث متجهات Qdrant تلقائياً.`
                      : `Your changes will be saved as new version v${(doc.version || 1) + 1}, preserving all historical snapshots while refreshing Qdrant vector chunks.`}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">
                    {isRtl ? 'عنوان المستند' : 'Document Title'}
                  </label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">
                      {isRtl ? 'ملخص التغيير / Changelog' : 'Change Summary'}
                    </label>
                    <input
                      type="text"
                      placeholder={
                        isRtl
                          ? 'مثال: تحديث بنود العزل الأمني وتعديل الشروط'
                          : 'e.g., Updated multi-tenant isolation terms'
                      }
                      value={changeSummary}
                      onChange={(e) => setChangeSummary(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">
                      {isRtl ? 'اسم المحرر / المراجع' : 'Editor Name'}
                    </label>
                    <input
                      type="text"
                      value={authorName}
                      onChange={(e) => setAuthorName(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">
                      {isRtl ? 'محتوى المستند الكامل' : 'Document Content'}
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono">
                      ~{Math.round(newContent.length / 4)} tokens
                    </span>
                  </div>
                  <textarea
                    rows={12}
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-sans focus:outline-none focus:border-indigo-500 leading-relaxed"
                  />
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setViewMode('diff')}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    {isRtl ? 'إلغاء' : 'Cancel'}
                  </button>

                  <button
                    type="submit"
                    disabled={isSavingNewVer}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-2xs"
                  >
                    <Sparkles className={`w-4 h-4 ${isSavingNewVer ? 'animate-spin' : ''}`} />
                    <span>
                      {isSavingNewVer
                        ? isRtl
                          ? 'جاري الحفظ والتجزئة...'
                          : 'Saving & Indexing...'
                        : isRtl
                          ? `حفظ وفهرسة الإصدار v${(doc.version || 1) + 1}`
                          : `Save & Index as v${(doc.version || 1) + 1}`}
                    </span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* MODAL FOOTER */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between gap-3 text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700">{isRtl ? 'المستند الحالي:' : 'Active Doc:'}</span>
            <span className="font-mono text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
              v{doc.version || 1}
            </span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            {isRtl ? 'إغلاق النافذة' : 'Close Window'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={pendingRevertVersion !== null}
        title={isRtl ? 'استرجاع إصدار سابق' : 'Revert to previous version'}
        message={
          pendingRevertVersion
            ? isRtl
              ? `هل أنت متأكد من استرجاع المستند إلى الإصدار v${pendingRevertVersion.versionNumber}؟ سيتم تحديث الفهارس والمتجهات في Qdrant.`
              : `Are you sure you want to revert this document to version v${pendingRevertVersion.versionNumber}? Vector indexes will be updated in Qdrant.`
            : ''
        }
        confirmLabel={isRtl ? 'استرجاع' : 'Revert'}
        cancelLabel={isRtl ? 'إلغاء' : 'Cancel'}
        variant="warning"
        loading={isReverting}
        onConfirm={() => pendingRevertVersion && performRevert(pendingRevertVersion)}
        onCancel={() => setPendingRevertVersion(null)}
      />
    </div>
  );
}
