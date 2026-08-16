'use client';

import React, { useState } from 'react';
import { Document, DocumentChunk } from '@/lib/types/omnirag';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import { useAsync } from '@/hooks/useAsync';
import { X, Layers, Search, Copy, Check, Sparkles, Loader2, Database, ShieldCheck, Hash } from 'lucide-react';

interface DocumentChunkInspectorModalProps {
  document: Document;
  tenantId: string;
  lang: 'ar' | 'en';
  onClose: () => void;
}

export function DocumentChunkInspectorModal({ document, tenantId, lang, onClose }: DocumentChunkInspectorModalProps) {
  const isRtl = lang === 'ar';
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'chunks' | 'raw'>('chunks');

  const { data: chunks, isLoading } = useAsync<DocumentChunk[]>(
    async (signal) => {
      const res = await fetchWithAuth(`/api/v1/documents?tenantId=${tenantId}&documentId=${document.id}`, { signal });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.chunks) ? data.chunks : [];
    },
    [document.id, tenantId],
  );
  const chunkList = chunks ?? [];

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredChunks = chunkList.filter((c) => {
    if (!searchQuery.trim()) return true;
    return (
      c.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const totalTokens = chunkList.reduce((acc, c) => acc + Math.round(c.content.length / 4), 0);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        className="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-150 flex items-center justify-between gap-4 bg-slate-50/70">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100/60 shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-indigo-100/70 text-indigo-800 font-mono">
                  {isRtl ? 'فاحص متجهات Qdrant' : 'Qdrant Vector Inspector'}
                </span>
                <span className="text-[10px] font-mono text-slate-500 font-bold bg-slate-200/60 px-1.5 py-0.5 rounded">
                  {document.language?.toUpperCase() || 'AR'}
                </span>
              </div>
              <h3 className="text-sm font-extrabold text-slate-900 truncate mt-0.5">{document.title}</h3>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center bg-slate-200/70 p-0.5 rounded-xl border border-slate-300/60 text-xs">
              <button
                onClick={() => setActiveView('chunks')}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  activeView === 'chunks'
                    ? 'bg-white text-indigo-600 shadow-3xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {isRtl ? 'المقاطع الدلالية' : 'Vector Chunks'} ({chunkList.length})
              </button>
              <button
                onClick={() => setActiveView('raw')}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  activeView === 'raw' ? 'bg-white text-indigo-600 shadow-3xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {isRtl ? 'النص الكامل المستخرج' : 'Raw Text'}
              </button>
            </div>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats Strip */}
        <div className="px-5 py-2.5 bg-indigo-50/40 border-b border-indigo-100/60 flex items-center justify-between gap-4 flex-wrap text-xs text-indigo-950 font-medium">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-indigo-600" />
              <span>{isRtl ? 'إجمالي المقاطع:' : 'Total Chunks:'}</span>
              <strong className="font-mono text-indigo-700">{chunkList.length}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>{isRtl ? 'الرموز التقديرية:' : 'Estimated Tokens:'}</span>
              <strong className="font-mono text-indigo-700">~{totalTokens.toLocaleString()}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-indigo-600" />
              <span>{isRtl ? 'نموذج التضمين:' : 'Embedding Model:'}</span>
              <strong className="font-mono text-indigo-700">text-embedding-004</strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{isRtl ? 'فضاء متجهي معزول وآمن' : 'Isolated Multi-Tenant Vector Space'}</span>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {activeView === 'chunks' ? (
            <>
              {/* Search filter */}
              <div className="relative">
                <Search className={`w-4 h-4 text-slate-400 absolute top-2.5 ${isRtl ? 'right-3' : 'left-3'}`} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isRtl ? 'بحث داخل نصوص المقاطع أو المعرّفات...' : 'Search within chunks or chunk IDs...'}
                  className={`w-full py-2 bg-slate-50 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-indigo-500 font-sans ${
                    isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'
                  }`}
                />
              </div>

              {isLoading ? (
                <div className="py-16 text-center space-y-3">
                  <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
                  <p className="text-xs text-slate-500 font-medium">
                    {isRtl
                      ? 'جاري جلب المقاطع والمتجهات الدلالية من Qdrant...'
                      : 'Retrieving vector points and payloads from Qdrant...'}
                  </p>
                </div>
              ) : filteredChunks.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-xs space-y-2">
                  <Search className="w-8 h-8 text-slate-300 mx-auto" />
                  <p>{isRtl ? 'لم يتم العثور على مقاطع مطابقة للبحث.' : 'No matching chunks found.'}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredChunks.map((chunk, idx) => {
                    const chunkTokens = Math.round(chunk.content.length / 4);
                    const isCopied = copiedId === chunk.id;
                    return (
                      <div
                        key={chunk.id || idx}
                        className="p-4 rounded-2xl bg-slate-900 text-slate-100 border border-slate-800 space-y-3 shadow-3xs group hover:border-indigo-500/50 transition-colors"
                      >
                        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5 gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-indigo-400 bg-indigo-950/70 px-2 py-0.5 rounded border border-indigo-800/60">
                              #{chunk.chunkIndex !== undefined ? chunk.chunkIndex + 1 : idx + 1}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                              ID: {chunk.id.slice(0, 16)}...
                            </span>
                            {chunk.pageNumber && (
                              <span className="text-[10px] font-mono text-amber-300 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/50">
                                {isRtl ? `ص ${chunk.pageNumber}` : `p. ${chunk.pageNumber}`}
                              </span>
                            )}
                            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/50">
                              ~{chunkTokens} {isRtl ? 'رمز' : 'tokens'}
                            </span>
                          </div>

                          <button
                            onClick={() => handleCopy(chunk.content, chunk.id)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white transition flex items-center gap-1 text-[11px] font-mono cursor-pointer"
                            title={isRtl ? 'نسخ محتوى المقطع' : 'Copy chunk text'}
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-emerald-400">{isRtl ? 'تم النسخ' : 'Copied'}</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>{isRtl ? 'نسخ' : 'Copy'}</span>
                              </>
                            )}
                          </button>
                        </div>

                        <p className="text-xs text-slate-300 leading-relaxed font-sans whitespace-pre-wrap selection:bg-indigo-700 selection:text-white">
                          {chunk.content}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="text-xs font-bold text-slate-700">
                  {isRtl ? 'النص الكامل المفروز' : 'Parsed Raw Content Stream'}
                </span>
                <button
                  onClick={() => handleCopy(document.content, 'full-doc')}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
                >
                  {copiedId === 'full-doc' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-600">{isRtl ? 'تم نسخ النص' : 'Copied'}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>{isRtl ? 'نسخ النص الكامل' : 'Copy Full Text'}</span>
                    </>
                  )}
                </button>
              </div>
              <div className="max-h-[450px] overflow-y-auto pr-1 text-xs text-slate-800 leading-relaxed font-sans whitespace-pre-wrap">
                {document.content || (isRtl ? 'لا يوجد نص خام مسجل.' : 'No raw text available.')}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-150 bg-slate-50/70 flex items-center justify-between text-xs text-slate-500">
          <span className="font-mono text-[11px]">
            Tenant: <strong className="text-slate-800">{tenantId}</strong>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition cursor-pointer"
          >
            {isRtl ? 'إغلاق الفاحص' : 'Close Inspector'}
          </button>
        </div>
      </div>
    </div>
  );
}
