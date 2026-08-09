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
  Copy,
  Download,
  FolderPlus,
  Folder,
} from 'lucide-react';
import { Document, DocumentChunk, Collection } from '@/lib/types/omnirag';

interface KnowledgeBaseProps {
  tenantId: string;
  lang: 'ar' | 'en';
}

export default function KnowledgeBase({ tenantId, lang }: KnowledgeBaseProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedColId, setSelectedColId] = useState<string>('all');
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Modal Form for New Document
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newLanguage, setNewLanguage] = useState<'ar' | 'en'>('ar');
  const [newCollectionId, setNewCollectionId] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Modal Form for New Collection
  const [showColModal, setShowColModal] = useState(false);
  const [colName, setColName] = useState('');
  const [colDesc, setColDesc] = useState('');

  const fetchDocsAndCols = async () => {
    try {
      const [docsRes, colsRes] = await Promise.all([
        fetch(`/api/v1/documents?tenantId=${tenantId}`),
        fetch(`/api/v1/collections?tenantId=${tenantId}`),
      ]);
      const docsData = await docsRes.json();
      const colsData = await colsRes.json();

      if (docsData.documents) setDocuments(docsData.documents);
      if (colsData.collections) setCollections(colsData.collections);
    } catch (e) {
      console.error('Failed to fetch docs or collections:', e);
    }
  };

  useEffect(() => {
    fetchDocsAndCols();
  }, [tenantId]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

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
          collectionIds: newCollectionId ? [newCollectionId] : [],
        }),
      });

      if (res.ok) {
        setNewTitle('');
        setNewContent('');
        setShowAddModal(false);
        fetchDocsAndCols();
        showToast(lang === 'ar' ? 'تم حفظ المستند وتقسيمه وفهرسته بنجاح!' : 'Document ingested and indexed successfully!');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!colName.trim()) return;

    try {
      const res = await fetch('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, name: colName, description: colDesc }),
      });
      if (res.ok) {
        setColName('');
        setColDesc('');
        setShowColModal(false);
        fetchDocsAndCols();
        showToast(lang === 'ar' ? 'تمت إضافة المجموعة الجديدة!' : 'Collection created successfully!');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/v1/documents?id=${id}&tenantId=${tenantId}`, { method: 'DELETE' });
    fetchDocsAndCols();
    if (selectedDoc?.id === id) setSelectedDoc(null);
    showToast(lang === 'ar' ? 'تم حذف المستند بنجاح' : 'Document deleted');
  };

  const addQuickSampleDoc = async () => {
    setIsUploading(true);
    try {
      await fetch('/api/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          title: lang === 'ar' ? 'دليل امتثال السلامة المهنية المتقدم 2026' : 'Safety Compliance Guide 2026',
          content: lang === 'ar'
            ? 'يتوجب على جميع الموظفين والمقاولين الالتزام التام بمعايير السلامة ISO45001. يحظر تشغيل الأدوات عالية المخاطر بدون التأكد من تفعيل أجهزة الحماية والمراقبة الذكية.'
            : 'All contractors must comply with ISO45001 safety guidelines. High-risk tool operations require active monitoring.',
          language: lang,
        }),
      });
      fetchDocsAndCols();
      showToast(lang === 'ar' ? 'تمت إضافة المستند التجريبي' : 'Sample doc added');
    } catch (e) {
      console.error(e);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast(lang === 'ar' ? 'تم نسخ النص إلى الحافظة' : 'Text copied to clipboard');
  };

  const handleDownloadDoc = (doc: Document) => {
    const blob = new Blob([doc.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredDocs = documents.filter((d) => {
    const matchesQuery = d.title.toLowerCase().includes(filterQuery.toLowerCase());
    const matchesCol = selectedColId === 'all' || (d.collectionIds && d.collectionIds.includes(selectedColId));
    return matchesQuery && matchesCol;
  });

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2 shadow-sm animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-semibold">{toastMsg}</span>
        </div>
      )}

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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowColModal(true)}
            className="px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer border border-indigo-200/60"
          >
            <FolderPlus className="w-4 h-4 text-indigo-600" />
            <span>{lang === 'ar' ? 'مجموعة جديدة' : 'New Collection'}</span>
          </button>

          <button
            type="button"
            onClick={addQuickSampleDoc}
            disabled={isUploading}
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer"
          >
            <Plus className="w-4 h-4 text-indigo-600" />
            <span>{lang === 'ar' ? 'إضافة مستند تجريبي' : 'Add Sample Doc'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center gap-2 shadow-xs transition cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>{lang === 'ar' ? 'رفع مستند مخصص' : 'Upload Custom'}</span>
          </button>
        </div>
      </div>

      {/* Collections Filter Pills */}
      {collections.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto py-1 no-scrollbar">
          <span className="text-xs font-bold text-slate-500 shrink-0 flex items-center gap-1">
            <Folder className="w-3.5 h-3.5 text-indigo-500" />
            {lang === 'ar' ? 'المجموعات:' : 'Collections:'}
          </span>
          <button
            type="button"
            onClick={() => setSelectedColId('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              selectedColId === 'all'
                ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {lang === 'ar' ? 'كافة المستندات' : 'All Documents'} ({documents.length})
          </button>
          {collections.map((col) => {
            const count = documents.filter((d) => d.collectionIds && d.collectionIds.includes(col.id)).length;
            return (
              <button
                key={col.id}
                type="button"
                onClick={() => setSelectedColId(col.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  selectedColId === col.id
                    ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                📁 {col.name} ({count})
              </button>
            );
          })}
        </div>
      )}

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
              onClick={fetchDocsAndCols}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition cursor-pointer"
              title="تحديث البيانات"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
            {filteredDocs.length > 0 ? (
              filteredDocs.map((doc) => (
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
                    className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                    title="حذف المستند"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-xs text-slate-400">
                لا توجد مستندات في هذه المجموعة حالياً.
              </div>
            )}
          </div>
        </div>

        {/* Selected Document & Chunk Viewer */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex flex-col h-full">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <FileCode className="w-4 h-4 text-indigo-600" />
              <span>{lang === 'ar' ? 'تفاصيل المستند والمعاينة' : 'Document Details'}</span>
            </h3>

            {selectedDoc && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleCopyText(selectedDoc.content)}
                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs transition cursor-pointer"
                  title="نسخ النص الكامل"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadDoc(selectedDoc)}
                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs transition cursor-pointer"
                  title="تحميل كملف نصي"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

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

      {/* Modal: Create New Collection */}
      {showColModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full border border-slate-200 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FolderPlus className="w-5 h-5 text-indigo-600" />
              <span>{lang === 'ar' ? 'إنشاء مجموعة مستندات جديدة' : 'Create New Collection'}</span>
            </h3>

            <form onSubmit={handleCreateCollection} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'اسم المجموعة:' : 'Collection Name:'}
                </label>
                <input
                  type="text"
                  required
                  value={colName}
                  onChange={(e) => setColName(e.target.value)}
                  placeholder="مثال: السياسات واللوائح التنظيمية"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'وصف المجموعة:' : 'Description:'}
                </label>
                <textarea
                  rows={3}
                  value={colDesc}
                  onChange={(e) => setColDesc(e.target.value)}
                  placeholder="وصف مختصر لمحتوى المجموعة..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition cursor-pointer"
                >
                  إنشاء
                </button>
                <button
                  type="button"
                  onClick={() => setShowColModal(false)}
                  className="py-2.5 px-4 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

              {collections.length > 0 && (
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    {lang === 'ar' ? 'إضافة إلى مجموعة:' : 'Assign to Collection:'}
                  </label>
                  <select
                    value={newCollectionId}
                    onChange={(e) => setNewCollectionId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">بدون مجموعة مستقلة</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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
                  className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition cursor-pointer"
                >
                  {isUploading ? 'جاري التقسيم والفهرسة...' : 'حفظ واستيعاب'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="py-2.5 px-4 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
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
