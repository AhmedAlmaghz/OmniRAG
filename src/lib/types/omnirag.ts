export type TenantId = string;

export interface Tenant {
  id: TenantId;
  name: string;
  plan: 'enterprise' | 'pro' | 'starter';
  createdAt: string;
  settings: TenantSettings;
}

export interface TenantSettings {
  chunkSize: number;
  chunkOverlap: number;
  hybridWeights: {
    semantic: number;
    lexical: number;
  };
  defaultModel: string;
  dataRetentionDays: number;
  enablePiiRedaction: boolean;
  enablePromptSanitizer: boolean;
}

export type ChatMode = 'private' | 'hybrid' | 'general' | 'analysis';

/**
 * Auth account (Postgres-only — replaces Firebase Auth). The password hash is
 * stored exclusively on the server; `User` never reaches the client. Each user
 * belongs to exactly one tenant (single-tenant-at-signup model) — `tenantId`
 * is explicit data, reconstructed at login rather than derived by convention.
 */
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  tenantId: string;
  createdAt: string;
}

/**
 * A persisted session row. `token` is an opaque random value (never a JWT),
 * looked up verbatim against the `sessions` table to authorize requests.
 */
export interface SessionRecord {
  token: string;
  userId: string;
  tenantId: string;
  expiresAt: string; // ISO timestamp
  createdAt: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  title: string;
  content: string;
  chunkCount: number;
  createdAt: string;
  createdBy?: string;
  changeSummary?: string;
  metadata?: Record<string, any>;
}

export interface Document {
  id: string;
  tenantId: TenantId;
  title: string;
  content: string;
  sourceType: 'file' | 'url' | 'api' | 'integration';
  language: 'ar' | 'en' | 'auto';
  status: 'pending' | 'processing' | 'indexed' | 'failed';
  chunkCount: number;
  createdAt: string;
  updatedAt?: string;
  metadata: Record<string, any>;
  collectionIds?: string[];
  version?: number;
  versions?: DocumentVersion[];
}

export interface DocumentChunk {
  id: string;
  tenantId: TenantId;
  documentId: string;
  documentTitle: string;
  content: string;
  chunkIndex: number;
  pageNumber?: number;
  score?: number;
  semanticScore?: number;
  lexicalScore?: number;
  language: 'ar' | 'en';
  metadata?: Record<string, any>;
}

/**
 * Structured outcome of a batch chunk-indexing operation. Previously the
 * ingestion path swallowed embedding/Qdrant errors and always reported success,
 * so a document could show "indexed" while having zero searchable vectors.
 * Callers now receive explicit counts and can flip the document status to
 * `failed` (or `indexed` with a warning) accordingly.
 */
export interface ChunkIndexResult {
  /** Number of chunks that successfully reached the vector store. */
  indexed: number;
  /** Number of chunks that failed embedding or vector upsert. */
  failed: number;
  /** Total chunks attempted. */
  total: number;
  /** Human-readable failure reasons (empty when fully successful). */
  errors: string[];
  /** True when every chunk was indexed successfully. */
  success: boolean;
}

export interface Collection {
  id: string;
  tenantId: TenantId;
  name: string;
  description: string;
  documentCount: number;
  createdAt: string;
}

export interface Conversation {
  id: string;
  tenantId: TenantId;
  title: string;
  mode: ChatMode;
  model: string;
  collectionIds: string[];
  enabledMcpServers: string[];
  createdAt: string;
  updatedAt: string;
  /** Preview of the first user request in this conversation (list views). */
  firstUserMessage?: string;
}

export interface Citation {
  index: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  pageNumber?: number;
  score: number;
  snippet: string;
  /** Direct URL to the source document (external link or in-app deep link) */
  sourceUrl?: string;
}

export interface Message {
  id: string;
  tenantId: TenantId;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: Citation[];
  modelUsed?: string;
  tokensUsed?: {
    input: number;
    output: number;
  };
  feedback?: 'up' | 'down';
  toolCalls?: MCPToolCall[];
  hasPiiRedacted?: boolean;
  createdAt: string;
}

export type SandboxTier = 'T0_READ_ONLY' | 'T1_LIMITED' | 'T2_ELEVATED' | 'T3_FULL_EXECUTION';

export interface MCPServerConfig {
  id: string;
  tenantId: TenantId;
  name: string;
  description: string;
  endpointUrl: string;
  protocolVersion: '2026-07-28' | '2025-11-25';
  sandboxTier: SandboxTier;
  enabledTools: string[];
  requireConfirmationTools: string[];
  status: 'healthy' | 'degraded' | 'down';
  latencyMs: number;
  lastChecked: string;
  headers?: Record<string, string>;
  category?: string;
  url?: string;
  authType?: 'none' | 'basic' | 'bearer' | 'oauth2';
  transportType?: 'http' | 'sse' | 'stdio' | 'websocket';
  config?: Record<string, any>;
  customToolSchemas?: Record<string, any>;
}

export interface MCPToolDefinition {
  name: string;
  scopedName: string;
  description: string;
  serverId: string;
  hasSideEffect: boolean;
  parameters: Record<string, any>;
}

export interface MCPToolCall {
  id: string;
  tenantId: TenantId;
  conversationId?: string;
  scopedToolName: string;
  inputParams: Record<string, any>;
  outputResult?: any;
  latencyMs: number;
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'failed';
  hasSideEffect: boolean;
  userConfirmed?: boolean;
  timestamp: string;
}

export interface AuditLogEntry {
  id: string;
  tenantId: TenantId;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  status: 'success' | 'blocked' | 'error';
  details: string;
  timestamp: string;
}

export type SourceType =
  | 'file'
  | 'web_file'
  | 'url'
  | 'rss'
  | 'youtube'
  | 'github'
  | 'notion'
  | 'gdrive'
  | 'confluence'
  | 'slack'
  | 'email'
  | 'database'
  | 'api';

/**
 * Runtime list mirroring {@link SourceType}. Single source of truth for route
 * validation — routes previously re-declared their own copies of this array,
 * so adding a connector type required editing three places in sync.
 */
export const SOURCE_TYPE_VALUES: SourceType[] = [
  'file',
  'web_file',
  'url',
  'rss',
  'youtube',
  'github',
  'notion',
  'gdrive',
  'confluence',
  'slack',
  'email',
  'database',
  'api',
];

export type SourceStatus = 'healthy' | 'syncing' | 'degraded' | 'error' | 'paused';

export interface SourceConnector {
  id: string;
  tenantId: TenantId;
  name: string;
  type: SourceType;
  status: SourceStatus;
  /**
   * Connector configuration. Credential-bearing keys (apiKey, token, password,
   * secret, connectionString) are stored AES-256-GCM encrypted at rest via
   * {@link encryptSourceConfig}; decrypted lazily for sync execution only.
   */
  config: Record<string, any>;
  /** Set true once {@link config} has been encrypted at rest. */
  configEncrypted?: boolean;
  syncSchedule: string; // Cron e.g. "0 */6 * * *" or "manual"
  lastSyncAt?: string;
  nextSyncAt?: string;
  documentCount: number;
  totalBytes?: number;
  collectionIds: string[];
  lastError?: string;
  createdAt: string;
}

export interface SyncLogEntry {
  id: string;
  tenantId: TenantId;
  sourceId: string;
  sourceName: string;
  status: 'success' | 'failed' | 'warning';
  itemsProcessed: number;
  durationMs: number;
  message: string;
  timestamp: string;
}

export interface McpResourceItem {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  tenantId: TenantId;
  sourceId?: string;
  updatedAt: string;
}

export interface SearchQuery {
  query: string;
  tenantId: TenantId;
  language?: 'ar' | 'en' | 'auto';
  collectionIds?: string[];
  topK?: number;
  scoreThreshold?: number;
  semanticWeight?: number;
  lexicalWeight?: number;
  rerank?: boolean;
  useHyde?: boolean;
}

export interface SearchResult {
  chunks: DocumentChunk[];
  totalCount: number;
  latencyMs: number;
  hydePrompt?: string;
  distribution: {
    semanticMatches: number;
    lexicalMatches: number;
    fusionCount: number;
  };
}
