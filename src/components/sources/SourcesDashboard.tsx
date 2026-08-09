'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { SourceConnector, SyncLogEntry, McpResourceItem, Collection, Document, DocumentChunk } from '@/lib/types/omnirag';
import { AddSourceWizard } from './AddSourceWizard';
import { EditSourceModal } from './EditSourceModal';
import { SyncLogModal } from './SyncLogModal';
import {
  Database,
  RefreshCw,
  Plus,
  Upload,
  Search,
  FileText,
  Clock,
  Layers,
  Sparkles,
  Sliders,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  FolderPlus,
  Copy,
  Download,
  BookOpen,
  FileCode,
  Globe,
  Youtube,
  Github,
  Server,
  Zap,
} from 'lucide-react';

interface SourcesDashboardProps {
  tenantId?: string;
  lang?: 'ar' | 'en';
}

export function SourcesDashboard({ tenantId = 'tenant-acme-01', lang = 'ar' }: SourcesDashboardProps) {
  const [activeTab, setActiveTab] = useState<'connectors' | 'add' | 'upload' | 'documents' | 'mcp'>('connectors');
  const [sources, setSources] = useState<SourceConnector[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([]);
  const [mcpResources, setMcpResources] = useState<McpResourceItem[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [docChunks, setDocChunks] = useState<DocumentChunk[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [editingSource, setEditingSource] = useState<SourceConnector | null>(null);
  const [viewingLogsSource, setViewingLogsSource] = useState<SourceConnector | null>(null);

  // File Upload State
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadContent, setUploadContent] = useState('');
  const [chunkStrategy, setChunkStrategy] = useState<'semantic' | 'markdown' | 'code' | 'sliding'>('semantic');
  const [chunkSize, setChunkSize] = useState<number>(512);
  const [chunkOverlap, setChunkOverlap] = useState<number>(20);
  const [selectedColId, setSelectedColId] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState('');

  const fetchSourcesData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sourcesRes, colsRes, docsRes] = await Promise.all([
        fetch(`/api/v1/sources?tenantId=${tenantId}`),
        fetch(`/api/v1/collections?tenantId=${tenantId}`),
        fetch(`/api/v1/documents?tenantId=${tenantId}`),
      ]);

      const sourcesData = await sourcesRes.json();
      const colsData = await colsRes.json();
      const docsData = await docsRes.json();

      if (sourcesData.sources) setSources(sourcesData.sources);
      if (sourcesData.syncLogs) setSyncLogs(sourcesData.syncLogs);
      if (sourcesData.mcpResources) setMcpResources(sourcesData.mcpResources);
      if (colsData.collections) setCollections(colsData.collections);
      if (docsData.documents) {
        setDocuments(docsData.documents);
        if (!selectedDoc && docsData.documents.length > 0) {
          setSelectedDoc(docsData.documents[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load sources pipeline data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, selectedDoc]);

  useEffect(() => {
    fetchSourcesData();
  }, [fetchSourcesData]);

  // Sync single source
  const handleSyncSource = async (sourceId: string) => {
    try {
      const res = await fetch(`/api/v1/sources/${sourceId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      if (res.ok) {
        fetchSourcesData();
      }
    } catch (err) {
      console.error('Sync failed:', err);
    }
  };

  // Delete source
  const handleDeleteSource = async (sourceId: string) => {
    if (!confirm(lang === 'ar' ? 'هل أنت تأكد من حذف هذا الموصل وإلغاء فهرسة مستنداته؟' : 'Are you sure you want to delete this source connector?')) return;
    try {
      const res = await fetch(`/api/v1/sources?id=${sourceId}&tenantId=${tenantId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchSourcesData();
      }
    } catch (err) {
      console.error('Delete source failed:', err);
    }
  };

  // Update source config
  const handleUpdateSource = async (id: string, updates: Partial<SourceConnector>) => {
    await fetch(`/api/v1/sources/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, ...updates }),
    });
    fetchSourcesData();
  };

  // Handle direct file upload / chunking
  const handleFileUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadTitle || !uploadContent) return;

    setIsUploading(true);
    setUploadSuccessMsg('');

    try {
      const res = await fetch('/api/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          title: uploadTitle,
          content: uploadContent,
          sourceType: 'file',
          language: 'ar',
          collectionIds: selectedColId ? [selectedColId] : [],
          chunkingConfig: {
            strategy: chunkStrategy,
            size: chunkSize,
            overlap: chunkOverlap,
          },
        }),
      });

      if (res.ok) {
        setUploadSuccessMsg(lang === 'ar' ? 'تم رفع المستند وتقطيعه ودعم متجهات Qdrant بنجاح!' : 'Document ingested & chunked successfully!');
        setUploadTitle('');
        setUploadContent('');
        fetchSourcesData();
        setTimeout(() => setActiveTab('documents'), 1200);
      }
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setIsUploading(false);
    }
  };

  const filteredSources = sources.filter((s) => {
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.type.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || s.type === filterType;
    return matchesSearch && matchesType;
  });

  const getSourceIcon = (type: string) => {
    switch (type) {
      case 'file': return <FileText className="w-5 h-5 text-indigo-600" />;
      case 'url': return <Globe className="w-5 h-5 text-blue-600" />;
      case 'youtube': return <Youtube className="w-5 h-5 text-rose-600" />;
      case 'github': return <Github className="w-5 h-5 text-slate-800" />;
      case 'database': return <Database className="w-5 h-5 text-amber-600" />;
      case 'gdrive': return <FolderPlus className="w-5 h-5 text-emerald-600" />;
      default: return <Server className="w-5 h-5 text-violet-600" />;
    }
  };

  const totalDocsCount = sources.reduce((acc, curr) => acc + (curr.documentCount || 0), 0);
  const healthyCount = sources.filter((s) => s.status === 'healthy').length;

  return (
    <div className="space-y-6">
      {/* Header Statistics & Pipeline Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs text-slate-500 font-semibold">{lang === 'ar' ? 'الموصلات الفاعلة' : 'Active Connectors'}</span>
            <div className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
              <span>{sources.length}</span>
              <span className="text-xs font-normal text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                {healthyCount} {lang === 'ar' ? 'سليمة' : 'healthy'}
              </span>
            </div>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Database className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs text-slate-500 font-semibold">{lang === 'ar' ? 'المستندات المفهرسة' : 'Indexed Documents'}</span>
            <div className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
              <span>{documents.length || totalDocsCount}</span>
              <span className="text-xs font-normal text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                RLS Multi-Tenant
              </span>
            </div>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs text-slate-500 font-semibold">{lang === 'ar' ? 'موارد MCP المكشوفة' : 'MCP Resources'}</span>
            <div className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
              <span>{mcpResources.length}</span>
              <span className="text-xs font-mono font-normal text-slate-500">v2 Protocol</span>
            </div>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center">
            <Zap className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs text-slate-500 font-semibold">{lang === 'ar' ? 'آخر عملية مزامنة' : 'Last Sync Execution'}</span>
            <div className="text-xs font-bold text-slate-800 font-mono">
              {syncLogs.length > 0 ? new Date(syncLogs[0].timestamp).toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US') : 'N/A'}
            </div>
            <span className="text-[10px] text-emerald-600 font-bold block">
              {syncLogs.length > 0 ? `✓ ${syncLogs[0].message.slice(0, 32)}...` : 'جاهز للمزامنة'}
            </span>
          </div>
          <button
            onClick={fetchSourcesData}
            className="w-11 h-11 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-600 flex items-center justify-center transition cursor-pointer"
            title="تحديث البيانات"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin text-indigo-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Tab Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-1 overflow-x-auto py-1">
          <button
            onClick={() => setActiveTab('connectors')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'connectors'
                ? 'bg-indigo-600 text-white shadow-2xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>{lang === 'ar' ? 'الموصلات والمصادر الفاعلة' : 'Connectors & Sources'} ({sources.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('add')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'add'
                ? 'bg-indigo-600 text-white shadow-2xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'ar' ? 'معالج إضافة مصدر جديد' : 'Add Source Wizard'}</span>
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'upload'
                ? 'bg-indigo-600 text-white shadow-2xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>{lang === 'ar' ? 'منطقة رفع وتجزئة الملفات' : 'Upload & Chunking'}</span>
          </button>

          <button
            onClick={() => setActiveTab('documents')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'documents'
                ? 'bg-indigo-600 text-white shadow-2xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>{lang === 'ar' ? 'مستودع المستندات والمتجهات' : 'Documents & Vectors'} ({documents.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('mcp')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'mcp'
                ? 'bg-indigo-600 text-white shadow-2xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Zap className="w-4 h-4 text-amber-500" />
            <span>{lang === 'ar' ? 'موارد MCP للمحرك' : 'MCP Resources Context'}</span>
          </button>
        </div>
      </div>

      {/* TAB 1: CONNECTORS GRID */}
      {activeTab === 'connectors' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={lang === 'ar' ? 'بحث في الموصلات النشطة...' : 'Search active connectors...'}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
              <span className="text-xs font-bold text-slate-500">{lang === 'ar' ? 'تصفية النوع:' : 'Type:'}</span>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-500"
              >
                <option value="all">{lang === 'ar' ? 'كافة الأنواع' : 'All Types'}</option>
                <option value="file">Files</option>
                <option value="url">Web Crawlers</option>
                <option value="youtube">YouTube</option>
                <option value="github">GitHub</option>
                <option value="database">Databases</option>
                <option value="gdrive">Google Drive</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSources.map((source) => (
              <div
                key={source.id}
                className="bg-white rounded-2xl p-5 border border-slate-200/80 hover:border-indigo-200 shadow-xs hover:shadow-md transition space-y-4 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200/60">
                        {getSourceIcon(source.type)}
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-slate-900 leading-snug">{source.name}</h3>
                        <span className="text-[10px] font-mono uppercase bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 mt-1 inline-block">
                          {source.type}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${
                        source.status === 'healthy'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : source.status === 'degraded'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {source.status}
                    </span>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5 text-[11px] text-slate-600">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">{lang === 'ar' ? 'المستندات المفهرسة:' : 'Indexed Docs:'}</span>
                      <span className="font-bold text-slate-800">{source.documentCount} {lang === 'ar' ? 'مستند' : 'docs'}</span>
                    </div>
                    <div className="flex items-center justify-between font-mono text-[10px]">
                      <span className="text-slate-400">{lang === 'ar' ? 'الجدولة (Cron):' : 'Schedule:'}</span>
                      <span className="text-indigo-600 font-bold">{source.syncSchedule}</span>
                    </div>
                    {source.lastSyncAt && (
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-400">{lang === 'ar' ? 'آخر مزامنة:' : 'Last Sync:'}</span>
                        <span className="text-slate-500 font-mono">{new Date(source.lastSyncAt).toLocaleTimeString()}</span>
                      </div>
                    )}
                  </div>

                  {source.lastError && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] text-rose-800 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{source.lastError}</span>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleSyncSource(source.id)}
                      className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                      title="تشغيل المزامنة الآن"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{lang === 'ar' ? 'مزامنة' : 'Sync'}</span>
                    </button>
                    <button
                      onClick={() => setViewingLogsSource(source)}
                      className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition cursor-pointer"
                      title="عرض سجل المزامنة"
                    >
                      <Clock className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditingSource(source)}
                      className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition cursor-pointer"
                      title="تعديل الإعدادات"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteSource(source.id)}
                      className="p-1.5 bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg text-xs transition cursor-pointer"
                      title="حذف الموصل"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: ADD SOURCE WIZARD */}
      {activeTab === 'add' && (
        <AddSourceWizard
          tenantId={tenantId}
          collections={collections}
          lang={lang}
          onCompleted={() => {
            fetchSourcesData();
            setActiveTab('connectors');
          }}
          onCancel={() => setActiveTab('connectors')}
        />
      )}

      {/* TAB 3: RESUMABLE FILE UPLOAD & CHUNKING ZONE */}
      {activeTab === 'upload' && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-md space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Upload className="w-5 h-5 text-indigo-600" />
              <span>{lang === 'ar' ? 'منطقة رفع وتجزئة المستندات الحتمية' : 'Resumable File Upload & Chunking Zone'}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {lang === 'ar'
                ? 'استخلاص المستندات وتحويلها لمقاطع دلالية متجهة مع التحكم بـ Chunk Size و Overlap'
                : 'Ingest text & PDF files into vector chunks with custom chunking parameters'}
            </p>
          </div>

          <form onSubmit={handleFileUploadSubmit} className="space-y-5">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                {lang === 'ar' ? 'عنوان المستند المستورد:' : 'Document Title:'}
              </label>
              <input
                type="text"
                required
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="مثال: سياسة حماية البيانات والخصوصية 2026"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Chunk Strategy Settings Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'استراتيجية التقطيع (Strategy):' : 'Chunk Strategy:'}
                </label>
                <select
                  value={chunkStrategy}
                  onChange={(e) => setChunkStrategy(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500 bg-white"
                >
                  <option value="semantic">{lang === 'ar' ? 'تقطيع دلالي حتمي (Semantic)' : 'Semantic'}</option>
                  <option value="markdown">{lang === 'ar' ? 'هيكل الترويسات (Markdown Headings)' : 'Markdown Headings'}</option>
                  <option value="code">{lang === 'ar' ? 'تقطيع الشفرة (Code AST)' : 'Code AST'}</option>
                  <option value="sliding">{lang === 'ar' ? 'نافذة متداخلة (Sliding Window)' : 'Sliding Window'}</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? `حجم القطعة (Chunk Size: ${chunkSize} tokens):` : `Chunk Size: ${chunkSize}`}
                </label>
                <input
                  type="range"
                  min={128}
                  max={2048}
                  step={64}
                  value={chunkSize}
                  onChange={(e) => setChunkSize(Number(e.target.value))}
                  className="w-full accent-indigo-600"
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1">
                  <span>128</span>
                  <span>512</span>
                  <span>1024</span>
                  <span>2048</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? `نسبة التداخل (Overlap: ${chunkOverlap}%):` : `Overlap: ${chunkOverlap}%`}
                </label>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={5}
                  value={chunkOverlap}
                  onChange={(e) => setChunkOverlap(Number(e.target.value))}
                  className="w-full accent-indigo-600"
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1">
                  <span>0%</span>
                  <span>20%</span>
                  <span>50%</span>
                </div>
              </div>
            </div>

            {collections.length > 0 && (
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'المجموعة التابعة:' : 'Target Collection:'}
                </label>
                <select
                  value={selectedColId}
                  onChange={(e) => setSelectedColId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                >
                  <option value="">{lang === 'ar' ? 'بدون مجموعة خاصة' : 'No specific collection'}</option>
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
                {lang === 'ar' ? 'نص المستند لاستخلاصه:' : 'Raw Content Text:'}
              </label>
              <textarea
                required
                rows={8}
                value={uploadContent}
                onChange={(e) => setUploadContent(e.target.value)}
                placeholder={
                  lang === 'ar'
                    ? 'ضع النص المستخرج أو انسخ محتوى الملف هنا ليعالج فورا...'
                    : 'Paste document content to process and index into vectors...'
                }
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-sans text-slate-800 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {uploadSuccessMsg && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>{uploadSuccessMsg}</span>
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={isUploading || !uploadTitle || !uploadContent}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {isUploading
                    ? (lang === 'ar' ? 'جاري تقطيع النص وحساب المتجهات...' : 'Processing & Indexing...')
                    : (lang === 'ar' ? 'تجزئة المستند وحفظه في Qdrant' : 'Ingest & Chunk Document')}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 4: DOCUMENTS & CHUNKS INSPECTOR */}
      {activeTab === 'documents' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">
                {lang === 'ar' ? 'قائمة المستندات المجلوبة والمفهرسة' : 'Ingested Documents'} ({documents.length})
              </h3>
              <button
                onClick={fetchSourcesData}
                className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => setSelectedDoc(doc)}
                  className={`p-4 flex items-center justify-between cursor-pointer transition ${
                    selectedDoc?.id === doc.id ? 'bg-indigo-50/80' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">{doc.title}</h4>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                        <span className="font-mono text-indigo-600 font-bold">{doc.chunkCount} {lang === 'ar' ? 'قطع' : 'chunks'}</span>
                        <span className="uppercase font-mono font-bold bg-slate-100 px-1 rounded text-slate-600">{doc.language}</span>
                        <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <FileCode className="w-4 h-4 text-indigo-600" />
              <span>{lang === 'ar' ? 'معاينة المستند' : 'Document Preview'}</span>
            </h3>

            {selectedDoc ? (
              <div className="space-y-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <h4 className="text-xs font-bold text-slate-900">{selectedDoc.title}</h4>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">ID: {selectedDoc.id}</p>
                </div>

                <div>
                  <span className="text-xs font-bold text-slate-700 block mb-1">
                    {lang === 'ar' ? 'النص الأصلي:' : 'Content:'}
                  </span>
                  <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 max-h-80 overflow-y-auto whitespace-pre-line leading-relaxed font-sans">
                    {selectedDoc.content}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-slate-400">
                {lang === 'ar' ? 'اختر مستنداً للبدء بمعاينته.' : 'Select a document to inspect.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: MCP RESOURCES INSPECTOR */}
      {activeTab === 'mcp' && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-md space-y-5">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              <span>{lang === 'ar' ? 'موارد بروتوكول سياق النموذج (MCP Resources Inspector)' : 'MCP Resources Inspector'}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {lang === 'ar'
                ? 'الموارد المكشوفة للنماذج ومحركات الذكاء الاصطناعي برمز URI سياقي للقراءة الفورية'
                : 'Resources exposed to LLMs via standard resource:// URIs'}
            </p>
          </div>

          <div className="space-y-3">
            {mcpResources.map((res) => (
              <div
                key={res.uri}
                className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-start justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                      {res.uri}
                    </span>
                    <span className="text-[10px] uppercase font-mono font-bold bg-slate-200 px-1.5 py-0.5 rounded text-slate-700">
                      {res.mimeType}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-900 pt-1">{res.name}</h4>
                  <p className="text-xs text-slate-500">{res.description}</p>
                </div>

                <div className="text-[10px] text-slate-400 font-mono shrink-0">
                  {new Date(res.updatedAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODALS */}
      {editingSource && (
        <EditSourceModal
          source={editingSource}
          lang={lang}
          onClose={() => setEditingSource(null)}
          onSave={handleUpdateSource}
        />
      )}

      {viewingLogsSource && (
        <SyncLogModal
          source={viewingLogsSource}
          logs={syncLogs}
          lang={lang}
          onClose={() => setViewingLogsSource(null)}
          onSyncNow={() => handleSyncSource(viewingLogsSource.id)}
        />
      )}
    </div>
  );
}
