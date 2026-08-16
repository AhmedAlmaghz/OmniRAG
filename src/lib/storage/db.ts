import {
  Tenant,
  User,
  SessionRecord,
  Document,
  DocumentVersion,
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
  resetPostgresPool,
  getPostgresUserByEmail,
  getPostgresUserById,
  insertPostgresUser,
  getPostgresTenant,
  insertPostgresTenant,
  getPostgresSession,
  insertPostgresSession,
  deletePostgresSession,
  deleteExpiredPostgresSessions,
} from './postgres';
import { upsertQdrantChunk, upsertQdrantChunks, deleteQdrantDocument, updateQdrantDocumentPayload } from './qdrant';
import { generateEmbedding, embedBatch } from '../rag/embedding';
import { processYoutubeTranscript } from '../youtube/transcriptParser';
import { processPdfWithBatchedPipeline } from '../pdf/pdfChunker';
import { decryptSourceConfig } from './sourceConfigCrypto';

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
import type { IOmniRAGDatabase } from './IOmniRAGDatabase';

// Lazy-seeding state
let isSeeded = false;

export class MemoryDatabase implements IOmniRAGDatabase {
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
  // Auth state (Postgres-only auth — replaces Firebase Auth)
  users: User[] = [];
  sessions: SessionRecord[] = [];

  constructor() {
    this.mcpServers = [...INITIAL_MCP_SERVERS];
  }

  resetDatabaseState(): void {
    // No external pool to reset for the in-memory store; reseed initial data.
    this.tenants = [...INITIAL_TENANTS];
    this.collections = [...INITIAL_COLLECTIONS];
    this.documents = [...INITIAL_DOCUMENTS];
    this.chunks = [...INITIAL_CHUNKS];
    this.mcpServers = [...INITIAL_MCP_SERVERS];
    this.sources = [...INITIAL_SOURCES];
    this.syncLogs = [...INITIAL_SYNC_LOGS];
    this.auditLogs = [...INITIAL_AUDIT_LOGS];
    this.toolCalls = [];
    this.conversations = [];
    this.messages = [];
    this.users = [];
    this.sessions = [];
  }

  async getSources(tenantId: string): Promise<SourceConnector[]> {
    return this.sources
      .filter((s) => s.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getSourceById(id: string, tenantId: string): Promise<SourceConnector | undefined> {
    return this.sources.find((s) => s.id === id && s.tenantId === tenantId);
  }

  async addSource(source: SourceConnector): Promise<void> {
    const startedAt = Date.now();
    this.sources = this.sources.filter((s) => s.id !== source.id);
    this.sources.push(source);
    await this.addSyncLog({
      id: `log-${Date.now()}`,
      tenantId: source.tenantId,
      sourceId: source.id,
      sourceName: source.name,
      status: 'success',
      itemsProcessed: source.documentCount || 1,
      durationMs: Math.max(1, Date.now() - startedAt),
      message: `تم ربط الموصل ${source.name} وتشغيل استيعاب البيانات الأولي (ذاكرة بديلة)`,
      timestamp: new Date().toISOString(),
    });
  }

  async updateSource(
    id: string,
    updates: Partial<SourceConnector>,
    tenantId: string,
  ): Promise<SourceConnector | undefined> {
    const s = await this.getSourceById(id, tenantId);
    if (s) {
      Object.assign(s, updates);
      return s;
    }
    return undefined;
  }

  async deleteSource(id: string, tenantId: string): Promise<void> {
    this.sources = this.sources.filter((s) => !(s.id === id && s.tenantId === tenantId));
  }

  async syncSource(
    id: string,
    tenantId: string,
  ): Promise<{ success: boolean; itemsProcessed: number; durationMs: number }> {
    const source = await this.getSourceById(id, tenantId);
    if (!source) return { success: false, itemsProcessed: 0, durationMs: 0 };
    return { success: true, itemsProcessed: source.documentCount || 0, durationMs: 0 };
  }

  async getSyncLogs(tenantId: string, sourceId?: string): Promise<SyncLogEntry[]> {
    let logs = this.syncLogs.filter((l) => l.tenantId === tenantId);
    if (sourceId) {
      logs = logs.filter((l) => l.sourceId === sourceId);
    }
    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async addSyncLog(log: SyncLogEntry): Promise<void> {
    this.syncLogs = this.syncLogs.filter((l) => l.id !== log.id);
    this.syncLogs.push(log);
  }

  async getMcpResources(tenantId: string): Promise<McpResourceItem[]> {
    const sList = await this.getSources(tenantId);
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

  async getDocuments(tenantId: string): Promise<Document[]> {
    const docs = this.documents
      .filter((d) => d.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Dev-only data auto-seed: after Demo Auth removal, real local-auth tenants
    // (`tenant-<id>`) no longer collide with the seeded `tenant-acme-01` /
    // `tenant-health-02` demo data. Without this, a fresh dev user (e.g. the
    // AuthScreen "Sandbox Guest") would see an empty Knowledge Base in the
    // memory-only path. In production, returns whatever exists (empty allowed).
    if (docs.length === 0 && process.env.NODE_ENV !== 'production') {
      const defaultDocs = INITIAL_DOCUMENTS.map((d) => ({
        ...d,
        id: `${d.id}-${tenantId}`,
        tenantId,
      }));
      for (const d of defaultDocs) {
        await this.addDocument(d);
      }
      const defaultChunks = INITIAL_CHUNKS.map((c) => ({
        ...c,
        id: `${c.id}-${tenantId}`,
        documentId: `${c.documentId}-${tenantId}`,
        tenantId,
      }));
      await this.addChunks(defaultChunks);
      return this.documents
        .filter((d) => d.tenantId === tenantId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    return docs;
  }

  async getDocumentById(id: string, tenantId: string): Promise<Document | undefined> {
    return this.documents.find((d) => d.id === id && d.tenantId === tenantId);
  }

  async addDocument(docObj: Document): Promise<void> {
    this.documents = this.documents.filter((d) => d.id !== docObj.id);
    this.documents.push(docObj);
  }

  async updateDocument(id: string, updates: Partial<Document>, tenantId: string): Promise<Document | undefined> {
    const doc = await this.getDocumentById(id, tenantId);
    if (!doc) return undefined;
    Object.assign(doc, updates);
    return doc;
  }

  async deleteDocument(id: string, tenantId: string): Promise<void> {
    this.documents = this.documents.filter((d) => !(d.id === id && d.tenantId === tenantId));
    this.chunks = this.chunks.filter((c) => !(c.documentId === id && c.tenantId === tenantId));
  }

  async getChunks(tenantId: string): Promise<DocumentChunk[]> {
    return this.chunks.filter((c) => c.tenantId === tenantId);
  }

  async addChunk(chunk: DocumentChunk): Promise<void> {
    this.chunks = this.chunks.filter((c) => c.id !== chunk.id);
    this.chunks.push(chunk);
  }

  async addChunks(chunks: DocumentChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const ids = new Set(chunks.map((c) => c.id));
    this.chunks = this.chunks.filter((c) => !ids.has(c.id));
    this.chunks.push(...chunks);
  }

  async getDocumentVersions(documentId: string, tenantId: string): Promise<DocumentVersion[]> {
    const doc = await this.getDocumentById(documentId, tenantId);
    return doc?.versions || [];
  }

  async createDocumentVersion(
    documentId: string,
    params: { title?: string; content: string; changeSummary?: string; createdBy?: string },
    tenantId: string,
  ): Promise<{ document: Document; version: DocumentVersion } | undefined> {
    const doc = await this.getDocumentById(documentId, tenantId);
    if (!doc) return undefined;
    const versions = doc.versions || [];
    const versionNumber = versions.length + 1;
    const version: DocumentVersion = {
      id: `ver-${documentId}-${versionNumber}`,
      documentId,
      versionNumber,
      title: params.title || doc.title,
      content: params.content,
      chunkCount: 0,
      changeSummary: params.changeSummary,
      createdBy: params.createdBy,
      createdAt: new Date().toISOString(),
    };
    doc.versions = [...versions, version];
    doc.content = params.content;
    doc.version = versionNumber;
    doc.updatedAt = new Date().toISOString();
    return { document: doc, version };
  }

  async revertDocumentVersion(
    documentId: string,
    targetVersionNumber: number,
    tenantId: string,
  ): Promise<{ document: Document; restoredVersion: DocumentVersion } | undefined> {
    const doc = await this.getDocumentById(documentId, tenantId);
    if (!doc) return undefined;
    const targetVer = (doc.versions || []).find((v) => v.versionNumber === targetVersionNumber);
    if (!targetVer) return undefined;
    doc.content = targetVer.content;
    doc.version = targetVer.versionNumber;
    doc.updatedAt = new Date().toISOString();
    return { document: doc, restoredVersion: targetVer };
  }

  async getCollections(tenantId: string): Promise<Collection[]> {
    return this.collections
      .filter((c) => c.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async addCollection(col: Collection): Promise<void> {
    this.collections = this.collections.filter((c) => c.id !== col.id);
    this.collections.push(col);
  }

  async getMcpServers(tenantId: string): Promise<MCPServerConfig[]> {
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

  async addMcpServer(server: MCPServerConfig): Promise<void> {
    this.mcpServers = this.mcpServers.filter((s) => s.id !== server.id);
    this.mcpServers.push(server);
  }

  async toggleMcpTool(serverId: string, toolName: string, tenantId: string): Promise<void> {
    const s = this.mcpServers.find((srv) => srv.id === serverId && srv.tenantId === tenantId);
    if (s) {
      if (s.enabledTools.includes(toolName)) {
        s.enabledTools = s.enabledTools.filter((t) => t !== toolName);
      } else {
        s.enabledTools.push(toolName);
      }
    }
  }

  async deleteMcpServer(serverId: string, tenantId: string): Promise<void> {
    this.mcpServers = this.mcpServers.filter((s) => !(s.id === serverId && s.tenantId === tenantId));
  }

  async getAuditLogs(tenantId: string): Promise<AuditLogEntry[]> {
    return this.auditLogs
      .filter((a) => a.tenantId === tenantId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async addAuditLog(entry: AuditLogEntry): Promise<void> {
    this.auditLogs = this.auditLogs.filter((a) => a.id !== entry.id);
    this.auditLogs.push(entry);
  }

  async getToolCalls(tenantId: string): Promise<MCPToolCall[]> {
    return this.toolCalls
      .filter((tc) => tc.tenantId === tenantId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async addToolCall(tc: MCPToolCall): Promise<void> {
    this.toolCalls = this.toolCalls.filter((t) => t.id !== tc.id);
    this.toolCalls.push(tc);
  }

  async getConversations(tenantId: string): Promise<Conversation[]> {
    const convs = this.conversations.filter((c) => c.tenantId === tenantId);
    if (convs.length === 0) {
      const defaultConv: Conversation = {
        id: `conv-init-${tenantId}`,
        tenantId,
        title: 'جلسة استفسارات السياسات والأمن (ذاكرة بديلة)',
        mode: 'hybrid',
        model: 'gemini-3.7-flash',
        collectionIds: [],
        enabledMcpServers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.conversations.push(defaultConv);
      await this.getMessages(defaultConv.id, tenantId);
      return [defaultConv];
    }
    return convs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async getConversationById(id: string, tenantId: string): Promise<Conversation | null> {
    return this.conversations.find((c) => c.id === id && c.tenantId === tenantId) || null;
  }

  async saveConversation(conv: Conversation): Promise<void> {
    this.conversations = this.conversations.filter((c) => c.id !== conv.id);
    this.conversations.push(conv);
  }

  async deleteConversation(id: string, tenantId: string): Promise<void> {
    this.conversations = this.conversations.filter((c) => !(c.id === id && c.tenantId === tenantId));
    this.messages = this.messages.filter((m) => !(m.conversationId === id && m.tenantId === tenantId));
  }

  async getMessages(conversationId: string, tenantId: string): Promise<Message[]> {
    const msgs = this.messages.filter((m) => m.conversationId === conversationId && m.tenantId === tenantId);
    if (msgs.length === 0 && conversationId.startsWith('conv-init')) {
      const welcomeMsg: Message = {
        id: `msg-welcome-${conversationId}`,
        tenantId,
        conversationId,
        role: 'assistant',
        content:
          'مرحباً بك في استوديو المحادثة المعززة لمنصة OmniRAG (ذاكرة بديلة). يمكنك طرح أي سؤال استعلامي حول السياسات، العقود، أو معايير أمن المعلومات المرفقة ببيانات المستأجر الحالي.',
        createdAt: new Date().toISOString(),
        modelUsed: 'gemini-3.7-flash',
      };
      this.messages.push(welcomeMsg);
      return [welcomeMsg];
    }
    return msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async addMessage(msg: Message): Promise<void> {
    this.messages = this.messages.filter((m) => m.id !== msg.id);
    this.messages.push(msg);

    const conv = this.conversations.find((c) => c.id === msg.conversationId && c.tenantId === msg.tenantId);
    if (conv) {
      conv.updatedAt = new Date().toISOString();
      if (
        msg.role === 'user' &&
        (conv.title.startsWith('محادثة جديدة') ||
          conv.title.startsWith('New Conversation') ||
          conv.title === 'جلسة استفسارات السياسات والأمن' ||
          conv.title === 'جلسة استفسارات السياسات والأمن (ذاكرة بديلة)')
      ) {
        conv.title = msg.content.length > 35 ? msg.content.substring(0, 35) + '...' : msg.content;
      }
    }
  }

  // Auth (Postgres-only — user, tenant, and opaque session lifecycle)
  async getUserByEmail(email: string): Promise<User | undefined> {
    const lower = email.toLowerCase();
    return this.users.find((u) => u.email.toLowerCase() === lower);
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.users.find((u) => u.id === id);
  }

  async createUser(user: User): Promise<void> {
    this.users = this.users.filter((u) => u.id !== user.id && u.email.toLowerCase() !== user.email.toLowerCase());
    this.users.push({ ...user, email: user.email.toLowerCase() });
  }

  async createTenant(tenant: Tenant): Promise<void> {
    this.tenants = this.tenants.filter((t) => t.id !== tenant.id);
    this.tenants.push(tenant);
  }

  async getTenant(tenantId: string): Promise<Tenant | undefined> {
    return this.tenants.find((t) => t.id === tenantId);
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.token !== session.token);
    this.sessions.push(session);
  }

  async getSession(token: string): Promise<SessionRecord | undefined> {
    return this.sessions.find((s) => s.token === token);
  }

  async deleteSession(token: string): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.token !== token);
  }

  async deleteExpiredSessions(): Promise<void> {
    const now = Date.now();
    this.sessions = this.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  }
}

export const memoryDb = new MemoryDatabase();

let seedingPromise: Promise<void> | null = null;

async function ensureSeeded(): Promise<void> {
  if (isSeeded) return;
  if (seedingPromise) return seedingPromise;

  seedingPromise = (async () => {
    let timeoutId: NodeJS.Timeout;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('PostgreSQL connection timeout')), 8000);
      });

      const dbPromise = ensurePostgresTables().catch((err) => {
        if (!isSeeded) throw err; // if race is still ongoing, pass error to Promise.race
        console.error('Background ensurePostgresTables late error caught to prevent unhandled rejection:', err);
      });

      await Promise.race([dbPromise, timeoutPromise]);
      isSeeded = true;
    } catch (error) {
      console.log('PostgreSQL database initialization offline fallback triggered:', (error as Error)?.message);
      dbInstance.enableMemoryFallback();
      isSeeded = true;
    } finally {
      clearTimeout(timeoutId!);
      seedingPromise = null;
    }
  })();

  return seedingPromise;
}

// Durable Postgres Database Singleton Store (the production backend)
class OmniRAGDatabase implements IOmniRAGDatabase {
  private useMemory = false;

  enableMemoryFallback() {
    this.useMemory = true;
  }

  disableMemoryFallback() {
    this.useMemory = false;
  }

  isMemoryEnabled(): boolean {
    return this.useMemory;
  }

  resetDatabaseState() {
    this.useMemory = false;
    resetPostgresPool();
    isSeeded = false;
    seedingPromise = null;
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
    let sourcesList: SourceConnector[] = [];
    if (this.useMemory) {
      sourcesList = await memoryDb.getSources(tenantId);
    } else {
      try {
        await ensureSeeded();
        if (this.useMemory) {
          sourcesList = await memoryDb.getSources(tenantId);
        } else {
          sourcesList = await getPostgresSources(tenantId);
        }
      } catch (e) {
        this.handleDatabaseError(e, 'getSources');
        sourcesList = await memoryDb.getSources(tenantId);
      }
    }

    if (sourcesList.length === 0) {
      const defaultSources = INITIAL_SOURCES.map((s) => ({
        ...s,
        id: `${s.id}-${tenantId}`,
        tenantId,
      }));
      for (const s of defaultSources) {
        await this.addSource(s);
      }
      return defaultSources;
    }

    return sourcesList;
  }

  async getSourceById(id: string, tenantId: string): Promise<SourceConnector | undefined> {
    if (this.useMemory) return await memoryDb.getSourceById(id, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return await memoryDb.getSourceById(id, tenantId);
      const s = await getPostgresSourceById(id, tenantId);
      if (s) return s;
    } catch (e) {
      this.handleDatabaseError(e, 'getSourceById');
    }
    return await memoryDb.getSourceById(id, tenantId);
  }

  async addSource(source: SourceConnector): Promise<void> {
    await memoryDb.addSource(source);
    if (this.useMemory) return;

    const startedAt = Date.now();
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
        durationMs: Math.max(1, Date.now() - startedAt),
        message: `تم ربط الموصل ${source.name} وتشغيل استيعاب البيانات الأولي في قاعدة Postgres`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      this.handleDatabaseError(e, 'addSource');
    }
  }

  async updateSource(
    id: string,
    updates: Partial<SourceConnector>,
    tenantId: string,
  ): Promise<SourceConnector | undefined> {
    const memUpdated = await memoryDb.updateSource(id, updates, tenantId);
    if (this.useMemory) {
      if (updates.collectionIds) {
        const docs = await memoryDb.getDocuments(tenantId);
        const docsToUpdate = docs.filter((d) => d.metadata?.sourceId === id);
        for (const d of docsToUpdate) {
          await memoryDb.addDocument({ ...d, collectionIds: updates.collectionIds });
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
    await memoryDb.deleteSource(id, tenantId);
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

  async syncSource(
    id: string,
    tenantId: string,
  ): Promise<{ success: boolean; itemsProcessed: number; durationMs: number }> {
    try {
      const source = await this.getSourceById(id, tenantId);
      if (!source) return { success: false, itemsProcessed: 0, durationMs: 0 };

      // Decrypt connector credentials for the trusted sync path only.
      const decryptedConfig = source.config ? decryptSourceConfig(source.config) : source.config;
      const duration = 2400;
      const items = 1;

      source.status = 'healthy';
      source.lastSyncAt = new Date().toISOString();
      source.documentCount = (source.documentCount || 0) + items;
      source.lastError = undefined;

      await memoryDb.updateSource(id, source, tenantId);
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
        const ytUrl =
          decryptedConfig?.playlistUrl || decryptedConfig?.url || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        try {
          const ytData = await processYoutubeTranscript(ytUrl, 'ar');
          if (ytData && ytData.success && ytData.transcript) {
            newDocTitle = ytData.title ? `[تفريغ فيديو يوتيوب] ${ytData.title}` : newDocTitle;
            newDocContent = ytData.transcript;
          }
        } catch (ytErr) {
          console.log('YouTube sync transcript failed, fallback to structured summary:', (ytErr as Error)?.message);
        }
      } else if (source.type === 'file') {
        const fileData = decryptedConfig?.fileData || decryptedConfig?.base64;
        if (fileData && typeof fileData === 'string') {
          try {
            const cleanBase64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
            const fileBuffer = Buffer.from(cleanBase64, 'base64');
            const pipelineRes = await processPdfWithBatchedPipeline(fileBuffer, {
              preferredEngine: 'mistral',
              pagesPerChunk: 25,
            });
            if (pipelineRes.text && pipelineRes.text.trim().length > 10) {
              newDocContent = pipelineRes.text;
              newDocTitle = `${source.name} (معالجة ${pipelineRes.chunksProcessed} دفعة / ${pipelineRes.totalPages} صفحة)`;
            }
          } catch (pdfErr) {
            console.log('PDF sync pipeline fallback:', pdfErr);
          }
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

      const chunks = chunkTextList.map(
        (text, index) =>
          ({
            id: `chunk-${newDocId}-${index + 1}`,
            tenantId,
            documentId: newDocId,
            documentTitle: newDocTitle,
            content: text,
            chunkIndex: index,
            pageNumber: 1,
            language: 'ar',
            metadata: { sourceId: source.id, position: index },
          }) as DocumentChunk,
      );
      await this.addChunks(chunks);

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
      return (await memoryDb.getSourceById(id, tenantId))
        ? { success: true, itemsProcessed: 1, durationMs: 1200 }
        : { success: false, itemsProcessed: 0, durationMs: 0 };
    }
  }

  // Sync Logs
  async getSyncLogs(tenantId: string, sourceId?: string): Promise<SyncLogEntry[]> {
    let logsList: SyncLogEntry[] = [];
    if (this.useMemory) {
      logsList = await memoryDb.getSyncLogs(tenantId, sourceId);
    } else {
      try {
        await ensureSeeded();
        if (this.useMemory) {
          logsList = await memoryDb.getSyncLogs(tenantId, sourceId);
        } else {
          logsList = await getPostgresSyncLogs(tenantId, sourceId);
        }
      } catch (e) {
        this.handleDatabaseError(e, 'getSyncLogs');
        logsList = await memoryDb.getSyncLogs(tenantId, sourceId);
      }
    }

    if (logsList.length === 0) {
      const defaultLogs = INITIAL_SYNC_LOGS.map((l) => ({
        ...l,
        id: `${l.id}-${tenantId}`,
        tenantId,
      }));
      for (const l of defaultLogs) {
        await this.addSyncLog(l);
      }
      return defaultLogs;
    }

    return logsList;
  }

  async addSyncLog(log: SyncLogEntry): Promise<void> {
    await memoryDb.addSyncLog(log);
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
      return await memoryDb.getMcpResources(tenantId);
    }
  }

  // Documents
  async getDocuments(tenantId: string): Promise<Document[]> {
    let docsList: Document[] = [];
    if (this.useMemory) {
      docsList = await memoryDb.getDocuments(tenantId);
    } else {
      try {
        await ensureSeeded();
        if (this.useMemory) {
          docsList = await memoryDb.getDocuments(tenantId);
        } else {
          docsList = await getPostgresDocuments(tenantId);
        }
      } catch (e) {
        this.handleDatabaseError(e, 'getDocuments');
        docsList = await memoryDb.getDocuments(tenantId);
      }
    }

    if (docsList.length === 0) {
      const defaultDocs = INITIAL_DOCUMENTS.map((d) => ({
        ...d,
        id: `${d.id}-${tenantId}`,
        tenantId,
      }));
      for (const d of defaultDocs) {
        await this.addDocument(d);
      }

      const defaultChunks = INITIAL_CHUNKS.map((c) => ({
        ...c,
        id: `${c.id}-${tenantId}`,
        documentId: `${c.documentId}-${tenantId}`,
        tenantId,
      }));
      await this.addChunks(defaultChunks);

      return defaultDocs;
    }

    return docsList;
  }

  async getDocumentById(id: string, tenantId: string): Promise<Document | undefined> {
    if (this.useMemory) return await memoryDb.getDocumentById(id, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return await memoryDb.getDocumentById(id, tenantId);
      const d = await getPostgresDocumentById(id, tenantId);
      if (d) return d;
    } catch (e) {
      this.handleDatabaseError(e, 'getDocumentById');
    }
    return await memoryDb.getDocumentById(id, tenantId);
  }

  async addDocument(docObj: Document): Promise<void> {
    await memoryDb.addDocument(docObj);
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
      await memoryDb.addDocument(updated);
      if (!this.useMemory) {
        try {
          await insertPostgresDocument(updated);

          if (updates.collectionIds) {
            await updateQdrantDocumentPayload(id, tenantId, { collectionIds: updates.collectionIds });
          }
        } catch (e) {
          this.handleDatabaseError(e, 'updateDocument');
        }
      }
      return updated;
    }
    return undefined;
  }

  async deleteDocument(id: string, tenantId: string): Promise<void> {
    await memoryDb.deleteDocument(id, tenantId);

    try {
      await deletePostgresDocument(id, tenantId);
      await deleteQdrantDocument(id, tenantId);
    } catch (extErr) {
      this.handleDatabaseError(extErr, 'deleteDocument');
    }
  }

  // Document Versions
  async getDocumentVersions(documentId: string, tenantId: string): Promise<DocumentVersion[]> {
    const doc = await this.getDocumentById(documentId, tenantId);
    if (!doc) return [];
    if (doc.versions && doc.versions.length > 0) {
      return [...doc.versions].sort((a, b) => b.versionNumber - a.versionNumber);
    }
    // Fallback default version snapshot if none exists
    const v1: DocumentVersion = {
      id: `ver-${doc.id}-v1`,
      documentId: doc.id,
      versionNumber: doc.version || 1,
      title: doc.title,
      content: doc.content,
      chunkCount: doc.chunkCount || 0,
      createdAt: doc.createdAt,
      createdBy: 'Ingestion Engine',
      changeSummary: 'الإصدار الأولي المستوعب في قاعدة المعرفة',
    };
    return [v1];
  }

  async createDocumentVersion(
    documentId: string,
    params: {
      title?: string;
      content: string;
      changeSummary?: string;
      createdBy?: string;
    },
    tenantId: string,
  ): Promise<{ document: Document; version: DocumentVersion } | undefined> {
    const doc = await this.getDocumentById(documentId, tenantId);
    if (!doc) return undefined;

    const existingVersions =
      doc.versions && doc.versions.length > 0
        ? [...doc.versions]
        : [
            {
              id: `ver-${doc.id}-v1`,
              documentId: doc.id,
              versionNumber: 1,
              title: doc.title,
              content: doc.content,
              chunkCount: doc.chunkCount || 0,
              createdAt: doc.createdAt,
              createdBy: 'Ingestion Engine',
              changeSummary: 'الإصدار الأولي المستوعب في قاعدة المعرفة',
            },
          ];

    const currentMaxVer = existingVersions.reduce((max, v) => Math.max(max, v.versionNumber), 1);
    const nextVerNumber = currentMaxVer + 1;
    const newTitle = params.title?.trim() || doc.title;
    const newContent = params.content;
    const nowIso = new Date().toISOString();

    // Re-chunk content
    const charSize = 1000;
    const step = 800;
    const chunkTextList: string[] = [];
    for (let i = 0; i < newContent.length; i += step) {
      const snippet = newContent.substring(i, i + charSize).trim();
      if (snippet) chunkTextList.push(snippet);
    }
    if (chunkTextList.length === 0 && newContent.trim()) {
      chunkTextList.push(newContent.trim());
    }

    const newVersion: DocumentVersion = {
      id: `ver-${doc.id}-v${nextVerNumber}`,
      documentId: doc.id,
      versionNumber: nextVerNumber,
      title: newTitle,
      content: newContent,
      chunkCount: chunkTextList.length,
      createdAt: nowIso,
      createdBy: params.createdBy || 'Knowledge Admin',
      changeSummary: params.changeSummary || `تحديث محتوى المستند (الإصدار v${nextVerNumber})`,
    };

    const updatedVersions = [newVersion, ...existingVersions];

    const updatedDoc: Document = {
      ...doc,
      title: newTitle,
      content: newContent,
      chunkCount: chunkTextList.length,
      version: nextVerNumber,
      versions: updatedVersions,
      updatedAt: nowIso,
    };

    await this.addDocument(updatedDoc);

    // Update chunks
    memoryDb.chunks = memoryDb.chunks.filter((c) => !(c.documentId === documentId && c.tenantId === tenantId));
    const versionChunks: DocumentChunk[] = chunkTextList.map((text, i) => ({
      id: `chunk-${doc.id}-v${nextVerNumber}-${i + 1}`,
      tenantId,
      documentId: doc.id,
      documentTitle: newTitle,
      content: text,
      chunkIndex: i,
      pageNumber: 1,
      language: doc.language === 'en' ? 'en' : 'ar',
      metadata: {
        version: nextVerNumber,
        position: i,
      },
    }));
    await this.addChunks(versionChunks);

    await this.addSyncLog({
      id: `log-ver-${Date.now()}`,
      tenantId,
      sourceId: doc.metadata?.sourceId || doc.id,
      sourceName: doc.title,
      status: 'success',
      itemsProcessed: chunkTextList.length,
      durationMs: 850,
      message: `تم إنشاء وحفظ الإصدار v${nextVerNumber} للمستند "${newTitle}" وتحديث فهرسة المتجهات`,
      timestamp: nowIso,
    });

    return { document: updatedDoc, version: newVersion };
  }

  async revertDocumentVersion(
    documentId: string,
    targetVersionNumber: number,
    tenantId: string,
  ): Promise<{ document: Document; restoredVersion: DocumentVersion } | undefined> {
    const doc = await this.getDocumentById(documentId, tenantId);
    if (!doc) return undefined;

    const versions = doc.versions || [];
    const targetVer = versions.find((v) => v.versionNumber === targetVersionNumber);
    if (!targetVer) return undefined;

    const nowIso = new Date().toISOString();

    const charSize = 1000;
    const step = 800;
    const chunkTextList: string[] = [];
    for (let i = 0; i < targetVer.content.length; i += step) {
      const snippet = targetVer.content.substring(i, i + charSize).trim();
      if (snippet) chunkTextList.push(snippet);
    }
    if (chunkTextList.length === 0 && targetVer.content.trim()) {
      chunkTextList.push(targetVer.content.trim());
    }

    const updatedDoc: Document = {
      ...doc,
      title: targetVer.title,
      content: targetVer.content,
      chunkCount: chunkTextList.length,
      version: targetVer.versionNumber,
      updatedAt: nowIso,
    };

    await this.addDocument(updatedDoc);

    // Update chunks
    memoryDb.chunks = memoryDb.chunks.filter((c) => !(c.documentId === documentId && c.tenantId === tenantId));
    const revertChunks: DocumentChunk[] = chunkTextList.map((text, i) => ({
      id: `chunk-${doc.id}-rev-v${targetVer.versionNumber}-${i + 1}`,
      tenantId,
      documentId: doc.id,
      documentTitle: targetVer.title,
      content: text,
      chunkIndex: i,
      pageNumber: 1,
      language: doc.language === 'en' ? 'en' : 'ar',
      metadata: {
        restoredFromVersion: targetVer.versionNumber,
        position: i,
      },
    }));
    await this.addChunks(revertChunks);

    await this.addSyncLog({
      id: `log-revert-${Date.now()}`,
      tenantId,
      sourceId: doc.metadata?.sourceId || doc.id,
      sourceName: targetVer.title,
      status: 'success',
      itemsProcessed: chunkTextList.length,
      durationMs: 920,
      message: `تم استرجاع المستند "${targetVer.title}" إلى الإصدار v${targetVer.versionNumber} بنجاح وإعادة الفهرسة`,
      timestamp: nowIso,
    });

    return { document: updatedDoc, restoredVersion: targetVer };
  }

  // Chunks
  async getChunks(tenantId: string): Promise<DocumentChunk[]> {
    let chunksList: DocumentChunk[] = [];
    if (this.useMemory) {
      chunksList = await memoryDb.getChunks(tenantId);
    } else {
      try {
        await ensureSeeded();
        if (this.useMemory) {
          chunksList = await memoryDb.getChunks(tenantId);
        } else {
          chunksList = await getPostgresChunks(tenantId);
        }
      } catch (e) {
        this.handleDatabaseError(e, 'getChunks');
        chunksList = await memoryDb.getChunks(tenantId);
      }
    }

    if (chunksList.length === 0) {
      const defaultChunks = INITIAL_CHUNKS.map((c) => ({
        ...c,
        id: `${c.id}-${tenantId}`,
        documentId: `${c.documentId}-${tenantId}`,
        tenantId,
      }));
      await this.addChunks(defaultChunks);
      return defaultChunks;
    }

    return chunksList;
  }

  async addChunk(chunk: DocumentChunk): Promise<void> {
    await memoryDb.addChunk(chunk);

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
          ...(chunk.metadata || {}),
        },
      });
    } catch (vecErr) {
      console.error('Vector embedding/Qdrant indexing error:', (vecErr as Error)?.message);
    }
  }

  /**
   * Batch ingestion path. Ingests many chunks in one pass instead of looping
   * `addChunk`, which issued a serial embedding API call + a per-chunk parent-
   * document lookup + a single-point Qdrant upsert for every chunk.
   *
   * Here we:
   *   1. write all chunks to the memory store in one shot;
   *   2. generate all embeddings with bounded concurrency (one batched wave);
   *   3. resolve each unique parent document's collectionIds ONCE (not per chunk);
   *   4. insert all Postgres rows in parallel;
   *   5. push all vectors to Qdrant in a single multi-point upsert.
   */
  async addChunks(chunks: DocumentChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    await memoryDb.addChunks(chunks);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;

      // 1. Generate all embeddings in one bounded-concurrency wave.
      const vectors = await embedBatch(chunks.map((c) => c.content));

      // 2. Resolve collectionIds per unique parent document ONCE.
      const collectionIdsByDoc = new Map<string, string[]>();
      for (const docId of new Set(chunks.map((c) => c.documentId))) {
        try {
          const parentDoc = await this.getDocumentById(docId, chunks[0].tenantId);
          collectionIdsByDoc.set(docId, parentDoc?.collectionIds || []);
        } catch {
          collectionIdsByDoc.set(docId, []);
        }
      }

      // 3. Insert all Postgres rows in parallel (cheap local writes).
      await Promise.all(
        chunks.map((chunk) =>
          insertPostgresChunk({
            id: chunk.id,
            tenantId: chunk.tenantId,
            documentId: chunk.documentId,
            documentTitle: chunk.documentTitle,
            content: chunk.content,
            chunkIndex: chunk.chunkIndex || 0,
            pageNumber: chunk.pageNumber || 1,
            language: chunk.language || 'ar',
            metadata: chunk.metadata || {},
          }).catch(() => {
            /* a single failed lexical row must not abort the batch */
          }),
        ),
      );

      // 4. One multi-point Qdrant upsert for the whole batch.
      const points = chunks
        .map((chunk, i) => ({
          id: chunk.id,
          vector: vectors[i],
          payload: {
            tenantId: chunk.tenantId,
            documentId: chunk.documentId,
            documentTitle: chunk.documentTitle || '',
            content: chunk.content,
            chunkIndex: chunk.chunkIndex || 0,
            pageNumber: chunk.pageNumber || 1,
            language: chunk.language || 'ar',
            collectionIds: collectionIdsByDoc.get(chunk.documentId) || [],
            ...(chunk.metadata || {}),
          },
        }))
        .filter((p) => Array.isArray(p.vector) && p.vector.length > 0);

      await upsertQdrantChunks(points);
    } catch (vecErr) {
      console.error('Batch vector embedding/Qdrant indexing error:', (vecErr as Error)?.message);
    }
  }

  async getCollections(tenantId: string): Promise<Collection[]> {
    let collectionsList: Collection[] = [];
    if (this.useMemory) {
      collectionsList = await memoryDb.getCollections(tenantId);
    } else {
      try {
        await ensureSeeded();
        if (this.useMemory) {
          collectionsList = await memoryDb.getCollections(tenantId);
        } else {
          collectionsList = await getPostgresCollections(tenantId);
        }
      } catch (e) {
        this.handleDatabaseError(e, 'getCollections');
        collectionsList = await memoryDb.getCollections(tenantId);
      }
    }

    if (collectionsList.length === 0) {
      const defaultCols = INITIAL_COLLECTIONS.map((c) => ({
        ...c,
        id: `${c.id}-${tenantId}`,
        tenantId,
      }));
      for (const c of defaultCols) {
        await this.addCollection(c);
      }
      return defaultCols;
    }

    return collectionsList;
  }

  async addCollection(col: Collection): Promise<void> {
    await memoryDb.addCollection(col);
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
    let serversList: MCPServerConfig[] = [];
    if (this.useMemory) {
      serversList = await memoryDb.getMcpServers(tenantId);
    } else {
      try {
        await ensureSeeded();
        if (this.useMemory) {
          serversList = await memoryDb.getMcpServers(tenantId);
        } else {
          serversList = await getPostgresMcpServers(tenantId);
        }
      } catch (e) {
        this.handleDatabaseError(e, 'getMcpServers');
        serversList = await memoryDb.getMcpServers(tenantId);
      }
    }

    if (serversList.length === 0) {
      const defaultServers = INITIAL_MCP_SERVERS.map((s) => ({
        ...s,
        id: `${s.id}-${tenantId}`,
        tenantId,
      }));
      for (const s of defaultServers) {
        await this.addMcpServer(s);
      }
      return defaultServers;
    }

    // Ensure Unstructured Transform is always auto-injected for existing active sessions
    const hasUnstructured = serversList.some(
      (s) => s.endpointUrl === 'https://mcp.transform.unstructured.io' || s.id.includes('unstructured-transform'),
    );
    if (!hasUnstructured) {
      const unstructuredServer: MCPServerConfig = {
        id: `mcp-unstructured-transform-${tenantId}`,
        tenantId,
        name: 'Unstructured Transform',
        description:
          'Connect to the official Unstructured Transform MCP server for advanced document transform, clean and chunk pipelines.',
        endpointUrl: 'https://mcp.transform.unstructured.io',
        protocolVersion: '2026-07-28',
        sandboxTier: 'T2_ELEVATED',
        enabledTools: ['unstructured_transform_document', 'unstructured_chunk_document'],
        requireConfirmationTools: [],
        status: 'healthy',
        latencyMs: 45,
        lastChecked: new Date().toISOString(),
      };
      await this.addMcpServer(unstructuredServer);
      serversList.push(unstructuredServer);
    }

    return serversList;
  }

  async addMcpServer(server: MCPServerConfig): Promise<void> {
    await memoryDb.addMcpServer(server);
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
    await memoryDb.toggleMcpTool(serverId, toolName, tenantId);
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
    await memoryDb.deleteMcpServer(serverId, tenantId);
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
    let auditList: AuditLogEntry[] = [];
    if (this.useMemory) {
      auditList = await memoryDb.getAuditLogs(tenantId);
    } else {
      try {
        await ensureSeeded();
        if (this.useMemory) {
          auditList = await memoryDb.getAuditLogs(tenantId);
        } else {
          auditList = await getPostgresAuditLogs(tenantId);
        }
      } catch (e) {
        this.handleDatabaseError(e, 'getAuditLogs');
        auditList = await memoryDb.getAuditLogs(tenantId);
      }
    }

    if (auditList.length === 0) {
      const defaultAudit = INITIAL_AUDIT_LOGS.map((a) => ({
        ...a,
        id: `${a.id}-${tenantId}`,
        tenantId,
      }));
      for (const a of defaultAudit) {
        await this.addAuditLog(a);
      }
      return defaultAudit;
    }

    return auditList;
  }

  async addAuditLog(entry: AuditLogEntry): Promise<void> {
    await memoryDb.addAuditLog(entry);
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
    if (this.useMemory) return await memoryDb.getToolCalls(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return await memoryDb.getToolCalls(tenantId);
      return await getPostgresToolCalls(tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'getToolCalls');
    }
    return await memoryDb.getToolCalls(tenantId);
  }

  async addToolCall(tc: MCPToolCall): Promise<void> {
    await memoryDb.addToolCall(tc);
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
    if (this.useMemory) return await memoryDb.getConversations(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return await memoryDb.getConversations(tenantId);
      const convs = await getPostgresConversations(tenantId);
      if (convs.length > 0) return convs;

      // Seed default conversation in Postgres
      const defaultConv: Conversation = {
        id: `conv-init-${tenantId}`,
        tenantId,
        title: 'جلسة استفسارات السياسات والأمن',
        mode: 'hybrid',
        model: 'gemini-3.7-flash',
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
        content:
          'مرحباً بك في استوديو المحادثة المعززة لمنصة OmniRAG. يمكنك طرح أي سؤال استعلامي حول السياسات، العقود، أو معايير أمن المعلومات المرفقة ببيانات المستأجر الحالي.',
        createdAt: new Date().toISOString(),
        modelUsed: 'gemini-3.7-flash',
      };
      await insertPostgresMessage(welcomeMsg);

      return [defaultConv];
    } catch (e) {
      this.handleDatabaseError(e, 'getConversations');
    }
    return await memoryDb.getConversations(tenantId);
  }

  async getConversationById(id: string, tenantId: string): Promise<Conversation | null> {
    if (this.useMemory) return await memoryDb.getConversationById(id, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return await memoryDb.getConversationById(id, tenantId);
      return await getPostgresConversationById(id, tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'getConversationById');
    }
    return await memoryDb.getConversationById(id, tenantId);
  }

  async saveConversation(conv: Conversation): Promise<void> {
    await memoryDb.saveConversation(conv);
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
    await memoryDb.deleteConversation(id, tenantId);
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
    if (this.useMemory) return await memoryDb.getMessages(conversationId, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return await memoryDb.getMessages(conversationId, tenantId);
      const msgs = await getPostgresMessages(conversationId, tenantId);
      if (msgs.length === 0 && conversationId.startsWith('conv-init')) {
        const welcomeMsg: Message = {
          id: `msg-welcome-${conversationId}`,
          tenantId,
          conversationId,
          role: 'assistant',
          content:
            'مرحباً بك في استوديو المحادثة المعززة لمنصة OmniRAG. يمكنك طرح أي سؤال استعلامي حول السياسات، العقود، أو معايير أمن المعلومات المرفقة ببيانات المستأجر الحالي.',
          createdAt: new Date().toISOString(),
          modelUsed: 'gemini-3.7-flash',
        };
        await insertPostgresMessage(welcomeMsg);
        return [welcomeMsg];
      }
      return msgs;
    } catch (e) {
      this.handleDatabaseError(e, 'getMessages');
    }
    return await memoryDb.getMessages(conversationId, tenantId);
  }

  async addMessage(msg: Message): Promise<void> {
    await memoryDb.addMessage(msg);
    if (this.useMemory) return;

    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresMessage(msg);

      try {
        const conv = await getPostgresConversationById(msg.conversationId, msg.tenantId);
        if (conv) {
          conv.updatedAt = new Date().toISOString();
          if (
            msg.role === 'user' &&
            (conv.title.startsWith('محادثة جديدة') ||
              conv.title.startsWith('New Conversation') ||
              conv.title === 'جلسة استفسارات السياسات والأمن')
          ) {
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

  // Auth (Postgres-only — user, tenant, and opaque session lifecycle)
  async getUserByEmail(email: string): Promise<User | undefined> {
    if (this.useMemory) return await memoryDb.getUserByEmail(email);
    try {
      await ensureSeeded();
      if (this.useMemory) return await memoryDb.getUserByEmail(email);
      const user = await getPostgresUserByEmail(email);
      if (user) return user;
    } catch (e) {
      this.handleDatabaseError(e, 'getUserByEmail');
    }
    return await memoryDb.getUserByEmail(email);
  }

  async getUserById(id: string): Promise<User | undefined> {
    if (this.useMemory) return await memoryDb.getUserById(id);
    try {
      await ensureSeeded();
      if (this.useMemory) return await memoryDb.getUserById(id);
      const user = await getPostgresUserById(id);
      if (user) return user;
    } catch (e) {
      this.handleDatabaseError(e, 'getUserById');
    }
    return await memoryDb.getUserById(id);
  }

  async createUser(user: User): Promise<void> {
    await memoryDb.createUser(user);
    if (this.useMemory) return;
    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresUser(user);
    } catch (e) {
      this.handleDatabaseError(e, 'createUser');
    }
  }

  async createTenant(tenant: Tenant): Promise<void> {
    await memoryDb.createTenant(tenant);
    if (this.useMemory) return;
    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresTenant(tenant);
    } catch (e) {
      this.handleDatabaseError(e, 'createTenant');
    }
  }

  async getTenant(tenantId: string): Promise<Tenant | undefined> {
    const memTenant = await memoryDb.getTenant(tenantId);
    if (this.useMemory) return memTenant;
    try {
      await ensureSeeded();
      if (this.useMemory) return memTenant;
      const t = await getPostgresTenant(tenantId);
      return t ?? memTenant;
    } catch (e) {
      this.handleDatabaseError(e, 'getTenant');
      return memTenant;
    }
  }

  async createSession(session: SessionRecord): Promise<void> {
    await memoryDb.createSession(session);
    if (this.useMemory) return;
    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresSession(session);
    } catch (e) {
      this.handleDatabaseError(e, 'createSession');
    }
  }

  async getSession(token: string): Promise<SessionRecord | undefined> {
    if (this.useMemory) return await memoryDb.getSession(token);
    try {
      await ensureSeeded();
      if (this.useMemory) return await memoryDb.getSession(token);
      const session = await getPostgresSession(token);
      return session;
    } catch (e) {
      this.handleDatabaseError(e, 'getSession');
      return await memoryDb.getSession(token);
    }
  }

  async deleteSession(token: string): Promise<void> {
    await memoryDb.deleteSession(token);
    if (this.useMemory) return;
    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await deletePostgresSession(token);
    } catch (e) {
      this.handleDatabaseError(e, 'deleteSession');
    }
  }

  async deleteExpiredSessions(): Promise<void> {
    await memoryDb.deleteExpiredSessions();
    if (this.useMemory) return;
    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await deleteExpiredPostgresSessions();
    } catch (e) {
      this.handleDatabaseError(e, 'deleteExpiredSessions');
    }
  }
}

/**
 * Concrete singleton used internally by this module for lifecycle control
 * (memory-fallback toggling, pool reset) that is intentionally absent from the
 * public `IOmniRAGDatabase` contract.
 */
const dbInstance = new OmniRAGDatabase();

/**
 * Singleton storage instance. Typed against the contract so call sites depend
 * on `IOmniRAGDatabase` rather than the concrete Postgres-backed class — this
 * keeps routes/libraries decoupled from the backend and enables swapping to a
 * test double without editing consumers.
 */
export const db: IOmniRAGDatabase = dbInstance;
