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
  metadata: Record<string, any>;
  collectionIds?: string[];
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
}

export interface Citation {
  index: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  pageNumber?: number;
  score: number;
  snippet: string;
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

export type SourceStatus = 'healthy' | 'syncing' | 'degraded' | 'error' | 'paused';

export interface SourceConnector {
  id: string;
  tenantId: TenantId;
  name: string;
  type: SourceType;
  status: SourceStatus;
  config: Record<string, any>;
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
  mmrDiversity?: number;
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
