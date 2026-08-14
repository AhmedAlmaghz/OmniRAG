import { pgTable, varchar, text, integer, jsonb, boolean } from 'drizzle-orm/pg-core';

// 1. Documents Table
export const documents = pgTable('documents', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  sourceType: varchar('source_type', { length: 50 }).notNull().default('file'),
  language: varchar('language', { length: 10 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  chunkCount: integer('chunk_count').default(0),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
  metadata: jsonb('metadata'),
  collectionIds: jsonb('collection_ids'),
});

// 2. Chunks Table
export const chunks = pgTable('chunks', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  documentId: varchar('document_id', { length: 100 }).notNull(),
  documentTitle: text('document_title').notNull().default(''),
  content: text('content').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  pageNumber: integer('page_number').default(1),
  language: varchar('language', { length: 10 }).notNull(),
  metadata: jsonb('metadata'),
});

// 3. Sources Table
export const sources = pgTable('sources', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  name: text('name').notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  config: jsonb('config').default({}),
  syncSchedule: varchar('sync_schedule', { length: 100 }),
  lastSyncAt: varchar('last_sync_at', { length: 100 }),
  nextSyncAt: varchar('next_sync_at', { length: 100 }),
  documentCount: integer('document_count').default(0),
  totalBytes: integer('total_bytes').default(0),
  lastError: text('last_error'),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
  collectionIds: jsonb('collection_ids').default([]),
});

// 4. Sync Logs Table
export const syncLogs = pgTable('sync_logs', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  sourceId: varchar('source_id', { length: 100 }).notNull(),
  sourceName: text('source_name').notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  itemsProcessed: integer('items_processed').default(0),
  durationMs: integer('duration_ms').default(0),
  message: text('message'),
  timestamp: varchar('timestamp', { length: 100 }).notNull(),
});

// 5. Collections Table
export const collections = pgTable('collections', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  documentCount: integer('document_count').default(0),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
});

// 6. MCP Servers Table
export const mcpServers = pgTable('mcp_servers', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  endpointUrl: text('endpoint_url').notNull(),
  protocolVersion: varchar('protocol_version', { length: 50 }).notNull(),
  sandboxTier: varchar('sandbox_tier', { length: 50 }).notNull(),
  enabledTools: jsonb('enabled_tools').default([]),
  requireConfirmationTools: jsonb('require_confirmation_tools').default([]),
  status: varchar('status', { length: 50 }).notNull(),
  latencyMs: integer('latency_ms').default(0),
  lastChecked: varchar('last_checked', { length: 100 }).notNull(),
  headers: jsonb('headers').default({}),
  category: varchar('category', { length: 100 }),
  url: text('url'),
  authType: varchar('auth_type', { length: 50 }),
  transportType: varchar('transport_type', { length: 50 }),
  config: jsonb('config').default({}),
  customToolSchemas: jsonb('custom_tool_schemas').default({}),
  createdAt: varchar('created_at', { length: 100 }).default(''),
});

// 7. Audit Logs Table
export const auditLogs = pgTable('audit_logs', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  actorId: varchar('actor_id', { length: 100 }).notNull(),
  action: text('action').notNull(),
  resourceType: varchar('resource_type', { length: 100 }).notNull(),
  resourceId: varchar('resource_id', { length: 100 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  details: text('details'),
  timestamp: varchar('timestamp', { length: 100 }).notNull(),
});

// 8. Tool Calls Table
export const toolCalls = pgTable('tool_calls', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  conversationId: varchar('conversation_id', { length: 100 }),
  scopedToolName: text('scoped_tool_name').notNull(),
  inputParams: jsonb('input_params').default({}),
  outputResult: jsonb('output_result').default({}),
  latencyMs: integer('latency_ms').default(0),
  status: varchar('status', { length: 50 }).notNull(),
  hasSideEffect: boolean('has_side_effect').default(false),
  userConfirmed: boolean('user_confirmed').default(false),
  timestamp: varchar('timestamp', { length: 100 }).notNull(),
});

// 9. Conversations Table
export const conversations = pgTable('conversations', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  title: text('title').notNull(),
  mode: varchar('mode', { length: 50 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  collectionIds: jsonb('collection_ids').default([]),
  enabledMcpServers: jsonb('enabled_mcp_servers').default([]),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
  updatedAt: varchar('updated_at', { length: 100 }).notNull(),
});

// 10. Messages Table
export const messages = pgTable('messages', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  conversationId: varchar('conversation_id', { length: 100 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(),
  content: text('content').notNull(),
  citations: jsonb('citations').default([]),
  modelUsed: varchar('model_used', { length: 100 }),
  tokensUsed: jsonb('tokens_used').default({}),
  feedback: varchar('feedback', { length: 50 }),
  toolCalls: jsonb('tool_calls').default([]),
  hasPiiRedacted: boolean('has_pii_redacted').default(false),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
});
