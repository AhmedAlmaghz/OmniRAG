import {
  pgTable,
  varchar,
  text,
  integer,
  bigint,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
 *
 * SINGLE SOURCE OF TRUTH — this file is the canonical schema. The runtime
 * migrator (src/lib/db/migrateAndSeedDrizzle.ts) and the standalone SQL script
 * (scripts/manual-migration.sql) are both derived from it; when you change a
 * table here, regenerate the baseline migration (npx drizzle-kit generate)
 * and keep the manual script in sync.
 */

// 1. Documents Table
export const documents = pgTable(
  'documents',
  {
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
  },
  (table) => [
    // Every tenant-scoped query filters by tenant_id; without an index these
    // are full seq-scans (also created by the legacy fallback in postgres.ts).
    index('documents_tenant_id_idx').on(table.tenantId),
  ],
);

// 2. Chunks Table
export const chunks = pgTable(
  'chunks',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 100 }).notNull(),
    documentId: varchar('document_id', { length: 100 }).notNull(),
    documentTitle: text('document_title').notNull().default(''),
    content: text('content').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    pageNumber: integer('page_number').default(1),
    language: varchar('language', { length: 10 }).notNull(),
    metadata: jsonb('metadata'),
  },
  (table) => [
    index('chunks_tenant_id_idx').on(table.tenantId),
    // Version/reindex paths purge chunks by document_id — previously a full
    // tenant scan because only tenant_id was indexed.
    index('chunks_document_id_idx').on(table.documentId),
    // Hot-path composite: nearly every chunk query filters both dimensions.
    index('chunks_tenant_document_idx').on(table.tenantId, table.documentId),
    // Lexical search runs `to_tsvector($1, content) @@ to_tsquery($1, $2)`
    // with $1 ∈ {arabic, english}; without a matching expression index the
    // planner seq-scans every tenant chunk per query. One GIN index per
    // dictionary config keeps the expression byte-identical so the planner
    // can use it.
    index('chunks_fts_english_gin').using('gin', sql`to_tsvector('english'::regconfig, content)`),
    index('chunks_fts_arabic_gin').using('gin', sql`to_tsvector('arabic'::regconfig, content)`),
  ],
);

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
export const messages = pgTable(
  'messages',
  {
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
  },
  (table) => [
    // Conversation history ordering (list conversations, latest messages).
    index('messages_tenant_conversation_idx').on(table.tenantId, table.conversationId),
  ],
);

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
export const apiKeys = pgTable(
  'api_keys',
  {
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
  },
  (table) => [
    // Inbound Bearer auth hashes the presented key and looks up key_hash —
    // without an index every API request would seq-scan the table.
    index('api_keys_key_hash_idx').on(table.keyHash),
    index('api_keys_tenant_id_idx').on(table.tenantId),
  ],
);

// 15. Provider Credentials Table (per-tenant AI provider keys, encrypted)
// `credentials` values are AES-256-GCM ciphertext (encryptToken format).
export const providerCredentials = pgTable(
  'provider_credentials',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 100 }).notNull(),
    providerId: varchar('provider_id', { length: 100 }).notNull(),
    credentials: jsonb('credentials').default({}),
    baseUrl: text('base_url'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: varchar('created_at', { length: 100 }).notNull(),
    updatedAt: varchar('updated_at', { length: 100 }).notNull(),
  },
  (table) => [
    // Enforces one credential row per provider per tenant (upsert semantics
    // in the credentials service).
    uniqueIndex('provider_credentials_tenant_provider_idx').on(table.tenantId, table.providerId),
  ],
);

// 16. Memberships Table (Phase 5 — user ↔ tenant + role)
// A user may belong to many tenants; the session's tenantId picks the active
// one. role ∈ owner|admin|editor|viewer (see lib/auth/permissions.ts).
export const memberships = pgTable(
  'memberships',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    userId: varchar('user_id', { length: 100 }).notNull(),
    tenantId: varchar('tenant_id', { length: 100 }).notNull(),
    role: varchar('role', { length: 20 }).notNull().default('viewer'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    invitedBy: varchar('invited_by', { length: 100 }),
    createdAt: varchar('created_at', { length: 100 }).notNull(),
  },
  (table) => [
    // Membership resolution runs on EVERY authenticated request (resolveRole),
    // so both lookup directions must be indexed.
    uniqueIndex('memberships_user_tenant_idx').on(table.userId, table.tenantId),
    index('memberships_tenant_id_idx').on(table.tenantId),
  ],
);

// 17. Invitations Table (Phase 5 — email + token + expiry)
// status ∈ pending|accepted|revoked|expired. token is CSPRNG-random and
// single-use; accepting it converts the invitation into a membership.
export const invitations = pgTable(
  'invitations',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 100 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    role: varchar('role', { length: 20 }).notNull().default('viewer'),
    token: varchar('token', { length: 100 }).notNull(),
    invitedBy: varchar('invited_by', { length: 100 }).notNull(),
    expiresAt: varchar('expires_at', { length: 100 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    createdAt: varchar('created_at', { length: 100 }).notNull(),
  },
  (table) => [
    uniqueIndex('invitations_token_idx').on(table.token),
    index('invitations_tenant_id_idx').on(table.tenantId),
  ],
);

// 18. Teams Table (Phase 5)
export const teams = pgTable(
  'teams',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    createdAt: varchar('created_at', { length: 100 }).notNull(),
  },
  (table) => [index('teams_tenant_id_idx').on(table.tenantId)],
);

// 19. Team Members Table (Phase 5)
export const teamMembers = pgTable(
  'team_members',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    teamId: varchar('team_id', { length: 100 }).notNull(),
    userId: varchar('user_id', { length: 100 }).notNull(),
    addedBy: varchar('added_by', { length: 100 }),
    createdAt: varchar('created_at', { length: 100 }).notNull(),
  },
  (table) => [
    uniqueIndex('team_members_team_user_idx').on(table.teamId, table.userId),
    index('team_members_user_id_idx').on(table.userId),
  ],
);

// 20. Resource Shares Table (Phase 5)
// Grants a user or team read/edit on a specific resource (collection,
// conversation, document) independent of their tenant-wide role. linkToken,
// when set, enables an unauthenticated read-only share link (/api/v1/share).
export const resourceShares = pgTable(
  'resource_shares',
  {
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
  },
  (table) => [
    uniqueIndex('resource_shares_grant_idx').on(
      table.resourceType,
      table.resourceId,
      table.granteeType,
      table.granteeId,
    ),
    index('resource_shares_tenant_id_idx').on(table.tenantId),
    uniqueIndex('resource_shares_link_token_idx')
      .on(table.linkToken)
      .where(sql`link_token IS NOT NULL`),
  ],
);

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
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
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
  },
  (table) => [index('webhook_endpoints_tenant_id_idx').on(table.tenantId)],
);

// 23. Rate Limit Windows Table (durable per-process rate limiting)
// The in-memory limiter is per-process, so on serverless the effective limit
// is N× instances and every cold start wipes the counters (brute-force /
// share-token abuse). One atomic upsert per request via the single-statement
// CASE in lib/security/durableRateLimiter.ts. Timestamps follow the repo-wide
// varchar(ISO-8601) convention (see header).
export const rateLimitWindows = pgTable(
  'rate_limit_windows',
  {
    bucketId: varchar('bucket_id', { length: 300 }).primaryKey(),
    count: integer('count').notNull().default(1),
    windowStart: varchar('window_start', { length: 100 }).notNull(),
  },
  (table) => [index('rate_limit_windows_window_start_idx').on(table.windowStart)],
);

// 24. Schema Meta Table (cold-start fast-path marker)
// migrateAndSeedWithDrizzle() stamps `schema_revision` after a successful
// full DDL pass and checks it before every subsequent run — one indexed
// SELECT instead of a multi-round-trip DDL transaction on every cold start.
export const schemaMeta = pgTable('schema_meta', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: varchar('value', { length: 200 }).notNull(),
});

// 25. Usage Counters Table (monthly per-tenant token accounting, Phase 4)
// Plan budgets are enforced against this counter — a single atomic upsert
// per completion, no locks. period is 'YYYY-MM'; the row is deleted/rewritten
// when the month rolls.
export const usageCounters = pgTable(
  'usage_counters',
  {
    tenantId: varchar('tenant_id', { length: 100 }).notNull(),
    period: varchar('period', { length: 7 }).notNull(),
    tokensUsed: bigint('tokens_used', { mode: 'number' }).notNull().default(0),
    updatedAt: varchar('updated_at', { length: 100 }).notNull(),
  },
  (table) => [
    // Composite PK — one counter row per tenant per month.
    primaryKey({ columns: [table.tenantId, table.period] }),
  ],
);
