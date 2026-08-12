'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { SourceConnector, SyncLogEntry, McpResourceItem, Collection, Document, DocumentChunk } from '@/lib/types/omnirag';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import { AddSourceWizard } from './AddSourceWizard';
import { DocumentIngestionStudio } from './DocumentIngestionStudio';
import { EditSourceModal } from './EditSourceModal';
import { SyncLogModal } from './SyncLogModal';
import { CreateCollectionModal } from './CreateCollectionModal';
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
} from 'lucide-react';

interface SourcesDashboardProps {
  tenantId?: string;
  lang?: 'ar' | 'en';
}

interface KeysStatus {
  mistralActive: boolean;
  unstructuredActive: boolean;
  geminiActive: boolean;
  qdrantActive: boolean;
}

export function SourcesDashboard({ tenantId = 'tenant-acme-01', lang = 'ar' }: SourcesDashboardProps) {
  const [activeTab, setActiveTab] = useState<'connectors' | 'collections' | 'add' | 'upload' | 'documents' | 'mcp' | 'keys' | 'youtube'>('connectors');
  const [sources, setSources] = useState<SourceConnector[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([]);
  const [mcpResources, setMcpResources] = useState<McpResourceItem[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [selectedDocChunks, setSelectedDocChunks] = useState<DocumentChunk[]>([]);
  const [isLoadingChunks, setIsLoadingChunks] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [docViewMode, setDocViewMode] = useState<'list' | 'grid'>('list');
  
  // Real-time API keys verification status
  const [keysStatus, setKeysStatus] = useState<KeysStatus | null>(null);

  // Filters & searches state
  const [filterType, setFilterType] = useState<string>('all');
  const [filterHealth, setFilterHealth] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'type' | 'status' | 'date'>('date');
  const [searchQuery, setSearchQuery] = useState('');
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const [docCollectionFilter, setDocCollectionFilter] = useState<string>('all');

  // Modals state
  const [editingSource, setEditingSource] = useState<SourceConnector | null>(null);
  const [viewingLogsSource, setViewingLogsSource] = useState<SourceConnector | null>(null);
  const [isCreateColModalOpen, setIsCreateColModalOpen] = useState(false);

  // Copy feedback state
  const [copiedChunkId, setCopiedChunkId] = useState<string | null>(null);

  const fetchSourcesData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sourcesRes, colsRes, docsRes, keysRes] = await Promise.all([
        fetchWithAuth(`/api/v1/sources?tenantId=${tenantId}`),
        fetchWithAuth(`/api/v1/collections?tenantId=${tenantId}`),
        fetchWithAuth(`/api/v1/documents?tenantId=${tenantId}`),
        fetchWithAuth('/api/v1/sources/api-keys-status'),
      ]);

      let sourcesData: any = {};
      let colsData: any = {};
      let docsData: any = {};
      let keysData: any = null;

      try {
        if (sourcesRes.ok) sourcesData = await sourcesRes.json();
      } catch (e) {
        console.warn('Failed to parse sources JSON:', e);
      }

      try {
        if (colsRes.ok) colsData = await colsRes.json();
      } catch (e) {
        console.warn('Failed to parse collections JSON:', e);
      }

      try {
        if (docsRes.ok) docsData = await docsRes.json();
      } catch (e) {
        console.warn('Failed to parse documents JSON:', e);
      }

      try {
        if (keysRes.ok) keysData = await keysRes.json();
      } catch (e) {
        console.warn('Failed to parse api-keys-status JSON:', e);
      }

      if (sourcesData.sources) setSources(sourcesData.sources);
      if (sourcesData.syncLogs) setSyncLogs(sourcesData.syncLogs);
      if (sourcesData.mcpResources) setMcpResources(sourcesData.mcpResources);
      if (colsData.collections) setCollections(colsData.collections);
      if (keysData) setKeysStatus(keysData);
      
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

  // Fetch chunks whenever selectedDoc changes
  const fetchChunksForDoc = useCallback(async (docId: string) => {
    setIsLoadingChunks(true);
    try {
      const res = await fetchWithAuth(`/api/v1/documents?tenantId=${tenantId}&documentId=${docId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.chunks) {
          setSelectedDocChunks(data.chunks);
        }
      }
    } catch (err) {
      console.error('Error loading document chunks:', err);
    } finally {
      setIsLoadingChunks(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (selectedDoc) {
      fetchChunksForDoc(selectedDoc.id);
    } else {
      setSelectedDocChunks([]);
    }
  }, [selectedDoc, fetchChunksForDoc]);

  // Sync single source
  const handleSyncSource = async (sourceId: string) => {
    try {
      const res = await fetchWithAuth(`/api/v1/sources/${sourceId}/sync`, {
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
      await fetchSourcesData();
    } catch (err) {
      console.error('Sync all failed:', err);
    } finally {
      setIsSyncingAll(false);
    }
  };

  // Delete source
  const handleDeleteSource = async (sourceId: string) => {
    if (!confirm(lang === 'ar' ? 'هل أنت تأكد من حذف هذا الموصل وإلغاء فهرسة مستنداته؟' : 'Are you sure you want to delete this source connector?')) return;
    try {
      const res = await fetchWithAuth(`/api/v1/sources?id=${sourceId}&tenantId=${tenantId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchSourcesData();
      }
    } catch (err) {
      console.error('Delete source failed:', err);
    }
  };

  // Delete Document
  const handleDeleteDocument = async (docId: string) => {
    if (!confirm(lang === 'ar' ? 'هل تود حذف هذا المستند ومتجهاته نهائياً من Qdrant؟' : 'Permanently delete this document and its Qdrant vectors?')) return;
    try {
      const res = await fetchWithAuth(`/api/v1/documents?id=${docId}&tenantId=${tenantId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSelectedDoc(null);
        fetchSourcesData();
      }
    } catch (err) {
      console.error('Delete document failed:', err);
    }
  };

  // Update source config
  const handleUpdateSource = async (id: string, updates: Partial<SourceConnector>) => {
    await fetchWithAuth(`/api/v1/sources/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, ...updates }),
    });
    fetchSourcesData();
  };

  // Copy chunk text helper
  const handleCopyChunk = (chunkId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedChunkId(chunkId);
    setTimeout(() => setCopiedChunkId(null), 1800);
  };

  const filteredSources = sources
    .filter((s) => {
      const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.type.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = filterType === 'all' || s.type === filterType;
      const matchesHealth = filterHealth === 'all' || s.status === filterHealth;
      return matchesSearch && matchesType && matchesHealth;
    })
    .sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'type') {
        return a.type.localeCompare(b.type);
      }
      if (sortBy === 'status') {
        return a.status.localeCompare(b.status);
      }
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch = doc.title.toLowerCase().includes(docSearchQuery.toLowerCase()) || doc.content.toLowerCase().includes(docSearchQuery.toLowerCase());
    const matchesCollection = docCollectionFilter === 'all' || (doc.collectionIds && doc.collectionIds.includes(docCollectionFilter));
    return matchesSearch && matchesCollection;
  });

  const getSourceIcon = (type: string) => {
    switch (type) {
      case 'file': return <FileText className="w-5 h-5 text-indigo-600" />;
      case 'pdf': return <FileText className="w-5 h-5 text-rose-600" />;
      case 'text': return <FileCheck className="w-5 h-5 text-emerald-600" />;
      case 'sample': return <Sparkles className="w-5 h-5 text-indigo-500" />;
      case 'url': return <Globe className="w-5 h-5 text-blue-600" />;
      case 'youtube': return <Youtube className="w-5 h-5 text-rose-600" />;
      case 'github': return <Github className="w-5 h-5 text-slate-800" />;
      case 'database': return <Database className="w-5 h-5 text-amber-600" />;
      case 'gdrive': return <FolderPlus className="w-5 h-5 text-emerald-600" />;
      case 'custom_mcp': return <Zap className="w-5 h-5 text-amber-500" />;
      default: return <Server className="w-5 h-5 text-violet-600" />;
    }
  };

  // Improved Status Badges for Ingested Documents
  const getDocStatusBadge = (status: 'pending' | 'processing' | 'indexed' | 'failed' | string) => {
    switch (status) {
      case 'indexed':
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60 shadow-3xs uppercase tracking-wide">
            <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
            {isRtl ? 'مفهرس' : 'Indexed'}
          </span>
        );
      case 'processing':
      case 'indexing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/60 shadow-3xs uppercase tracking-wide">
            <span className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse" />
            {isRtl ? 'فهرسة...' : 'Indexing...'}
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-200/60 shadow-3xs uppercase tracking-wide">
            <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
            {isRtl ? 'معلق' : 'Pending'}
          </span>
        );
      case 'failed':
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full bg-rose-50 text-rose-700 border border-rose-200/60 shadow-3xs uppercase tracking-wide">
            <span className="w-1 h-1 rounded-full bg-rose-500" />
            {isRtl ? 'فشل' : 'Failed'}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full bg-slate-50 text-slate-700 border border-slate-200/60 shadow-3xs uppercase tracking-wide">
            {status || 'INDEXED'}
          </span>
        );
    }
  };

  // Document management list/grid skeleton loader
  const DocumentSkeleton = () => (
    <div className={docViewMode === 'grid' ? "grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[500px] overflow-y-auto pr-1" : "space-y-3 max-h-[500px] overflow-y-auto pr-1"}>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-slate-50/50 rounded-2xl p-4 border border-slate-150 animate-pulse space-y-3 shadow-3xs">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 bg-slate-200 rounded-xl" />
            <div className="w-16 h-4 bg-slate-200 rounded-full" />
          </div>
          <div className="space-y-1.5">
            <div className="h-3.5 bg-slate-200 rounded w-5/6" />
            <div className="h-2.5 bg-slate-200 rounded w-1/2" />
          </div>
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <div className="w-14 h-2.5 bg-slate-200 rounded" />
            <div className="w-14 h-2.5 bg-slate-200 rounded" />
          </div>
        </div>
      ))}
    </div>
  );

  // Document Chunk list skeleton loader
  const ChunkSkeleton = () => (
    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
      {[1, 2].map((i) => (
        <div key={i} className="p-4 rounded-xl bg-slate-900 border border-slate-800 animate-pulse space-y-3 shadow-3xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="w-20 h-3.5 bg-slate-800 rounded" />
            <div className="w-24 h-2.5 bg-slate-800 rounded" />
          </div>
          <div className="space-y-2">
            <div className="h-3 bg-slate-800 rounded w-full" />
            <div className="h-3 bg-slate-800 rounded w-11/12" />
            <div className="h-3 bg-slate-800 rounded w-5/6" />
          </div>
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
            <div className="w-24 h-2 bg-slate-800 rounded" />
            <div className="w-16 h-2 bg-slate-800 rounded" />
          </div>
        </div>
      ))}
    </div>
  );

  // Automated Connectors Grid loading skeleton loader
  const ConnectorsSkeleton = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-2xl p-5 border border-slate-200 animate-pulse space-y-4 shadow-3xs flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 animate-pulse shrink-0 border border-slate-200" />
                <div className="space-y-2">
                  <div className="h-3.5 bg-slate-200 rounded w-24" />
                  <div className="h-2.5 bg-slate-200 rounded w-12" />
                </div>
              </div>
              <div className="w-14 h-4 bg-slate-200 rounded-full" />
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-2">
              <div className="flex items-center justify-between">
                <div className="w-20 h-2 bg-slate-200 rounded" />
                <div className="w-10 h-2.5 bg-slate-200 rounded" />
              </div>
              <div className="flex items-center justify-between">
                <div className="w-16 h-2 bg-slate-200 rounded" />
                <div className="w-12 h-2 bg-slate-200 rounded" />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
            <div className="w-20 h-7 bg-slate-200 rounded-lg" />
            <div className="flex gap-1.5">
              <div className="w-7 h-7 bg-slate-200 rounded-lg" />
              <div className="w-7 h-7 bg-slate-200 rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  // Isolated Knowledge Collections loading skeleton loader
  const CollectionsSkeleton = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-2xl p-5 border border-slate-200 animate-pulse space-y-3 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="w-10 h-10 rounded-xl bg-slate-100 animate-pulse shrink-0 border border-slate-200" />
              <div className="w-14 h-5 bg-slate-200 rounded-full" />
            </div>
            <div className="h-4 bg-slate-200 rounded w-2/3" />
            <div className="space-y-1.5 pt-1">
              <div className="h-3 bg-slate-200 rounded w-full" />
              <div className="h-3 bg-slate-200 rounded w-5/6" />
            </div>
          </div>
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <div className="w-16 h-3 bg-slate-200 rounded" />
            <div className="w-24 h-4 bg-slate-200 rounded" />
          </div>
        </div>
      ))}
    </div>
  );

  const totalDocsCount = sources.reduce((acc, curr) => acc + (curr.documentCount || 0), 0);
  const healthyCount = sources.filter((s) => s.status === 'healthy').length;

  const isRtl = lang === 'ar';

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* 1. Header Section: Refined, elegant branding without splash headers */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              {isRtl ? 'بوابة إدارة البيانات الموحدة' : 'Unified Ingestion Hub'}
            </span>
            <span className="text-[10px] uppercase font-mono font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
              Qdrant & Hybrid Multi-Tenant
            </span>
          </div>
          <h1 className="text-xl font-extrabold text-slate-900 leading-tight">
            {isRtl ? 'لوحة التحكم والربط المعرفي' : 'Knowledge Control Room'}
          </h1>
          <p className="text-xs text-slate-500 max-w-2xl">
            {isRtl 
              ? 'بوابة تحكم مركزية لربط المجموعات المعرفية، رفع المستندات الحية، إدارة موصلات البيانات، وإعداد خوادم سياق بروتوكول MCP.'
              : 'Enterprise-grade command room to manage knowledge pipelines, live-chunk documents, configure automated connectors, and inspect active MCP servers.'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative group">
            <button
              onClick={fetchSourcesData}
              className="p-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl transition flex items-center justify-center cursor-pointer shadow-3xs"
            >
              <RefreshCw className={`w-4 h-4 text-slate-500 ${isLoading ? 'animate-spin text-indigo-600' : ''}`} />
            </button>
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block px-2 py-1 bg-slate-800 text-white text-[10px] rounded shadow-lg whitespace-nowrap z-50">
              {isRtl ? 'تحديث ومزامنة' : 'Sync Status'}
            </div>
          </div>
        </div>
      </div>

      {/* 2. System Status Ribbon: Flat, high-contrast, beautiful micro-states */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-3xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{isRtl ? 'الموصلات النشطة' : 'Active Connectors'}</span>
            <div className="text-xl font-extrabold text-slate-950 flex items-baseline gap-2">
              <span>{sources.length}</span>
              <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                {healthyCount} {isRtl ? 'سليمة' : 'healthy'}
              </span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100/50">
            <Database className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-3xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{isRtl ? 'المستندات المفهرسة' : 'Indexed Documents'}</span>
            <div className="text-xl font-extrabold text-slate-950 flex items-baseline gap-1.5">
              <span>{documents.length || totalDocsCount}</span>
              <span className="text-[9px] text-slate-400 font-mono font-medium block truncate max-w-[120px]">
                Qdrant Cloud
              </span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100/50">
            <FileText className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-3xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{isRtl ? 'المجموعات الدلالية' : 'Knowledge Domains'}</span>
            <div className="text-xl font-extrabold text-slate-950 flex items-baseline gap-2">
              <span>{collections.length}</span>
              <span className="text-[10px] text-violet-600 font-bold bg-violet-50 px-1.5 py-0.2 rounded border border-violet-200">
                Isolated
              </span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center border border-violet-100/50">
            <Folder className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-3xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{isRtl ? 'آخر عملية مزامنة' : 'Last Ingestion Event'}</span>
            <div className="text-xs font-mono font-bold text-slate-800">
              {syncLogs.length > 0 ? new Date(syncLogs[0].timestamp).toLocaleTimeString(isRtl ? 'ar-SA' : 'en-US') : 'READY'}
            </div>
            <span className="text-[9px] text-slate-400 block truncate max-w-40 font-bold">
              {syncLogs.length > 0 ? `✓ ${syncLogs[0].message}` : (isRtl ? 'النظام جاهز للاستيعاب' : 'Ready for ingestion')}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-500 flex items-center justify-center border border-slate-100">
            <Clock className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* 3. Advanced Split Operation Panel: Side Menu + Central Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* SIDE BAR MENU (lg:col-span-3) - Compact, structured, premium navigation */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200/80 p-4 space-y-6">
          <div className="space-y-1.5">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              {isRtl ? 'بوابات وعمليات المعرفة' : 'Knowledge Gateways'}
            </span>
            <div className="h-px bg-slate-100 w-full" />
          </div>

          <div className="space-y-1 flex flex-col">
            <span className="text-[9px] font-bold text-slate-400 px-2.5 pb-1 block uppercase">
              {isRtl ? 'الفهرسة والاستيراد' : 'Pipeline & Ingestion'}
            </span>
            
            <button
              onClick={() => setActiveTab('connectors')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                activeTab === 'connectors'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4" />
                <span>{isRtl ? 'الموصلات ومصادر البيانات' : 'Automated Connectors'}</span>
              </div>
              <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${activeTab === 'connectors' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {sources.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('upload')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                activeTab === 'upload'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4" />
                <span>{isRtl ? 'استوديو الرفع والتجزئة' : 'File Ingestion Studio'}</span>
              </div>
              <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-bold uppercase">
                {isRtl ? 'حي' : 'Live'}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('youtube')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                activeTab === 'youtube'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Youtube className="w-4 h-4 text-rose-500" />
                <span>{isRtl ? 'مفرغ يوتيوب (yt-caption)' : 'YouTube Transcriber'}</span>
              </div>
              <span className="text-[9px] bg-rose-100 text-rose-800 px-1.5 py-0.2 rounded font-bold uppercase">
                {isRtl ? 'ذكي' : 'AI'}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('collections')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                activeTab === 'collections'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4" />
                <span>{isRtl ? 'المجموعات المعرفية' : 'Collections Map'}</span>
              </div>
              <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${activeTab === 'collections' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {collections.length}
              </span>
            </button>
          </div>

          <div className="space-y-1 flex flex-col pt-1">
            <span className="text-[9px] font-bold text-slate-400 px-2.5 pb-1 block uppercase">
              {isRtl ? 'المستودع والدلائل' : 'Vectors & Protocols'}
            </span>

            <button
              onClick={() => setActiveTab('documents')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                activeTab === 'documents'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4" />
                <span>{isRtl ? 'المستندات ومتجهات Qdrant' : 'Qdrant Vectors'}</span>
              </div>
              <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${activeTab === 'documents' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {documents.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('mcp')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                activeTab === 'mcp'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                <span>{isRtl ? 'بروتوكول وسياق MCP' : 'MCP Context Map'}</span>
              </div>
              <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-bold font-mono">
                {mcpResources.length}
              </span>
            </button>
          </div>

          <div className="space-y-1 flex flex-col pt-1">
            <span className="text-[9px] font-bold text-slate-400 px-2.5 pb-1 block uppercase">
              {isRtl ? 'تكاملات ومفاتيح الخدمات' : 'Keys & Integrations'}
            </span>

            <button
              onClick={() => setActiveTab('keys')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                activeTab === 'keys'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                <span>{isRtl ? 'حالة المفاتيح والربط المتقدم' : 'Mistral & Keys Status'}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>
            </button>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-3">
            <button
              onClick={() => setActiveTab('add')}
              className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{isRtl ? 'موصل بيانات جديد' : 'New Connector'}</span>
            </button>

            {/* Quick keys diagnostic banner */}
            <div className="bg-slate-50 border border-slate-150 p-3 rounded-xl text-[11px] text-slate-600 space-y-2">
              <div className="font-bold text-slate-700 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                <span>{isRtl ? 'التحقق السريع من الأمن' : 'Pipeline Safety'}</span>
              </div>
              <p className="leading-normal text-slate-500">
                {isRtl
                  ? 'يتم عزل المستندات والمتجهات لكل مستأجر RLS تلقائياً.'
                  : 'RLS ensures strictly isolated vector space for multi-tenant keys.'}
              </p>
            </div>
          </div>
        </div>

        {/* MAIN DYNAMIC CONTENT WORKSPACE (lg:col-span-9) */}
        <div className="lg:col-span-9 min-h-[600px]">
          
          {/* TAB 1: AUTOMATED CONNECTORS GRID */}
          {activeTab === 'connectors' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-3xs">
                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={isRtl ? 'بحث في موصلات البيانات النشطة...' : 'Search active data connectors...'}
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-indigo-500 font-sans"
                  />
                </div>

                <div className="flex items-center gap-3 shrink-0 w-full sm:w-auto">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-bold text-slate-500">{isRtl ? 'النوع:' : 'Type:'}</span>
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      className="px-2.5 py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="all">{isRtl ? 'كافة الأنواع' : 'All Types'}</option>
                      <option value="file">Files / Storage</option>
                      <option value="url">Web Crawlers</option>
                      <option value="youtube">YouTube</option>
                      <option value="github">GitHub</option>
                      <option value="database">SQL Databases</option>
                      <option value="gdrive">Google Drive</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-bold text-slate-500">{isRtl ? 'الحالة:' : 'Status:'}</span>
                    <select
                      value={filterHealth}
                      onChange={(e) => setFilterHealth(e.target.value)}
                      className="px-2.5 py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="all">{isRtl ? 'كافة الحالات' : 'All Health'}</option>
                      <option value="healthy">Healthy</option>
                      <option value="degraded">Degraded</option>
                      <option value="failed">Failed</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-bold text-slate-500">{isRtl ? 'ترتيب حسب:' : 'Sort by:'}</span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="px-2.5 py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="date">{isRtl ? 'الأحدث إنشائاً' : 'Newest'}</option>
                      <option value="name">{isRtl ? 'الاسم أبجدياً' : 'Name'}</option>
                      <option value="type">{isRtl ? 'نوع الموصل' : 'Type'}</option>
                      <option value="status">{isRtl ? 'الحالة الصحية' : 'Health Status'}</option>
                    </select>
                  </div>
                </div>
              </div>

              {isLoading ? (
                <ConnectorsSkeleton />
              ) : filteredSources.length === 0 ? (
                <div className="bg-white rounded-3xl p-12 text-center border border-slate-200/80 space-y-3 shadow-3xs">
                  <Database className="w-12 h-12 text-slate-300 mx-auto" />
                  <h3 className="text-sm font-bold text-slate-700">
                    {isRtl ? 'لم يتم العثور على موصلات معرفية مطابقة' : 'No matching connectors found'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {isRtl ? 'جرب البحث بكلمات مختلفة أو أنشئ موصلاً جديداً' : 'Try searching different keywords or add a new data connector'}
                  </p>
                  <button
                    onClick={() => setActiveTab('add')}
                    className="mt-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition cursor-pointer shadow-3xs"
                  >
                    {isRtl ? 'إضافة موصل جديد الآن' : 'Create First Connector'}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredSources.map((source) => (
                    <div
                      key={source.id}
                      className="bg-white rounded-2xl p-5 border border-slate-200 hover:border-indigo-200 shadow-3xs hover:shadow-md transition space-y-4 flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200/60">
                              {getSourceIcon(source.type)}
                            </div>
                            <div>
                              <h3 className="text-xs font-bold text-slate-900 leading-snug">{source.name}</h3>
                              <span className="text-[10px] font-mono uppercase bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 mt-1 inline-block border border-slate-200">
                                {source.type}
                              </span>
                            </div>
                          </div>

                          <span
                            className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase border ${
                              source.status === 'healthy'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : source.status === 'degraded'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          >
                            {source.status}
                          </span>
                        </div>

                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5 text-[11px] text-slate-600 font-sans">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">{isRtl ? 'المستندات المفهرسة:' : 'Indexed Docs:'}</span>
                            <span className="font-bold text-slate-800">{source.documentCount} {isRtl ? 'مستند' : 'docs'}</span>
                          </div>
                          <div className="flex items-center justify-between font-mono text-[10px]">
                            <span className="text-slate-400">{isRtl ? 'جدولة التحديث:' : 'Sync Interval:'}</span>
                            <span className="text-indigo-600 font-bold">{source.syncSchedule}</span>
                          </div>
                          {source.lastSyncAt && (
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-slate-400">{isRtl ? 'آخر تحديث تلقائي:' : 'Last Ingestion:'}</span>
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
                            title={isRtl ? 'تشغيل المزامنة الآن' : 'Trigger pipeline now'}
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>{isRtl ? 'مزامنة' : 'Sync'}</span>
                          </button>
                          <button
                            onClick={() => setViewingLogsSource(source)}
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition cursor-pointer"
                            title={isRtl ? 'سجل العمليات' : 'Pipeline audit logs'}
                          >
                            <Clock className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEditingSource(source)}
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition cursor-pointer"
                            title={isRtl ? 'تعديل الإعدادات' : 'Edit config'}
                          >
                            <Sliders className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteSource(source.id)}
                            className="p-1.5 bg-slate-150 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg text-xs transition cursor-pointer"
                            title={isRtl ? 'حذف الموصل' : 'Delete connector'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: KNOWLEDGE COLLECTIONS MAP */}
          {activeTab === 'collections' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-white p-5 rounded-2xl border border-slate-100 shadow-3xs">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <Folder className="w-4 h-4 text-indigo-600" />
                    <span>{isRtl ? 'إدارة المجموعات المعرفية المعزولة' : 'Isolated Knowledge Collections'}</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {isRtl 
                      ? 'تصنيف وتنظيم مستندات RAG في نطاقات ومجموعات مستقلة لتحديد سياق البحث بدقة.'
                      : 'Isolate or group RAG documents by domain, team, or category to fine-tune retrieval scopes.'}
                  </p>
                </div>

                <button
                  onClick={() => setIsCreateColModalOpen(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
                >
                  <FolderPlus className="w-4 h-4" />
                  <span>{isRtl ? 'إنشاء مجموعة جديدة' : 'Create Collection'}</span>
                </button>
              </div>

              {isLoading ? (
                <CollectionsSkeleton />
              ) : collections.length === 0 ? (
                <div className="bg-white rounded-3xl p-12 text-center border border-slate-200/80 space-y-3 shadow-3xs">
                  <Folder className="w-12 h-12 text-slate-300 mx-auto" />
                  <h3 className="text-sm font-bold text-slate-700">
                    {isRtl ? 'لا توجد مجموعات معرفية حالياً' : 'No collections available'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {isRtl ? 'أنشئ أول مجموعة معرفية لتنظيم سياق المستندات' : 'Create your first knowledge collection to group your RAG documents.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {collections.map((col) => {
                    const docsInCol = documents.filter((d) => d.collectionIds && d.collectionIds.includes(col.id)).length;
                    return (
                      <div
                        key={col.id}
                        className="bg-white rounded-2xl p-5 border border-slate-200 hover:border-indigo-300 shadow-3xs transition space-y-3 flex flex-col justify-between"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0 border border-violet-100">
                              <Folder className="w-5 h-5" />
                            </div>
                            <span className="text-xs font-bold font-mono bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-0.5 rounded-full">
                              {docsInCol || col.documentCount || 0} {isRtl ? 'مستند' : 'docs'}
                            </span>
                          </div>

                          <h4 className="text-xs font-extrabold text-slate-900 pt-1 leading-tight">{col.name}</h4>
                          <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{col.description}</p>
                        </div>

                        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px]">
                          <span className="text-slate-400 font-mono">ID: {col.id}</span>
                          <button
                            onClick={() => {
                              setDocCollectionFilter(col.id);
                              setActiveTab('documents');
                            }}
                            className="text-indigo-600 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                          >
                          <span>{isRtl ? 'استعراض المستندات' : 'View Documents'}</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          )}

          {/* TAB 3: LIVE FILE UPLOAD STUDIO */}
          {activeTab === 'upload' && (
            <DocumentIngestionStudio
              tenantId={tenantId}
              collections={collections}
              lang={lang}
              onNavigateTab={(tab) => setActiveTab(tab as any)}
              onIngestionCompleted={() => {
                fetchSourcesData();
              }}
            />
          )}

          {/* TAB 3.5: DEDICATED YOUTUBE CAPTION TRANSCRIBER (yt-caption) */}
          {activeTab === 'youtube' && (
            <DocumentIngestionStudio
              tenantId={tenantId}
              collections={collections}
              lang={lang}
              initialTab="youtube"
              onNavigateTab={(tab) => setActiveTab(tab as any)}
              onIngestionCompleted={() => {
                fetchSourcesData();
              }}
            />
          )}

          {/* TAB 4: SYSTEM & API KEYS STATUS GRID - Directly addresses User Key Concerns */}
          {activeTab === 'keys' && (
            <div className="space-y-6">
              <div className="bg-white rounded-3xl p-6 border border-slate-150 shadow-3xs space-y-4">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <Key className="w-4 h-4 text-indigo-600" />
                    <span>{isRtl ? 'حالة ربط الخدمات الخارجية ورموز الوصول' : 'External Services & API Keys Status'}</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {isRtl
                      ? 'رصد متكامل لحالة تهيئة مفاتيح الربط مع الخدمات المتقدمة مثل Mistral AI لاستخراج نصوص الصور وملفات الـ PDF المعقدة وتكامل Unstructured.'
                      : 'Verify environment configurations for advanced document parsing tools (Mistral AI Document OCR, Unstructured, Gemini API, Qdrant).'}
                  </p>
                </div>

                {/* API keys status display cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Gemini Key */}
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">Google Gemini API</span>
                      {keysStatus?.geminiActive ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {isRtl ? 'نشط ومتصل ✓' : 'Active ✓'}
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          {isRtl ? 'معطل أو لم يتم إعداده ⚠' : 'Missing ⚠'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 leading-normal">
                      {isRtl
                        ? 'مطلوب للمحرك الأساسي وعمليات التجزئة الدلالية وتوسيع الاستعلامات الهجينة.'
                        : 'Required for core retrieval augmented generation (RAG) capabilities & semantic search.'}
                    </p>
                    <div className="text-[10px] font-mono bg-slate-100 p-2 rounded text-slate-600 border border-slate-150">
                      GEMINI_API_KEY
                    </div>
                  </div>

                  {/* Qdrant DB */}
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">Qdrant Vector Database</span>
                      {keysStatus?.qdrantActive ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {isRtl ? 'نشط ومفعل ✓' : 'Connected ✓'}
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 border border-slate-300">
                          {isRtl ? 'محاكاة محلية نشطة' : 'Local Sandbox Active'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 leading-normal">
                      {isRtl
                        ? 'فهرس الفضاء المتجهي المعتمد لعزل متجهات مستندات RAG الدلالية لكل مستأجر.'
                        : 'Vector cluster used to index, store, and segment isolated multi-tenant embedded documents.'}
                    </p>
                    <div className="text-[10px] font-mono bg-slate-100 p-2 rounded text-slate-600 border border-slate-150">
                      QDRANT_API_KEY / URL
                    </div>
                  </div>

                  {/* Mistral OCR */}
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-800">Mistral Document AI</span>
                        <span className="text-[9px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.2 rounded font-bold uppercase">
                          OCR + LAYOUT
                        </span>
                      </div>
                      {keysStatus?.mistralActive ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {isRtl ? 'نشط ومتصل ✓' : 'Active ✓'}
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          {isRtl ? 'لم يتم إدخال مفتاح ⚠' : 'Key Missing ⚠'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 leading-normal">
                      {isRtl
                        ? 'محرك استخراج نصوص متقدم ومعالجة ملفات PDF المعقدة والمسح الضوئي البصري.'
                        : 'Advanced AI-based OCR engine designed for parsing dense text and tables in visual documents.'}
                    </p>
                    <div className="text-[10px] font-mono bg-slate-100 p-2 rounded text-slate-600 border border-slate-150">
                      MISTRAL_API_KEY
                    </div>
                  </div>

                  {/* Unstructured API */}
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-800">Unstructured Transform API</span>
                        <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.2 rounded font-bold uppercase">
                          MCP
                        </span>
                      </div>
                      {keysStatus?.unstructuredActive ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {isRtl ? 'نشط ومتصل ✓' : 'Active ✓'}
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          {isRtl ? 'لم يتم إدخال مفتاح ⚠' : 'Key Missing ⚠'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 leading-normal">
                      {isRtl
                        ? 'تفكيك مستندات PDF الملتوية وتحويلها لصيغ هيكلية نظيفة مع تمييز العناوين والجداول.'
                        : 'Performs multi-format structural analysis, metadata parsing, and document mapping.'}
                    </p>
                    <div className="text-[10px] font-mono bg-slate-100 p-2 rounded text-slate-600 border border-slate-150">
                      UNSTRUCTURED_API_KEY
                    </div>
                  </div>
                </div>

                {/* Instructions on how to configure */}
                <div className="p-4 rounded-2xl bg-indigo-50/50 border border-indigo-150 space-y-2 text-xs text-indigo-950 font-sans leading-relaxed">
                  <h4 className="font-bold text-indigo-900 flex items-center gap-1">
                    <HelpCircle className="w-4 h-4 text-indigo-700" />
                    <span>{isRtl ? 'كيف أقوم بتفعيل وتزويد هذه المفاتيح؟' : 'How do I supply these credentials?'}</span>
                  </h4>
                  <p>
                    {isRtl
                      ? 'بإمكانك توفير قيم هذه المتغيرات في البيئة السحابية عبر صفحة الإعدادات (Settings) السفلية لـ AI Studio أو كتابتها في ملف .env بالخادم قبل البدء بالتشغيل لتشغيل محرك المعالجة المتطور.'
                      : 'Supply these variables in your deployment environment or the AI Studio secrets configuration tab. They will be dynamically referenced by our server-side processors.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: VECTOR DATABASE INSPECTOR */}
          {activeTab === 'documents' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left col: documents list & grid options (lg:col-span-5) */}
              <div className="lg:col-span-5 bg-white rounded-2xl p-4 border border-slate-200/80 shadow-3xs space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <div className="space-y-0.5">
                    <h3 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-indigo-600" />
                      <span>{isRtl ? 'قائمة مستندات المستأجر' : 'Tenant Ingested Documents'}</span>
                    </h3>
                    <p className="text-[10px] text-slate-400">
                      {isRtl ? `${filteredDocuments.length} مستند نشط` : `${filteredDocuments.length} active documents`}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-1.5">
                    {/* View Mode Toggle */}
                    <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                      <button
                        onClick={() => setDocViewMode('list')}
                        className={`p-1 rounded-md transition cursor-pointer ${
                          docViewMode === 'list' ? 'bg-white text-indigo-600 shadow-3xs' : 'text-slate-400 hover:text-slate-700'
                        }`}
                        title={isRtl ? 'عرض القائمة' : 'List view'}
                      >
                        <List className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDocViewMode('grid')}
                        className={`p-1 rounded-md transition cursor-pointer ${
                          docViewMode === 'grid' ? 'bg-white text-indigo-600 shadow-3xs' : 'text-slate-400 hover:text-slate-700'
                        }`}
                        title={isRtl ? 'عرض بطاقات شبكية' : 'Grid view'}
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <button
                      onClick={fetchSourcesData}
                      className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-lg transition cursor-pointer"
                      title={isRtl ? 'تحديث القائمة' : 'Sync list'}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={docSearchQuery}
                      onChange={(e) => setDocSearchQuery(e.target.value)}
                      placeholder={isRtl ? 'تصفية المستندات المرفوعة...' : 'Filter ingested documents...'}
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-indigo-500 font-sans"
                    />
                  </div>

                  {collections.length > 0 && (
                    <select
                      value={docCollectionFilter}
                      onChange={(e) => setDocCollectionFilter(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 font-medium focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="all">{isRtl ? 'كافة المجموعات المعرفية' : 'All Collections'}</option>
                      {collections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {isLoading ? (
                  <DocumentSkeleton />
                ) : filteredDocuments.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs space-y-2">
                    <Search className="w-8 h-8 text-slate-300 mx-auto" />
                    <p>{isRtl ? 'لم يتم العثور على أي مستندات متطابقة.' : 'No matching documents found.'}</p>
                  </div>
                ) : docViewMode === 'list' ? (
                  /* ENHANCED CARD-BASED LIST VIEW */
                  <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                    {filteredDocuments.map((doc) => {
                      const isSelected = selectedDoc?.id === doc.id;
                      const srcType = doc.metadata?.connectorType || doc.sourceType;
                      return (
                        <div
                          key={doc.id}
                          onClick={() => setSelectedDoc(doc)}
                          className={`group p-3 rounded-xl border cursor-pointer transition-all duration-200 flex items-start justify-between gap-3 ${
                            isSelected
                              ? 'bg-indigo-50/70 border-indigo-200 shadow-3xs'
                              : 'bg-white border-slate-150 hover:bg-slate-50/60 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                              isSelected
                                ? 'bg-indigo-600 text-white border-indigo-700 shadow-3xs'
                                : 'bg-slate-100 text-slate-600 border-slate-200 group-hover:bg-indigo-50 group-hover:text-indigo-600 group-hover:border-indigo-200'
                            } transition`}>
                              {srcType === 'youtube' ? <Youtube className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-rose-600'}`} /> :
                               srcType === 'url' ? <Globe className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-blue-600'}`} /> :
                               srcType === 'github' ? <Github className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-slate-800'}`} /> :
                               srcType === 'database' ? <Database className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-amber-600'}`} /> :
                               srcType === 'gdrive' ? <FolderPlus className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-emerald-600'}`} /> :
                               <FileText className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-indigo-600'}`} />}
                            </div>
                            <div className="min-w-0 space-y-0.5">
                              <h4 className="text-xs font-bold text-slate-900 leading-tight group-hover:text-indigo-950 transition break-all">
                                {doc.title}
                              </h4>
                              <div className="flex items-center gap-2 text-[10px] text-slate-500 font-sans font-medium">
                                <span className="font-mono text-indigo-600 font-bold bg-indigo-50 px-1 py-0.2 rounded border border-indigo-100 shrink-0">
                                  {doc.chunkCount} {isRtl ? 'مقطع' : 'chunks'}
                                </span>
                                <span className="uppercase font-mono bg-slate-100 px-1 rounded text-slate-600 border border-slate-200 text-[9px] shrink-0 font-bold">
                                  {doc.language}
                                </span>
                                <span className="text-slate-400 font-mono text-[9px] truncate">
                                  {new Date(doc.createdAt).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="shrink-0 pt-0.5">
                            {getDocStatusBadge(doc.status)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* PREMIUM CARD-BASED GRID VIEW */
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-h-[500px] overflow-y-auto pr-1">
                    {filteredDocuments.map((doc) => {
                      const isSelected = selectedDoc?.id === doc.id;
                      const srcType = doc.metadata?.connectorType || doc.sourceType;
                      return (
                        <div
                          key={doc.id}
                          onClick={() => setSelectedDoc(doc)}
                          className={`group p-4 rounded-xl border cursor-pointer transition-all duration-200 flex flex-col justify-between space-y-3 ${
                            isSelected
                              ? 'bg-indigo-50/70 border-indigo-200 shadow-2xs ring-1 ring-indigo-100'
                              : 'bg-white border-slate-150 hover:bg-slate-50 hover:border-slate-300'
                          }`}
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
                                isSelected ? 'bg-indigo-600 text-white border-indigo-700 shadow-3xs' : 'bg-slate-50 border-slate-200'
                              }`}>
                                {srcType === 'youtube' ? <Youtube className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-rose-600'}`} /> :
                                 srcType === 'url' ? <Globe className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-blue-600'}`} /> :
                                 srcType === 'github' ? <Github className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-slate-800'}`} /> :
                                 srcType === 'database' ? <Database className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-amber-600'}`} /> :
                                 srcType === 'gdrive' ? <FolderPlus className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-emerald-600'}`} /> :
                                 <FileText className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-indigo-600'}`} />}
                              </div>
                              {getDocStatusBadge(doc.status)}
                            </div>

                            <h4 className="text-xs font-bold text-slate-900 leading-tight line-clamp-2 pt-0.5 break-all">
                              {doc.title}
                            </h4>
                          </div>

                          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                            <span className="font-bold text-indigo-600 bg-indigo-50 px-1 py-0.2 rounded">
                              {doc.chunkCount} {isRtl ? 'مقطع' : 'chunks'}
                            </span>
                            <span className="text-[9px] text-slate-400">
                              {new Date(doc.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right col: Selected document chunk inspector (lg:col-span-7) */}
              <div className="lg:col-span-7">
                {selectedDoc ? (
                  <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-3xs space-y-5">
                    {/* Document Header Bar */}
                    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {getDocStatusBadge(selectedDoc.status)}
                          <span className="text-[10px] font-mono text-slate-400">ID: {selectedDoc.id}</span>
                        </div>
                        <h3 className="text-xs font-extrabold text-slate-900 leading-tight break-all">{selectedDoc.title}</h3>
                        <p className="text-[10px] text-slate-500 font-mono">
                          {new Date(selectedDoc.createdAt).toLocaleString(isRtl ? 'ar-SA' : 'en-US')} | RLS Isolated
                        </p>
                      </div>

                      <button
                        onClick={() => handleDeleteDocument(selectedDoc.id)}
                        className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl transition cursor-pointer flex items-center gap-1 text-[11px] font-bold shrink-0 border border-rose-200 shadow-3xs hover:shadow-2xs"
                        title={isRtl ? 'حذف المستند من نظام Qdrant' : 'Delete Document'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{isRtl ? 'حذف' : 'Delete'}</span>
                      </button>
                    </div>

                    {/* Content View */}
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-xs font-bold text-slate-800 mb-1 flex items-center justify-between font-sans">
                          <span>{isRtl ? 'محتوى النص الكامل المستخلص:' : 'Extracted Text:'}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{selectedDoc.content.length} chars</span>
                        </h4>
                        <div className="text-xs text-slate-700 bg-slate-50 p-3.5 rounded-xl border border-slate-150 max-h-40 overflow-y-auto whitespace-pre-line font-sans leading-relaxed">
                          {selectedDoc.content}
                        </div>
                      </div>

                      {/* Vector pieces */}
                      <div className="space-y-3 pt-3 border-t border-slate-100">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-extrabold text-slate-900 flex items-center gap-2">
                            <Scissors className="w-4 h-4 text-indigo-600" />
                            <span>{isRtl ? 'المقاطع ومتجهات Qdrant الدلالية' : 'Qdrant Vector Pieces'}</span>
                            <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-mono text-[10px] font-bold">
                              {selectedDocChunks.length} Chunks
                            </span>
                          </h4>
                          {isLoadingChunks && <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />}
                        </div>

                        {isLoadingChunks ? (
                          <ChunkSkeleton />
                        ) : ((selectedDoc.status as string) === 'processing' || (selectedDoc.status as string) === 'indexing' || selectedDoc.status === 'pending') ? (
                          <div className="space-y-3">
                            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3 shadow-3xs">
                              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
                                  <span className="text-[10px] text-indigo-400 font-bold font-sans">
                                    {isRtl ? 'جاري تقسيم ومعالجة النصوص دلالياً...' : 'Slicing & processing text...'}
                                  </span>
                                </div>
                                <div className="w-16 h-2 bg-slate-800 rounded animate-pulse" />
                              </div>
                              <div className="space-y-2 animate-pulse">
                                <div className="h-3 bg-slate-850 rounded w-full animate-pulse" />
                                <div className="h-3 bg-slate-850 rounded w-11/12 animate-pulse" />
                              </div>
                            </div>
                            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3 shadow-3xs opacity-60">
                              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-slate-600 animate-pulse" />
                                  <span className="text-[10px] text-slate-500 font-bold font-sans">
                                    {isRtl ? 'بانتظار نموذج ترميز المتجهات...' : 'Waiting for Embedding model...'}
                                  </span>
                                </div>
                                <div className="w-16 h-2 bg-slate-800 rounded" />
                              </div>
                              <div className="space-y-2 opacity-50">
                                <div className="h-3 bg-slate-850 rounded w-5/6" />
                              </div>
                            </div>
                          </div>
                        ) : selectedDocChunks.length === 0 ? (
                          <div className="py-8 text-center text-slate-400 text-xs">
                            {isRtl ? 'لم يتم العثور على أي مقاطع دلالية متوفرة.' : 'No chunks available for this document.'}
                          </div>
                        ) : (
                          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                            {selectedDocChunks.map((chunk, idx) => (
                              <div
                                key={chunk.id}
                                className="p-3.5 rounded-xl bg-slate-900 text-slate-100 border border-slate-800 space-y-2 text-xs font-mono"
                              >
                                <div className="flex items-center justify-between text-[10px] border-b border-slate-800 pb-1.5">
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded bg-indigo-600 text-white font-bold text-[9px]">
                                      Chunk #{idx + 1}
                                    </span>
                                    <span className="text-slate-400 text-[9px]">ID: {chunk.id}</span>
                                  </div>
                                  <button
                                    onClick={() => handleCopyChunk(chunk.id, chunk.content)}
                                    className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition cursor-pointer flex items-center gap-1 text-[9px]"
                                  >
                                    {copiedChunkId === chunk.id ? (
                                      <>
                                        <Check className="w-3 h-3 text-emerald-400" />
                                        <span className="text-emerald-400 font-bold">{isRtl ? 'تم النسخ' : 'Copied'}</span>
                                      </>
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>

                                <p className="text-[11px] text-slate-200 font-sans leading-relaxed whitespace-pre-line">
                                  {chunk.content}
                                </p>

                                <div className="flex items-center justify-between text-[9px] text-slate-400 pt-1 border-t border-slate-800/80">
                                  <span>Embedding: Text-embedding-004 (768d)</span>
                                  <span className="text-emerald-400 font-bold">HNSW Indexed ✓</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 text-xs text-slate-400 space-y-2 shadow-3xs">
                    <FileText className="w-10 h-10 text-slate-300 mx-auto" />
                    <p>{isRtl ? 'اختر مستنداً دلالياً من القائمة لعرض متجهات Qdrant ومعاينة تجزئته ومحتواه.' : 'Select a document to inspect full extracted metadata, content, and dynamic embeddings.'}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 6: MCP SERVER RESOURCES INSPECTOR */}
          {activeTab === 'mcp' && (
            <div className="bg-white rounded-3xl p-6 border border-slate-150 shadow-3xs space-y-5">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-500" />
                  <span>{isRtl ? 'موارد بروتوكول سياق النموذج (MCP Resources Inspector)' : 'MCP Context Resources Inspector'}</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {isRtl
                    ? 'الموارد السياقية المكشوفة لخوادم الـ MCP والتي تتيح للذكاء الاصطناعي قراءة البيانات المعرفية المباشرة عبر رمز URI موحد.'
                    : 'System resource endpoints exposed to standard LLM clients via standardized resource:// URIs.'}
                </p>
              </div>

              {mcpResources.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  {isRtl ? 'لم يتم العثور على خوادم أو موارد MCP نشطة حالياً.' : 'No active MCP servers/resources detected.'}
                </div>
              ) : (
                <div className="space-y-3">
                  {mcpResources.map((res) => (
                    <div
                      key={res.uri}
                      className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-start justify-between gap-4 font-sans"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                            {res.uri}
                          </span>
                          <span className="text-[10px] uppercase font-mono font-bold bg-slate-200 px-1.5 py-0.5 rounded text-slate-700 border border-slate-350">
                            {res.mimeType}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-slate-900 pt-1 leading-tight">{res.name}</h4>
                        <p className="text-xs text-slate-500">{res.description}</p>
                      </div>

                      <div className="text-[10px] text-slate-400 font-mono shrink-0">
                        {new Date(res.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 7: ADD SOURCE WIZARD OVERLAY */}
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

        </div>
      </div>

      {/* 4. SYSTEM MODALS */}
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

      {isCreateColModalOpen && (
        <CreateCollectionModal
          tenantId={tenantId}
          lang={lang}
          onClose={() => setIsCreateColModalOpen(false)}
          onCreated={(newCol) => {
            setCollections((prev) => [...prev, newCol]);
            fetchSourcesData();
          }}
        />
      )}
    </div>
  );
}
