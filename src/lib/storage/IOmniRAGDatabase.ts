/**
 * The canonical storage contract for OmniRAG.
 *
 * All persistence backends (Postgres-backed production store, in-memory
 * test/demo store) MUST implement this interface. API routes and
 * libraries depend on `IOmniRAGDatabase` rather than a concrete class so the
 * backend can be swapped, mocked in tests, or split per-tenant without
 * touching call sites.
 *
 * Methods are intentionally async — even backends that resolve from an
 * in-memory buffer return Promises so call sites use a single `await` shape.
 */
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

export interface IOmniRAGDatabase {
  // Lifecycle / operational control
  resetDatabaseState(): void;

  // Sources
  getSources(tenantId: string): Promise<SourceConnector[]>;
  getScheduledSources(): Promise<Array<{ id: string; tenantId: string; syncSchedule: string }>>;
  getSourceById(id: string, tenantId: string): Promise<SourceConnector | undefined>;
  addSource(source: SourceConnector): Promise<void>;
  updateSource(id: string, updates: Partial<SourceConnector>, tenantId: string): Promise<SourceConnector | undefined>;
  deleteSource(id: string, tenantId: string, purgeDocs?: boolean): Promise<void>;
  syncSource(id: string, tenantId: string): Promise<{ success: boolean; itemsProcessed: number; durationMs: number }>;

  // Sync logs
  getSyncLogs(tenantId: string, sourceId?: string): Promise<SyncLogEntry[]>;
  addSyncLog(log: SyncLogEntry): Promise<void>;

  // MCP
  getMcpResources(tenantId: string): Promise<McpResourceItem[]>;
  getMcpServers(tenantId: string): Promise<MCPServerConfig[]>;
  addMcpServer(server: MCPServerConfig): Promise<void>;
  toggleMcpTool(serverId: string, toolName: string, tenantId: string): Promise<void>;
  deleteMcpServer(serverId: string, tenantId: string): Promise<void>;
  getToolCalls(tenantId: string): Promise<MCPToolCall[]>;
  addToolCall(tc: MCPToolCall): Promise<void>;

  // Documents & chunks
  getDocuments(tenantId: string): Promise<Document[]>;
  getDocumentById(id: string, tenantId: string): Promise<Document | undefined>;
  addDocument(docObj: Document): Promise<void>;
  updateDocument(id: string, updates: Partial<Document>, tenantId: string): Promise<Document | undefined>;
  deleteDocument(id: string, tenantId: string): Promise<void>;
  getChunks(tenantId: string): Promise<DocumentChunk[]>;
  /**
   * Document-scoped, paginated chunk read. Filters in SQL via the
   * (tenant_id, document_id) composite index instead of loading the whole
   * tenant chunk grid — use for per-document views (documents GET ?documentId).
   */
  getChunksByDocument(
    tenantId: string,
    documentId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<{ chunks: DocumentChunk[]; total: number }>;
  addChunk(chunk: DocumentChunk): Promise<void>;
  /**
   * Ingest a batch of chunks in one pass: embeddings are generated with bounded
   * concurrency, the parent document's collectionIds are resolved once (not per
   * chunk), and Qdrant receives a single multi-point upsert. Preferred over
   * looping `addChunk` whenever the full chunk list is known up-front.
   *
   * Returns a structured result so callers can surface indexing failures
   * instead of silently reporting success when embedding or the vector store
   * failed. `indexed` counts chunks that reached the vector store; `failed`
   * counts chunks that did not; `errors` carries human-readable reasons.
   */
  addChunks(chunks: DocumentChunk[]): Promise<ChunkIndexResult>;

  // Document versioning
  getDocumentVersions(documentId: string, tenantId: string): Promise<DocumentVersion[]>;
  createDocumentVersion(
    documentId: string,
    params: { title?: string; content: string; changeSummary?: string; createdBy?: string },
    tenantId: string,
  ): Promise<{ document: Document; version: DocumentVersion } | undefined>;
  revertDocumentVersion(
    documentId: string,
    targetVersionNumber: number,
    tenantId: string,
  ): Promise<{ document: Document; restoredVersion: DocumentVersion } | undefined>;
  /**
   * Rebuild a document's chunk grid and vector index from its current
   * content. Recovery path for `failed` documents and the real handler behind
   * the UI reindex action. Returns undefined when the document is missing.
   */
  reindexDocument(
    documentId: string,
    tenantId: string,
  ): Promise<{ document: Document; result: ChunkIndexResult } | undefined>;

  // Collections
  getCollections(tenantId: string): Promise<Collection[]>;
  addCollection(col: Collection): Promise<void>;

  // Audit
  getAuditLogs(tenantId: string): Promise<AuditLogEntry[]>;
  addAuditLog(entry: AuditLogEntry): Promise<void>;

  // Conversations & messages
  getConversations(tenantId: string): Promise<Conversation[]>;
  getConversationById(id: string, tenantId: string): Promise<Conversation | null>;
  saveConversation(conv: Conversation): Promise<void>;
  deleteConversation(id: string, tenantId: string): Promise<void>;
  getMessages(conversationId: string, tenantId: string): Promise<Message[]>;
  addMessage(msg: Message): Promise<void>;

  // Auth (Postgres-only — user account, tenant, and opaque session lifecycle)
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  createUser(user: User): Promise<void>;
  createTenant(tenant: Tenant): Promise<void>;
  getTenant(tenantId: string): Promise<Tenant | undefined>;
  findTenantIdBySsoEmailDomain(domain: string): Promise<string | undefined>;
  createSession(session: SessionRecord): Promise<void>;
  getSession(token: string): Promise<SessionRecord | undefined>;
  deleteSession(token: string): Promise<void>;
  deleteTenantSessionsForUser(tenantId: string, userId: string): Promise<void>;
  deleteExpiredSessions(): Promise<void>;

  // API keys (headless/external access — Bearer auth)
  createApiKey(key: ApiKeyRecord): Promise<void>;
  listApiKeys(tenantId: string): Promise<ApiKeyRecord[]>;
  getApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | undefined>;
  revokeApiKey(id: string, tenantId: string): Promise<void>;
  /** Best-effort last-used stamp; MUST NOT throw into the auth hot path. */
  touchApiKeyLastUsed(id: string, timestamp: string): Promise<void>;

  // AI provider credentials (per-tenant, encrypted at rest)
  upsertProviderCredentials(record: ProviderCredentialRecord): Promise<void>;
  getProviderCredentials(tenantId: string, providerId: string): Promise<ProviderCredentialRecord | undefined>;
  listProviderCredentials(tenantId: string): Promise<ProviderCredentialRecord[]>;
  deleteProviderCredentials(tenantId: string, providerId: string): Promise<void>;

  // Webhook endpoints (Phase 6 — outbound event notifications)
  createWebhookEndpoint(endpoint: WebhookEndpoint): Promise<void>;
  listWebhookEndpoints(tenantId: string): Promise<WebhookEndpoint[]>;
  getWebhookEndpointById(id: string, tenantId: string): Promise<WebhookEndpoint | undefined>;
  updateWebhookEndpoint(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<
        WebhookEndpoint,
        'name' | 'url' | 'secretEncrypted' | 'events' | 'enabled' | 'lastDeliveryAt' | 'lastDeliveryStatus'
      >
    >,
  ): Promise<void>;
  deleteWebhookEndpoint(id: string, tenantId: string): Promise<void>;

  // Tenant settings (server-side config of record; see tenantConfigService)
  updateTenantSettings(tenantId: string, settings: Partial<Tenant['settings']>): Promise<Tenant | undefined>;

  // Subscription plan (Phase 7 — quota catalog in planService)
  updateTenantPlan(tenantId: string, plan: Tenant['plan']): Promise<Tenant | undefined>;
}

export type { Tenant, User, SessionRecord };
