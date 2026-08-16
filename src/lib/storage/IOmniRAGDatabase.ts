/**
 * The canonical storage contract for OmniRAG.
 *
 * All persistence backends (Postgres-backed production store, Firestore,
 * in-memory test/demo store) MUST implement this interface. API routes and
 * libraries depend on `IOmniRAGDatabase` rather than a concrete class so the
 * backend can be swapped, mocked in tests, or split per-tenant without
 * touching call sites.
 *
 * Methods are intentionally async — even backends that resolve from an
 * in-memory buffer return Promises so call sites use a single `await` shape.
 */
import {
  Tenant,
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

export interface IOmniRAGDatabase {
  // Lifecycle / operational control
  resetDatabaseState(): void;

  // Sources
  getSources(tenantId: string): Promise<SourceConnector[]>;
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
  addChunk(chunk: DocumentChunk): Promise<void>;
  /**
   * Ingest a batch of chunks in one pass: embeddings are generated with bounded
   * concurrency, the parent document's collectionIds are resolved once (not per
   * chunk), and Qdrant receives a single multi-point upsert. Preferred over
   * looping `addChunk` whenever the full chunk list is known up-front.
   */
  addChunks(chunks: DocumentChunk[]): Promise<void>;

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
}

/**
 * Open question (intentional non-goal for this slice): a `Tenant` read/write
 * surface lives on the concrete store today but is not yet exercised by any
 * route. It is deliberately omitted from the contract until a route depends on
 * it, to avoid advertising an unstable API.
 */
export type { Tenant };
