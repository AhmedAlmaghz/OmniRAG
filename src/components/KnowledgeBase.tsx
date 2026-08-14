'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useDocumentCache } from '@/hooks/useDocumentCache';
import {
  OcrCacheEntry,
} from '@/lib/cache/mistralOcrCache';
import {
  SourceConnector,
  SyncLogEntry,
  McpResourceItem,
  Collection,
  Document,
  DocumentChunk
} from '@/lib/types/omnirag';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import { AddSourceWizard } from './sources/AddSourceWizard';
import { DocumentIngestionStudio } from './sources/DocumentIngestionStudio';
import { EditSourceModal } from './sources/EditSourceModal';
import { SyncLogModal } from './sources/SyncLogModal';
import { CreateCollectionModal } from './sources/CreateCollectionModal';
import { DocumentCard } from './knowledge/DocumentCard';
import { DocumentChunkInspectorModal } from './knowledge/DocumentChunkInspectorModal';
import { DocumentPreviewModal } from './knowledge/DocumentPreviewModal';
import { HealthDiagnosticsModal } from './knowledge/HealthDiagnosticsModal';
import { DocumentVersionHistoryModal } from './knowledge/DocumentVersionHistoryModal';
import {
  Database,
  RefreshCw,
  Plus,
  Upload,
  Search,
  FileText,
  FileCheck,
  Clock,
  Layers,
  Sparkles,
  Sliders,
  Trash2,
  AlertTriangle,
  FolderPlus,
  Copy,
  Folder,
  Check,
  Scissors,
  Zap,
  Globe,
  Youtube,
  Github,
  Server,
  Key,
  ShieldCheck,
  CheckCircle2,
  HelpCircle,
  Settings,
  ArrowRight,
  ArrowUpRight,
  LayoutGrid,
  List,
  Activity,
  BarChart3,
  HardDrive,
  Cpu,
  Eye,
  Filter,
  CheckCircle,
  XCircle,
  Tag,
  Hash,
  Play,
  Share2,
  History,
  GitBranch,
} from 'lucide-react';

interface KnowledgeBaseProps {
  tenantId?: string;
  lang?: 'ar' | 'en';
}

interface KeysStatus {
  mistralActive: boolean;
  unstructuredActive: boolean;
  geminiActive: boolean;
  qdrantActive: boolean;
}

type TabType =
  | 'dashboard'
  | 'documents'
  | 'collections'
  | 'upload'
  | 'ocr_cache'
  | 'connectors'
  | 'youtube'
  | 'keys'
  | 'mcp';

export default function KnowledgeBase({
  tenantId = 'tenant-acme-01',
  lang = 'ar',
}: KnowledgeBaseProps) {
  const isRtl = lang === 'ar';

  // Primary active tab
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  // OCR Cache Hook
  const {
    cacheEntries: ocrCacheEntries,
    cacheStats: ocrCacheStats,
    deleteCache: deleteOcrCacheEntry,
    clearCache: clearAllOcrCache,
    refreshCache: refreshOcrCache,
  } = useDocumentCache();

  const [previewOcrEntry, setPreviewOcrEntry] = useState<OcrCacheEntry | null>(null);

  // State arrays
  const [sources, setSources] = useState<SourceConnector[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([]);
  const [mcpResources, setMcpResources] = useState<McpResourceItem[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [keysStatus, setKeysStatus] = useState<KeysStatus | null>(null);

  // Loading and action state
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [reindexingDocId, setReindexingDocId] = useState<string | null>(null);

  // View preferences
  const [docViewMode, setDocViewMode] = useState<'grid' | 'list'>('grid');

  // Filters & searches
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCollection, setFilterCollection] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterHealth, setFilterHealth] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'chunks' | 'size'>('date');

  // Modals & Drawers
  const [inspectingDoc, setInspectingDoc] = useState<Document | null>(null);
  const [previewingDoc, setPreviewingDoc] = useState<Document | null>(null);
  const [versionHistoryDoc, setVersionHistoryDoc] = useState<Document | null>(null);
  const [isCreateColModalOpen, setIsCreateColModalOpen] = useState(false);
  const [isHealthModalOpen, setIsHealthModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<SourceConnector | null>(null);
  const [viewingLogsSource, setViewingLogsSource] = useState<SourceConnector | null>(null);
  const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);

  // Load all knowledge base data
  const fetchKnowledgeData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sourcesRes, colsRes, docsRes, keysRes] = await Promise.all([
        fetchWithAuth(`/api/v1/sources?tenantId=${tenantId}`).catch(() => ({
          ok: false,
          json: async () => ({ sources: [], syncLogs: [], mcpResources: [] }),
        } as Response)),
        fetchWithAuth(`/api/v1/collections?tenantId=${tenantId}`).catch(() => ({
          ok: false,
          json: async () => ({ collections: [] }),
        } as Response)),
        fetchWithAuth(`/api/v1/documents?tenantId=${tenantId}`).catch(() => ({
          ok: false,
          json: async () => ({ documents: [] }),
        } as Response)),
        fetchWithAuth('/api/v1/sources/system-status').catch(() => ({
          ok: false,
          json: async () => ({}),
        } as Response)),
      ]);

      let sourcesData: any = {};
      let colsData: any = {};
      let docsData: any = {};
      let keysData: any = null;

      try {
        if (sourcesRes.ok) sourcesData = await sourcesRes.json();
      } catch (e) {}

      try {
        if (colsRes.ok) colsData = await colsRes.json();
      } catch (e) {}

      try {
        if (docsRes.ok) docsData = await docsRes.json();
      } catch (e) {}

      try {
        if (keysRes.ok) keysData = await keysRes.json();
      } catch (e) {}

      if (sourcesData.sources) setSources(sourcesData.sources);
      if (sourcesData.syncLogs) setSyncLogs(sourcesData.syncLogs);
      if (sourcesData.mcpResources) setMcpResources(sourcesData.mcpResources);
      if (colsData.collections) setCollections(colsData.collections);
      if (keysData) setKeysStatus(keysData);
      if (docsData.documents) setDocuments(docsData.documents);
    } catch (error) {
      console.error('Failed to load knowledge base data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchKnowledgeData();
  }, [fetchKnowledgeData]);

  // Sync single source
  const handleSyncSource = async (sourceId: string) => {
    try {
      const res = await fetchWithAuth(`/api/v1/sources/${sourceId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      if (res.ok) {
        fetchKnowledgeData();
      }
    } catch (err) {
      console.error('Sync failed:', err);
    }
  };

  // Sync All Sources
  const handleSyncAllSources = async () => {
    setIsSyncingAll(true);
    try {
      await Promise.all(
        sources.map((s) =>
          fetchWithAuth(`/api/v1/sources/${s.id}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId }),
          })
        )
      );
      await fetchKnowledgeData();
    } catch (err) {
      console.error('Sync all failed:', err);
    } finally {
      setIsSyncingAll(false);
    }
  };

  // Delete source
  const handleDeleteSource = async (sourceId: string) => {
    if (!confirm(isRtl ? 'هل أنت متأكد من حذف هذا الموصل وإلغاء فهرسة مستنداته؟' : 'Are you sure you want to delete this source connector?')) return;
    try {
      const res = await fetchWithAuth(`/api/v1/sources?id=${sourceId}&tenantId=${tenantId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchKnowledgeData();
      }
    } catch (err) {
      console.error('Delete source failed:', err);
    }
  };

  // Delete Document
  const handleDeleteDocument = async (docId: string) => {
    if (!confirm(isRtl ? 'هل تود حذف هذا المستند ومتجهاته نهائياً من Qdrant؟' : 'Permanently delete this document and its Qdrant vectors?')) return;
    try {
      const res = await fetchWithAuth(`/api/v1/documents?id=${docId}&tenantId=${tenantId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        if (inspectingDoc?.id === docId) setInspectingDoc(null);
        if (previewingDoc?.id === docId) setPreviewingDoc(null);
        fetchKnowledgeData();
      }
    } catch (err) {
      console.error('Delete document failed:', err);
    }
  };

  // Re-index Document
  const handleReindexDocument = async (doc: Document) => {
    setReindexingDocId(doc.id);
    try {
      // Simulate re-indexing request to backend
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await fetchKnowledgeData();
    } catch (err) {
      console.error('Reindexing failed:', err);
    } finally {
      setReindexingDocId(null);
    }
  };

  // Update source config
  const handleUpdateSource = async (id: string, updates: Partial<SourceConnector>) => {
    await fetchWithAuth(`/api/v1/sources/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, updates }),
    });
    fetchKnowledgeData();
    setEditingSource(null);
  };

  // Compute stats
  const totalDocsCount = documents.length;
  const totalChunksCount = documents.reduce((sum, d) => sum + (d.chunkCount || 0), 0);
  const indexedDocsCount = documents.filter((d) => d.status === 'indexed' || (d.status as string) === 'success' || !d.status).length;
  const healthPercentage = totalDocsCount > 0 ? Math.round((indexedDocsCount / totalDocsCount) * 100) : 100;
  const avgChunksPerDoc = totalDocsCount > 0 ? (totalChunksCount / totalDocsCount).toFixed(1) : '0';
  const healthySourcesCount = sources.filter((s) => s.status === 'healthy').length;

  // Active Ingestion Jobs simulation/detection
  const activeIngestionJobs = useMemo(() => {
    const processingDocs = documents.filter((d) => d.status === 'processing' || d.status === 'pending');
    const recentSyncs = syncLogs.slice(0, 3);
    return {
      runningCount: processingDocs.length,
      recentSyncs,
      processingDocs,
    };
  }, [documents, syncLogs]);

  // Filtered & sorted documents
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      // Search
      const matchSearch =
        !searchQuery.trim() ||
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (doc.content && doc.content.toLowerCase().includes(searchQuery.toLowerCase()));

      // Collection
      const matchCollection =
        filterCollection === 'all' ||
        (doc.collectionIds && doc.collectionIds.includes(filterCollection)) ||
        doc.metadata?.collectionId === filterCollection;

      // Type
      const srcType = doc.metadata?.connectorType || doc.sourceType || 'file';
      const matchType =
        filterType === 'all' ||
        (filterType === 'pdf' && (doc.title.toLowerCase().endsWith('.pdf') || doc.metadata?.fileType === 'application/pdf')) ||
        (filterType === 'markdown' && (doc.title.toLowerCase().endsWith('.md') || doc.title.toLowerCase().endsWith('.txt'))) ||
        (filterType === 'web' && srcType === 'url') ||
        (filterType === 'youtube' && srcType === 'youtube') ||
        (filterType === 'github' && srcType === 'github') ||
        (filterType === 'database' && srcType === 'database');

      // Health status
      const matchHealth =
        filterHealth === 'all' ||
        (filterHealth === 'indexed' && (doc.status === 'indexed' || (doc.status as string) === 'success' || !doc.status)) ||
        (filterHealth === 'processing' && (doc.status === 'processing' || doc.status === 'pending')) ||
        (filterHealth === 'failed' && (doc.status === 'failed' || (doc.status as string) === 'error'));

      return matchSearch && matchCollection && matchType && matchHealth;
    }).sort((a, b) => {
      if (sortBy === 'date') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === 'name') return a.title.localeCompare(b.title);
      if (sortBy === 'chunks') return (b.chunkCount || 0) - (a.chunkCount || 0);
      if (sortBy === 'size') return (b.content?.length || 0) - (a.content?.length || 0);
      return 0;
    });
  }, [documents, searchQuery, filterCollection, filterType, filterHealth, sortBy]);

  // Recent files (top 6 newest)
  const recentFiles = useMemo(() => {
    return [...documents]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);
  }, [documents]);

  // Helper to find collection name
  const getCollectionName = (colId?: string) => {
    if (!colId) return undefined;
    const col = collections.find((c) => c.id === colId);
    return col ? col.name : undefined;
  };

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* 1. TOP HEADER & MAIN CONTROLS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-200/80 shadow-3xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-2xs">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-extrabold text-slate-950 tracking-tight">
                  {isRtl ? 'قاعدة المعرفة واستوديو الوثائق الدلالية' : 'Knowledge Base & Semantic Document Studio'}
                </h1>
                <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200 uppercase">
                  v2.4 QDRANT CLOUD
                </span>
              </div>
              <p className="text-xs text-slate-500 font-sans mt-0.5">
                {isRtl
                  ? `إدارة ذكية لملفات الـ PDF، تجزئة مقاطع دلالية، فحص الصحة المتجهية، واستيعاب البيانات لمستأجر (${tenantId})`
                  : `Intelligent PDF document ingestion, vector health diagnostic, and multi-tenant isolated search for (${tenantId})`}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            onClick={() => setIsHealthModalOpen(true)}
            className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
          >
            <Activity className="w-4 h-4 text-emerald-600" />
            <span>{isRtl ? 'فحص الصحة' : 'Health Scan'}</span>
          </button>

          <button
            onClick={() => setIsCreateColModalOpen(true)}
            className="px-3.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
          >
            <FolderPlus className="w-4 h-4 text-slate-500" />
            <span>{isRtl ? 'مجموعة جديدة' : 'New Collection'}</span>
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Upload className="w-4 h-4" />
            <span>{isRtl ? 'رفع واستيعاب مستند' : 'Ingest Document'}</span>
          </button>

          <button
            onClick={fetchKnowledgeData}
            className="p-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl transition flex items-center justify-center cursor-pointer shadow-3xs"
            title={isRtl ? 'تحديث البيانات' : 'Refresh Data'}
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${isLoading ? 'animate-spin text-indigo-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* 2. TAB NAVIGATION BAR */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200/80 no-scrollbar">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'dashboard'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200/60'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>{isRtl ? 'لوحة التحكم والصحة' : 'Overview & Health'}</span>
        </button>

        <button
          onClick={() => setActiveTab('documents')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'documents'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200/60'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>{isRtl ? 'بطاقات المستندات' : 'Document Cards'}</span>
          <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${
            activeTab === 'documents' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-600'
          }`}>
            {documents.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('collections')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'collections'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200/60'
          }`}
        >
          <Folder className="w-4 h-4" />
          <span>{isRtl ? 'المجموعات المعرفية' : 'Collections Map'}</span>
          <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${
            activeTab === 'collections' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-600'
          }`}>
            {collections.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('upload')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'upload'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200/60'
          }`}
        >
          <Upload className="w-4 h-4" />
          <span>{isRtl ? 'استوديو الرفع والتجزئة' : 'Ingestion Studio'}</span>
          <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-bold uppercase">
            OCR 50p
          </span>
        </button>

        <button
          onClick={() => setActiveTab('ocr_cache')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'ocr_cache'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200/60'
          }`}
        >
          <Zap className="w-4 h-4 text-amber-500 fill-amber-500/20" />
          <span>{isRtl ? 'ذاكرة OCR المؤقتة' : 'Mistral OCR Cache'}</span>
          <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${
            activeTab === 'ocr_cache' ? 'bg-indigo-700 text-white' : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}>
            {ocrCacheEntries.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('connectors')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'connectors'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200/60'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>{isRtl ? 'الموصلات الآلية' : 'Connectors'}</span>
          <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${
            activeTab === 'connectors' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-600'
          }`}>
            {sources.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('youtube')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'youtube'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200/60'
          }`}
        >
          <Youtube className="w-4 h-4 text-rose-500" />
          <span>{isRtl ? 'مفرغ يوتيوب الذكي' : 'YouTube Transcriber'}</span>
        </button>

        <button
          onClick={() => setActiveTab('keys')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'keys'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200/60'
          }`}
        >
          <Key className="w-4 h-4" />
          <span>{isRtl ? 'مفاتيح الخدمات' : 'API Integrations'}</span>
        </button>

        <button
          onClick={() => setActiveTab('mcp')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'mcp'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200/60'
          }`}
        >
          <Zap className="w-4 h-4 text-amber-500" />
          <span>{isRtl ? 'سياق MCP' : 'MCP Context'}</span>
        </button>
      </div>

      {/* 3. TAB 1: OVERVIEW & HEALTH DASHBOARD VIEW */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Top KPI Ribbon */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Documents */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-3xs flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">
                  {isRtl ? 'إجمالي المستندات المفهرسة' : 'Total Documents'}
                </span>
                <div className="text-2xl font-black text-slate-950 flex items-baseline gap-2 font-mono">
                  <span>{totalDocsCount}</span>
                  <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-sans">
                    {indexedDocsCount} {isRtl ? 'جاهز' : 'ready'}
                  </span>
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
                <FileText className="w-5 h-5" />
              </div>
            </div>

            {/* Total Chunks */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-3xs flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">
                  {isRtl ? 'المقاطع المتجهية (Qdrant)' : 'Vector Chunks (Qdrant)'}
                </span>
                <div className="text-2xl font-black text-slate-950 flex items-baseline gap-2 font-mono">
                  <span>{totalChunksCount}</span>
                  <span className="text-[10px] text-slate-400 font-sans">
                    ~{avgChunksPerDoc} {isRtl ? 'مقطع/ملف' : 'ch/doc'}
                  </span>
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                <Layers className="w-5 h-5" />
              </div>
            </div>

            {/* Document Health Index */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-3xs flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">
                  {isRtl ? 'مؤشر الصحة والجودة' : 'Health & Quality Score'}
                </span>
                <div className="text-2xl font-black text-emerald-600 flex items-baseline gap-2 font-mono">
                  <span>{healthPercentage}%</span>
                  <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-sans">
                    {isRtl ? 'سليم' : 'Optimal'}
                  </span>
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                <Activity className="w-5 h-5" />
              </div>
            </div>

            {/* Active Connectors */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-3xs flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">
                  {isRtl ? 'الموصلات ومصادر المزامنة' : 'Active Connectors'}
                </span>
                <div className="text-2xl font-black text-slate-950 flex items-baseline gap-2 font-mono">
                  <span>{sources.length}</span>
                  <span className="text-[10px] text-violet-700 font-bold bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200 font-sans">
                    {healthySourcesCount} {isRtl ? 'متصل' : 'healthy'}
                  </span>
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center border border-violet-100">
                <Database className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Middle Row: Active Ingestion Jobs & Document Health Statistics */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Active Ingestion Pipeline & Jobs (lg:col-span-7) */}
            <div className="lg:col-span-7 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-3xs space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900">
                      {isRtl ? 'مهام الاستيعاب وخط المعالجة المباشر' : 'Active Ingestion Jobs & Live Pipeline'}
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      {isRtl ? 'مراقبة فورية لمراحل التقطيع، استخراج النصوص بـ OCR، وتوليد المتجهات' : 'Real-time monitoring of document chunking, OCR parsing, and vector indexing'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE ENGINE
                  </span>
                </div>
              </div>

              {/* 4-Stage Visual Ingestion Pipeline */}
              <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-200/70 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span className="flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-indigo-600" />
                    <span>{isRtl ? 'مسار استيعاب ملفات الـ PDF الكبيرة (دفعات 50 صفحة)' : '50-Page PDF Partition Pipeline'}</span>
                  </span>
                  <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                    4-Stage Pipeline
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-3xs space-y-1">
                    <span className="text-[10px] font-mono text-slate-400 font-bold">STAGE 1</span>
                    <h5 className="font-bold text-slate-800 text-[11px]">{isRtl ? 'التقسيم لـ 50ص' : '50p Slicing'}</h5>
                    <span className="text-[9px] text-emerald-600 block font-bold">✓ Ready</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-3xs space-y-1">
                    <span className="text-[10px] font-mono text-slate-400 font-bold">STAGE 2</span>
                    <h5 className="font-bold text-slate-800 text-[11px]">{isRtl ? 'OCR ميسترال' : 'Mistral OCR'}</h5>
                    <span className="text-[9px] text-emerald-600 block font-bold">✓ High Res</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-3xs space-y-1">
                    <span className="text-[10px] font-mono text-slate-400 font-bold">STAGE 3</span>
                    <h5 className="font-bold text-slate-800 text-[11px]">{isRtl ? 'تقطيع 512t' : 'Sliding Chunks'}</h5>
                    <span className="text-[9px] text-emerald-600 block font-bold">✓ Overlap 64t</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-3xs space-y-1">
                    <span className="text-[10px] font-mono text-slate-400 font-bold">STAGE 4</span>
                    <h5 className="font-bold text-slate-800 text-[11px]">{isRtl ? 'فهرسة Qdrant' : 'Qdrant Embed'}</h5>
                    <span className="text-[9px] text-emerald-600 block font-bold">✓ Cosine 768d</span>
                  </div>
                </div>
              </div>

              {/* Ingestion & Sync Activity Stream */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>{isRtl ? 'سجل أحداث الفهرسة والمزامنة الأخيرة' : 'Recent Ingestion & Sync Events'}</span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {syncLogs.length} events logged
                  </span>
                </div>

                {syncLogs.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                    {isRtl ? 'لا توجد عمليات مزامنة سابقة.' : 'No sync events recorded yet.'}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                    {syncLogs.slice(0, 5).map((log) => {
                      const isSuccess = log.status === 'success';
                      return (
                        <div
                          key={log.id}
                          className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {isSuccess ? (
                              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="font-bold text-slate-900 truncate">{log.message}</p>
                              <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                                <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                                <span>•</span>
                                <span className="text-indigo-600 font-bold">
                                  +{log.itemsProcessed || 0} {isRtl ? 'عناصر' : 'items'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0 ${
                            isSuccess
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {log.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Document Health & Diagnostics Panel (lg:col-span-5) */}
            <div className="lg:col-span-5 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-3xs space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900">
                      {isRtl ? 'إحصائيات صحة المستندات' : 'Document Health Statistics'}
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      {isRtl ? 'فحص جاهزية الفهارس وسلامة التضمين' : 'Vector index coverage and semantic readiness'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setIsHealthModalOpen(true)}
                  className="p-1.5 rounded-lg bg-slate-50 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-slate-200 transition cursor-pointer text-[10px] font-bold flex items-center gap-1"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>{isRtl ? 'فحص شامل' : 'Deep Scan'}</span>
                </button>
              </div>

              {/* Health Score Gauge */}
              <div className="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-200/70 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-950">
                    {isRtl ? 'تغطية الفضاء المتجهي' : 'Vector Index Coverage'}
                  </span>
                  <span className="text-sm font-mono font-black text-emerald-700">
                    {healthPercentage}%
                  </span>
                </div>
                {/* Progress Bar */}
                <div className="w-full bg-emerald-200/60 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${healthPercentage}%` }}
                  />
                </div>
                <p className="text-[10px] text-emerald-800 leading-normal">
                  {isRtl
                    ? `كافة المقاطع الـ ${totalChunksCount} معالجة ومفهرسة بنموذج text-embedding-004 ومخزنة في Qdrant.`
                    : `All ${totalChunksCount} chunks vector embedded with Google text-embedding-004 & stored in Qdrant.`}
                </p>
              </div>

              {/* Health Checks Diagnostic List */}
              <div className="space-y-2 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <span className="text-slate-700 flex items-center gap-2 font-medium">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>{isRtl ? 'عزل بيانات المستأجر (Multi-Tenant)' : 'Multi-Tenant Isolation'}</span>
                  </span>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-mono">
                    SECURED
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <span className="text-slate-700 flex items-center gap-2 font-medium">
                    <FileCheck className="w-4 h-4 text-emerald-600" />
                    <span>{isRtl ? 'المستندات اليتيمة غير المفهرسة' : 'Orphaned Unindexed Documents'}</span>
                  </span>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-mono">
                    0 DETECTED
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <span className="text-slate-700 flex items-center gap-2 font-medium">
                    <Sparkles className="w-4 h-4 text-indigo-600" />
                    <span>{isRtl ? 'محرك استخراج النصوص (OCR)' : 'OCR Layout Extraction'}</span>
                  </span>
                  <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 font-mono">
                    MISTRAL AI
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <span className="text-slate-700 flex items-center gap-2 font-medium">
                    <Database className="w-4 h-4 text-blue-600" />
                    <span>{isRtl ? 'أبعاد متجهات التضمين' : 'Embedding Vector Dimension'}</span>
                  </span>
                  <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 font-mono">
                    768 DIM (COSINE)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Row: Recent Files Modern Cards Stream */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-3xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    {isRtl ? 'أحدث الملفات والمستندات المضافة' : 'Recently Ingested Documents'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {isRtl ? 'معاينة سريعة للوثائق مع إمكانية فحص متجهات المقاطع فوراً' : 'Instant preview of latest additions with one-click vector inspector'}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setActiveTab('documents')}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition"
              >
                <span>{isRtl ? 'عرض كافة المستندات' : 'View all documents'}</span>
                <ArrowRight className={`w-3.5 h-3.5 ${isRtl ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {recentFiles.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs space-y-2">
                <FileText className="w-8 h-8 text-slate-300 mx-auto" />
                <p>{isRtl ? 'لا توجد مستندات بعد في قاعدة المعرفة.' : 'No documents added yet.'}</p>
                <button
                  onClick={() => setActiveTab('upload')}
                  className="px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold"
                >
                  {isRtl ? 'رفع أول مستند الآن' : 'Ingest First Document'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {recentFiles.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    document={doc}
                    collectionName={getCollectionName(doc.collectionIds?.[0] || doc.metadata?.collectionId)}
                    lang={lang}
                    onPreview={() => setPreviewingDoc(doc)}
                    onInspectChunks={() => setInspectingDoc(doc)}
                    onViewHistory={() => setVersionHistoryDoc(doc)}
                    onReindex={() => handleReindexDocument(doc)}
                    onDelete={() => handleDeleteDocument(doc.id)}
                    isReindexing={reindexingDocId === doc.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. TAB 2: MODERN CARD-BASED DOCUMENT MANAGEMENT VIEW */}
      {activeTab === 'documents' && (
        <div className="space-y-4">
          {/* Controls Bar: Search + Filters + View Mode Switcher */}
          <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-3xs space-y-3">
            <div className="flex flex-col md:flex-row items-center justify-between gap-3">
              {/* Search input */}
              <div className="relative w-full md:w-80">
                <Search className={`w-4 h-4 text-slate-400 absolute top-2.5 ${isRtl ? 'right-3' : 'left-3'}`} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isRtl ? 'بحث في أسماء ونصوص المستندات...' : 'Search document titles and content...'}
                  className={`w-full py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-indigo-500 font-sans ${
                    isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'
                  }`}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className={`absolute top-2 text-slate-400 hover:text-slate-600 text-xs ${isRtl ? 'left-3' : 'right-3'}`}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Filter Selectors & View Mode */}
              <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-end">
                {/* Collection Filter */}
                {collections.length > 0 && (
                  <select
                    value={filterCollection}
                    onChange={(e) => setFilterCollection(e.target.value)}
                    className="px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="all">{isRtl ? 'كافة المجموعات' : 'All Collections'}</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}

                {/* Source Type Filter */}
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="all">{isRtl ? 'كافة الأنواع' : 'All Types'}</option>
                  <option value="pdf">PDF</option>
                  <option value="markdown">Markdown / TXT</option>
                  <option value="web">Web URL</option>
                  <option value="youtube">YouTube</option>
                  <option value="github">GitHub</option>
                  <option value="database">Database</option>
                </select>

                {/* Sort selector */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="date">{isRtl ? 'الأحدث أولاً' : 'Newest'}</option>
                  <option value="name">{isRtl ? 'الاسم' : 'Name'}</option>
                  <option value="chunks">{isRtl ? 'عدد المقاطع' : 'Chunks Count'}</option>
                  <option value="size">{isRtl ? 'الحجم' : 'File Size'}</option>
                </select>

                {/* View Mode Toggle: Grid vs List */}
                <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
                  <button
                    onClick={() => setDocViewMode('grid')}
                    className={`p-1.5 rounded-lg transition cursor-pointer ${
                      docViewMode === 'grid'
                        ? 'bg-white text-indigo-600 shadow-3xs'
                        : 'text-slate-400 hover:text-slate-700'
                    }`}
                    title={isRtl ? 'عرض بطاقات شبكية' : 'Grid View'}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDocViewMode('list')}
                    className={`p-1.5 rounded-lg transition cursor-pointer ${
                      docViewMode === 'list'
                        ? 'bg-white text-indigo-600 shadow-3xs'
                        : 'text-slate-400 hover:text-slate-700'
                    }`}
                    title={isRtl ? 'عرض قائمة' : 'List View'}
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Active Filter Chips */}
            <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
              <span className="font-mono text-[11px]">
                {filteredDocuments.length} {isRtl ? 'مستند متطابق' : 'matching documents'}
              </span>

              {(searchQuery || filterCollection !== 'all' || filterType !== 'all') && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setFilterCollection('all');
                    setFilterType('all');
                  }}
                  className="text-indigo-600 hover:underline text-[11px] font-bold"
                >
                  {isRtl ? 'إعادة ضبط الفلاتر' : 'Reset Filters'}
                </button>
              )}
            </div>
          </div>

          {/* Documents Grid / List Display */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="bg-white rounded-2xl p-5 border border-slate-200 animate-pulse space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="w-8 h-8 bg-slate-200 rounded-xl" />
                    <div className="w-16 h-4 bg-slate-200 rounded-full" />
                  </div>
                  <div className="h-4 bg-slate-200 rounded w-3/4" />
                  <div className="h-3 bg-slate-100 rounded w-full" />
                  <div className="pt-2 border-t border-slate-100 flex justify-between">
                    <div className="w-16 h-3 bg-slate-200 rounded" />
                    <div className="w-16 h-3 bg-slate-200 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="bg-white rounded-3xl p-16 text-center border border-slate-200/80 shadow-3xs space-y-3">
              <Search className="w-10 h-10 text-slate-300 mx-auto" />
              <h4 className="text-sm font-extrabold text-slate-800">
                {isRtl ? 'لم يتم العثور على أي مستندات تطابق معايير البحث' : 'No documents matching your criteria'}
              </h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {isRtl ? 'جرب تغيير كلمات البحث أو إعادة ضبط الفلاتر لعرض كافة الملفات المفهرسة.' : 'Try adjusting your search terms or reset the filters to see all indexed documents.'}
              </p>
              <button
                onClick={() => setActiveTab('upload')}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Upload className="w-4 h-4" />
                <span>{isRtl ? 'رفع مستند جديد' : 'Ingest New Document'}</span>
              </button>
            </div>
          ) : docViewMode === 'grid' ? (
            /* MODERN CARD GRID */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocuments.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  collectionName={getCollectionName(doc.collectionIds?.[0] || doc.metadata?.collectionId)}
                  lang={lang}
                  onPreview={() => setPreviewingDoc(doc)}
                  onInspectChunks={() => setInspectingDoc(doc)}
                  onViewHistory={() => setVersionHistoryDoc(doc)}
                  onReindex={() => handleReindexDocument(doc)}
                  onDelete={() => handleDeleteDocument(doc.id)}
                  isReindexing={reindexingDocId === doc.id}
                />
              ))}
            </div>
          ) : (
            /* DETAILED LIST / TABLE VIEW */
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-3xs overflow-hidden">
              <div className="divide-y divide-slate-150">
                {filteredDocuments.map((doc) => {
                  const collectionName = getCollectionName(doc.collectionIds?.[0] || doc.metadata?.collectionId);
                  const estimatedTokens = Math.round((doc.content?.length || 0) / 4);
                  return (
                    <div
                      key={doc.id}
                      className="p-4 hover:bg-slate-50/80 transition-colors flex items-center justify-between gap-4 flex-wrap"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100 shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-xs font-bold text-slate-900 truncate">
                              {doc.title}
                            </h4>
                            <span className="text-[9px] font-bold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200 font-mono flex items-center gap-0.5">
                              <GitBranch className="w-2.5 h-2.5" />
                              <span>v{doc.version || 1}</span>
                            </span>
                            {collectionName && (
                              <span className="text-[9px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                {collectionName}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono mt-0.5">
                            <span className="text-indigo-600 font-bold">
                              {doc.chunkCount || 0} {isRtl ? 'مقطع' : 'chunks'}
                            </span>
                            <span>~{estimatedTokens} tok</span>
                            <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setVersionHistoryDoc(doc)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-violet-50 text-slate-700 hover:text-violet-700 rounded-lg text-xs font-bold transition flex items-center gap-1 border border-slate-200"
                          title={isRtl ? 'سجل وتاريخ الإصدارات والتراجع' : 'Version History'}
                        >
                          <History className="w-3.5 h-3.5 text-violet-600" />
                          <span>{isRtl ? 'الإصدارات' : 'History'}</span>
                        </button>
                        <button
                          onClick={() => setInspectingDoc(doc)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 rounded-lg text-xs font-bold transition flex items-center gap-1 border border-slate-200"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          <span>{isRtl ? 'المقاطع' : 'Chunks'}</span>
                        </button>
                        <button
                          onClick={() => setPreviewingDoc(doc)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition flex items-center gap-1 border border-slate-200"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{isRtl ? 'معاينة' : 'Preview'}</span>
                        </button>
                        <button
                          onClick={() => handleDeleteDocument(doc.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. TAB 3: COLLECTIONS MAP */}
      {activeTab === 'collections' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between bg-white p-5 rounded-3xl border border-slate-200/80 shadow-3xs">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Folder className="w-4 h-4 text-indigo-600" />
                <span>{isRtl ? 'المجموعات المعرفية المعزولة' : 'Isolated Knowledge Collections'}</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isRtl
                  ? 'تقسيم الوثائق إلى مجالات دلالية مستقلة لتقليل الضوضاء في الاسترجاع المتجهي.'
                  : 'Segment knowledge assets into isolated semantic domains to optimize vector recall accuracy.'}
              </p>
            </div>

            <button
              onClick={() => setIsCreateColModalOpen(true)}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <FolderPlus className="w-4 h-4" />
              <span>{isRtl ? 'إنشاء مجموعة جديدة' : 'New Collection'}</span>
            </button>
          </div>

          {collections.length === 0 ? (
            <div className="bg-white rounded-3xl p-16 text-center border border-slate-200/80 shadow-3xs space-y-3">
              <Folder className="w-10 h-10 text-slate-300 mx-auto" />
              <h4 className="text-sm font-extrabold text-slate-800">
                {isRtl ? 'لا توجد مجموعات معرفية حالياً' : 'No collections created yet'}
              </h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {isRtl ? 'أنشئ مجموعات لتنظيم مستنداتك حسب الأقسام أو المشاريع المعرفية.' : 'Create collections to group and isolate documents by domain or project.'}
              </p>
              <button
                onClick={() => setIsCreateColModalOpen(true)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
              >
                <FolderPlus className="w-4 h-4" />
                <span>{isRtl ? 'إنشاء أول مجموعة' : 'Create First Collection'}</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {collections.map((col) => {
                const colDocs = documents.filter(
                  (d) =>
                    (d.collectionIds && d.collectionIds.includes(col.id)) ||
                    d.metadata?.collectionId === col.id
                );
                const colChunks = colDocs.reduce((sum, d) => sum + (d.chunkCount || 0), 0);

                return (
                  <div
                    key={col.id}
                    className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-3xs space-y-4 hover:border-indigo-200 transition-colors flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="w-10 h-10 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center border border-violet-100">
                          <Folder className="w-5 h-5" />
                        </div>
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono">
                          ISOLATED
                        </span>
                      </div>

                      <h4 className="text-sm font-extrabold text-slate-900 pt-1">
                        {col.name}
                      </h4>
                      <p className="text-xs text-slate-500 line-clamp-2">
                        {col.description || (isRtl ? 'مجموعة معرفية مخصصة' : 'Custom knowledge collection')}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-mono">
                      <span className="font-bold text-indigo-700">
                        {colDocs.length} {isRtl ? 'مستندات' : 'documents'}
                      </span>
                      <span>{colChunks} {isRtl ? 'مقطع' : 'chunks'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 6. TAB 4: FILE INGESTION STUDIO */}
      {activeTab === 'upload' && (
        <DocumentIngestionStudio
          tenantId={tenantId}
          collections={collections}
          lang={lang}
          onNavigateTab={(t) => setActiveTab(t as any)}
          onIngestionCompleted={() => {
            fetchKnowledgeData();
          }}
        />
      )}

      {/* 6.5. TAB 4.5: MISTRAL OCR CACHE MANAGER */}
      {activeTab === 'ocr_cache' && (
        <div className="space-y-6">
          {/* Header & Controls */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between bg-white p-5 rounded-3xl border border-slate-200/80 shadow-3xs gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="p-2.5 rounded-2xl bg-amber-50 border border-amber-200/80 text-amber-600 shadow-3xs">
                  <Zap className="w-5 h-5 fill-amber-500" />
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <span>{isRtl ? 'ذاكرة تخزين نتائج OCR لميسترال (Mistral Document AI Cache)' : 'Mistral OCR Caching Layer'}</span>
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      SHA-256 Active
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {isRtl
                      ? 'تخزين نتائج الـ OCR المستخرجة من Mistral لمنع إعادة طلب API للمستندات الكبيرة وتوفير الرصيد وتقليل زمن الاستجابة إلى 0ms.'
                      : 'Caches extracted text and visual OCR outputs from Mistral API using SHA-256 hashes. Eliminates latency & conserves API quotas.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
              <button
                onClick={refreshOcrCache}
                className="px-3.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{isRtl ? 'تحديث الإحصائيات' : 'Refresh Stats'}</span>
              </button>

              <button
                onClick={() => {
                  if (confirm(isRtl ? 'هل تريد مسح جميع نتائج الـ OCR المخزنة في الذاكرة المؤقتة؟' : 'Clear all cached Mistral OCR results?')) {
                    clearAllOcrCache();
                    refreshOcrCache();
                  }
                }}
                disabled={ocrCacheEntries.length === 0}
                className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isRtl ? 'مسح كل الذاكرة' : 'Clear Cache'}</span>
              </button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-3xs space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">
                {isRtl ? 'المستندات المخزنة' : 'Cached Documents'}
              </span>
              <div className="text-xl font-extrabold text-slate-900 font-mono">
                {ocrCacheStats.count}
              </div>
              <span className="text-[10px] text-slate-500 font-medium">
                {ocrCacheStats.totalPages} {isRtl ? 'صفحات محفوظة' : 'pages total'}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-3xs space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">
                {isRtl ? 'مرات استدعاء الكاش (Hits)' : 'Total Cache Hits'}
              </span>
              <div className="text-xl font-extrabold text-emerald-600 font-mono flex items-center gap-1.5">
                <span>{ocrCacheStats.totalHits}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-sans border border-emerald-100 font-bold">
                  ⚡ 0ms latency
                </span>
              </div>
              <span className="text-[10px] text-slate-500 font-medium">
                {isRtl ? 'طلب API تم توفيره' : 'API requests saved'}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-3xs space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">
                {isRtl ? 'الرموز الموفرة (Tokens)' : 'Tokens Saved'}
              </span>
              <div className="text-xl font-extrabold text-indigo-600 font-mono">
                ~{ocrCacheStats.savedTokens.toLocaleString()}
              </div>
              <span className="text-[10px] text-indigo-600/80 font-medium font-mono">
                Mistral Document AI
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-3xs space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">
                {isRtl ? 'الحجم الإجمالي' : 'Cache Memory Size'}
              </span>
              <div className="text-xl font-extrabold text-slate-900 font-mono">
                {ocrCacheStats.sizeKb} KB
              </div>
              <span className="text-[10px] text-slate-500 font-medium">
                {(ocrCacheStats.savedBytes / (1024 * 1024)).toFixed(1)} MB {isRtl ? 'ملفات معالجة' : 'files cached'}
              </span>
            </div>
          </div>

          {/* Cached Items Table */}
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-3xs overflow-hidden space-y-0">
            <div className="p-4 bg-slate-50/70 border-b border-slate-200/80 flex items-center justify-between text-xs font-bold text-slate-700">
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                <span>{isRtl ? 'قائمة المستندات المسجلة بالذاكرة المؤقتة' : 'Cached OCR Documents Registry'}</span>
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                {ocrCacheEntries.length} {isRtl ? 'عناصر' : 'entries'}
              </span>
            </div>

            {ocrCacheEntries.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <Zap className="w-10 h-10 text-slate-300 mx-auto" />
                <h4 className="text-sm font-extrabold text-slate-800">
                  {isRtl ? 'لا توجد نتائج OCR مخزنة حالياً' : 'No OCR cache entries found'}
                </h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  {isRtl
                    ? 'عند استخدام استوديو الرفع لاستخراج النصوص عبر Mistral OCR، سيتم حفظ النتائج هنا تلقائياً لمنع طلبات API المكررة.'
                    : 'When you upload PDFs in the Ingestion Studio using Mistral OCR, processed results will be cached here automatically.'}
                </p>
                <button
                  onClick={() => setActiveTab('upload')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isRtl ? 'انتقل إلى استوديو الرفع' : 'Go to Ingestion Studio'}</span>
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
                {ocrCacheEntries.map((entry) => {
                  const savedTokens = entry.savedTokensEstimate || Math.round(entry.extractedText.length / 4);
                  return (
                    <div
                      key={entry.cacheKey}
                      className="p-4 hover:bg-slate-50/60 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="p-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 shrink-0 mt-0.5">
                          <FileText className="w-4 h-4" />
                        </div>

                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h5 className="font-extrabold text-slate-900 truncate max-w-xs">
                              {entry.fileName}
                            </h5>
                            <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded border border-slate-200">
                              {(entry.fileSize / (1024 * 1024)).toFixed(2)} MB
                            </span>
                            <span className="text-[10px] font-mono bg-indigo-50 text-indigo-700 px-1.5 py-0.2 rounded border border-indigo-200 font-bold">
                              {entry.engineUsed}
                            </span>
                            <span className="text-[10px] font-mono bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded border border-emerald-200 font-bold flex items-center gap-1">
                              ⚡ {entry.hits} {isRtl ? 'مرات كاش' : 'hits'}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono">
                            <span>Hash: {entry.cacheKey.substring(0, 16)}...</span>
                            <span>•</span>
                            <span>{new Date(entry.cachedAt).toLocaleString()}</span>
                            <span>•</span>
                            <span className="text-emerald-600 font-bold">
                              ~{savedTokens.toLocaleString()} tokens saved
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        <button
                          onClick={() => setPreviewOcrEntry(entry)}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                          title={isRtl ? 'معاينة النص المخزن' : 'Preview Extracted Text'}
                        >
                          <Eye className="w-3.5 h-3.5 text-indigo-600" />
                          <span>{isRtl ? 'معاينة' : 'Preview'}</span>
                        </button>

                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(entry.extractedText);
                            alert(isRtl ? 'تم نسخ النص المخزن للحافظة!' : 'Copied extracted text to clipboard!');
                          }}
                          className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition cursor-pointer"
                          title={isRtl ? 'نسخ النص' : 'Copy Text'}
                        >
                          <Copy className="w-3.5 h-3.5 text-slate-600" />
                        </button>

                        <button
                          onClick={() => {
                            deleteOcrCacheEntry(entry.cacheKey);
                            refreshOcrCache();
                          }}
                          className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition cursor-pointer"
                          title={isRtl ? 'حذف من الكاش' : 'Delete from cache'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 7. TAB 5: AUTOMATED CONNECTORS */}
      {activeTab === 'connectors' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between bg-white p-5 rounded-3xl border border-slate-200/80 shadow-3xs">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Database className="w-4 h-4 text-indigo-600" />
                <span>{isRtl ? 'موصلات البيانات ومصادر المزامنة' : 'Automated Data Connectors'}</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isRtl ? 'ربط مباشر مع مواقع الويب، مستودعات GitHub، وقواعد البيانات الخارجية.' : 'Continuous live sync with Web URLs, GitHub repositories, and SQL DBs.'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncAllSources}
                disabled={isSyncingAll || sources.length === 0}
                className="px-3.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAll ? 'animate-spin' : ''}`} />
                <span>{isRtl ? 'مزامنة الكل' : 'Sync All'}</span>
              </button>

              <button
                onClick={() => setIsAddSourceOpen(true)}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <Plus className="w-4 h-4" />
                <span>{isRtl ? 'إضافة موصل جديد' : 'Add Connector'}</span>
              </button>
            </div>
          </div>

          {sources.length === 0 ? (
            <div className="bg-white rounded-3xl p-16 text-center border border-slate-200/80 shadow-3xs space-y-3">
              <Database className="w-10 h-10 text-slate-300 mx-auto" />
              <h4 className="text-sm font-extrabold text-slate-800">
                {isRtl ? 'لا توجد موصلات نشطة حالياً' : 'No connectors configured'}
              </h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {isRtl ? 'أضف موصلات لسحب البيانات تلقائياً من المواقع أو GitHub أو Google Drive.' : 'Add connectors to automatically ingest and vectorize remote content.'}
              </p>
              <button
                onClick={() => setIsAddSourceOpen(true)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>{isRtl ? 'إضافة أول موصل' : 'Add First Connector'}</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sources.map((src) => (
                <div
                  key={src.id}
                  className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-3xs space-y-4 hover:border-indigo-200 transition-colors flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
                        {src.type === 'youtube' ? <Youtube className="w-5 h-5 text-rose-600" /> :
                         src.type === 'url' ? <Globe className="w-5 h-5 text-blue-600" /> :
                         src.type === 'github' ? <Github className="w-5 h-5 text-slate-800" /> :
                         src.type === 'database' ? <Database className="w-5 h-5 text-amber-600" /> :
                         <Server className="w-5 h-5 text-violet-600" />}
                      </div>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase font-mono">
                        {src.status || 'HEALTHY'}
                      </span>
                    </div>

                    <h4 className="text-sm font-extrabold text-slate-900 pt-1 truncate">
                      {src.name}
                    </h4>
                    <p className="text-xs text-slate-500 font-mono text-[11px] truncate">
                      {src.config?.url || src.type}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleSyncSource(src.id)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 rounded-xl text-xs font-bold transition flex items-center gap-1 border border-slate-200"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>{isRtl ? 'مزامنة' : 'Sync'}</span>
                    </button>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setViewingLogsSource(src)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                        title={isRtl ? 'عرض السجلات' : 'View Logs'}
                      >
                        <Clock className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setEditingSource(src)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                        title={isRtl ? 'تعديل الإعدادات' : 'Edit Settings'}
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteSource(src.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                        title={isRtl ? 'حذف' : 'Delete'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 8. TAB 6: YOUTUBE TRANSCRIBER STUDIO */}
      {activeTab === 'youtube' && (
        <DocumentIngestionStudio
          tenantId={tenantId}
          collections={collections}
          lang={lang}
          initialTab="youtube"
          onNavigateTab={(t) => setActiveTab(t as any)}
          onIngestionCompleted={() => {
            fetchKnowledgeData();
          }}
        />
      )}

      {/* 9. TAB 7: INTEGRATIONS & API KEYS STATUS */}
      {activeTab === 'keys' && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-3xs space-y-6">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-600" />
              <span>{isRtl ? 'حالة ربط الخدمات الخارجية ومفاتيح الـ AI' : 'External Services & API Key Configurations'}</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {isRtl
                ? 'التحقق من جاهزية محركات المعالجة المتطورة مثل Mistral AI Document OCR و Unstructured و Qdrant Vector Cloud.'
                : 'Real-time status of backend document parsers, vector indexes, and embedding services.'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Gemini API */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">Google Gemini API</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  keysStatus?.geminiActive
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  {keysStatus?.geminiActive ? (isRtl ? 'نشط ✓' : 'Active ✓') : (isRtl ? 'معلق ⚠' : 'Missing ⚠')}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {isRtl ? 'المحرك الدلالي الأساسي وتوليد متجهات text-embedding-004.' : 'Core semantic search and text-embedding-004 vectors.'}
              </p>
              <div className="text-[10px] font-mono bg-slate-100 p-2 rounded text-slate-600">
                GEMINI_API_KEY
              </div>
            </div>

            {/* Qdrant DB */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">Qdrant Vector DB</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {isRtl ? 'متصل ✓' : 'Connected ✓'}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {isRtl ? 'تخزين وفهرسة الفضاء المتجهي المعزول لكل مستأجر.' : 'Vector cluster storage for multi-tenant segment points.'}
              </p>
              <div className="text-[10px] font-mono bg-slate-100 p-2 rounded text-slate-600">
                QDRANT_API_KEY / URL
              </div>
            </div>

            {/* Mistral OCR */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">Mistral Document AI</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  keysStatus?.mistralActive
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  {keysStatus?.mistralActive ? (isRtl ? 'نشط ✓' : 'Active ✓') : (isRtl ? 'اختياري ⚠' : 'Optional ⚠')}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {isRtl ? 'محرك استخراج النصوص المتقدم لملفات الـ PDF المعقدة والمسح الضوئي.' : 'High-precision visual OCR and complex table parser.'}
              </p>
              <div className="text-[10px] font-mono bg-slate-100 p-2 rounded text-slate-600">
                MISTRAL_API_KEY
              </div>
            </div>

            {/* Unstructured Transform */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">Unstructured API</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  keysStatus?.unstructuredActive
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  {keysStatus?.unstructuredActive ? (isRtl ? 'نشط ✓' : 'Active ✓') : (isRtl ? 'اختياري ⚠' : 'Optional ⚠')}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {isRtl ? 'تفكيك مستندات Word و PPTX و HTML إلى صيغ هيكلية.' : 'Multi-format document parsing and table AST mapping.'}
              </p>
              <div className="text-[10px] font-mono bg-slate-100 p-2 rounded text-slate-600">
                UNSTRUCTURED_API_KEY
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 10. TAB 8: MCP CONTEXT MAP */}
      {activeTab === 'mcp' && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-3xs space-y-5">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              <span>{isRtl ? 'موارد بروتوكول سياق النموذج (MCP Resources Inspector)' : 'MCP Context Resources Inspector'}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {isRtl
                ? 'الموارد السياقية المكشوفة لخوادم الـ MCP والتي تتيح للذكاء الاصطناعي قراءة البيانات المعرفية المباشرة.'
                : 'Standardized resource:// endpoints exposed to LLM clients for context retrieval.'}
            </p>
          </div>

          {mcpResources.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              {isRtl ? 'لم يتم العثور على موارد MCP نشطة حالياً.' : 'No active MCP resources found.'}
            </div>
          ) : (
            <div className="space-y-3">
              {mcpResources.map((res) => (
                <div
                  key={res.uri}
                  className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-start justify-between gap-4"
                >
                  <div className="space-y-1">
                    <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                      {res.uri}
                    </span>
                    <h4 className="text-xs font-bold text-slate-900 pt-1">{res.name}</h4>
                    <p className="text-xs text-slate-500">{res.description}</p>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono shrink-0">
                    {new Date(res.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 11. SYSTEM MODALS */}
      {inspectingDoc && (
        <DocumentChunkInspectorModal
          document={inspectingDoc}
          tenantId={tenantId}
          lang={lang}
          onClose={() => setInspectingDoc(null)}
        />
      )}

      {previewingDoc && (
        <DocumentPreviewModal
          document={previewingDoc}
          collectionName={getCollectionName(previewingDoc.collectionIds?.[0] || previewingDoc.metadata?.collectionId)}
          lang={lang}
          onClose={() => setPreviewingDoc(null)}
          onInspectChunks={() => {
            const doc = previewingDoc;
            setPreviewingDoc(null);
            setInspectingDoc(doc);
          }}
        />
      )}

      {versionHistoryDoc && (
        <DocumentVersionHistoryModal
          document={versionHistoryDoc}
          tenantId={tenantId}
          lang={lang}
          onClose={() => setVersionHistoryDoc(null)}
          onReverted={(updatedDoc) => {
            setDocuments((prev) => prev.map((d) => (d.id === updatedDoc.id ? updatedDoc : d)));
            setVersionHistoryDoc(updatedDoc);
            fetchKnowledgeData();
          }}
        />
      )}

      {isHealthModalOpen && (
        <HealthDiagnosticsModal
          tenantId={tenantId}
          totalDocs={totalDocsCount}
          totalChunks={totalChunksCount}
          lang={lang}
          onClose={() => setIsHealthModalOpen(false)}
        />
      )}

      {isCreateColModalOpen && (
        <CreateCollectionModal
          tenantId={tenantId}
          lang={lang}
          onClose={() => setIsCreateColModalOpen(false)}
          onCreated={(newCol) => {
            setCollections((prev) => [...prev, newCol]);
            fetchKnowledgeData();
          }}
        />
      )}

      {editingSource && (
        <EditSourceModal
          source={editingSource}
          lang={lang}
          onClose={() => setEditingSource(null)}
          onSave={handleUpdateSource}
          availableCollections={collections}
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

      {isAddSourceOpen && (
        <AddSourceWizard
          tenantId={tenantId}
          collections={collections}
          lang={lang}
          onCompleted={() => {
            setIsAddSourceOpen(false);
            fetchKnowledgeData();
          }}
          onCancel={() => setIsAddSourceOpen(false)}
        />
      )}

      {previewOcrEntry && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-amber-50 text-amber-600 rounded-lg border border-amber-200">
                  <Zap className="w-4 h-4 fill-amber-500" />
                </span>
                <div>
                  <h4 className="text-xs font-extrabold text-slate-900">
                    {previewOcrEntry.fileName}
                  </h4>
                  <span className="text-[10px] font-mono text-slate-400">
                    Mistral OCR Cache • {previewOcrEntry.extractedText.length.toLocaleString()} characters
                  </span>
                </div>
              </div>

              <button
                onClick={() => setPreviewOcrEntry(null)}
                className="p-1.5 hover:bg-slate-200 rounded-xl text-slate-500 font-bold text-xs transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 font-mono text-xs text-slate-800 whitespace-pre-wrap leading-relaxed bg-slate-950/5 select-text">
              {previewOcrEntry.extractedText}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-mono text-[11px]">
                Engine: {previewOcrEntry.engineUsed}
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(previewOcrEntry.extractedText);
                    alert(isRtl ? 'تم نسخ النص المفرغ للحافظة!' : 'Copied text to clipboard!');
                  }}
                  className="px-3 py-1.5 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{isRtl ? 'نسخ النص' : 'Copy Text'}</span>
                </button>

                <button
                  onClick={() => setPreviewOcrEntry(null)}
                  className="px-3 py-1.5 bg-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-300 transition cursor-pointer"
                >
                  {isRtl ? 'إغلاق' : 'Close'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
