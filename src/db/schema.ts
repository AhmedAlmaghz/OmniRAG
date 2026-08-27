import { pgTable, varchar, text, integer, jsonb, boolean } from 'drizzle-orm/pg-core';

/**
 * TIMESTAMP STORAGE — documented engineering decision (not an accident).
 *
 * All temporal columns are `varchar(100)` holding ISO-8601 UTC strings
 * produced exclusively by `new Date().toISOString()` (always `…Z`, fixed
 * width). For that uniform format, lexicographic ordering IS chronological
 * ordering, so the few SQL-level comparisons (e.g.
 * `DELETE FROM sessions WHERE expires_at < $1::text`) and every JS-side
 * `new Date(x)` sort remain correct.
 *
 * Migrating to `timestamptz` would be the more idiomatic choice and unlocks
 * SQL-side temporal indexes/intervals, but it requires converting ~20 columns
 * AND changing every read/write helper in lib/storage/postgres.ts (the driver
 * would return Date objects where ISO strings are expected today). That is a
 * dedicated migration with its own test pass — do not "fix" these columns
 * piecemeal; either migrate all of them together or leave this contract intact.
 */

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
  documentCount: integer('document_count').default(0),
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

// 11. Users Table (Postgres-only auth — replaces Firebase Auth)
export const users = pgTable('users', {
  id: varchar('id', { length: 100 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
});

// 12. Tenants Table (owns tenant identity — was a string convention before)
export const tenants = pgTable('tenants', {
  id: varchar('id', { length: 100 }).primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  plan: varchar('plan', { length: 50 }).notNull().default('starter'),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
  settings: jsonb('settings'),
});

// 13. Sessions Table (opaque session token — never a JWT)
export const sessions = pgTable('sessions', {
  token: varchar('token', { length: 100 }).primaryKey(),
  userId: varchar('user_id', { length: 100 }).notNull(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  expiresAt: varchar('expires_at', { length: 100 }).notNull(),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
});

// 14. API Keys Table (headless/external access — REST + outbound MCP)
// Only the SHA-256 hash of the full key is stored; the plaintext is shown
// once at creation. Lookup hashes the presented Bearer key and matches keyHash.
export const apiKeys = pgTable('api_keys', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  userId: varchar('user_id', { length: 100 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  prefix: varchar('prefix', { length: 30 }).notNull(),
  keyHash: varchar('key_hash', { length: 100 }).notNull(),
  scopes: jsonb('scopes').default([]),
  rateLimitPerMinute: integer('rate_limit_per_minute'),
  mcpTools: jsonb('mcp_tools'),
  expiresAt: varchar('expires_at', { length: 100 }),
  lastUsedAt: varchar('last_used_at', { length: 100 }),
  revokedAt: varchar('revoked_at', { length: 100 }),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
});

// 15. Provider Credentials Table (per-tenant AI provider keys, encrypted)
// `credentials` values are AES-256-GCM ciphertext (encryptToken format).
export const providerCredentials = pgTable('provider_credentials', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  providerId: varchar('provider_id', { length: 100 }).notNull(),
  credentials: jsonb('credentials').default({}),
  baseUrl: text('base_url'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
  updatedAt: varchar('updated_at', { length: 100 }).notNull(),
});

// 16. Memberships Table (Phase 5 — user ↔ tenant + role)
// A user may belong to many tenants; the session's tenantId picks the active
// one. role ∈ owner|admin|editor|viewer (see lib/auth/permissions.ts).
export const memberships = pgTable('memberships', {
  id: varchar('id', { length: 100 }).primaryKey(),
  userId: varchar('user_id', { length: 100 }).notNull(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  role: varchar('role', { length: 20 }).notNull().default('viewer'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  invitedBy: varchar('invited_by', { length: 100 }),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
});

// 17. Invitations Table (Phase 5 — email + token + expiry)
// status ∈ pending|accepted|revoked|expired. token is CSPRNG-random and
// single-use; accepting it converts the invitation into a membership.
export const invitations = pgTable('invitations', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 20 }).notNull().default('viewer'),
  token: varchar('token', { length: 100 }).notNull(),
  invitedBy: varchar('invited_by', { length: 100 }).notNull(),
  expiresAt: varchar('expires_at', { length: 100 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
});

// 18. Teams Table (Phase 5)
export const teams = pgTable('teams', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
});

// 19. Team Members Table (Phase 5)
export const teamMembers = pgTable('team_members', {
  id: varchar('id', { length: 100 }).primaryKey(),
  teamId: varchar('team_id', { length: 100 }).notNull(),
  userId: varchar('user_id', { length: 100 }).notNull(),
  addedBy: varchar('added_by', { length: 100 }),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
});

// 20. Resource Shares Table (Phase 5)
// Grants a user or team read/edit on a specific resource (collection,
// conversation, document) independent of their tenant-wide role. linkToken,
// when set, enables an unauthenticated read-only share link (/api/v1/share).
export const resourceShares = pgTable('resource_shares', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }).notNull(),
  resourceId: varchar('resource_id', { length: 100 }).notNull(),
  granteeType: varchar('grantee_type', { length: 20 }).notNull(),
  granteeId: varchar('grantee_id', { length: 100 }).notNull(),
  permission: varchar('permission', { length: 20 }).notNull().default('read'),
  linkToken: varchar('link_token', { length: 100 }),
  sharedBy: varchar('shared_by', { length: 100 }).notNull(),
  expiresAt: varchar('expires_at', { length: 100 }),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
});

// 21. SSO OIDC Flows Table (Phase 5 — short-lived authorization state)
// One row per in-flight OIDC authorization code + PKCE flow; consumed on
// callback and garbage-collected by expiry.
export const ssoFlows = pgTable('sso_flows', {
  state: varchar('state', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  codeVerifier: varchar('code_verifier', { length: 200 }).notNull(),
  redirectUri: text('redirect_uri').notNull(),
  expiresAt: varchar('expires_at', { length: 100 }).notNull(),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
});

// 22. Webhook Endpoints Table (Phase 6 — outbound event notifications)
// `secret` holds AES-256-GCM ciphertext (encryptToken format) of the HMAC
// signing secret; decrypt only on the dispatch path, never serialize out.
export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: varchar('id', { length: 100 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 100 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: jsonb('events').default([]),
  enabled: boolean('enabled').notNull().default(true),
  lastDeliveryAt: varchar('last_delivery_at', { length: 100 }),
  lastDeliveryStatus: varchar('last_delivery_status', { length: 20 }),
  createdAt: varchar('created_at', { length: 100 }).notNull(),
  updatedAt: varchar('updated_at', { length: 100 }).notNull(),
});
