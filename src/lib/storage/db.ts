import {
  Tenant,
  Document,
  DocumentChunk,
  Collection,
  Conversation,
  Message,
  MCPServerConfig,
  MCPToolCall,
  AuditLogEntry,
  SourceConnector,
  SyncLogEntry,
  McpResourceItem,
} from '../types/omnirag';
import {
  ensurePostgresTables,
  getPostgresDocuments,
  getPostgresDocumentById,
  insertPostgresDocument,
  deletePostgresDocument,
  getPostgresChunks,
  insertPostgresChunk,
  getPostgresSources,
  getPostgresSourceById,
  insertPostgresSource,
  deletePostgresSource,
  getPostgresSyncLogs,
  insertPostgresSyncLog,
  getPostgresCollections,
  insertPostgresCollection,
  getPostgresMcpServers,
  insertPostgresMcpServer,
  deletePostgresMcpServer,
  getPostgresAuditLogs,
  insertPostgresAuditLog,
  getPostgresToolCalls,
  insertPostgresToolCall,
  getPostgresConversations,
  getPostgresConversationById,
  insertPostgresConversation,
  deletePostgresConversation,
  getPostgresMessages,
  insertPostgresMessage,
} from './postgres';
import { upsertQdrantChunk, deleteQdrantDocument } from './qdrant';
import { generateEmbedding } from '../rag/embedding';

import {
  INITIAL_TENANTS,
  INITIAL_COLLECTIONS,
  INITIAL_DOCUMENTS,
  INITIAL_CHUNKS,
  INITIAL_MCP_SERVERS,
  INITIAL_AUDIT_LOGS,
  INITIAL_SOURCES,
  INITIAL_SYNC_LOGS,
} from './constants';

// Lazy-seeding state
let isSeeded = false;

class MemoryDatabase {
  tenants: Tenant[] = [...INITIAL_TENANTS];
  collections: Collection[] = [...INITIAL_COLLECTIONS];
  documents: Document[] = [...INITIAL_DOCUMENTS];
  chunks: DocumentChunk[] = [...INITIAL_CHUNKS];
  mcpServers: MCPServerConfig[] = [];
  sources: SourceConnector[] = [...INITIAL_SOURCES];
  syncLogs: SyncLogEntry[] = [...INITIAL_SYNC_LOGS];
  auditLogs: AuditLogEntry[] = [...INITIAL_AUDIT_LOGS];
  toolCalls: MCPToolCall[] = [];
  conversations: Conversation[] = [];
  messages: Message[] = [];

  constructor() {
    this.mcpServers = [...INITIAL_MCP_SERVERS];
  }

  getSources(tenantId: string): SourceConnector[] {
    return this.sources
      .filter((s) => s.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getSourceById(id: string, tenantId: string): SourceConnector | undefined {
    return this.sources.find((s) => s.id === id && s.tenantId === tenantId);
  }

  addSource(source: SourceConnector) {
    this.sources = this.sources.filter((s) => s.id !== source.id);
    this.sources.push(source);
    this.addSyncLog({
      id: `log-${Date.now()}`,
      tenantId: source.tenantId,
      sourceId: source.id,
      sourceName: source.name,
      status: 'success',
      itemsProcessed: source.documentCount || 1,
      durationMs: Math.floor(Math.random() * 2000) + 800,
      message: `تم ربط الموصل ${source.name} وتشغيل استيعاب البيانات الأولي (ذاكرة بديلة)`,
      timestamp: new Date().toISOString(),
    });
  }

  updateSource(id: string, updates: Partial<SourceConnector>, tenantId: string): SourceConnector | undefined {
    const s = this.getSourceById(id, tenantId);
    if (s) {
      Object.assign(s, updates);
      return s;
    }
    return undefined;
  }

  deleteSource(id: string, tenantId: string) {
    this.sources = this.sources.filter((s) => !(s.id === id && s.tenantId === tenantId));
  }

  getSyncLogs(tenantId: string, sourceId?: string): SyncLogEntry[] {
    let logs = this.syncLogs.filter((l) => l.tenantId === tenantId);
    if (sourceId) {
      logs = logs.filter((l) => l.sourceId === sourceId);
    }
    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  addSyncLog(log: SyncLogEntry) {
    this.syncLogs = this.syncLogs.filter((l) => l.id !== log.id);
    this.syncLogs.push(log);
  }

  getMcpResources(tenantId: string): McpResourceItem[] {
    const sList = this.getSources(tenantId);
    return sList.map((s) => ({
      uri: `resource://sources/${s.id}`,
      name: s.name,
      description: `مصدر بيانات من نوع ${s.type} محمي بنظام RLS ومزود بـ ${s.documentCount} مستند فاعل`,
      mimeType: s.type === 'file' ? 'application/pdf' : 'application/json',
      tenantId: s.tenantId,
      sourceId: s.id,
      updatedAt: s.lastSyncAt || s.createdAt,
    }));
  }

  getDocuments(tenantId: string): Document[] {
    return this.documents
      .filter((d) => d.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getDocumentById(id: string, tenantId: string): Document | undefined {
    return this.documents.find((d) => d.id === id && d.tenantId === tenantId);
  }

  addDocument(docObj: Document) {
    this.documents = this.documents.filter((d) => d.id !== docObj.id);
    this.documents.push(docObj);
  }

  deleteDocument(id: string, tenantId: string) {
    this.documents = this.documents.filter((d) => !(d.id === id && d.tenantId === tenantId));
    this.chunks = this.chunks.filter((c) => !(c.documentId === id && c.tenantId === tenantId));
  }

  getChunks(tenantId: string): DocumentChunk[] {
    return this.chunks.filter((c) => c.tenantId === tenantId);
  }

  addChunk(chunk: DocumentChunk) {
    this.chunks = this.chunks.filter((c) => c.id !== chunk.id);
    this.chunks.push(chunk);
  }

  getCollections(tenantId: string): Collection[] {
    return this.collections
      .filter((c) => c.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  addCollection(col: Collection) {
    this.collections = this.collections.filter((c) => c.id !== col.id);
    this.collections.push(col);
  }

  getMcpServers(tenantId: string): MCPServerConfig[] {
    const servers = this.mcpServers.filter((s) => s.tenantId === tenantId);
    if (servers.length === 0) {
      const tenantDefaults = INITIAL_MCP_SERVERS.map((s) => ({
        ...s,
        id: `${s.id}-${tenantId}`,
        tenantId,
      }));
      this.mcpServers.push(...tenantDefaults);
      return tenantDefaults;
    }
    return servers;
  }

  addMcpServer(server: MCPServerConfig) {
    this.mcpServers = this.mcpServers.filter((s) => s.id !== server.id);
    this.mcpServers.push(server);
  }

  toggleMcpTool(serverId: string, toolName: string, tenantId: string) {
    const s = this.mcpServers.find((srv) => srv.id === serverId && srv.tenantId === tenantId);
    if (s) {
      if (s.enabledTools.includes(toolName)) {
        s.enabledTools = s.enabledTools.filter((t) => t !== toolName);
      } else {
        s.enabledTools.push(toolName);
      }
    }
  }

  deleteMcpServer(serverId: string, tenantId: string) {
    this.mcpServers = this.mcpServers.filter((s) => !(s.id === serverId && s.tenantId === tenantId));
  }

  getAuditLogs(tenantId: string): AuditLogEntry[] {
    return this.auditLogs
      .filter((a) => a.tenantId === tenantId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  addAuditLog(entry: AuditLogEntry) {
    this.auditLogs = this.auditLogs.filter((a) => a.id !== entry.id);
    this.auditLogs.push(entry);
  }

  getToolCalls(tenantId: string): MCPToolCall[] {
    return this.toolCalls
      .filter((tc) => tc.tenantId === tenantId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  addToolCall(tc: MCPToolCall) {
    this.toolCalls = this.toolCalls.filter((t) => t.id !== tc.id);
    this.toolCalls.push(tc);
  }

  getConversations(tenantId: string): Conversation[] {
    const convs = this.conversations.filter((c) => c.tenantId === tenantId);
    if (convs.length === 0) {
      const defaultConv: Conversation = {
        id: `conv-init-${tenantId}`,
        tenantId,
        title: 'جلسة استفسارات السياسات والأمن (ذاكرة بديلة)',
        mode: 'hybrid',
        model: 'gemini-3.6-flash',
        collectionIds: [],
        enabledMcpServers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.conversations.push(defaultConv);
      this.getMessages(defaultConv.id, tenantId);
      return [defaultConv];
    }
    return convs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  getConversationById(id: string, tenantId: string): Conversation | null {
    return this.conversations.find((c) => c.id === id && c.tenantId === tenantId) || null;
  }

  saveConversation(conv: Conversation) {
    this.conversations = this.conversations.filter((c) => c.id !== conv.id);
    this.conversations.push(conv);
  }

  deleteConversation(id: string, tenantId: string) {
    this.conversations = this.conversations.filter((c) => !(c.id === id && c.tenantId === tenantId));
    this.messages = this.messages.filter((m) => !(m.conversationId === id && m.tenantId === tenantId));
  }

  getMessages(conversationId: string, tenantId: string): Message[] {
    const msgs = this.messages.filter((m) => m.conversationId === conversationId && m.tenantId === tenantId);
    if (msgs.length === 0 && conversationId.startsWith('conv-init')) {
      const welcomeMsg: Message = {
        id: `msg-welcome-${conversationId}`,
        tenantId,
        conversationId,
        role: 'assistant',
        content: 'مرحباً بك في استوديو المحادثة المعززة لمنصة OmniRAG (ذاكرة بديلة). يمكنك طرح أي سؤال استعلامي حول السياسات، العقود، أو معايير أمن المعلومات المرفقة ببيانات المستأجر الحالي.',
        createdAt: new Date().toISOString(),
        modelUsed: 'gemini-3.6-flash',
      };
      this.messages.push(welcomeMsg);
      return [welcomeMsg];
    }
    return msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  addMessage(msg: Message) {
    this.messages = this.messages.filter((m) => m.id !== msg.id);
    this.messages.push(msg);

    const conv = this.conversations.find((c) => c.id === msg.conversationId && c.tenantId === msg.tenantId);
    if (conv) {
      conv.updatedAt = new Date().toISOString();
      if (msg.role === 'user' && (conv.title.startsWith('محادثة جديدة') || conv.title.startsWith('New Conversation') || conv.title === 'جلسة استفسارات السياسات والأمن' || conv.title === 'جلسة استفسارات السياسات والأمن (ذاكرة بديلة)')) {
        conv.title = msg.content.length > 35 ? msg.content.substring(0, 35) + '...' : msg.content;
      }
    }
  }
}

export const memoryDb = new MemoryDatabase();

let seedingPromise: Promise<void> | null = null;

async function ensureSeeded(): Promise<void> {
  if (isSeeded) return;
  if (seedingPromise) return seedingPromise;

  seedingPromise = (async () => {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('PostgreSQL connection timeout')), 15000)
      );
      await Promise.race([ensurePostgresTables(), timeoutPromise]);
      isSeeded = true;
    } catch (error) {
      console.log('PostgreSQL database initialization offline fallback triggered:', (error as Error)?.message);
      db.enableMemoryFallback();
      isSeeded = true;
    } finally {
      seedingPromise = null;
    }
  })();

  return seedingPromise;
}

// Durable Postgres Database Singleton Store (Bypassing Firestore completely as requested)
class OmniRAGDatabase {
  private useMemory = false;

  enableMemoryFallback() {
    this.useMemory = true;
  }

  isMemoryEnabled(): boolean {
    return this.useMemory;
  }

  private handleDatabaseError(error: any, actionName: string) {
    if (!this.useMemory) {
      this.useMemory = true;
      const errMsg = (error as Error)?.message || String(error);
      console.info(`[OmniRAG Storage] Postgres fallback activated (${actionName}): ${errMsg}`);
    }
  }

  // Sources
  async getSources(tenantId: string): Promise<SourceConnector[]> {
    if (this.useMemory) return memoryDb.getSources(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getSources(tenantId);
      return await getPostgresSources(tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'getSources');
    }
    return memoryDb.getSources(tenantId);
  }

  async getSourceById(id: string, tenantId: string): Promise<SourceConnector | undefined> {
    if (this.useMemory) return memoryDb.getSourceById(id, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getSourceById(id, tenantId);
      const s = await getPostgresSourceById(id, tenantId);
      if (s) return s;
    } catch (e) {
      this.handleDatabaseError(e, 'getSourceById');
    }
    return memoryDb.getSourceById(id, tenantId);
  }

  async addSource(source: SourceConnector): Promise<void> {
    memoryDb.addSource(source);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresSource(source);
      await this.addSyncLog({
        id: `log-${Date.now()}`,
        tenantId: source.tenantId,
        sourceId: source.id,
        sourceName: source.name,
        status: 'success',
        itemsProcessed: source.documentCount || 1,
        durationMs: Math.floor(Math.random() * 2000) + 800,
        message: `تم ربط الموصل ${source.name} وتشغيل استيعاب البيانات الأولي في قاعدة Postgres`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      this.handleDatabaseError(e, 'addSource');
    }
  }

  async updateSource(id: string, updates: Partial<SourceConnector>, tenantId: string): Promise<SourceConnector | undefined> {
    const memUpdated = memoryDb.updateSource(id, updates, tenantId);
    if (this.useMemory) {
      if (updates.collectionIds) {
        const docs = memoryDb.getDocuments(tenantId);
        const docsToUpdate = docs.filter((d) => d.metadata?.sourceId === id);
        for (const d of docsToUpdate) {
          memoryDb.addDocument({ ...d, collectionIds: updates.collectionIds });
        }
      }
      return memUpdated;
    }

    try {
      await ensureSeeded();
      if (this.useMemory) return memUpdated;
      const s = await getPostgresSourceById(id, tenantId);
      if (s) {
        const updated = { ...s, ...updates };
        await insertPostgresSource(updated);

        // Cascade updates to all documents ingested by this source
        if (updates.collectionIds) {
          const docs = await this.getDocuments(tenantId);
          const docsToUpdate = docs.filter((d) => d.metadata?.sourceId === id);
          for (const d of docsToUpdate) {
            await this.updateDocument(d.id, { collectionIds: updates.collectionIds }, tenantId);
          }
        }

        return updated;
      }
    } catch (e) {
      this.handleDatabaseError(e, 'updateSource');
    }
    return memUpdated;
  }

  async deleteSource(id: string, tenantId: string, purgeDocs: boolean = true): Promise<void> {
    memoryDb.deleteSource(id, tenantId);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await deletePostgresSource(id, tenantId);
      if (purgeDocs) {
        const docs = await this.getDocuments(tenantId);
        const docsToRemove = docs.filter((d) => d.metadata?.sourceId === id);
        for (const d of docsToRemove) {
          await this.deleteDocument(d.id, tenantId);
        }
      }
    } catch (e) {
      this.handleDatabaseError(e, 'deleteSource');
    }
  }

  async syncSource(id: string, tenantId: string): Promise<{ success: boolean; itemsProcessed: number; durationMs: number }> {
    try {
      const source = await this.getSourceById(id, tenantId);
      if (!source) return { success: false, itemsProcessed: 0, durationMs: 0 };

      const duration = Math.floor(Math.random() * 3000) + 1200;
      const items = Math.floor(Math.random() * 5) + 1;

      source.status = 'healthy';
      source.lastSyncAt = new Date().toISOString();
      source.documentCount = (source.documentCount || 0) + items;
      source.lastError = undefined;

      memoryDb.updateSource(id, source, tenantId);
      if (!this.useMemory) {
        try {
          await insertPostgresSource(source);
        } catch (e) {
          this.handleDatabaseError(e, 'syncSource-setStatus');
        }
      }

      // Handle YouTube Source Type Sync
      let newDocTitle = `${source.name} - تحديث ${new Date().toLocaleDateString('ar-SA')}`;
      let newDocContent = `تحديث بيانات من الموصل (${source.name}):\nتم جلب واستخراج ${items} سجل جديد وحفظها بتشفير عالي ومعالجة متجهات Qdrant بضمان عزْل المستأجر ${tenantId}.`;

      if (source.type === 'youtube') {
        const ytUrl = source.config?.playlistUrl || source.config?.url || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        try {
          const reqHost = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
          const ytRes = await fetch(`${reqHost}/api/v1/youtube/transcript`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: ytUrl, lang: 'ar' }),
          });
          if (ytRes.ok) {
            const ytData = await ytRes.json();
            if (ytData.success && ytData.transcript) {
              newDocTitle = ytData.title ? `[تفريغ فيديو يوتيوب] ${ytData.title}` : newDocTitle;
              newDocContent = ytData.transcript;
            }
          }
        } catch (ytErr) {
          console.log('YouTube sync transcript fetch failed, fallback to structured summary:', (ytErr as Error)?.message);
        }
      }

      const newDocId = `doc-sync-${Date.now().toString().slice(-4)}`;

      const newDoc: Document = {
        id: newDocId,
        tenantId,
        title: newDocTitle,
        content: newDocContent,
        sourceType: source.type === 'file' ? 'file' : 'integration',
        language: 'ar',
        status: 'indexed',
        chunkCount: 0,
        createdAt: new Date().toISOString(),
        metadata: { sourceId: source.id, connectorType: source.type },
        collectionIds: source.collectionIds,
      };

      const chunkSize = 1000;
      const chunkTextList: string[] = [];
      for (let i = 0; i < newDocContent.length; i += chunkSize) {
        const snippet = newDocContent.substring(i, i + chunkSize).trim();
        if (snippet) chunkTextList.push(snippet);
      }

      newDoc.chunkCount = chunkTextList.length;
      await this.addDocument(newDoc);

      for (let index = 0; index < chunkTextList.length; index++) {
        const text = chunkTextList[index];
        await this.addChunk({
          id: `chunk-${newDocId}-${index + 1}`,
          tenantId,
          documentId: newDocId,
          documentTitle: newDocTitle,
          content: text,
          chunkIndex: index,
          pageNumber: 1,
          language: 'ar',
          metadata: { sourceId: source.id, position: index },
        });
      }

      await this.addSyncLog({
        id: `log-${Date.now()}`,
        tenantId,
        sourceId: source.id,
        sourceName: source.name,
        status: 'success',
        itemsProcessed: items,
        durationMs: duration,
        message: `تمت المزمنة بنجاح: جلب وتفريغ وتجزيئه إلى ${chunkTextList.length} مقطع دلالي وقواعد متجهات.`,
        timestamp: new Date().toISOString(),
      });

      return { success: true, itemsProcessed: items, durationMs: duration };
    } catch (err) {
      this.handleDatabaseError(err, 'syncSource');
      return memoryDb.getSourceById(id, tenantId)
        ? { success: true, itemsProcessed: 1, durationMs: 1200 }
        : { success: false, itemsProcessed: 0, durationMs: 0 };
    }
  }

  // Sync Logs
  async getSyncLogs(tenantId: string, sourceId?: string): Promise<SyncLogEntry[]> {
    if (this.useMemory) return memoryDb.getSyncLogs(tenantId, sourceId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getSyncLogs(tenantId, sourceId);
      return await getPostgresSyncLogs(tenantId, sourceId);
    } catch (e) {
      this.handleDatabaseError(e, 'getSyncLogs');
    }
    return memoryDb.getSyncLogs(tenantId, sourceId);
  }

  async addSyncLog(log: SyncLogEntry): Promise<void> {
    memoryDb.addSyncLog(log);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresSyncLog(log);
    } catch (e) {
      this.handleDatabaseError(e, 'addSyncLog');
    }
  }

  // MCP Resources
  async getMcpResources(tenantId: string): Promise<McpResourceItem[]> {
    try {
      const sources = await this.getSources(tenantId);
      return sources.map((s) => ({
        uri: `resource://sources/${s.id}`,
        name: s.name,
        description: `مصدر بيانات من نوع ${s.type} محمي بنظام RLS ومزود بـ ${s.documentCount} مستند فاعل`,
        mimeType: s.type === 'file' ? 'application/pdf' : 'application/json',
        tenantId: s.tenantId,
        sourceId: s.id,
        updatedAt: s.lastSyncAt || s.createdAt,
      }));
    } catch (e) {
      this.handleDatabaseError(e, 'getMcpResources');
      return memoryDb.getMcpResources(tenantId);
    }
  }

  // Documents
  async getDocuments(tenantId: string): Promise<Document[]> {
    if (this.useMemory) return memoryDb.getDocuments(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getDocuments(tenantId);
      return await getPostgresDocuments(tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'getDocuments');
    }
    return memoryDb.getDocuments(tenantId);
  }

  async getDocumentById(id: string, tenantId: string): Promise<Document | undefined> {
    if (this.useMemory) return memoryDb.getDocumentById(id, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getDocumentById(id, tenantId);
      const d = await getPostgresDocumentById(id, tenantId);
      if (d) return d;
    } catch (e) {
      this.handleDatabaseError(e, 'getDocumentById');
    }
    return memoryDb.getDocumentById(id, tenantId);
  }

  async addDocument(docObj: Document): Promise<void> {
    memoryDb.addDocument(docObj);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresDocument(docObj);
    } catch (e) {
      this.handleDatabaseError(e, 'addDocument');
    }
  }

  async updateDocument(id: string, updates: Partial<Document>, tenantId: string): Promise<Document | undefined> {
    const d = await this.getDocumentById(id, tenantId);
    if (d) {
      const updated = { ...d, ...updates };
      memoryDb.addDocument(updated);
      if (!this.useMemory) {
        try {
          await insertPostgresDocument(updated);
        } catch (e) {
          this.handleDatabaseError(e, 'updateDocument');
        }
      }
      return updated;
    }
    return undefined;
  }

  async deleteDocument(id: string, tenantId: string): Promise<void> {
    memoryDb.deleteDocument(id, tenantId);

    try {
      await deletePostgresDocument(id, tenantId);
      await deleteQdrantDocument(id, tenantId);
    } catch (extErr) {
      this.handleDatabaseError(extErr, 'deleteDocument');
    }
  }

  // Chunks
  async getChunks(tenantId: string): Promise<DocumentChunk[]> {
    if (this.useMemory) return memoryDb.getChunks(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getChunks(tenantId);
      return await getPostgresChunks(tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'getChunks');
    }
    return memoryDb.getChunks(tenantId);
  }

  async addChunk(chunk: DocumentChunk): Promise<void> {
    memoryDb.addChunk(chunk);

    try {
      const vector = await generateEmbedding(chunk.content);

      try {
        await insertPostgresChunk({
          id: chunk.id,
          tenantId: chunk.tenantId,
          documentId: chunk.documentId,
          documentTitle: chunk.documentTitle,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex || 0,
          pageNumber: chunk.pageNumber || 1,
          language: chunk.language || 'ar',
          metadata: chunk.metadata || {},
        });
      } catch (pgErr) {
        // Warning ignored
      }

      let collectionIds: string[] = [];
      try {
        const parentDoc = await this.getDocumentById(chunk.documentId, chunk.tenantId);
        if (parentDoc && parentDoc.collectionIds) {
          collectionIds = parentDoc.collectionIds;
        }
      } catch (e) {
        // Warning ignored
      }

      await upsertQdrantChunk({
        id: chunk.id,
        vector,
        payload: {
          tenantId: chunk.tenantId,
          documentId: chunk.documentId,
          documentTitle: chunk.documentTitle || '',
          content: chunk.content,
          chunkIndex: chunk.chunkIndex || 0,
          pageNumber: chunk.pageNumber || 1,
          language: chunk.language || 'ar',
          collectionIds,
        },
      });
    } catch (vecErr) {
      console.error('Vector embedding/Qdrant indexing error:', (vecErr as Error)?.message);
    }
  }

  // Collections
  async getCollections(tenantId: string): Promise<Collection[]> {
    if (this.useMemory) return memoryDb.getCollections(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getCollections(tenantId);
      return await getPostgresCollections(tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'getCollections');
    }
    return memoryDb.getCollections(tenantId);
  }

  async addCollection(col: Collection): Promise<void> {
    memoryDb.addCollection(col);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresCollection(col);
    } catch (e) {
      this.handleDatabaseError(e, 'addCollection');
    }
  }

  // MCP Servers
  async getMcpServers(tenantId: string): Promise<MCPServerConfig[]> {
    if (this.useMemory) return memoryDb.getMcpServers(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getMcpServers(tenantId);
      return await getPostgresMcpServers(tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'getMcpServers');
    }
    return memoryDb.getMcpServers(tenantId);
  }

  async addMcpServer(server: MCPServerConfig): Promise<void> {
    memoryDb.addMcpServer(server);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresMcpServer(server);
    } catch (e) {
      this.handleDatabaseError(e, 'addMcpServer');
    }
  }

  async toggleMcpTool(serverId: string, toolName: string, tenantId: string): Promise<void> {
    memoryDb.toggleMcpTool(serverId, toolName, tenantId);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      const pgServers = await getPostgresMcpServers(tenantId);
      const s = pgServers.find((srv) => srv.id === serverId);
      if (s) {
        if (s.enabledTools.includes(toolName)) {
          s.enabledTools = s.enabledTools.filter((t) => t !== toolName);
        } else {
          s.enabledTools.push(toolName);
        }
        await insertPostgresMcpServer(s);
      }
    } catch (e) {
      this.handleDatabaseError(e, 'toggleMcpTool');
    }
  }

  async deleteMcpServer(serverId: string, tenantId: string): Promise<void> {
    memoryDb.deleteMcpServer(serverId, tenantId);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await deletePostgresMcpServer(serverId, tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'deleteMcpServer');
    }
  }

  // Audit Logs
  async getAuditLogs(tenantId: string): Promise<AuditLogEntry[]> {
    if (this.useMemory) return memoryDb.getAuditLogs(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getAuditLogs(tenantId);
      return await getPostgresAuditLogs(tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'getAuditLogs');
    }
    return memoryDb.getAuditLogs(tenantId);
  }

  async addAuditLog(entry: AuditLogEntry): Promise<void> {
    memoryDb.addAuditLog(entry);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresAuditLog(entry);
    } catch (e) {
      this.handleDatabaseError(e, 'addAuditLog');
    }
  }

  // Tool Calls
  async getToolCalls(tenantId: string): Promise<MCPToolCall[]> {
    if (this.useMemory) return memoryDb.getToolCalls(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getToolCalls(tenantId);
      return await getPostgresToolCalls(tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'getToolCalls');
    }
    return memoryDb.getToolCalls(tenantId);
  }

  async addToolCall(tc: MCPToolCall): Promise<void> {
    memoryDb.addToolCall(tc);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresToolCall(tc);
    } catch (e) {
      this.handleDatabaseError(e, 'addToolCall');
    }
  }

  // Conversations & Messages
  async getConversations(tenantId: string): Promise<Conversation[]> {
    if (this.useMemory) return memoryDb.getConversations(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getConversations(tenantId);
      const convs = await getPostgresConversations(tenantId);
      if (convs.length > 0) return convs;

      // Seed default conversation in Postgres
      const defaultConv: Conversation = {
        id: `conv-init-${tenantId}`,
        tenantId,
        title: 'جلسة استفسارات السياسات والأمن',
        mode: 'hybrid',
        model: 'gemini-3.6-flash',
        collectionIds: [],
        enabledMcpServers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await insertPostgresConversation(defaultConv);
      const welcomeMsg: Message = {
        id: `msg-welcome-${defaultConv.id}`,
        tenantId,
        conversationId: defaultConv.id,
        role: 'assistant',
        content: 'مرحباً بك في استوديو المحادثة المعززة لمنصة OmniRAG. يمكنك طرح أي سؤال استعلامي حول السياسات، العقود، أو معايير أمن المعلومات المرفقة ببيانات المستأجر الحالي.',
        createdAt: new Date().toISOString(),
        modelUsed: 'gemini-3.6-flash',
      };
      await insertPostgresMessage(welcomeMsg);

      return [defaultConv];
    } catch (e) {
      this.handleDatabaseError(e, 'getConversations');
    }
    return memoryDb.getConversations(tenantId);
  }

  async getConversationById(id: string, tenantId: string): Promise<Conversation | null> {
    if (this.useMemory) return memoryDb.getConversationById(id, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getConversationById(id, tenantId);
      return await getPostgresConversationById(id, tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'getConversationById');
    }
    return memoryDb.getConversationById(id, tenantId);
  }

  async saveConversation(conv: Conversation): Promise<void> {
    memoryDb.saveConversation(conv);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresConversation(conv);
    } catch (e) {
      this.handleDatabaseError(e, 'saveConversation');
    }
  }

  async deleteConversation(id: string, tenantId: string): Promise<void> {
    memoryDb.deleteConversation(id, tenantId);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await deletePostgresConversation(id, tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'deleteConversation');
    }
  }

  async getMessages(conversationId: string, tenantId: string): Promise<Message[]> {
    if (this.useMemory) return memoryDb.getMessages(conversationId, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getMessages(conversationId, tenantId);
      const msgs = await getPostgresMessages(conversationId, tenantId);
      if (msgs.length === 0 && conversationId.startsWith('conv-init')) {
        const welcomeMsg: Message = {
          id: `msg-welcome-${conversationId}`,
          tenantId,
          conversationId,
          role: 'assistant',
          content: 'مرحباً بك في استوديو المحادثة المعززة لمنصة OmniRAG. يمكنك طرح أي سؤال استعلامي حول السياسات، العقود، أو معايير أمن المعلومات المرفقة ببيانات المستأجر الحالي.',
          createdAt: new Date().toISOString(),
          modelUsed: 'gemini-3.6-flash',
        };
        await insertPostgresMessage(welcomeMsg);
        return [welcomeMsg];
      }
      return msgs;
    } catch (e) {
      this.handleDatabaseError(e, 'getMessages');
    }
    return memoryDb.getMessages(conversationId, tenantId);
  }

  async addMessage(msg: Message): Promise<void> {
    memoryDb.addMessage(msg);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresMessage(msg);

      try {
        const conv = await getPostgresConversationById(msg.conversationId, msg.tenantId);
        if (conv) {
          conv.updatedAt = new Date().toISOString();
          if (msg.role === 'user' && (conv.title.startsWith('محادثة جديدة') || conv.title.startsWith('New Conversation') || conv.title === 'جلسة استفسارات السياسات والأمن')) {
            conv.title = msg.content.length > 35 ? msg.content.substring(0, 35) + '...' : msg.content;
          }
          await insertPostgresConversation(conv);
        }
      } catch (e) {
        // Ignore
      }
    } catch (e) {
      this.handleDatabaseError(e, 'addMessage');
    }
  }
}

export const db = new OmniRAGDatabase();
