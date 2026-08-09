'use client';

import React, { useState, useEffect } from 'react';
import {
  FileText,
  Upload,
  Plus,
  Trash2,
  RefreshCw,
  Search,
  BookOpen,
  Layers,
  Globe,
  CheckCircle2,
  FileCode,
} from 'lucide-react';
import { Document, DocumentChunk } from '@/lib/types/omnirag';

interface KnowledgeBaseProps {
  tenantId: string;
  lang: 'ar' | 'en';
}

export default function KnowledgeBase({ tenantId, lang }: KnowledgeBaseProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [chunks, setChunks] = useState<DocumentChunk[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // Modal Form for New Document
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newLanguage, setNewLanguage] = useState<'ar' | 'en'>('ar');
  const [showAddModal, setShowAddModal] = useState(false);

  const fetchDocs = async () => {
    try {
      const res = await fetch(`/api/v1/documents?tenantId=${tenantId}`);
      const data = await res.json();
      if (data.documents) {
        setDocuments(data.documents);
      }
    } catch (e) {
      console.error('Failed to fetch docs:', e);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, [tenantId]);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    setIsUploading(true);
    try {
      const res = await fetch('/api/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          title: newTitle,
          content: newContent,
          language: newLanguage,
        }),
      });

      if (res.ok) {
        setNewTitle('');
        setNewContent('');
        setShowAddModal(false);
        fetchDocs();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(lang === 'ar' ? 'هل أنت تأكد من حذف هذا المستند والقطع التابعة له؟' : 'Delete document?')) return;
    await fetch(`/api/v1/documents?id=${id}&tenantId=${tenantId}`, { method: 'DELETE' });
    fetchDocs();
    if (selectedDoc?.id === id) setSelectedDoc(null);
  };

  const filteredDocs = documents.filter((d) =>
    d.title.toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Bar */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-600" />
            <span>{lang === 'ar' ? 'مستودع المعرفة والاستيعاب (Ingestion Pipeline)' : 'Knowledge & Ingestion Base'}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'ar'
              ? 'إدارة وتقسيم المستندات، استخراج التضمينات المتجهية، وفهرسة Qdrant مع عزْل المستأجر.'
              : 'Manage documents, chunking strategies, and multi-tenant vector indexing.'}
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center gap-2 shadow-xs transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{lang === 'ar' ? 'إضافة مستند جديد' : 'Upload Document'}</span>
        </button>
      </div>

      {/* Main Grid: Document List & Chunk Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Document List */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder={lang === 'ar' ? 'بحث في المستندات المفهومة...' : 'Search documents...'}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              onClick={fetchDocs}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition"
              title="تحديث"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
            {filteredDocs.map((doc) => (
              <div
                key={doc.id}
                onClick={() => setSelectedDoc(doc)}
                className={`p-4 flex items-center justify-between cursor-pointer transition ${
                  selectedDoc?.id === doc.id ? 'bg-indigo-50/70' : 'hover:bg-slate-50/80'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">{doc.title}</h3>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1 font-mono">
                        <Layers className="w-3 h-3 text-indigo-500" />
                        {doc.chunkCount} {lang === 'ar' ? 'قطع' : 'chunks'}
                      </span>
                      <span className="uppercase font-mono font-bold bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                        {doc.language}
                      </span>
                      <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(doc.id);
                  }}
                  className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Selected Document & Chunk Viewer */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex flex-col h-full">
          <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
            <FileCode className="w-4 h-4 text-indigo-600" />
            <span>{lang === 'ar' ? 'تفاصيل المستند والمعاينة' : 'Document Details'}</span>
          </h3>

          {selectedDoc ? (
            <div className="space-y-3 flex-1 overflow-y-auto">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                <h4 className="text-xs font-bold text-slate-900">{selectedDoc.title}</h4>
                <p className="text-[11px] text-slate-500 mt-1 font-mono">ID: {selectedDoc.id}</p>
              </div>

              <div>
                <span className="text-xs font-bold text-slate-700 block mb-2">
                  {lang === 'ar' ? 'النص الخام والأصلي:' : 'Raw Document Text:'}
                </span>
                <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100 font-sans max-h-80 overflow-y-auto whitespace-pre-line">
                  {selectedDoc.content}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400">
              <BookOpen className="w-8 h-8 mb-2 text-slate-300" />
              <p className="text-xs">
                {lang === 'ar' ? 'حدد مستنداً من القائمة لملاحظة تفاصيله المقطعّة.' : 'Select document to inspect.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Upload / Add New Document */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full border border-slate-200 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              {lang === 'ar' ? 'استيعاب مستند جديد لـ OmniRAG' : 'Ingest New Document'}
            </h3>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'عنوان المستند:' : 'Document Title:'}
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="مثال: سياسة أمن المعلومات 2026"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'اللغة الأساسية:' : 'Primary Language:'}
                </label>
                <select
                  value={newLanguage}
                  onChange={(e) => setNewLanguage(e.target.value as 'ar' | 'en')}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                >
                  <option value="ar">العربية (AR)</option>
                  <option value="en">English (EN)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'محتوى النص الكامل:' : 'Document Content:'}
                </label>
                <textarea
                  required
                  rows={5}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="ضع النص المستخرج هنا..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isUploading}
                  className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition"
                >
                  {isUploading ? 'جاري التقسيم والفهرسة...' : 'حفظ واستيعاب'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="py-2.5 px-4 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-200 transition"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
