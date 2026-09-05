import {
  Tenant,
  User,
  SessionRecord,
  ApiKeyRecord,
  ProviderCredentialRecord,
  WebhookEndpoint,
  Document,
  DocumentVersion,
  DocumentChunk,
  DocumentSummary,
  ChunkIndexResult,
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
import { randomUUID } from 'crypto';
import { chunkDocumentWithPages, estimateTokenCount } from '../rag/chunker';
import { createLogger } from '@/lib/logging/logger';

const log = createLogger('OmniRAGStorage');
import { DEFAULT_AI_MODELS, getAiModel } from '../config/aiModels';
import {
  ensurePostgresTables,
  getPostgresDocuments,
  getPostgresDocumentSummaries,
  getPostgresDocumentById,
  insertPostgresDocument,
  deletePostgresDocument,
  getPostgresChunks,
  getPostgresChunksByDocument,
  insertPostgresChunk,
  deletePostgresChunksByDocument,
  getPostgresSources,
  getPostgresSourceById,
  getPostgresScheduledSources,
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
  findPostgresTenantIdBySsoDomain,
  getPostgresSession,
  insertPostgresSession,
  deletePostgresSession,
  deletePostgresSessionsForTenantUser,
  deleteExpiredPostgresSessions,
  insertPostgresApiKey,
  getPostgresApiKeys,
  getPostgresApiKeyByHash,
  revokePostgresApiKey,
  touchPostgresApiKeyLastUsed,
  upsertPostgresProviderCredentials,
  getPostgresProviderCredentials,
  getPostgresProviderCredentialsList,
  deletePostgresProviderCredentials,
  updatePostgresTenantPlan,
  insertPostgresWebhookEndpoint,
  getPostgresWebhookEndpoints,
  getPostgresWebhookEndpointById,
  updatePostgresWebhookEndpoint,
  deletePostgresWebhookEndpoint,
  updatePostgresTenantSettings,
} from './postgres';
import { getVectorStoreForTenant } from './vectors/registry';
import { generateEmbedding, embedBatch } from '../rag/embedding';
import { processYoutubeTranscript } from '../youtube/transcriptParser';
import { processPdfWithBatchedPipeline } from '../pdf/pdfChunker';
import { extractConnectorContent, supportsLiveSync } from '../connectors/liveConnectors';
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
import { buildSkillsServer } from '../mcp/registry/skillTools';

// Lazy-seeding state
let isSeeded = false;

/**
 * Demo-content gate. INITIAL_* fixtures are marketing/demo documents, chunks,
 * sources and sync logs. Previously the wrapper seeded them for ANY tenant
 * whose store came back empty — including production tenants — so a fresh
 * production tenant could "search" demo documents they never uploaded.
 * Seeding now happens in development only; production tenants start empty
 * like a real multi-tenant system should.
 */
function shouldSeedDemoData(): boolean {
  return process.env.NODE_ENV !== 'production';
}

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
  // Platform state (API keys + provider credentials)
  apiKeys: ApiKeyRecord[] = [];
  providerCredentials: ProviderCredentialRecord[] = [];
  // Outbound webhooks (Phase 6)
  webhookEndpoints: WebhookEndpoint[] = [];

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
    this.apiKeys = [];
    this.providerCredentials = [];
    this.webhookEndpoints = [];
  }

  async getSources(tenantId: string): Promise<SourceConnector[]> {
    return this.sources
      .filter((s) => s.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getScheduledSources(): Promise<Array<{ id: string; tenantId: string; syncSchedule: string }>> {
    return this.sources
      .filter((s) => s.syncSchedule && s.syncSchedule !== 'manual')
      .map((s) => ({ id: s.id, tenantId: s.tenantId, syncSchedule: s.syncSchedule }));
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
    // The in-memory store has no live extraction pipeline. Reporting
    // success here was a lie — callers now surface an honest failure.
    return { success: false, itemsProcessed: 0, durationMs: 0 };
  }

  async getSyncLogs(tenantId: string, sourceId?: string, limit = 100): Promise<SyncLogEntry[]> {
    let logs = this.syncLogs.filter((l) => l.tenantId === tenantId);
    if (sourceId) {
      logs = logs.filter((l) => l.sourceId === sourceId);
    }
    return logs
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, Math.min(Math.max(limit, 1), 500));
  }

  /**
   * Memory twin of the list-shaped read (v0.12.11, audit item 7): no content,
   * no versions — only length + 400-char preview, paginated.
   */
  async getDocumentSummaries(
    tenantId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<{ documents: DocumentSummary[]; total: number }> {
    // Delegates seeding behavior to getDocuments so dev demo data appears.
    await this.getDocuments(tenantId);
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    const offset = Math.max(opts?.offset ?? 0, 0);
    const all = this.documents
      .filter((d) => d.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const documents: DocumentSummary[] = all.slice(offset, offset + limit).map((d) => {
      const meta = { ...d.metadata };
      delete meta.versions;
      const summary: DocumentSummary = {
        ...d,
        metadata: meta,
        content: '',
        contentChars: d.content.length,
        contentPreview: d.content.slice(0, 400),
      };
      delete summary.versions;
      return summary;
    });
    return { documents, total: all.length };
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

  async getChunksByDocument(
    tenantId: string,
    documentId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ chunks: DocumentChunk[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const all = this.chunks.filter((c) => c.tenantId === tenantId && c.documentId === documentId);
    return { chunks: all.slice(offset, offset + limit), total: all.length };
  }

  async addChunk(chunk: DocumentChunk): Promise<void> {
    this.chunks = this.chunks.filter((c) => c.id !== chunk.id);
    this.chunks.push(chunk);
  }

  async addChunks(chunks: DocumentChunk[]): Promise<ChunkIndexResult> {
    if (chunks.length === 0) {
      return { indexed: 0, failed: 0, total: 0, errors: [], success: true };
    }
    const ids = new Set(chunks.map((c) => c.id));
    this.chunks = this.chunks.filter((c) => !ids.has(c.id));
    this.chunks.push(...chunks);
    // In-memory store: every chunk is immediately searchable via the local
    // fallback engine, so the batch is fully indexed by definition.
    return { indexed: chunks.length, failed: 0, total: chunks.length, errors: [], success: true };
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

  async reindexDocument(
    documentId: string,
    tenantId: string,
  ): Promise<{ document: Document; result: ChunkIndexResult } | undefined> {
    const doc = await this.getDocumentById(documentId, tenantId);
    if (!doc || !doc.content) return undefined;

    const pageChunks = chunkDocumentWithPages(doc.content, doc.metadata?.chunkingConfig);
    this.chunks = this.chunks.filter((c) => !(c.documentId === documentId && c.tenantId === tenantId));
    const chunks: DocumentChunk[] = pageChunks.map((pageChunk, i) => ({
      id: `chunk-${doc.id}-re-${i + 1}`,
      tenantId,
      documentId: doc.id,
      documentTitle: doc.title,
      content: pageChunk.text,
      chunkIndex: i,
      pageNumber: pageChunk.pageNumber ?? 1,
      language: doc.language === 'en' ? 'en' : 'ar',
      metadata: { position: i, tokenCount: estimateTokenCount(pageChunk.text) },
    }));
    const result = await this.addChunks(chunks);

    doc.status = result.success ? 'indexed' : 'failed';
    doc.chunkCount = pageChunks.length;
    doc.updatedAt = new Date().toISOString();
    return { document: doc, result };
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
        model: DEFAULT_AI_MODELS.chatModel,
        collectionIds: [],
        enabledMcpServers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.conversations.push(defaultConv);
      await this.getMessages(defaultConv.id, tenantId);
      return [defaultConv];
    }
    // Attach a preview of each conversation's first user request so the
    // sidebar can show it on hover without extra round-trips.
    return convs
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((c) => {
        const firstUser = this.messages
          .filter((m) => m.conversationId === c.id && m.tenantId === tenantId && m.role === 'user')
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
        return { ...c, firstUserMessage: firstUser?.content };
      });
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
        modelUsed: DEFAULT_AI_MODELS.chatModel,
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

  async findTenantIdBySsoEmailDomain(domain: string): Promise<string | undefined> {
    const normalized = domain.trim().toLowerCase();
    const match = this.tenants.find((t) => {
      const sso = (t.settings as any)?.ssoOidc;
      return sso?.enabled === true && String(sso?.emailDomain || '').toLowerCase() === normalized;
    });
    return match?.id;
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

  async deleteTenantSessionsForUser(tenantId: string, userId: string): Promise<void> {
    this.sessions = this.sessions.filter((s) => !(s.tenantId === tenantId && s.userId === userId));
  }

  async deleteExpiredSessions(): Promise<void> {
    const now = Date.now();
    this.sessions = this.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  }

  // API keys (headless/external access — Bearer auth)
  async createApiKey(key: ApiKeyRecord): Promise<void> {
    this.apiKeys = this.apiKeys.filter((k) => k.id !== key.id);
    this.apiKeys.push(key);
  }

  async listApiKeys(tenantId: string): Promise<ApiKeyRecord[]> {
    return this.apiKeys
      .filter((k) => k.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | undefined> {
    return this.apiKeys.find((k) => k.keyHash === keyHash);
  }

  async revokeApiKey(id: string, tenantId: string): Promise<void> {
    const key = this.apiKeys.find((k) => k.id === id && k.tenantId === tenantId);
    if (key) key.revokedAt = new Date().toISOString();
  }

  async touchApiKeyLastUsed(id: string, timestamp: string): Promise<void> {
    const key = this.apiKeys.find((k) => k.id === id);
    if (key) key.lastUsedAt = timestamp;
  }

  // AI provider credentials (per-tenant, encrypted at rest)
  async upsertProviderCredentials(record: ProviderCredentialRecord): Promise<void> {
    this.providerCredentials = this.providerCredentials.filter(
      (c) => !(c.tenantId === record.tenantId && c.providerId === record.providerId),
    );
    this.providerCredentials.push(record);
  }

  async getProviderCredentials(tenantId: string, providerId: string): Promise<ProviderCredentialRecord | undefined> {
    return this.providerCredentials.find((c) => c.tenantId === tenantId && c.providerId === providerId);
  }

  async listProviderCredentials(tenantId: string): Promise<ProviderCredentialRecord[]> {
    return this.providerCredentials.filter((c) => c.tenantId === tenantId);
  }

  async deleteProviderCredentials(tenantId: string, providerId: string): Promise<void> {
    this.providerCredentials = this.providerCredentials.filter(
      (c) => !(c.tenantId === tenantId && c.providerId === providerId),
    );
  }

  // Webhook endpoints (Phase 6 — outbound event notifications)
  async createWebhookEndpoint(endpoint: WebhookEndpoint): Promise<void> {
    this.webhookEndpoints = this.webhookEndpoints.filter((w) => w.id !== endpoint.id);
    this.webhookEndpoints.push(endpoint);
  }

  async listWebhookEndpoints(tenantId: string): Promise<WebhookEndpoint[]> {
    return this.webhookEndpoints
      .filter((w) => w.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getWebhookEndpointById(id: string, tenantId: string): Promise<WebhookEndpoint | undefined> {
    return this.webhookEndpoints.find((w) => w.id === id && w.tenantId === tenantId);
  }

  async updateWebhookEndpoint(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<
        WebhookEndpoint,
        'name' | 'url' | 'secretEncrypted' | 'events' | 'enabled' | 'lastDeliveryAt' | 'lastDeliveryStatus'
      >
    >,
  ): Promise<void> {
    const endpoint = this.webhookEndpoints.find((w) => w.id === id && w.tenantId === tenantId);
    if (!endpoint) return;
    Object.assign(endpoint, patch, { updatedAt: new Date().toISOString() });
  }

  async deleteWebhookEndpoint(id: string, tenantId: string): Promise<void> {
    this.webhookEndpoints = this.webhookEndpoints.filter((w) => !(w.id === id && w.tenantId === tenantId));
  }

  // Tenant settings (server-side config of record)
  async updateTenantSettings(tenantId: string, settings: Partial<Tenant['settings']>): Promise<Tenant | undefined> {
    const tenant = this.tenants.find((t) => t.id === tenantId);
    if (!tenant) return undefined;
    tenant.settings = { ...tenant.settings, ...settings };
    return tenant;
  }

  // Subscription plan (Phase 7)
  async updateTenantPlan(tenantId: string, plan: Tenant['plan']): Promise<Tenant | undefined> {
    const tenant = this.tenants.find((t) => t.id === tenantId);
    if (!tenant) return undefined;
    tenant.plan = plan;
    return tenant;
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
      // Init budget: the migration runner pipelines its DDL (one round-trip),
      // but a cold Neon compute wake + pooler handshake can still take several
      // seconds. 20s keeps the first request on a cold serverless instance
      // well inside Vercel's function timeout while almost never demoting a
      // configured-but-slow database to the in-memory fallback (which loses
      // sessions → 401s for the whole instance lifetime).
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('PostgreSQL connection timeout')), 20000);
      });

      const dbPromise = ensurePostgresTables().catch((err) => {
        if (!isSeeded) throw err; // if race is still ongoing, pass error to Promise.race
        log.error('Background ensurePostgresTables late error caught to prevent unhandled rejection:', err);
      });

      await Promise.race([dbPromise, timeoutPromise]);
      isSeeded = true;
    } catch (error) {
      log.info('PostgreSQL database initialization offline fallback triggered:', (error as Error)?.message);
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

  /**
   * Postgres circuit-breaker state.
   *
   * The previous implementation flipped `useMemory = true` on the FIRST
   * Postgres error and never recovered — one transient blip (network hiccup,
   * pool exhaustion, brief restart) silently demoted the whole process to
   * in-memory storage for its entire lifetime, losing durability without any
   * operator notice.
   *
   * Now we only open the circuit after PG_ERROR_THRESHOLD errors within a
   * sliding PG_ERROR_WINDOW_MS window, and we automatically half-open it after
   * PG_FALLBACK_COOLDOWN_MS so the next operation retries Postgres. If Postgres
   * is truly down the errors re-open the circuit; if it recovered, the counter
   * ages out and we silently resume durable writes.
   */
  private static readonly PG_ERROR_THRESHOLD = 3;
  private static readonly PG_ERROR_WINDOW_MS = 60_000;
  private static readonly PG_FALLBACK_COOLDOWN_MS = 30_000;
  private pgErrorTimestamps: number[] = [];
  private pgRetryTimer: NodeJS.Timeout | null = null;

  enableMemoryFallback() {
    this.useMemory = true;
    this.schedulePostgresRetry('manual enableMemoryFallback');
  }

  disableMemoryFallback() {
    this.useMemory = false;
    this.pgErrorTimestamps = [];
    if (this.pgRetryTimer) {
      clearTimeout(this.pgRetryTimer);
      this.pgRetryTimer = null;
    }
  }

  isMemoryEnabled(): boolean {
    return this.useMemory;
  }

  resetDatabaseState() {
    this.useMemory = false;
    this.pgErrorTimestamps = [];
    if (this.pgRetryTimer) {
      clearTimeout(this.pgRetryTimer);
      this.pgRetryTimer = null;
    }
    resetPostgresPool();
    isSeeded = false;
    seedingPromise = null;
  }

  /**
   * Schedule an automatic retry of the Postgres connection after the cooldown.
   * When it fires we close the circuit (useMemory = false) and clear the seed
   * flag so the next operation re-runs table provisioning against a hopefully
   * recovered database. `unref()` keeps the timer from holding the process
   * open during shutdown.
   */
  private schedulePostgresRetry(reason: string) {
    if (this.pgRetryTimer) return; // one pending retry is enough
    this.pgRetryTimer = setTimeout(() => {
      this.pgRetryTimer = null;
      this.useMemory = false;
      this.pgErrorTimestamps = [];
      isSeeded = false;
      seedingPromise = null;
      log.info('[OmniRAG Storage] Postgres circuit breaker HALF-OPEN: retrying durable storage on next operation.');
    }, OmniRAGDatabase.PG_FALLBACK_COOLDOWN_MS);
    this.pgRetryTimer.unref?.();
    log.info(
      `[OmniRAG Storage] Will retry Postgres in ${OmniRAGDatabase.PG_FALLBACK_COOLDOWN_MS / 1000}s (${reason}).`,
    );
  }

  private handleDatabaseError(error: any, actionName: string) {
    const now = Date.now();
    // Keep only errors inside the sliding window so sporadic failures spread
    // over hours never accumulate into a false circuit break.
    this.pgErrorTimestamps = this.pgErrorTimestamps.filter((t) => now - t < OmniRAGDatabase.PG_ERROR_WINDOW_MS);
    this.pgErrorTimestamps.push(now);

    const errMsg = (error as Error)?.message || String(error);

    if (this.useMemory) return; // circuit already open

    if (this.pgErrorTimestamps.length >= OmniRAGDatabase.PG_ERROR_THRESHOLD) {
      this.useMemory = true;
      log.error(
        `[OmniRAG Storage] Postgres circuit breaker OPEN after ${this.pgErrorTimestamps.length} errors within ${
          OmniRAGDatabase.PG_ERROR_WINDOW_MS / 1000
        }s (last in ${actionName}): ${errMsg}. Falling back to in-memory storage temporarily.`,
      );
      this.schedulePostgresRetry(`circuit break in ${actionName}`);
    } else {
      // Transient error: this single call still falls back to memory (the
      // caller handles that), but the NEXT operation retries Postgres.
      log.warn(
        `[OmniRAG Storage] Transient Postgres error in ${actionName} (${this.pgErrorTimestamps.length}/${OmniRAGDatabase.PG_ERROR_THRESHOLD} in window): ${errMsg}`,
      );
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

    if (shouldSeedDemoData() && sourcesList.length === 0) {
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

  /**
   * Cross-tenant list of connectors with a real cron schedule (not 'manual').
   * Feeds the pg-boss scheduler reconciliation; returns scheduling fields only.
   */
  async getScheduledSources(): Promise<Array<{ id: string; tenantId: string; syncSchedule: string }>> {
    if (this.useMemory) return await memoryDb.getScheduledSources();
    try {
      await ensureSeeded();
      if (this.useMemory) return await memoryDb.getScheduledSources();
      return await getPostgresScheduledSources();
    } catch (e) {
      this.handleDatabaseError(e, 'getScheduledSources');
      return await memoryDb.getScheduledSources();
    }
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
    // Measure the REAL sync duration end-to-end. The previous implementation
    // reported a hardcoded 2400ms regardless of what actually happened.
    const startedAt = Date.now();
    try {
      const source = await this.getSourceById(id, tenantId);
      if (!source) return { success: false, itemsProcessed: 0, durationMs: Date.now() - startedAt };

      // Decrypt connector credentials for the trusted sync path only.
      const decryptedConfig = source.config ? decryptSourceConfig(source.config) : source.config;

      source.status = 'syncing';
      await memoryDb.updateSource(id, source, tenantId);
      if (!this.useMemory) {
        try {
          await insertPostgresSource(source);
        } catch (e) {
          this.handleDatabaseError(e, 'syncSource-setStatus');
        }
      }

      /**
       * Persist a FAILED sync attempt with a truthful message. Only YouTube
       * and file connectors have live extraction pipelines today; every other
       * advertised type previously indexed a synthetic Arabic placeholder that
       * CLAIMED records were fetched and logged success — fabricated content
       * polluting retrieval. They now fail honestly without ingesting anything.
       */
      const failSync = async (message: string): Promise<{ success: false; itemsProcessed: 0; durationMs: number }> => {
        const durationMs = Date.now() - startedAt;
        source.status = 'degraded';
        source.lastError = message;
        await memoryDb.updateSource(id, source, tenantId);
        if (!this.useMemory) {
          try {
            await insertPostgresSource(source);
          } catch (e) {
            this.handleDatabaseError(e, 'syncSource-failStatus');
          }
        }
        await this.addSyncLog({
          id: `log-${randomUUID()}`,
          tenantId,
          sourceId: source.id,
          sourceName: source.name,
          status: 'failed',
          itemsProcessed: 0,
          durationMs,
          message,
          timestamp: new Date().toISOString(),
        });
        return { success: false, itemsProcessed: 0, durationMs };
      };

      // Extract REAL content for the connector types with live pipelines.
      let extractedContent = '';
      let extractedTitle: string | null = null;
      let itemsProcessed = 1;

      if (source.type === 'youtube') {
        // channelOrVideoUrl = legacy wizard key (pre-registry catalog).
        const ytUrl = decryptedConfig?.playlistUrl || decryptedConfig?.url || decryptedConfig?.channelOrVideoUrl;
        if (!ytUrl || typeof ytUrl !== 'string' || !ytUrl.trim()) {
          return await failSync('لا يوجد رابط فيديو مهيأ في إعدادات موصل اليوتيوب.');
        }
        // processYoutubeTranscript THROWS when no real captions/transcription
        // are available — that failure propagates instead of indexing an
        // AI-invented transcript as ground truth.
        const ytData = await processYoutubeTranscript(ytUrl.trim(), 'ar');
        if (!ytData?.success || !ytData.transcript) {
          return await failSync('تعذر الحصول على تفريغ نصي حقيقي للفيديو.');
        }
        extractedContent = ytData.transcript;
        if (ytData.title) extractedTitle = `[تفريغ فيديو يوتيوب] ${ytData.title}`;
      } else if (source.type === 'file') {
        const fileData = decryptedConfig?.fileData || decryptedConfig?.base64;
        if (!fileData || typeof fileData !== 'string') {
          return await failSync('لا توجد بيانات ملف مخزنة في إعدادات هذا الموصل.');
        }
        try {
          const cleanBase64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
          const fileBuffer = Buffer.from(cleanBase64, 'base64');
          const pipelineRes = await processPdfWithBatchedPipeline(fileBuffer, {
            preferredEngine: 'mistral',
            pagesPerChunk: 25,
          });
          if (pipelineRes.text && pipelineRes.text.trim().length > 10) {
            extractedContent = pipelineRes.text;
          }
        } catch (pdfErr: any) {
          log.warn('[syncSource] PDF pipeline failed:', pdfErr?.message);
        }
        if (!extractedContent) {
          return await failSync('فشل استخراج النصوص من الملف المرتبط بهذا الموصل.');
        }
      } else if (supportsLiveSync(source.type)) {
        // Live HTTP-backed connectors (url / rss / github): extraction runs
        // through the SSRF-guarded shared module. Failures propagate as
        // honest sync failures — never as fabricated placeholder documents.
        try {
          const extraction = await extractConnectorContent(source.type, decryptedConfig || {});
          if (!extraction || !extraction.content.trim()) {
            return await failSync('لم يُنتج موصل الاستخلاص أي محتوى نصي قابل للفهرسة.');
          }
          extractedContent = extraction.content;
          extractedTitle = extraction.title || null;
          itemsProcessed = extraction.itemsProcessed || 1;
        } catch (extractErr: any) {
          return await failSync(extractErr?.message || 'فشل استخلاص المحتوى من المصدر الحي.');
        }
      } else {
        return await failSync(
          `المزامنة الآلية غير متاحة لموصلات نوع "${source.type}" بعد — استخدم الاستيعاب اليدوي من استوديو الرفع.`,
        );
      }

      const newDocId = `doc-sync-${randomUUID()}`;
      const newDocTitle = extractedTitle || `${source.name} - تحديث ${new Date().toLocaleDateString('ar-EG')}`;

      const newDoc: Document = {
        id: newDocId,
        tenantId,
        title: newDocTitle,
        content: extractedContent,
        sourceType: source.type === 'file' || source.type === 'web_file' ? 'file' : 'integration',
        language: 'ar',
        status: 'processing',
        chunkCount: 0,
        createdAt: new Date().toISOString(),
        metadata: { sourceId: source.id, connectorType: source.type },
        collectionIds: source.collectionIds,
      };

      // Unified page-aware chunker: chunks carry REAL page numbers from the
      // extraction markers so citations cite actual pages.
      const pageChunks = chunkDocumentWithPages(extractedContent);

      newDoc.chunkCount = pageChunks.length;
      await this.addDocument(newDoc);

      const chunks = pageChunks.map(
        (pageChunk, index) =>
          ({
            id: `chunk-${newDocId}-${index + 1}`,
            tenantId,
            documentId: newDocId,
            documentTitle: newDocTitle,
            content: pageChunk.text,
            chunkIndex: index,
            pageNumber: pageChunk.pageNumber ?? 1,
            language: 'ar',
            metadata: {
              sourceId: source.id,
              position: index,
              tokenCount: estimateTokenCount(pageChunk.text),
              ...(pageChunk.pageNumber != null ? { extractedPage: true } : {}),
            },
          }) as DocumentChunk,
      );
      const indexResult = await this.addChunks(chunks);

      // Document status lifecycle: processing → indexed | failed.
      const finalStatus: Document['status'] = indexResult.success ? 'indexed' : 'failed';
      newDoc.status = finalStatus;
      newDoc.metadata = {
        ...newDoc.metadata,
        indexedAt: new Date().toISOString(),
        indexErrors: indexResult.errors.length > 0 ? indexResult.errors : undefined,
      };
      await this.updateDocument(newDocId, { status: finalStatus, metadata: newDoc.metadata }, tenantId);

      // Mark the connector healthy/degraded based on the real outcome.
      source.status = indexResult.success ? 'healthy' : 'degraded';
      source.lastSyncAt = new Date().toISOString();
      source.documentCount = (source.documentCount || 0) + 1;
      source.lastError = indexResult.success ? undefined : indexResult.errors.join('؛ ');
      await memoryDb.updateSource(id, source, tenantId);
      if (!this.useMemory) {
        try {
          await insertPostgresSource(source);
        } catch (e) {
          this.handleDatabaseError(e, 'syncSource-finalStatus');
        }
      }

      const durationMs = Date.now() - startedAt;
      await this.addSyncLog({
        id: `log-${randomUUID()}`,
        tenantId,
        sourceId: source.id,
        sourceName: source.name,
        status: indexResult.success ? 'success' : 'failed',
        itemsProcessed: itemsProcessed,
        durationMs,
        message: indexResult.success
          ? `تمت المزامنة بنجاح: جلب وتفريغ ${itemsProcessed} عنصر وتجزيئها إلى ${pageChunks.length} مقطع دلالي وفهرستها في قواعد المتجهات.`
          : `اكتملت المزامنة مع فشل الفهرسة المتجهية: ${indexResult.errors.join('؛ ')}`,
        timestamp: new Date().toISOString(),
      });

      return { success: indexResult.success, itemsProcessed: itemsProcessed, durationMs };
    } catch (err) {
      this.handleDatabaseError(err, 'syncSource');
      const durationMs = Date.now() - startedAt;
      const errorMessage = (err as Error)?.message || String(err);
      try {
        const source = await memoryDb.getSourceById(id, tenantId);
        if (source) {
          source.status = 'error';
          source.lastError = errorMessage;
          await memoryDb.updateSource(id, source, tenantId);
        }
      } catch {
        /* best effort */
      }
      try {
        await this.addSyncLog({
          id: `log-${randomUUID()}`,
          tenantId,
          sourceId: id,
          sourceName: '',
          status: 'failed',
          itemsProcessed: 0,
          durationMs,
          message: `فشلت المزامنة: ${errorMessage}`,
          timestamp: new Date().toISOString(),
        });
      } catch {
        /* logging must never mask the original failure */
      }
      return { success: false, itemsProcessed: 0, durationMs };
    }
  }

  // Sync Logs — capped feed (v0.12.11, audit item 7: unbounded history read).
  async getSyncLogs(tenantId: string, sourceId?: string, limit = 100): Promise<SyncLogEntry[]> {
    let logsList: SyncLogEntry[] = [];
    if (this.useMemory) {
      logsList = await memoryDb.getSyncLogs(tenantId, sourceId, limit);
    } else {
      try {
        await ensureSeeded();
        if (this.useMemory) {
          logsList = await memoryDb.getSyncLogs(tenantId, sourceId, limit);
        } else {
          logsList = await getPostgresSyncLogs(tenantId, sourceId, limit);
        }
      } catch (e) {
        this.handleDatabaseError(e, 'getSyncLogs');
        logsList = await memoryDb.getSyncLogs(tenantId, sourceId, limit);
      }
    }

    if (shouldSeedDemoData() && logsList.length === 0) {
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
        // Honest isolation wording: tenant isolation is enforced by explicit
        // tenant_id predicates at the application layer, NOT Postgres RLS
        // (which is intentionally disabled — see ensurePostgresTables).
        description: `مصدر بيانات من نوع ${s.type} معزول على مستوى المستأجر عبر فلاتر tenant_id الإلزامية، ويحتوي ${s.documentCount} مستند`,
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

    if (shouldSeedDemoData() && docsList.length === 0) {
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

  /**
   * List-shaped read (v0.12.11, audit item 7): metadata + content length +
   * 400-char preview, paginated. Never ships full content or versions —
   * per-document fetches (getDocumentById) are the only content source.
   */
  async getDocumentSummaries(
    tenantId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<{ documents: DocumentSummary[]; total: number }> {
    if (this.useMemory) {
      return memoryDb.getDocumentSummaries(tenantId, opts);
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        return await memoryDb.getDocumentSummaries(tenantId, opts);
      }
      return await getPostgresDocumentSummaries(tenantId, opts);
    } catch (e) {
      this.handleDatabaseError(e, 'getDocumentSummaries');
      return memoryDb.getDocumentSummaries(tenantId, opts);
    }
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
            const vectorStore = await getVectorStoreForTenant(tenantId);
            await vectorStore.updateDocumentPayload(id, tenantId, { collectionIds: updates.collectionIds });
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
      const vectorStore = await getVectorStoreForTenant(tenantId);
      await vectorStore.deleteByDocument(id, tenantId);
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
    const startedAt = Date.now();

    // Unified page-aware chunker: all ingestion paths produce the same chunk
    // grid, with real page numbers extracted from content markers.
    const versionPageChunks = chunkDocumentWithPages(newContent);
    const chunkTextList = versionPageChunks.map((c) => c.text);

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

    // Replace chunks: purge the OLD chunk grid from every store first. The
    // previous implementation only filtered the in-memory array, so stale
    // vectors from earlier versions kept living in Qdrant and Postgres and
    // polluted retrieval with outdated content.
    memoryDb.chunks = memoryDb.chunks.filter((c) => !(c.documentId === documentId && c.tenantId === tenantId));
    await (await getVectorStoreForTenant(tenantId)).deleteByDocument(documentId, tenantId);
    await deletePostgresChunksByDocument(documentId, tenantId);

    const versionChunks: DocumentChunk[] = versionPageChunks.map((pageChunk, i) => ({
      id: `chunk-${doc.id}-v${nextVerNumber}-${i + 1}`,
      tenantId,
      documentId: doc.id,
      documentTitle: newTitle,
      content: pageChunk.text,
      chunkIndex: i,
      pageNumber: pageChunk.pageNumber ?? 1,
      language: doc.language === 'en' ? 'en' : 'ar',
      metadata: {
        version: nextVerNumber,
        position: i,
        tokenCount: estimateTokenCount(pageChunk.text),
        ...(pageChunk.pageNumber != null ? { extractedPage: true } : {}),
      },
    }));
    const indexResult = await this.addChunks(versionChunks);

    // Reflect the real indexing outcome on the document status.
    const finalStatus: Document['status'] = indexResult.success ? 'indexed' : 'failed';
    updatedDoc.status = finalStatus;
    await this.updateDocument(
      documentId,
      {
        status: finalStatus,
        metadata: {
          ...updatedDoc.metadata,
          indexedAt: new Date().toISOString(),
          indexErrors: indexResult.errors.length > 0 ? indexResult.errors : undefined,
        },
      },
      tenantId,
    );

    await this.addSyncLog({
      id: `log-ver-${Date.now()}`,
      tenantId,
      sourceId: doc.metadata?.sourceId || doc.id,
      sourceName: doc.title,
      status: indexResult.success ? 'success' : 'failed',
      itemsProcessed: chunkTextList.length,
      durationMs: Date.now() - startedAt,
      message: indexResult.success
        ? `تم إنشاء وحفظ الإصدار v${nextVerNumber} للمستند "${newTitle}" وتحديث فهرسة المتجهات`
        : `تم حفظ الإصدار v${nextVerNumber} مع فشل الفهرسة: ${indexResult.errors.join('؛ ')}`,
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
    const startedAt = Date.now();

    // Unified page-aware chunker: the restored chunk grid is identical to the
    // one createDocumentVersion would produce for the same content.
    const revertPageChunks = chunkDocumentWithPages(targetVer.content);
    const chunkTextList = revertPageChunks.map((c) => c.text);

    const updatedDoc: Document = {
      ...doc,
      title: targetVer.title,
      content: targetVer.content,
      chunkCount: chunkTextList.length,
      version: targetVer.versionNumber,
      updatedAt: nowIso,
    };

    await this.addDocument(updatedDoc);

    // Replace chunks across ALL stores (memory + Qdrant + Postgres) so no
    // stale vectors from the superseded version remain searchable.
    memoryDb.chunks = memoryDb.chunks.filter((c) => !(c.documentId === documentId && c.tenantId === tenantId));
    await (await getVectorStoreForTenant(tenantId)).deleteByDocument(documentId, tenantId);
    await deletePostgresChunksByDocument(documentId, tenantId);

    const revertChunks: DocumentChunk[] = revertPageChunks.map((pageChunk, i) => ({
      id: `chunk-${doc.id}-rev-v${targetVer.versionNumber}-${i + 1}`,
      tenantId,
      documentId: doc.id,
      documentTitle: targetVer.title,
      content: pageChunk.text,
      chunkIndex: i,
      pageNumber: pageChunk.pageNumber ?? 1,
      language: doc.language === 'en' ? 'en' : 'ar',
      metadata: {
        restoredFromVersion: targetVer.versionNumber,
        position: i,
        tokenCount: estimateTokenCount(pageChunk.text),
        ...(pageChunk.pageNumber != null ? { extractedPage: true } : {}),
      },
    }));
    const indexResult = await this.addChunks(revertChunks);

    const finalStatus: Document['status'] = indexResult.success ? 'indexed' : 'failed';
    updatedDoc.status = finalStatus;
    await this.updateDocument(
      documentId,
      {
        status: finalStatus,
        metadata: {
          ...updatedDoc.metadata,
          indexedAt: new Date().toISOString(),
          indexErrors: indexResult.errors.length > 0 ? indexResult.errors : undefined,
        },
      },
      tenantId,
    );

    await this.addSyncLog({
      id: `log-revert-${Date.now()}`,
      tenantId,
      sourceId: doc.metadata?.sourceId || doc.id,
      sourceName: targetVer.title,
      status: indexResult.success ? 'success' : 'failed',
      itemsProcessed: chunkTextList.length,
      durationMs: Date.now() - startedAt,
      message: indexResult.success
        ? `تم استرجاع المستند "${targetVer.title}" إلى الإصدار v${targetVer.versionNumber} بنجاح وإعادة الفهرسة`
        : `تم استرجاع الإصدار v${targetVer.versionNumber} مع فشل الفهرسة: ${indexResult.errors.join('؛ ')}`,
      timestamp: nowIso,
    });

    return { document: updatedDoc, restoredVersion: targetVer };
  }

  /**
   * Re-index an existing document: re-chunk its current content with the
   * unified chunker, purge the old chunk grid from every store, and rebuild
   * embeddings + Qdrant points + Postgres rows from scratch.
   *
   * This is the REAL implementation behind the UI's "reindex" button, which
   * previously ran a 1-second setTimeout and did nothing. It is also the
   * recovery path for documents stuck in `failed` after a vector-store outage.
   *
   * Returns undefined when the document does not exist; otherwise returns the
   * updated document and the indexing result so the caller can report the
   * outcome honestly.
   */
  async reindexDocument(
    documentId: string,
    tenantId: string,
  ): Promise<{ document: Document; result: ChunkIndexResult } | undefined> {
    const doc = await this.getDocumentById(documentId, tenantId);
    if (!doc || !doc.content) return undefined;

    const startedAt = Date.now();
    await this.updateDocument(documentId, { status: 'processing' }, tenantId);

    // Unified page-aware chunker — reuse the document's stored chunking config
    // when it has one so a reindex reproduces the original geometry.
    const reindexPageChunks = chunkDocumentWithPages(doc.content, doc.metadata?.chunkingConfig);
    const chunkTextList = reindexPageChunks.map((c) => c.text);

    // Purge the stale grid from all stores before rebuilding.
    memoryDb.chunks = memoryDb.chunks.filter((c) => !(c.documentId === documentId && c.tenantId === tenantId));
    await (await getVectorStoreForTenant(tenantId)).deleteByDocument(documentId, tenantId);
    await deletePostgresChunksByDocument(documentId, tenantId);

    const chunks: DocumentChunk[] = reindexPageChunks.map((pageChunk, i) => ({
      id: `chunk-${doc.id}-re-${Date.now().toString(36)}-${i + 1}`,
      tenantId,
      documentId: doc.id,
      documentTitle: doc.title,
      content: pageChunk.text,
      chunkIndex: i,
      pageNumber: pageChunk.pageNumber ?? 1,
      language: doc.language === 'en' ? 'en' : 'ar',
      metadata: {
        sourceId: doc.metadata?.sourceId,
        position: i,
        reindexedAt: new Date().toISOString(),
        tokenCount: estimateTokenCount(pageChunk.text),
        ...(pageChunk.pageNumber != null ? { extractedPage: true } : {}),
      },
    }));

    const result = await this.addChunks(chunks);

    const finalStatus: Document['status'] = result.success ? 'indexed' : 'failed';
    const updated = await this.updateDocument(
      documentId,
      {
        status: finalStatus,
        chunkCount: chunkTextList.length,
        metadata: {
          ...doc.metadata,
          indexedAt: new Date().toISOString(),
          indexErrors: result.errors.length > 0 ? result.errors : undefined,
        },
      },
      tenantId,
    );

    await this.addSyncLog({
      id: `log-reindex-${Date.now()}`,
      tenantId,
      sourceId: doc.metadata?.sourceId || doc.id,
      sourceName: doc.title,
      status: result.success ? 'success' : 'failed',
      itemsProcessed: chunkTextList.length,
      durationMs: Date.now() - startedAt,
      message: result.success
        ? `تمت إعادة فهرسة المستند "${doc.title}" إلى ${chunkTextList.length} مقطع دلالي بنجاح`
        : `فشلت إعادة فهرسة "${doc.title}": ${result.errors.join('؛ ')}`,
      timestamp: new Date().toISOString(),
    });

    return { document: updated || { ...doc, status: finalStatus, chunkCount: chunkTextList.length }, result };
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

    if (shouldSeedDemoData() && chunksList.length === 0) {
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

  /**
   * Document-scoped, paginated chunk read. Filters and paginates in SQL (the
   * (tenant_id, document_id) index) instead of loading every tenant chunk and
   * filtering in JS — the old GET /documents?documentId= behavior.
   */
  async getChunksByDocument(
    tenantId: string,
    documentId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ chunks: DocumentChunk[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);

    if (this.useMemory) {
      const all = (await memoryDb.getChunks(tenantId)).filter((c) => c.documentId === documentId);
      return { chunks: all.slice(offset, offset + limit), total: all.length };
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        const all = (await memoryDb.getChunks(tenantId)).filter((c) => c.documentId === documentId);
        return { chunks: all.slice(offset, offset + limit), total: all.length };
      }
      return await getPostgresChunksByDocument(tenantId, documentId, { limit, offset });
    } catch (e) {
      this.handleDatabaseError(e, 'getChunksByDocument');
      const all = (await memoryDb.getChunks(tenantId)).filter((c) => c.documentId === documentId);
      return { chunks: all.slice(offset, offset + limit), total: all.length };
    }
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

      const vectorStore = await getVectorStoreForTenant(chunk.tenantId);
      await vectorStore.upsertPoints([
        {
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
        },
      ]);
    } catch (vecErr) {
      log.error('Vector embedding/Qdrant indexing error:', (vecErr as Error)?.message);
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
   *
   * Returns a structured {@link ChunkIndexResult} instead of swallowing
   * failures: previously a Qdrant outage still produced a "success" API
   * response while zero vectors were stored, leaving documents marked
   * "indexed" but unsearchable. Callers now flip the document status to
   * `failed` (or surface a partial-indexing warning) based on this result.
   */
  async addChunks(chunks: DocumentChunk[]): Promise<ChunkIndexResult> {
    const result: ChunkIndexResult = {
      indexed: 0,
      failed: 0,
      total: chunks.length,
      errors: [],
      success: false,
    };
    if (chunks.length === 0) {
      result.success = true;
      return result;
    }
    await memoryDb.addChunks(chunks);
    if (this.useMemory) {
      // Memory-only mode: chunks are stored in-process and searchable via the
      // local fallback engine, so we report them as indexed.
      result.indexed = chunks.length;
      result.success = true;
      return result;
    }

    try {
      await ensureSeeded();
      if (this.useMemory) {
        result.indexed = chunks.length;
        result.success = true;
        return result;
      }

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
      let lexicalFailures = 0;
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
            lexicalFailures++;
          }),
        ),
      );
      if (lexicalFailures > 0) {
        result.errors.push(`تعذر حفظ ${lexicalFailures} مقطع في فهرس Postgres اللفظي`);
      }

      // 4. One multi-point upsert to the tenant's vector store for the batch.
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

      const embedFailed = chunks.length - points.length;
      if (embedFailed > 0) {
        result.errors.push(`فشل توليد التضمين المتجهي لـ ${embedFailed} مقطع`);
      }

      const vectorStore = await getVectorStoreForTenant(chunks[0].tenantId);
      const vectorOk = await vectorStore.upsertPoints(points);
      if (vectorOk) {
        result.indexed = points.length;
        result.failed = embedFailed;
        // Stamp the embedding model these vectors were built with so the
        // stale-detection (reembedService) knows the corpus's provenance.
        // Different embedding models produce incomparable vectors — this
        // tracking is what makes "model changed → must re-embed" detectable.
        try {
          const activeEmbeddingModel = getAiModel('embeddingModel');
          const tenant = await this.getTenant(chunks[0].tenantId);
          if (tenant && tenant.settings.indexedEmbeddingModel !== activeEmbeddingModel) {
            await this.updateTenantSettings(chunks[0].tenantId, { indexedEmbeddingModel: activeEmbeddingModel });
          }
        } catch {
          // Tracking is best-effort — a settings write failure must not flip
          // an otherwise-successful indexing batch to failed.
        }
      } else {
        // Vector store unreachable or rejected the batch: nothing is
        // semantically searchable yet. Report the whole batch as failed so the
        // caller can mark the document `failed` and offer a reindex.
        result.indexed = 0;
        result.failed = chunks.length;
        result.errors.push(`تعذر الرفع إلى محرك المتجهات (${vectorStore.nameAr}) — المستند غير قابل للبحث الدلالي بعد`);
      }
    } catch (vecErr) {
      log.error('Batch vector embedding/Qdrant indexing error:', (vecErr as Error)?.message);
      result.indexed = 0;
      result.failed = chunks.length;
      result.errors.push((vecErr as Error)?.message || 'خطأ غير معروف أثناء الفهرسة المتجهية');
    }

    result.success = result.failed === 0 && result.errors.length === 0;
    return result;
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

    if (shouldSeedDemoData() && collectionsList.length === 0) {
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
      defaultServers.push(buildSkillsServer(tenantId));
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

    // Phase 4 production skills server — auto-injected for every tenant the
    // same way as Unstructured Transform, so existing tenants pick it up
    // without re-seeding.
    const hasSkillsServer = serversList.some((s) => s.id.includes('mcp-omnirag-skills'));
    if (!hasSkillsServer) {
      const skillsServer = buildSkillsServer(tenantId);
      await this.addMcpServer(skillsServer);
      serversList.push(skillsServer);
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
        model: DEFAULT_AI_MODELS.chatModel,
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
        modelUsed: DEFAULT_AI_MODELS.chatModel,
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
          modelUsed: DEFAULT_AI_MODELS.chatModel,
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

  async findTenantIdBySsoEmailDomain(domain: string): Promise<string | undefined> {
    const memHit = await memoryDb.findTenantIdBySsoEmailDomain(domain);
    if (this.useMemory) return memHit;
    try {
      await ensureSeeded();
      if (this.useMemory) return memHit;
      const hit = await findPostgresTenantIdBySsoDomain(domain);
      return hit ?? memHit;
    } catch (e) {
      this.handleDatabaseError(e, 'findTenantIdBySsoEmailDomain');
      return memHit;
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

  async deleteTenantSessionsForUser(tenantId: string, userId: string): Promise<void> {
    await memoryDb.deleteTenantSessionsForUser(tenantId, userId);
    if (this.useMemory) return;
    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await deletePostgresSessionsForTenantUser(tenantId, userId);
    } catch (e) {
      this.handleDatabaseError(e, 'deleteTenantSessionsForUser');
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

  // API keys (headless/external access — Bearer auth)
  async createApiKey(key: ApiKeyRecord): Promise<void> {
    await memoryDb.createApiKey(key);
    if (this.useMemory) return;
    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresApiKey(key);
    } catch (e) {
      this.handleDatabaseError(e, 'createApiKey');
    }
  }

  async listApiKeys(tenantId: string): Promise<ApiKeyRecord[]> {
    const mem = await memoryDb.listApiKeys(tenantId);
    if (this.useMemory) return mem;
    try {
      await ensureSeeded();
      if (this.useMemory) return mem;
      const rows = await getPostgresApiKeys(tenantId);
      return rows.length > 0 ? rows : mem;
    } catch (e) {
      this.handleDatabaseError(e, 'listApiKeys');
      return mem;
    }
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | undefined> {
    if (this.useMemory) return await memoryDb.getApiKeyByHash(keyHash);
    try {
      await ensureSeeded();
      if (this.useMemory) return await memoryDb.getApiKeyByHash(keyHash);
      const key = await getPostgresApiKeyByHash(keyHash);
      return key ?? (await memoryDb.getApiKeyByHash(keyHash));
    } catch (e) {
      this.handleDatabaseError(e, 'getApiKeyByHash');
      return await memoryDb.getApiKeyByHash(keyHash);
    }
  }

  async revokeApiKey(id: string, tenantId: string): Promise<void> {
    await memoryDb.revokeApiKey(id, tenantId);
    if (this.useMemory) return;
    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await revokePostgresApiKey(id, tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'revokeApiKey');
    }
  }

  async touchApiKeyLastUsed(id: string, timestamp: string): Promise<void> {
    await memoryDb.touchApiKeyLastUsed(id, timestamp);
    if (this.useMemory) return;
    try {
      if (this.useMemory) return;
      await touchPostgresApiKeyLastUsed(id, timestamp);
    } catch (e) {
      // Best-effort telemetry — never surface into the auth path.
      log.warn('[db] touchApiKeyLastUsed skipped:', (e as Error)?.message);
    }
  }

  // AI provider credentials (per-tenant, encrypted at rest)
  async upsertProviderCredentials(record: ProviderCredentialRecord): Promise<void> {
    await memoryDb.upsertProviderCredentials(record);
    if (this.useMemory) return;
    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await upsertPostgresProviderCredentials(record);
    } catch (e) {
      this.handleDatabaseError(e, 'upsertProviderCredentials');
    }
  }

  async getProviderCredentials(tenantId: string, providerId: string): Promise<ProviderCredentialRecord | undefined> {
    if (this.useMemory) return await memoryDb.getProviderCredentials(tenantId, providerId);
    try {
      await ensureSeeded();
      if (this.useMemory) return await memoryDb.getProviderCredentials(tenantId, providerId);
      const row = await getPostgresProviderCredentials(tenantId, providerId);
      return row ?? (await memoryDb.getProviderCredentials(tenantId, providerId));
    } catch (e) {
      this.handleDatabaseError(e, 'getProviderCredentials');
      return await memoryDb.getProviderCredentials(tenantId, providerId);
    }
  }

  async listProviderCredentials(tenantId: string): Promise<ProviderCredentialRecord[]> {
    const mem = await memoryDb.listProviderCredentials(tenantId);
    if (this.useMemory) return mem;
    try {
      await ensureSeeded();
      if (this.useMemory) return mem;
      const rows = await getPostgresProviderCredentialsList(tenantId);
      return rows.length > 0 ? rows : mem;
    } catch (e) {
      this.handleDatabaseError(e, 'listProviderCredentials');
      return mem;
    }
  }

  async deleteProviderCredentials(tenantId: string, providerId: string): Promise<void> {
    await memoryDb.deleteProviderCredentials(tenantId, providerId);
    if (this.useMemory) return;
    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await deletePostgresProviderCredentials(tenantId, providerId);
    } catch (e) {
      this.handleDatabaseError(e, 'deleteProviderCredentials');
    }
  }

  // Webhook endpoints (Phase 6 — outbound event notifications)
  async createWebhookEndpoint(endpoint: WebhookEndpoint): Promise<void> {
    await memoryDb.createWebhookEndpoint(endpoint);
    if (this.useMemory) return;
    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await insertPostgresWebhookEndpoint(endpoint);
    } catch (e) {
      this.handleDatabaseError(e, 'createWebhookEndpoint');
    }
  }

  async listWebhookEndpoints(tenantId: string): Promise<WebhookEndpoint[]> {
    const mem = await memoryDb.listWebhookEndpoints(tenantId);
    if (this.useMemory) return mem;
    try {
      await ensureSeeded();
      if (this.useMemory) return mem;
      const rows = await getPostgresWebhookEndpoints(tenantId);
      return rows.length > 0 ? rows : mem;
    } catch (e) {
      this.handleDatabaseError(e, 'listWebhookEndpoints');
      return mem;
    }
  }

  async getWebhookEndpointById(id: string, tenantId: string): Promise<WebhookEndpoint | undefined> {
    if (this.useMemory) return await memoryDb.getWebhookEndpointById(id, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return await memoryDb.getWebhookEndpointById(id, tenantId);
      const row = await getPostgresWebhookEndpointById(id, tenantId);
      return row ?? (await memoryDb.getWebhookEndpointById(id, tenantId));
    } catch (e) {
      this.handleDatabaseError(e, 'getWebhookEndpointById');
      return await memoryDb.getWebhookEndpointById(id, tenantId);
    }
  }

  async updateWebhookEndpoint(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<
        WebhookEndpoint,
        'name' | 'url' | 'secretEncrypted' | 'events' | 'enabled' | 'lastDeliveryAt' | 'lastDeliveryStatus'
      >
    >,
  ): Promise<void> {
    await memoryDb.updateWebhookEndpoint(id, tenantId, patch);
    if (this.useMemory) return;
    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await updatePostgresWebhookEndpoint(id, tenantId, patch);
    } catch (e) {
      this.handleDatabaseError(e, 'updateWebhookEndpoint');
    }
  }

  async deleteWebhookEndpoint(id: string, tenantId: string): Promise<void> {
    await memoryDb.deleteWebhookEndpoint(id, tenantId);
    if (this.useMemory) return;
    try {
      await ensureSeeded();
      if (this.useMemory) return;
      await deletePostgresWebhookEndpoint(id, tenantId);
    } catch (e) {
      this.handleDatabaseError(e, 'deleteWebhookEndpoint');
    }
  }

  // Tenant settings (server-side config of record)
  async updateTenantSettings(tenantId: string, settings: Partial<Tenant['settings']>): Promise<Tenant | undefined> {
    const memTenant = await memoryDb.updateTenantSettings(tenantId, settings);
    if (this.useMemory) return memTenant;
    try {
      await ensureSeeded();
      if (this.useMemory) return memTenant;
      const current = await getPostgresTenant(tenantId);
      if (!current) return memTenant;
      const merged = { ...current.settings, ...settings };
      await updatePostgresTenantSettings(tenantId, JSON.stringify(merged));
      return { ...current, settings: merged };
    } catch (e) {
      this.handleDatabaseError(e, 'updateTenantSettings');
      return memTenant;
    }
  }

  // Subscription plan (Phase 7)
  async updateTenantPlan(tenantId: string, plan: Tenant['plan']): Promise<Tenant | undefined> {
    const memTenant = await memoryDb.updateTenantPlan(tenantId, plan);
    if (this.useMemory) return memTenant;
    try {
      await ensureSeeded();
      if (this.useMemory) return memTenant;
      await updatePostgresTenantPlan(tenantId, plan);
      const current = await getPostgresTenant(tenantId);
      return current ?? memTenant;
    } catch (e) {
      this.handleDatabaseError(e, 'updateTenantPlan');
      return memTenant;
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
