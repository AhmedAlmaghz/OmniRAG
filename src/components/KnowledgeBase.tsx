'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDocumentCache } from '@/hooks/useDocumentCache';
import { OcrCacheEntry } from '@/lib/cache/mistralOcrCache';
import { SourceConnector, SyncLogEntry, McpResourceItem, Collection, Document, DocumentSummary } from '@/lib/types/omnirag';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import { t } from '@/lib/i18n';
import { useToast } from './ui/Toast';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Modal, ModalCloseButton } from './ui/Modal';
import { copyToClipboard } from '@/lib/clipboard';
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
import { ConnectorStatusPill, getSourceTypeIcon } from './knowledge/displayHelpers';
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
  Trash2,
  AlertTriangle,
  FolderPlus,
  Copy,
  Folder,
  Zap,
  MonitorPlay,
  Key,
  ShieldCheck,
  Settings,
  ArrowRight,
  LayoutGrid,
  List,
  Activity,
  BarChart3,
  Cpu,
  Eye,
  CheckCircle,
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
  'dashboard' | 'documents' | 'collections' | 'upload' | 'ocr_cache' | 'connectors' | 'youtube' | 'keys' | 'mcp';

const KB_TAB_STORAGE_KEY = 'omnirag_kb_active_tab';

/** Data-driven knowledge-base sections — single source for the tab bar and keyboard navigation.
 *  Labels resolve through the Phase-7 dictionaries (kb.* keys); the old
 *  parallel labelAr/labelEn fields duplicated the dictionaries and would
 *  drift. */
const KB_TABS: Array<{
  id: TabType;
  icon: React.ElementType;
  labelKey: string;
  amber?: boolean;
}> = [
  { id: 'dashboard', icon: BarChart3, labelKey: 'kb.tabDashboard' },
  { id: 'documents', icon: Layers, labelKey: 'kb.tabDocuments' },
  { id: 'collections', icon: Folder, labelKey: 'kb.tabCollections' },
  { id: 'upload', icon: Upload, labelKey: 'kb.tabUpload' },
  { id: 'ocr_cache', icon: Zap, labelKey: 'kb.tabOcrCache', amber: true },
  { id: 'connectors', icon: Database, labelKey: 'kb.tabConnectors' },
  { id: 'youtube', icon: MonitorPlay, labelKey: 'kb.tabYoutube' },
  { id: 'keys', icon: Key, labelKey: 'kb.tabKeys' },
  { id: 'mcp', icon: Zap, labelKey: 'kb.tabMcp' },
];

export default function KnowledgeBase({ tenantId = 'tenant-acme-01', lang = 'ar' }: KnowledgeBaseProps) {
  const isRtl = lang === 'ar';
  const { toast } = useToast();

  // Primary active tab — persisted so a reload returns the user to the section
  // they were working in (previously always reset to the dashboard).
  const [activeTab, setActiveTabState] = useState<TabType>('dashboard');

  const setActiveTab = useCallback((tab: TabType) => {
    setActiveTabState(tab);
    try {
      localStorage.setItem(KB_TAB_STORAGE_KEY, tab);
    } catch {
      /* storage unavailable (private mode) — in-memory state still works */
    }
  }, []);

  // Restore the persisted tab once after mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KB_TAB_STORAGE_KEY);
      if (
        saved &&
        [
          'dashboard',
          'documents',
          'collections',
          'upload',
          'ocr_cache',
          'connectors',
          'youtube',
          'keys',
          'mcp',
        ].includes(saved)
      ) {
        setActiveTabState(saved as TabType);
      }
    } catch {
      /* ignore */
    }
  }, []);

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
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [keysStatus, setKeysStatus] = useState<KeysStatus | null>(null);

  // Loading and action state
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const [reindexingDocId, setReindexingDocId] = useState<string | null>(null);

  // Confirmation dialog state (replaces native confirm())
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<Document | null>(null);
  const [pendingDeleteSource, setPendingDeleteSource] = useState<SourceConnector | null>(null);
  const [isClearCacheConfirmOpen, setIsClearCacheConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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
  /**
   * v0.12.11: list rows are summaries (no content) — opening a preview fetches
   * the full document (`?id=`) and swaps it in; the summary renders instantly.
   */
  const openPreview = async (doc: Document) => {
    setPreviewingDoc(doc);
    try {
      const res = await fetchWithAuth(`/api/v1/documents?id=${doc.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.document) setPreviewingDoc(data.document);
      }
    } catch {
      // keep the summary open — the modal shows its "no content" note
    }
  };
  const [versionHistoryDoc, setVersionHistoryDoc] = useState<Document | null>(null);
  const [isCreateColModalOpen, setIsCreateColModalOpen] = useState(false);
  const [isHealthModalOpen, setIsHealthModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<SourceConnector | null>(null);
  const [viewingLogsSource, setViewingLogsSource] = useState<SourceConnector | null>(null);
  const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);

  // Load all knowledge base data. Tracks whether ANY core request failed so
  // the UI can show an error banner with retry instead of silently rendering
  // an empty state that is indistinguishable from "no documents yet".
  //
  // TanStack Query powers the fetch: the `kb.data` query caches across route
  // navigations (returning to /knowledge shows cached data instantly) and
  // `fetchKnowledgeData({silent:true})` maps to refetch (no skeleton flicker
  // after mutations). All 13 legacy call sites keep working through the shim
  // below.
  const queryClient = useQueryClient();
  const {
    data: kbData,
    isPending: kbIsLoading,
    error: kbQueryError,
    refetch: kbRefetch,
  } = useQuery({
    queryKey: ['kb', 'data', tenantId],
    queryFn: async () => {
      const [sourcesRes, colsRes, docsRes, keysRes] = await Promise.all([
        fetchWithAuth(`/api/v1/sources?tenantId=${tenantId}`).catch(() => null),
        fetchWithAuth(`/api/v1/collections?tenantId=${tenantId}`).catch(() => null),
        fetchWithAuth(`/api/v1/documents?tenantId=${tenantId}`).catch(() => null),
        fetchWithAuth('/api/v1/sources/system-status').catch(() => null),
      ]);

      let failedRequests = 0;
      const parse = async (res: Response | null) => {
        if (!res) {
          failedRequests++;
          return {};
        }
        try {
          if (res.ok) return await res.json();
          failedRequests++;
          return {};
        } catch {
          failedRequests++;
          return {};
        }
      };

      const sourcesData: any = await parse(sourcesRes);
      const colsData: any = await parse(colsRes);
      const docsData: any = await parse(docsRes);
      // keys status is non-critical — never count its failure.
      const keysData: any = keysRes?.ok ? await keysRes.json().catch(() => null) : null;

      // Surface core failures instead of an empty-looking knowledge base.
      if (failedRequests >= 2) {
        throw new Error(t(lang, 'kb.loadFailed'));
      }

      return {
        sources: (sourcesData.sources || []) as SourceConnector[],
        syncLogs: (sourcesData.syncLogs || []) as SyncLogEntry[],
        mcpResources: (sourcesData.mcpResources || []) as McpResourceItem[],
        collections: (colsData.collections || []) as Collection[],
        documents: (docsData.documents || []) as DocumentSummary[],
        keysStatus: keysData as KeysStatus | null,
      };
    },
    staleTime: 15_000,
    retry: 1,
  });

  // Server data → local state (single direction; mutations refresh the query).
  useEffect(() => {
    if (!kbData) return;
    setSources(kbData.sources);
    setSyncLogs(kbData.syncLogs);
    setMcpResources(kbData.mcpResources);
    setCollections(kbData.collections);
    setDocuments(kbData.documents);
    if (kbData.keysStatus) setKeysStatus(kbData.keysStatus);
  }, [kbData]);

  // React Query states → legacy view flags.
  useEffect(() => {
    setIsLoading(kbIsLoading);
  }, [kbIsLoading]);

  useEffect(() => {
    setLoadError(kbQueryError ? (kbQueryError as Error).message : null);
  }, [kbQueryError]);

  // Legacy shim: every existing call site (refresh buttons, silent post-
  // mutation refreshes) keeps the old fetchKnowledgeData contract. The query
  // itself auto-fetches on mount — do NOT call this in a mount effect: it
  // resets the query and re-fetches, and because kbRefetch changes identity
  // after every fetch cycle, an effect keyed on this callback would loop
  // (mount → fetch → new identity → effect again → double loads).
  const fetchKnowledgeData = useCallback(
    async (opts?: { silent?: boolean }) => {
      // `silent` = background refetch (keep current data visible); a full
      // call resets the query to pending so skeletons show — then refetches.
      if (!opts?.silent) await queryClient.resetQueries({ queryKey: ['kb', 'data'] });
      await kbRefetch();
    },
    [queryClient, kbRefetch],
  );

  // Live status polling: while any document is still processing/pending, poll
  // the lightweight status endpoint every 4s and merge fresh statuses in. This
  // replaces the old behavior where a processing document stayed "جاري
  // الفهرسة" until the user manually refreshed.
  const hasProcessingDocs = useMemo(
    () => documents.some((d) => d.status === 'processing' || d.status === 'pending'),
    [documents],
  );

  useEffect(() => {
    if (!hasProcessingDocs) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetchWithAuth(`/api/v1/documents/status?tenantId=${tenantId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data?.statuses)) return;

        const statusById = new Map<string, any>(data.statuses.map((s: any) => [s.id, s]));
        setDocuments((prev) =>
          prev.map((doc) => {
            const fresh = statusById.get(doc.id);
            if (!fresh || fresh.status === doc.status) return doc;
            return {
              ...doc,
              status: fresh.status,
              chunkCount: fresh.chunkCount ?? doc.chunkCount,
              metadata: { ...doc.metadata, indexErrors: fresh.indexErrors },
            };
          }),
        );
      } catch {
        /* transient polling failure — retry on next tick */
      }
    };

    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hasProcessingDocs, tenantId]);

  // Background connector sync: syncs now run AFTER the HTTP response (they can
  // take minutes on large/scanned files), so while any connector is 'syncing'
  // poll the LIGHTWEIGHT status endpoint every 4s. The old behavior polled the
  // full data query (4 parallel requests per tick = 60 req/min), which blew
  // the 30/min per-endpoint rate ceiling within ~20s and surfaced as the
  // "تعذر الاتصال بالخادم" outage banner. When the last sync finishes, refresh
  // everything ONCE through the React Query invalidation.
  const hasSyncingSources = useMemo(() => sources.some((s) => s.status === 'syncing'), [sources]);
  const wasSyncingRef = useRef(hasSyncingSources);
  // Stable handle for the interval effect — fetchKnowledgeData's identity
  // churns between fetch cycles (kbRefetch), which would re-arm the interval
  // on every poll if listed directly in the effect deps.
  const fetchRef = useRef(fetchKnowledgeData);
  useEffect(() => {
    fetchRef.current = fetchKnowledgeData;
  }, [fetchKnowledgeData]);

  useEffect(() => {
    if (!hasSyncingSources) {
      // A sync just finished (or none running): one full silent refresh to
      // pick up new documents / final connector statuses.
      if (wasSyncingRef.current) {
        wasSyncingRef.current = false;
        fetchRef.current({ silent: true });
      }
      return;
    }
    wasSyncingRef.current = true;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetchWithAuth(`/api/v1/sources/sync-status?tenantId=${tenantId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data?.statuses)) return;

        const statusById = new Map<string, any>(data.statuses.map((s: any) => [s.id, s]));
        setSources((prev) =>
          prev.map((src) => {
            const fresh = statusById.get(src.id);
            if (!fresh || fresh.status === src.status) return src;
            return {
              ...src,
              status: fresh.status,
              lastSyncAt: fresh.lastSyncAt ?? src.lastSyncAt,
              documentCount: fresh.documentCount ?? src.documentCount,
              lastError: fresh.lastError ?? src.lastError,
            };
          }),
        );
      } catch {
        /* transient polling failure — retry on next tick */
      }
    };

    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hasSyncingSources, tenantId]);

  // Sync single source — with per-connector busy state so each card's Sync
  // button shows its own spinner (previously only "Sync All" had one).
  const handleSyncSource = async (sourceId: string) => {
    setSyncingSourceId(sourceId);
    try {
      const res = await fetchWithAuth(`/api/v1/sources/${sourceId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.started) {
          // Sync runs in the background now — the connector card shows the
          // 'syncing' status until the polling refresh picks the outcome up.
          toast({
            title: t(lang, 'kb.syncStarted'),
            variant: 'success',
          });
        } else {
          const syncOk = data?.result?.success !== false;
          toast({
            title: syncOk
              ? isRtl
                ? 'تمت المزامنة بنجاح'
                : 'Sync completed'
              : data?.result?.message || t(lang, 'kb.syncPartial'),
            variant: syncOk ? 'success' : 'warning',
          });
        }
        fetchKnowledgeData({ silent: true });
      } else {
        toast({ title: t(lang, 'kb.syncFailed'), variant: 'error' });
      }
    } catch (err) {
      console.error('Sync failed:', err);
      toast({ title: t(lang, 'kb.syncFailed'), variant: 'error' });
    } finally {
      setSyncingSourceId(null);
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
          }),
        ),
      );
      toast({
        title: t(lang, 'kb.syncAllStarted', { count: String(sources.length) }),
        variant: 'success',
      });
      await fetchKnowledgeData({ silent: true });
    } catch (err) {
      console.error('Sync all failed:', err);
      toast({ title: t(lang, 'kb.syncSomeFailed'), variant: 'error' });
    } finally {
      setIsSyncingAll(false);
    }
  };

  // Delete source — confirmation now goes through the accessible ConfirmDialog
  // instead of native confirm(); the actual DELETE happens in confirmDeleteSource.
  const confirmDeleteSource = async () => {
    if (!pendingDeleteSource) return;
    setIsDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/v1/sources?id=${pendingDeleteSource.id}&tenantId=${tenantId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast({ title: t(lang, 'kb.connectorDeleted'), variant: 'success' });
        fetchKnowledgeData({ silent: true });
      } else {
        toast({ title: t(lang, 'kb.connectorDeleteFailed'), variant: 'error' });
      }
    } catch (err) {
      console.error('Delete source failed:', err);
      toast({ title: t(lang, 'kb.connectorDeleteFailed'), variant: 'error' });
    } finally {
      setIsDeleting(false);
      setPendingDeleteSource(null);
    }
  };

  // Delete Document — same ConfirmDialog flow.
  const confirmDeleteDocument = async () => {
    if (!pendingDeleteDoc) return;
    setIsDeleting(true);
    const docId = pendingDeleteDoc.id;
    try {
      const res = await fetchWithAuth(`/api/v1/documents?id=${docId}&tenantId=${tenantId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        if (inspectingDoc?.id === docId) setInspectingDoc(null);
        if (previewingDoc?.id === docId) setPreviewingDoc(null);
        toast({ title: t(lang, 'kb.documentDeleted'), variant: 'success' });
        fetchKnowledgeData({ silent: true });
      } else {
        toast({ title: t(lang, 'kb.documentDeleteFailed'), variant: 'error' });
      }
    } catch (err) {
      console.error('Delete document failed:', err);
      toast({ title: t(lang, 'kb.documentDeleteFailed'), variant: 'error' });
    } finally {
      setIsDeleting(false);
      setPendingDeleteDoc(null);
    }
  };

  // Re-index Document — calls the REAL reindex endpoint, which re-chunks the
  // document and rebuilds its embeddings + Qdrant points. The old
  // implementation was a 1-second setTimeout that changed nothing.
  const handleReindexDocument = async (doc: Document) => {
    setReindexingDocId(doc.id);
    try {
      const res = await fetchWithAuth(`/api/v1/documents/${doc.id}/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        toast({
          title: t(lang, 'kb.reindexed', { title: doc.title }),
          message: t(lang, 'kb.reindexedChunks', { count: String(data?.indexing?.indexed ?? 0) }),
          variant: 'success',
        });
      } else {
        toast({
          title: t(lang, 'kb.reindexFailed'),
          message: data?.message || data?.error,
          variant: 'error',
        });
      }
      await fetchKnowledgeData({ silent: true });
    } catch (err) {
      console.error('Reindexing failed:', err);
      toast({ title: t(lang, 'kb.reindexFailed'), variant: 'error' });
    } finally {
      setReindexingDocId(null);
    }
  };

  // Update source config — with honest error surfacing: a failed PUT used to
  // vanish into the caller's console while the modal closed as if saved.
  const handleUpdateSource = async (id: string, updates: Partial<SourceConnector>) => {
    const res = await fetchWithAuth(`/api/v1/sources/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, ...updates }),
    });
    if (!res.ok) {
      throw new Error(t(lang, 'kb.connectorSaveFailed'));
    }
    fetchKnowledgeData({ silent: true });
    setEditingSource(null);
    toast({ title: t(lang, 'kb.changesSaved'), variant: 'success' });
  };

  // Compute stats
  const totalDocsCount = documents.length;
  const totalChunksCount = documents.reduce((sum, d) => sum + (d.chunkCount || 0), 0);
  const indexedDocsCount = documents.filter(
    (d) => d.status === 'indexed' || (d.status as string) === 'success' || !d.status,
  ).length;
  const failedDocsCount = documents.filter((d) => d.status === 'failed' || (d.status as string) === 'error').length;
  const processingDocsCount = documents.filter((d) => d.status === 'processing' || d.status === 'pending').length;
  const healthPercentage = totalDocsCount > 0 ? Math.round((indexedDocsCount / totalDocsCount) * 100) : 100;
  const avgChunksPerDoc = totalDocsCount > 0 ? (totalChunksCount / totalDocsCount).toFixed(1) : '0';
  const healthySourcesCount = sources.filter((s) => s.status === 'healthy').length;

  // Active Ingestion Jobs simulation/detection
  // Filtered & sorted documents
  const filteredDocuments = useMemo(() => {
    return documents
      .filter((doc) => {
        // Search — over title + the 400-char content preview (v0.12.11: the
        // list no longer ships full content; deep search lives in chat/RAG).
        const matchSearch =
          !searchQuery.trim() ||
          doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (doc.contentPreview && doc.contentPreview.toLowerCase().includes(searchQuery.toLowerCase()));

        // Collection
        const matchCollection =
          filterCollection === 'all' ||
          (doc.collectionIds && doc.collectionIds.includes(filterCollection)) ||
          doc.metadata?.collectionId === filterCollection;

        // Type
        const srcType = doc.metadata?.connectorType || doc.sourceType || 'file';
        const matchType =
          filterType === 'all' ||
          (filterType === 'pdf' &&
            (doc.title.toLowerCase().endsWith('.pdf') || doc.metadata?.fileType === 'application/pdf')) ||
          (filterType === 'markdown' &&
            (doc.title.toLowerCase().endsWith('.md') || doc.title.toLowerCase().endsWith('.txt'))) ||
          (filterType === 'web' && srcType === 'url') ||
          (filterType === 'youtube' && srcType === 'youtube') ||
          (filterType === 'github' && srcType === 'github') ||
          (filterType === 'database' && srcType === 'database');

        // Health status
        const matchHealth =
          filterHealth === 'all' ||
          (filterHealth === 'indexed' &&
            (doc.status === 'indexed' || (doc.status as string) === 'success' || !doc.status)) ||
          (filterHealth === 'processing' && (doc.status === 'processing' || doc.status === 'pending')) ||
          (filterHealth === 'failed' && (doc.status === 'failed' || (doc.status as string) === 'error'));

        return matchSearch && matchCollection && matchType && matchHealth;
      })
      .sort((a, b) => {
        if (sortBy === 'date') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (sortBy === 'name') return a.title.localeCompare(b.title);
        if (sortBy === 'chunks') return (b.chunkCount || 0) - (a.chunkCount || 0);
        if (sortBy === 'size') return (b.contentChars ?? 0) - (a.contentChars ?? 0);
        return 0;
      });
  }, [documents, searchQuery, filterCollection, filterType, filterHealth, sortBy]);

  // Recent files (top 6 newest)
  const recentFiles = useMemo(() => {
    return [...documents].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6);
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
                  {t(lang, 'kb.knowledgeBaseSemanticDocumentStudio')}
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
            <span>{t(lang, 'kb.healthScan')}</span>
          </button>

          <button
            onClick={() => setIsCreateColModalOpen(true)}
            className="px-3.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
          >
            <FolderPlus className="w-4 h-4 text-slate-500" />
            <span>{t(lang, 'kb.newCollection')}</span>
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Upload className="w-4 h-4" />
            <span>{t(lang, 'kb.ingestDocument')}</span>
          </button>

          <button
            onClick={() => fetchKnowledgeData()}
            className="p-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl transition flex items-center justify-center cursor-pointer shadow-3xs"
            title={t(lang, 'kb.refreshData')}
            aria-label={t(lang, 'kb.refreshData')}
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${isLoading ? 'animate-spin text-indigo-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Load error banner — a backend outage must be visible, not silently
          rendered as an empty knowledge base. */}
      {loadError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-2xl px-4 py-3"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" aria-hidden="true" />
            <p className="text-xs font-bold text-rose-800 dark:text-rose-300 truncate">{loadError}</p>
          </div>
          <button
            onClick={() => fetchKnowledgeData()}
            className="shrink-0 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition cursor-pointer"
          >
            {t(lang, 'kb.retry')}
          </button>
        </div>
      )}

      {/* 2. TAB NAVIGATION BAR — data-driven, accessible (role=tablist). */}
      <div
        role="tablist"
        aria-label={t(lang, 'kb.knowledgeBaseSections')}
        onKeyDown={(e) => {
          // Complete ARIA tabs pattern: roving focus with arrow keys.
          // In RTL the visual order flips, so ArrowLeft/Right are mirrored.
          const idx = KB_TABS.findIndex((t) => t.id === activeTab);
          if (idx === -1) return;
          let next = -1;
          const forwardKey = isRtl ? 'ArrowLeft' : 'ArrowRight';
          const backKey = isRtl ? 'ArrowRight' : 'ArrowLeft';
          if (e.key === forwardKey) next = (idx + 1) % KB_TABS.length;
          else if (e.key === backKey) next = (idx - 1 + KB_TABS.length) % KB_TABS.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = KB_TABS.length - 1;
          else return;
          e.preventDefault();
          setActiveTab(KB_TABS[next].id);
          document.getElementById(`kb-tab-${KB_TABS[next].id}`)?.focus();
        }}
        className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200/80 no-scrollbar"
      >
        {KB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          // Live counts per section (documents/collections/connectors/OCR cache).
          const liveCount =
            tab.id === 'documents'
              ? documents.length
              : tab.id === 'collections'
                ? collections.length
                : tab.id === 'ocr_cache'
                  ? ocrCacheEntries.length
                  : tab.id === 'connectors'
                    ? sources.length
                    : undefined;
          return (
            <button
              key={tab.id}
              id={`kb-tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls="kb-tabpanel"
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200/60'
              }`}
            >
              <Icon
                className={`w-4 h-4 ${
                  tab.id === 'ocr_cache'
                    ? 'text-amber-500 fill-amber-500/20'
                    : tab.id === 'youtube'
                      ? 'text-rose-500'
                      : tab.id === 'mcp'
                        ? 'text-amber-500'
                        : ''
                }`}
                aria-hidden="true"
              />
              <span>{t(lang, tab.labelKey)}</span>
              {typeof liveCount === 'number' && (
                <span
                  className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${
                    isActive
                      ? 'bg-indigo-700 text-white'
                      : tab.amber
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {liveCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* All section panels live in ONE labelled tabpanel whose content swaps,
          completing the ARIA tabs pattern started by the tablist above. */}
      <div id="kb-tabpanel" role="tabpanel" aria-labelledby={`kb-tab-${activeTab}`} className="contents">
        {/* 3. TAB 1: OVERVIEW & HEALTH DASHBOARD VIEW */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Top KPI Ribbon */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Total Documents */}
              <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-3xs flex items-center justify-between">
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">
                    {t(lang, 'kb.totalDocuments')}
                  </span>
                  <div className="text-2xl font-black text-slate-950 flex items-baseline gap-2 font-mono">
                    <span>{totalDocsCount}</span>
                    <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-sans">
                      {indexedDocsCount} {t(lang, 'kb.ready')}
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
                    {t(lang, 'kb.vectorChunksQdrant')}
                  </span>
                  <div className="text-2xl font-black text-slate-950 flex items-baseline gap-2 font-mono">
                    <span>{totalChunksCount}</span>
                    <span className="text-[10px] text-slate-400 font-sans">
                      ~{avgChunksPerDoc} {t(lang, 'kb.chunksPerDoc')}
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
                    {t(lang, 'kb.healthQualityScore')}
                  </span>
                  <div className="text-2xl font-black text-emerald-600 flex items-baseline gap-2 font-mono">
                    <span>{healthPercentage}%</span>
                    <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-sans">
                      {t(lang, 'kb.optimal')}
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
                    {t(lang, 'kb.activeConnectors')}
                  </span>
                  <div className="text-2xl font-black text-slate-950 flex items-baseline gap-2 font-mono">
                    <span>{sources.length}</span>
                    <span className="text-[10px] text-violet-700 font-bold bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200 font-sans">
                      {healthySourcesCount} {t(lang, 'kb.healthy')}
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
                        {t(lang, 'kb.activeIngestionJobsLivePipeline')}
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        {isRtl
                          ? 'مراقبة فورية لمراحل التقطيع، استخراج النصوص بـ OCR، وتوليد المتجهات'
                          : 'Real-time monitoring of document chunking, OCR parsing, and vector indexing'}
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
                      <span>
                        {isRtl
                          ? 'مسار استيعاب ملفات الـ PDF الكبيرة (دفعات 50 صفحة)'
                          : '50-Page PDF Partition Pipeline'}
                      </span>
                    </span>
                    <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                      4-Stage Pipeline
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-3xs space-y-1">
                      <span className="text-[10px] font-mono text-slate-400 font-bold">STAGE 1</span>
                      <h5 className="font-bold text-slate-800 text-[11px]">{t(lang, 'kb.slicing50p')}</h5>
                      <span className="text-[9px] text-emerald-600 block font-bold">✓ Ready</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-3xs space-y-1">
                      <span className="text-[10px] font-mono text-slate-400 font-bold">STAGE 2</span>
                      <h5 className="font-bold text-slate-800 text-[11px]">{t(lang, 'kb.mistralOcr')}</h5>
                      <span className="text-[9px] text-emerald-600 block font-bold">✓ High Res</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-3xs space-y-1">
                      <span className="text-[10px] font-mono text-slate-400 font-bold">STAGE 3</span>
                      <h5 className="font-bold text-slate-800 text-[11px]">{t(lang, 'kb.slidingChunks')}</h5>
                      <span className="text-[9px] text-emerald-600 block font-bold">✓ Overlap 64t</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-3xs space-y-1">
                      <span className="text-[10px] font-mono text-slate-400 font-bold">STAGE 4</span>
                      <h5 className="font-bold text-slate-800 text-[11px]">{t(lang, 'kb.qdrantEmbed')}</h5>
                      <span className="text-[9px] text-emerald-600 block font-bold">✓ Cosine 768d</span>
                    </div>
                  </div>
                </div>

                {/* Ingestion & Sync Activity Stream */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                    <span>{t(lang, 'kb.recentIngestionSyncEvents')}</span>
                    <span className="text-[10px] font-mono text-slate-400">{syncLogs.length} events logged</span>
                  </div>

                  {syncLogs.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-xs bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                      {t(lang, 'kb.noSyncEventsRecordedYet')}
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
                                    +{log.itemsProcessed || 0} {t(lang, 'kb.items')}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <span
                              className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0 ${
                                isSuccess
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200'
                              }`}
                            >
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
                        {t(lang, 'kb.documentHealthStatistics')}
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        {t(lang, 'kb.vectorIndexCoverageAndSemanticReadiness')}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setIsHealthModalOpen(true)}
                    className="p-1.5 rounded-lg bg-slate-50 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-slate-200 transition cursor-pointer text-[10px] font-bold flex items-center gap-1"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>{t(lang, 'kb.deepScan')}</span>
                  </button>
                </div>

                {/* Health Score Gauge */}
                <div className="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-200/70 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-950">{t(lang, 'kb.vectorIndexCoverage')}</span>
                    <span className="text-sm font-mono font-black text-emerald-700">{healthPercentage}%</span>
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

                {/* Health Checks Diagnostic List — values are computed from real
                  state, not hardcoded marketing chips. */}
                <div className="space-y-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                    <span className="text-slate-700 flex items-center gap-2 font-medium">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>{t(lang, 'kb.multiTenantIsolation')}</span>
                    </span>
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-mono">
                      SECURED
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                    <span className="text-slate-700 flex items-center gap-2 font-medium">
                      <FileCheck className={`w-4 h-4 ${failedDocsCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`} />
                      <span>{t(lang, 'kb.documentsWithFailedIndexing')}</span>
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border font-mono ${
                        failedDocsCount > 0
                          ? 'text-rose-700 bg-rose-50 border-rose-200'
                          : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                      }`}
                    >
                      {failedDocsCount} {t(lang, 'kb.detected')}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                    <span className="text-slate-700 flex items-center gap-2 font-medium">
                      <Activity
                        className={`w-4 h-4 ${processingDocsCount > 0 ? 'text-amber-600' : 'text-slate-400'}`}
                      />
                      <span>{t(lang, 'kb.documentsProcessingNow')}</span>
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border font-mono ${
                        processingDocsCount > 0
                          ? 'text-amber-700 bg-amber-50 border-amber-200'
                          : 'text-slate-600 bg-slate-100 border-slate-200'
                      }`}
                    >
                      {processingDocsCount > 0
                        ? `${processingDocsCount} ${t(lang, 'kb.active')}`
                        : isRtl
                          ? 'لا يوجد'
                          : 'IDLE'}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                    <span className="text-slate-700 flex items-center gap-2 font-medium">
                      <Sparkles className="w-4 h-4 text-indigo-600" />
                      <span>{t(lang, 'kb.ocrLayoutExtraction')}</span>
                    </span>
                    <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 font-mono">
                      {keysStatus?.mistralActive ? 'MISTRAL AI' : 'GEMINI FALLBACK'}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                    <span className="text-slate-700 flex items-center gap-2 font-medium">
                      <Database className="w-4 h-4 text-blue-600" />
                      <span>{t(lang, 'kb.embeddingVectorDimension')}</span>
                    </span>
                    <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 font-mono">
                      3072 DIM (COSINE)
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
                    <h3 className="text-sm font-extrabold text-slate-900">{t(lang, 'kb.recentlyIngestedDocuments')}</h3>
                    <p className="text-[11px] text-slate-400">
                      {isRtl
                        ? 'معاينة سريعة للوثائق مع إمكانية فحص متجهات المقاطع فوراً'
                        : 'Instant preview of latest additions with one-click vector inspector'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setActiveTab('documents')}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition"
                >
                  <span>{t(lang, 'kb.viewAllDocuments')}</span>
                  <ArrowRight className={`w-3.5 h-3.5 ${isRtl ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {recentFiles.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs space-y-2">
                  <FileText className="w-8 h-8 text-slate-300 mx-auto" />
                  <p>{t(lang, 'kb.noDocumentsAddedYet')}</p>
                  <button
                    onClick={() => setActiveTab('upload')}
                    className="px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold"
                  >
                    {t(lang, 'kb.ingestFirstDocument')}
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
                      onPreview={() => openPreview(doc)}
                      onInspectChunks={() => setInspectingDoc(doc)}
                      onViewHistory={() => setVersionHistoryDoc(doc)}
                      onReindex={() => handleReindexDocument(doc)}
                      onDelete={() => setPendingDeleteDoc(doc)}
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
                    placeholder={t(lang, 'kb.searchDocumentTitlesAndContent')}
                    className={`w-full py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-indigo-500 font-sans ${
                      isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'
                    }`}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      aria-label={t(lang, 'kb.clearSearch')}
                      className={`absolute top-2 text-slate-400 hover:text-slate-600 text-xs ${isRtl ? 'left-3' : 'right-3'} cursor-pointer`}
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
                      <option value="all">{t(lang, 'kb.allCollections')}</option>
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
                    <option value="all">{t(lang, 'kb.allTypes')}</option>
                    <option value="pdf">PDF</option>
                    <option value="markdown">Markdown / TXT</option>
                    <option value="web">Web URL</option>
                    <option value="youtube">YouTube</option>
                    <option value="github">GitHub</option>
                    <option value="database">Database</option>
                  </select>

                  {/* Indexing Status Filter — previously declared in state but had
                    no UI control, so it could never be used. */}
                  <select
                    value={filterHealth}
                    onChange={(e) => setFilterHealth(e.target.value)}
                    aria-label={t(lang, 'kb.filterByIndexingStatus')}
                    className="px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="all">{t(lang, 'kb.allStatuses')}</option>
                    <option value="indexed">{t(lang, 'kb.indexed')}</option>
                    <option value="processing">{t(lang, 'kb.processing')}</option>
                    <option value="failed">{t(lang, 'kb.failed')}</option>
                  </select>

                  {/* Sort selector */}
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="date">{t(lang, 'kb.newest')}</option>
                    <option value="name">{t(lang, 'kb.name')}</option>
                    <option value="chunks">{t(lang, 'kb.chunksCount')}</option>
                    <option value="size">{t(lang, 'kb.fileSize')}</option>
                  </select>

                  {/* View Mode Toggle: Grid vs List */}
                  <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
                    <button
                      onClick={() => setDocViewMode('grid')}
                      aria-pressed={docViewMode === 'grid'}
                      aria-label={t(lang, 'kb.gridView')}
                      className={`p-1.5 rounded-lg transition cursor-pointer ${
                        docViewMode === 'grid'
                          ? 'bg-white text-indigo-600 shadow-3xs'
                          : 'text-slate-400 hover:text-slate-700'
                      }`}
                      title={t(lang, 'kb.gridView')}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDocViewMode('list')}
                      aria-pressed={docViewMode === 'list'}
                      aria-label={t(lang, 'kb.listView')}
                      className={`p-1.5 rounded-lg transition cursor-pointer ${
                        docViewMode === 'list'
                          ? 'bg-white text-indigo-600 shadow-3xs'
                          : 'text-slate-400 hover:text-slate-700'
                      }`}
                      title={t(lang, 'kb.listView')}
                    >
                      <List className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Active Filter Chips */}
              <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
                <span className="font-mono text-[11px]">
                  {filteredDocuments.length} {t(lang, 'kb.matchingDocuments')}
                </span>

                {(searchQuery || filterCollection !== 'all' || filterType !== 'all' || filterHealth !== 'all') && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setFilterCollection('all');
                      setFilterType('all');
                      setFilterHealth('all');
                    }}
                    className="text-indigo-600 hover:underline text-[11px] font-bold"
                  >
                    {t(lang, 'kb.resetFilters')}
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
                  {t(lang, 'kb.noDocumentsMatchingYourCriteria')}
                </h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  {isRtl
                    ? 'جرب تغيير كلمات البحث أو إعادة ضبط الفلاتر لعرض كافة الملفات المفهرسة.'
                    : 'Try adjusting your search terms or reset the filters to see all indexed documents.'}
                </p>
                <button
                  onClick={() => setActiveTab('upload')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Upload className="w-4 h-4" />
                  <span>{t(lang, 'kb.ingestNewDocument')}</span>
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
                    onPreview={() => openPreview(doc)}
                    onInspectChunks={() => setInspectingDoc(doc)}
                    onViewHistory={() => setVersionHistoryDoc(doc)}
                    onReindex={() => handleReindexDocument(doc)}
                    onDelete={() => setPendingDeleteDoc(doc)}
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
                    const estimatedTokens = Math.round((doc.contentChars ?? 0) / 4);
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
                              <h4 className="text-xs font-bold text-slate-900 truncate">{doc.title}</h4>
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
                                {doc.chunkCount || 0} {t(lang, 'kb.chunks')}
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
                            title={t(lang, 'kb.versionHistory')}
                          >
                            <History className="w-3.5 h-3.5 text-violet-600" />
                            <span>{t(lang, 'kb.history')}</span>
                          </button>
                          <button
                            onClick={() => setInspectingDoc(doc)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 rounded-lg text-xs font-bold transition flex items-center gap-1 border border-slate-200"
                          >
                            <Layers className="w-3.5 h-3.5" />
                            <span>{t(lang, 'kb.chunks2')}</span>
                          </button>
                          <button
                            onClick={() => openPreview(doc)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition flex items-center gap-1 border border-slate-200"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>{t(lang, 'kb.preview')}</span>
                          </button>
                          <button
                            onClick={() => setPendingDeleteDoc(doc)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                            aria-label={t(lang, 'kb.deleteDocumentAria', { name: doc.title })}
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
                  <span>{t(lang, 'kb.isolatedKnowledgeCollections')}</span>
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
                <span>{t(lang, 'kb.createNewCollection')}</span>
              </button>
            </div>

            {collections.length === 0 ? (
              <div className="bg-white rounded-3xl p-16 text-center border border-slate-200/80 shadow-3xs space-y-3">
                <Folder className="w-10 h-10 text-slate-300 mx-auto" />
                <h4 className="text-sm font-extrabold text-slate-800">{t(lang, 'kb.noCollectionsCreatedYet')}</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  {isRtl
                    ? 'أنشئ مجموعات لتنظيم مستنداتك حسب الأقسام أو المشاريع المعرفية.'
                    : 'Create collections to group and isolate documents by domain or project.'}
                </p>
                <button
                  onClick={() => setIsCreateColModalOpen(true)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <FolderPlus className="w-4 h-4" />
                  <span>{t(lang, 'kb.createFirstCollection')}</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {collections.map((col) => {
                  const colDocs = documents.filter(
                    (d) => (d.collectionIds && d.collectionIds.includes(col.id)) || d.metadata?.collectionId === col.id,
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

                        <h4 className="text-sm font-extrabold text-slate-900 pt-1">{col.name}</h4>
                        <p className="text-xs text-slate-500 line-clamp-2">
                          {col.description || t(lang, 'kb.customKnowledgeCollection')}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-mono">
                        <span className="font-bold text-indigo-700">
                          {colDocs.length} {t(lang, 'kb.documents')}
                        </span>
                        <span>
                          {colChunks} {t(lang, 'kb.chunks')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 6. TAB 4 / TAB 6: SHARED INGESTION STUDIO.
          One persistent instance serves BOTH the file-upload and YouTube tabs:
          mounting it twice previously threw away everything the user had
          typed or extracted whenever they switched between the two tabs. */}
        {(activeTab === 'upload' || activeTab === 'youtube') && (
          <DocumentIngestionStudio
            tenantId={tenantId}
            collections={collections}
            lang={lang}
            initialTab={activeTab === 'youtube' ? 'youtube' : undefined}
            onNavigateTab={(t) => setActiveTab(t as any)}
            onIngestionCompleted={() => {
              fetchKnowledgeData({ silent: true });
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
                      <span>
                        {isRtl
                          ? 'ذاكرة تخزين نتائج OCR لميسترال (Mistral Document AI Cache)'
                          : 'Mistral OCR Caching Layer'}
                      </span>
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
                  <span>{t(lang, 'kb.refreshStats')}</span>
                </button>

                <button
                  onClick={() => setIsClearCacheConfirmOpen(true)}
                  disabled={ocrCacheEntries.length === 0}
                  className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t(lang, 'kb.clearCache')}</span>
                </button>
              </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-3xs space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">
                  {t(lang, 'kb.cachedDocuments')}
                </span>
                <div className="text-xl font-extrabold text-slate-900 font-mono">{ocrCacheStats.count}</div>
                <span className="text-[10px] text-slate-500 font-medium">
                  {ocrCacheStats.totalPages} {t(lang, 'kb.pagesTotal')}
                </span>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-3xs space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">
                  {t(lang, 'kb.totalCacheHits')}
                </span>
                <div className="text-xl font-extrabold text-emerald-600 font-mono flex items-center gap-1.5">
                  <span>{ocrCacheStats.totalHits}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-sans border border-emerald-100 font-bold">
                    ⚡ 0ms latency
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 font-medium">{t(lang, 'kb.apiRequestsSaved')}</span>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-3xs space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">
                  {t(lang, 'kb.tokensSaved')}
                </span>
                <div className="text-xl font-extrabold text-indigo-600 font-mono">
                  ~{ocrCacheStats.savedTokens.toLocaleString()}
                </div>
                <span className="text-[10px] text-indigo-600/80 font-medium font-mono">Mistral Document AI</span>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-3xs space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">
                  {t(lang, 'kb.cacheMemorySize')}
                </span>
                <div className="text-xl font-extrabold text-slate-900 font-mono">{ocrCacheStats.sizeKb} KB</div>
                <span className="text-[10px] text-slate-500 font-medium">
                  {(ocrCacheStats.savedBytes / (1024 * 1024)).toFixed(1)} MB {t(lang, 'kb.filesCached')}
                </span>
              </div>
            </div>

            {/* Cached Items Table */}
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-3xs overflow-hidden space-y-0">
              <div className="p-4 bg-slate-50/70 border-b border-slate-200/80 flex items-center justify-between text-xs font-bold text-slate-700">
                <span className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span>{t(lang, 'kb.cachedOcrDocumentsRegistry')}</span>
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  {ocrCacheEntries.length} {t(lang, 'kb.entries')}
                </span>
              </div>

              {ocrCacheEntries.length === 0 ? (
                <div className="p-12 text-center space-y-3">
                  <Zap className="w-10 h-10 text-slate-300 mx-auto" />
                  <h4 className="text-sm font-extrabold text-slate-800">{t(lang, 'kb.noOcrCacheEntriesFound')}</h4>
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
                    <span>{t(lang, 'kb.goToIngestionStudio')}</span>
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
                              <h5 className="font-extrabold text-slate-900 truncate max-w-xs">{entry.fileName}</h5>
                              <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded border border-slate-200">
                                {(entry.fileSize / (1024 * 1024)).toFixed(2)} MB
                              </span>
                              <span className="text-[10px] font-mono bg-indigo-50 text-indigo-700 px-1.5 py-0.2 rounded border border-indigo-200 font-bold">
                                {entry.engineUsed}
                              </span>
                              <span className="text-[10px] font-mono bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded border border-emerald-200 font-bold flex items-center gap-1">
                                ⚡ {entry.hits} {t(lang, 'kb.hits')}
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
                            title={t(lang, 'kb.previewExtractedText')}
                          >
                            <Eye className="w-3.5 h-3.5 text-indigo-600" />
                            <span>{t(lang, 'kb.preview')}</span>
                          </button>

                          <button
                            onClick={async () => {
                              const ok = await copyToClipboard(entry.extractedText);
                              toast({
                                title: ok
                                  ? isRtl
                                    ? 'تم نسخ النص المخزن للحافظة'
                                    : 'Copied extracted text to clipboard'
                                  : isRtl
                                    ? 'تعذر النسخ إلى الحافظة'
                                    : 'Could not copy to clipboard',
                                variant: ok ? 'success' : 'error',
                              });
                            }}
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition cursor-pointer"
                            title={t(lang, 'kb.copyText')}
                            aria-label={t(lang, 'kb.copyText')}
                          >
                            <Copy className="w-3.5 h-3.5 text-slate-600" />
                          </button>

                          <button
                            onClick={() => {
                              deleteOcrCacheEntry(entry.cacheKey);
                              refreshOcrCache();
                            }}
                            className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition cursor-pointer"
                            title={t(lang, 'kb.deleteFromCache')}
                            aria-label={t(lang, 'kb.deleteFromCache')}
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
                  <span>{t(lang, 'kb.automatedDataConnectors')}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isRtl
                    ? 'ربط مباشر مع مواقع الويب، مستودعات GitHub، وقواعد البيانات الخارجية.'
                    : 'Continuous live sync with Web URLs, GitHub repositories, and SQL DBs.'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSyncAllSources}
                  disabled={isSyncingAll || sources.length === 0}
                  className="px-3.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAll ? 'animate-spin' : ''}`} />
                  <span>{t(lang, 'kb.syncAll')}</span>
                </button>

                <button
                  onClick={() => setIsAddSourceOpen(true)}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t(lang, 'kb.addConnector')}</span>
                </button>
              </div>
            </div>

            {sources.length === 0 ? (
              <div className="bg-white rounded-3xl p-16 text-center border border-slate-200/80 shadow-3xs space-y-3">
                <Database className="w-10 h-10 text-slate-300 mx-auto" />
                <h4 className="text-sm font-extrabold text-slate-800">{t(lang, 'kb.noConnectorsConfigured')}</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  {isRtl
                    ? 'أضف موصلات لسحب البيانات تلقائياً من المواقع أو GitHub أو Google Drive.'
                    : 'Add connectors to automatically ingest and vectorize remote content.'}
                </p>
                <button
                  onClick={() => setIsAddSourceOpen(true)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t(lang, 'kb.addFirstConnector')}</span>
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
                          {(() => {
                            const { Icon: TypeIcon, className } = getSourceTypeIcon(src.type);
                            return <TypeIcon className={`w-5 h-5 ${className}`} />;
                          })()}
                        </div>
                        {/* Status pill reflects the REAL connector state via the
                          shared display helper (single source of truth). */}
                        <ConnectorStatusPill status={src.status} isRtl={isRtl} />
                      </div>

                      <h4 className="text-sm font-extrabold text-slate-900 pt-1 truncate">{src.name}</h4>
                      <p className="text-xs text-slate-500 font-mono text-[11px] truncate">
                        {src.config?.url || src.type}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleSyncSource(src.id)}
                        disabled={syncingSourceId === src.id}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 rounded-xl text-xs font-bold transition flex items-center gap-1 border border-slate-200 disabled:opacity-60 cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${syncingSourceId === src.id ? 'animate-spin text-indigo-600' : ''}`}
                        />
                        <span>{syncingSourceId === src.id ? t(lang, 'kb.syncing') : t(lang, 'kb.sync')}</span>
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setViewingLogsSource(src)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                          title={t(lang, 'kb.viewLogs')}
                        >
                          <Clock className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingSource(src)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                          title={t(lang, 'kb.editSettings')}
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setPendingDeleteSource(src)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                          title={t(lang, 'kb.delete')}
                          aria-label={t(lang, 'kb.deleteConnectorAria', { name: src.name })}
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

        {/* 9. TAB 7: INTEGRATIONS & API KEYS STATUS */}
        {activeTab === 'keys' && (
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-3xs space-y-6">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Key className="w-4 h-4 text-indigo-600" />
                <span>{t(lang, 'kb.externalServicesApiKeyConfigurations')}</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {isRtl
                  ? 'التحقق من جاهزية محركات المعالجة المتطورة مثل Mistral AI Document OCR و Unstructured و Qdrant Vector Cloud.'
                  : 'Real-time status of backend document parsers, vector indexes, and embedding services.'}
              </p>
            </div>

            {keysStatus === null ? (
              /* Honest loading state — previously the four cards rendered
               "Not configured ⚠" while the status request was still in flight,
               making a healthy system look broken for the first seconds. */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 animate-pulse">
                    <div className="flex items-center justify-between">
                      <div className="h-3 w-28 bg-slate-200 rounded" />
                      <div className="h-4 w-16 bg-slate-200 rounded-full" />
                    </div>
                    <div className="h-3 w-full bg-slate-100 rounded" />
                    <div className="h-6 w-40 bg-slate-200 rounded mt-2" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Gemini API */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">Google Gemini API</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        keysStatus?.geminiActive
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {keysStatus?.geminiActive ? t(lang, 'kb.active2') : t(lang, 'kb.missing')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {isRtl
                      ? 'المحرك الدلالي الأساسي وتوليد متجهات text-embedding-004.'
                      : 'Core semantic search and text-embedding-004 vectors.'}
                  </p>
                  <div className="text-[10px] font-mono bg-slate-100 p-2 rounded text-slate-600">GEMINI_API_KEY</div>
                </div>

                {/* Qdrant DB — status reflects the real key/URL presence instead
                of a hardcoded "Connected ✓" that lied when Qdrant was absent. */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">Qdrant Vector DB</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        keysStatus?.qdrantActive
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {keysStatus?.qdrantActive
                        ? isRtl
                          ? 'مهيأ ✓'
                          : 'Configured ✓'
                        : isRtl
                          ? 'غير مهيأ ⚠'
                          : 'Not configured ⚠'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {isRtl
                      ? 'تخزين وفهرسة الفضاء المتجهي المعزول لكل مستأجر.'
                      : 'Vector cluster storage for multi-tenant segment points.'}
                  </p>
                  <div className="text-[10px] font-mono bg-slate-100 p-2 rounded text-slate-600">
                    QDRANT_API_KEY / URL
                  </div>
                </div>

                {/* Mistral OCR */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">Mistral Document AI</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        keysStatus?.mistralActive
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {keysStatus?.mistralActive ? t(lang, 'kb.active2') : t(lang, 'kb.optional')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {isRtl
                      ? 'محرك استخراج النصوص المتقدم لملفات الـ PDF المعقدة والمسح الضوئي.'
                      : 'High-precision visual OCR and complex table parser.'}
                  </p>
                  <div className="text-[10px] font-mono bg-slate-100 p-2 rounded text-slate-600">MISTRAL_API_KEY</div>
                </div>

                {/* Unstructured Transform */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">Unstructured API</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        keysStatus?.unstructuredActive
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {keysStatus?.unstructuredActive
                        ? isRtl
                          ? 'نشط ✓'
                          : 'Active ✓'
                        : isRtl
                          ? 'اختياري ⚠'
                          : 'Optional ⚠'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {isRtl
                      ? 'تفكيك مستندات Word و PPTX و HTML إلى صيغ هيكلية.'
                      : 'Multi-format document parsing and table AST mapping.'}
                  </p>
                  <div className="text-[10px] font-mono bg-slate-100 p-2 rounded text-slate-600">
                    UNSTRUCTURED_API_KEY
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 10. TAB 8: MCP CONTEXT MAP */}
        {activeTab === 'mcp' && (
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-3xs space-y-5">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-500" />
                <span>{t(lang, 'kb.mcpContextResourcesInspector')}</span>
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {isRtl
                  ? 'الموارد السياقية المكشوفة لخوادم الـ MCP والتي تتيح للذكاء الاصطناعي قراءة البيانات المعرفية المباشرة.'
                  : 'Standardized resource:// endpoints exposed to LLM clients for context retrieval.'}
              </p>
            </div>

            {mcpResources.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">{t(lang, 'kb.noActiveMcpResourcesFound')}</div>
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
      </div>

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
            // Keep the summary shape (no full content) — fetchKnowledgeData()
            // below refreshes from the summaries endpoint anyway.
            setDocuments((prev) =>
              prev.map((d) =>
                d.id === updatedDoc.id
                  ? {
                      ...d,
                      ...updatedDoc,
                      content: '',
                      contentChars: updatedDoc.content?.length || d.contentChars,
                      contentPreview: updatedDoc.content?.slice(0, 400) || d.contentPreview,
                    }
                  : d,
              ),
            );
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
        <Modal
          open
          onClose={() => setPreviewOcrEntry(null)}
          maxWidthClass="max-w-3xl"
          ariaLabelledBy="ocr-preview-title"
        >
          <div className="flex flex-col min-h-0 max-h-[85vh]">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-amber-50 text-amber-600 rounded-lg border border-amber-200">
                  <Zap className="w-4 h-4 fill-amber-500" />
                </span>
                <div>
                  <h4 id="ocr-preview-title" className="text-xs font-extrabold text-slate-900">
                    {previewOcrEntry.fileName}
                  </h4>
                  <span className="text-[10px] font-mono text-slate-400">
                    Mistral OCR Cache • {previewOcrEntry.extractedText.length.toLocaleString()} characters
                  </span>
                </div>
              </div>

              <ModalCloseButton onClose={() => setPreviewOcrEntry(null)} label={t(lang, 'kb.close')} />
            </div>

            <div className="p-5 overflow-y-auto flex-1 min-h-0 font-mono text-xs text-slate-800 whitespace-pre-wrap leading-relaxed bg-slate-950/5 select-text">
              {previewOcrEntry.extractedText}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs shrink-0">
              <span className="text-slate-500 font-mono text-[11px]">Engine: {previewOcrEntry.engineUsed}</span>

              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    const ok = await copyToClipboard(previewOcrEntry.extractedText);
                    toast({
                      title: ok
                        ? isRtl
                          ? 'تم نسخ النص المفرغ للحافظة'
                          : 'Copied text to clipboard'
                        : isRtl
                          ? 'تعذر النسخ إلى الحافظة'
                          : 'Could not copy to clipboard',
                      variant: ok ? 'success' : 'error',
                    });
                  }}
                  className="px-3 py-1.5 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{t(lang, 'kb.copyText')}</span>
                </button>

                <button
                  onClick={() => setPreviewOcrEntry(null)}
                  className="px-3 py-1.5 bg-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-300 transition cursor-pointer"
                >
                  {t(lang, 'kb.close')}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirmation dialogs (accessible replacements for native confirm()) */}
      <ConfirmDialog
        open={!!pendingDeleteDoc}
        title={t(lang, 'kb.permanentlyDeleteDocument')}
        message={
          isRtl
            ? `هل تود حذف "${pendingDeleteDoc?.title}" ومتجهاته نهائياً من Qdrant؟ لا يمكن التراجع عن هذا الإجراء.`
            : `Permanently delete "${pendingDeleteDoc?.title}" and its Qdrant vectors? This cannot be undone.`
        }
        confirmLabel={t(lang, 'kb.deletePermanently')}
        cancelLabel={t(lang, 'kb.cancel')}
        variant="danger"
        loading={isDeleting}
        onConfirm={confirmDeleteDocument}
        onCancel={() => setPendingDeleteDoc(null)}
      />

      <ConfirmDialog
        open={!!pendingDeleteSource}
        title={t(lang, 'kb.deleteConnector')}
        message={
          isRtl
            ? `هل أنت متأكد من حذف الموصل "${pendingDeleteSource?.name}" وإلغاء فهرسة مستنداته؟`
            : `Are you sure you want to delete the "${pendingDeleteSource?.name}" connector and de-index its documents?`
        }
        confirmLabel={t(lang, 'kb.delete')}
        cancelLabel={t(lang, 'kb.cancel')}
        variant="danger"
        loading={isDeleting}
        onConfirm={confirmDeleteSource}
        onCancel={() => setPendingDeleteSource(null)}
      />

      <ConfirmDialog
        open={isClearCacheConfirmOpen}
        title={t(lang, 'kb.clearOcrCache')}
        message={
          isRtl
            ? 'هل تريد مسح جميع نتائج الـ OCR المخزنة في الذاكرة المؤقتة؟ سيُعاد استخراج النصوص عند رفع نفس الملفات مجدداً.'
            : 'Clear all cached Mistral OCR results? Text will be re-extracted if you upload the same files again.'
        }
        confirmLabel={t(lang, 'kb.clearAll')}
        cancelLabel={t(lang, 'kb.cancel')}
        variant="warning"
        onConfirm={() => {
          clearAllOcrCache();
          refreshOcrCache();
          setIsClearCacheConfirmOpen(false);
          toast({ title: t(lang, 'kb.ocrCacheCleared'), variant: 'success' });
        }}
        onCancel={() => setIsClearCacheConfirmOpen(false)}
      />
    </div>
  );
}
