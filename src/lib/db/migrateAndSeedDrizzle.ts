import { getDrizzle } from '../../db';
import { collections, documents, chunks, mcpServers, sources, auditLogs } from '../../db/schema';
import {
  INITIAL_COLLECTIONS,
  INITIAL_DOCUMENTS,
  INITIAL_CHUNKS,
  INITIAL_MCP_SERVERS,
  INITIAL_SOURCES,
  INITIAL_AUDIT_LOGS,
} from '../storage/constants';
import { getOwnerPool } from '../storage/postgres';
import { createLogger } from '@/lib/logging/logger';

const log = createLogger('DrizzleMigrate');

/**
 * DDL statements per multi-statement round-trip. 46 statements at 12 per
 * batch = 4 round-trips instead of 46 (see the ddl() collector below).
 */
const DDL_BATCH_SIZE = 12;

/**
 * Schema revision for the DDL batch below. Bump whenever the DDL changes;
 * already-migrated databases then re-run the full pass once and stamp the new
 * revision. The revision marker makes cold starts a single SELECT instead of
 * the full 4-round-trip DDL transaction.
 */
const SCHEMA_REVISION = '2026-09-05-rls-activation';

/**
 * RLS activation DDL (v0.12.10) — ONE source of truth shared by the Drizzle
 * path (batched below) and the legacy fallback in postgres.ts (per-statement).
 * Idempotent everywhere: ENABLE + DROP/CREATE POLICY, role creation guarded,
 * grants re-asserted, functions CREATE OR REPLACE'd.
 *
 * `omnirag_app` is the least-privilege runtime role (DATABASE_APP_URL): being
 * non-owner, the policies apply to every runtime query. The ten SECURITY
 * DEFINER functions are the ONLY sanctioned cross-tenant paths — owner-owned,
 * search_path pinned, not executable by PUBLIC, each limited to a single
 * statement scoped to the caller's own credential (hash/token/state/id).
 */
const RLS_TABLES = [
  'documents',
  'chunks',
  'sources',
  'sync_logs',
  'collections',
  'mcp_servers',
  'audit_logs',
  'tool_calls',
  'conversations',
  'messages',
  'api_keys',
  'provider_credentials',
  'memberships',
  'invitations',
  'teams',
  'resource_shares',
  'sso_flows',
  'webhook_endpoints',
  'usage_counters',
];

export const TENANT_RLS_DDL: string[] = (() => {
  const stmts: string[] = [];
  for (const t of RLS_TABLES) {
    stmts.push(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_${t} ON ${t};
CREATE POLICY tenant_isolation_${t} ON ${t}
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));`);
  }
  stmts.push(`DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnirag_app') THEN
    CREATE ROLE omnirag_app NOLOGIN;
  END IF;
END $$;`);
  stmts.push(`GRANT USAGE ON SCHEMA public TO omnirag_app;`);
  stmts.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO omnirag_app;`);
  // Future tables (e.g. pgvector's dynamic vector_chunks) inherit the grants
  // automatically for tables created by THIS role (the owner).
  stmts.push(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omnirag_app;`);
  const definer = (sql: string, signature: string) => {
    stmts.push(sql);
    stmts.push(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
    stmts.push(`GRANT EXECUTE ON FUNCTION ${signature} TO omnirag_app;`);
  };
  definer(
    `CREATE OR REPLACE FUNCTION omnirag_get_api_key_by_hash(p_key_hash text)
  RETURNS SETOF api_keys LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $fn$ SELECT * FROM api_keys WHERE key_hash = p_key_hash LIMIT 1 $fn$;`,
    'omnirag_get_api_key_by_hash(text)',
  );
  definer(
    `CREATE OR REPLACE FUNCTION omnirag_touch_api_key_last_used(p_id text, p_ts text)
  RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
  AS $fn$ UPDATE api_keys SET last_used_at = p_ts WHERE id = p_id $fn$;`,
    'omnirag_touch_api_key_last_used(text, text)',
  );
  definer(
    `CREATE OR REPLACE FUNCTION omnirag_list_scheduled_sources()
  RETURNS TABLE(id text, tenant_id text, sync_schedule text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $fn$
    SELECT s.id, s.tenant_id, s.sync_schedule FROM sources s
    WHERE s.sync_schedule IS NOT NULL AND s.sync_schedule <> '' AND s.sync_schedule <> 'manual'
  $fn$;`,
    'omnirag_list_scheduled_sources()',
  );
  definer(
    `CREATE OR REPLACE FUNCTION omnirag_list_user_memberships(p_user_id text)
  RETURNS SETOF memberships LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $fn$ SELECT * FROM memberships WHERE user_id = p_user_id $fn$;`,
    'omnirag_list_user_memberships(text)',
  );
  definer(
    `CREATE OR REPLACE FUNCTION omnirag_get_invitation_by_token(p_token text)
  RETURNS SETOF invitations LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $fn$ SELECT * FROM invitations WHERE token = p_token $fn$;`,
    'omnirag_get_invitation_by_token(text)',
  );
  definer(
    `CREATE OR REPLACE FUNCTION omnirag_list_pending_invitations_by_email(p_email text)
  RETURNS SETOF invitations LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $fn$ SELECT * FROM invitations
    WHERE email = lower(p_email) AND status = 'pending' AND expires_at > to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $fn$;`,
    'omnirag_list_pending_invitations_by_email(text)',
  );
  definer(
    `CREATE OR REPLACE FUNCTION omnirag_set_invitation_status(p_id text, p_status text)
  RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
  AS $fn$ UPDATE invitations SET status = p_status WHERE id = p_id $fn$;`,
    'omnirag_set_invitation_status(text, text)',
  );
  definer(
    `CREATE OR REPLACE FUNCTION omnirag_get_share_by_link_token(p_token text)
  RETURNS SETOF resource_shares LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $fn$ SELECT * FROM resource_shares WHERE link_token = p_token $fn$;`,
    'omnirag_get_share_by_link_token(text)',
  );
  definer(
    `CREATE OR REPLACE FUNCTION omnirag_consume_sso_flow(p_state text)
  RETURNS SETOF sso_flows LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
  AS $fn$ DELETE FROM sso_flows WHERE state = p_state RETURNING * $fn$;`,
    'omnirag_consume_sso_flow(text)',
  );
  definer(
    `CREATE OR REPLACE FUNCTION omnirag_purge_expired_sso_flows(p_now text)
  RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
  AS $fn$ DELETE FROM sso_flows WHERE expires_at <= p_now $fn$;`,
    'omnirag_purge_expired_sso_flows(text)',
  );
  return stmts;
})();

/** Gives omnirag_app login capability when APP_DB_PASSWORD is configured. */
export async function applyAppRoleLoginPassword(client: any): Promise<void> {
  const appDbPassword = process.env.APP_DB_PASSWORD;
  if (!appDbPassword) return;
  // %L safely quotes; $1 needs an explicit type inside format().
  const stmt = await client.query(
    `SELECT format('ALTER ROLE omnirag_app WITH LOGIN PASSWORD %L', $1::text) AS sql`,
    [appDbPassword],
  );
  await client.query(stmt.rows[0].sql);
  log.info('[Drizzle] omnirag_app login credential applied (APP_DB_PASSWORD).');
}

export async function migrateAndSeedWithDrizzle() {
  // Migrations and seeding ALWAYS run on the owner connection — the runtime
  // app role (DATABASE_APP_URL) must never own tables, or it would bypass RLS.
  const pool = getOwnerPool();
  if (!pool) {
    log.warn('[Drizzle] Postgres is not configured. Skipping Drizzle migrations and seeding.');
    return;
  }

  // Fast path: one indexed SELECT. On serverless every cold start re-ran the
  // full 47-statement DDL transaction (~4 round-trips) just to verify what was
  // already there; the revision row lets identical schema deployments skip it.
  try {
    const meta = await pool.query(`SELECT 1 FROM schema_meta WHERE key = 'schema_revision' AND value = $1 LIMIT 1`, [
      SCHEMA_REVISION,
    ]);
    if (meta.rowCount === 1) return;
  } catch {
    // Table missing on first boot — fall through to the full migration, which
    // creates schema_meta below.
  }

  log.info('[Drizzle] Initializing database migration with Drizzle ORM...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Serverless hardening: collect the DDL and execute it as a few
    // multi-statement batches instead of ~50 individually awaited queries.
    // node-postgres does NOT pipeline queued simple queries — each awaited
    // statement pays a full client↔pooler round-trip (~180 ms to Neon), so the
    // sequential version measures 10+ seconds on a cold start, blowing the
    // ensureSeeded() init budget and demoting the instance to the in-memory
    // fallback (401s) or leaving the transaction uncommitted when the function
    // freezes (403s). Semicolon-joined statements travel in one message and run
    // sequentially inside the same transaction, so BEGIN/DDL/COMMIT semantics
    // are unchanged at a fraction of the round-trips.
    const ddlStatements: string[] = [];
    const ddl = (sql: string) => {
      ddlStatements.push(sql);
    };

    // 1. Drizzle Schema Tables Creation (Ensuring all exists)
    ddl(`
      CREATE TABLE IF NOT EXISTS collections (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        document_count INT DEFAULT 0,
        created_at VARCHAR(100) NOT NULL
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS documents (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source_type VARCHAR(50) NOT NULL DEFAULT 'file',
        language VARCHAR(10) NOT NULL,
        status VARCHAR(50) NOT NULL,
        chunk_count INT DEFAULT 0,
        created_at VARCHAR(100) NOT NULL,
        metadata JSONB,
        collection_ids JSONB
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS chunks (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        document_id VARCHAR(100) NOT NULL,
        document_title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        chunk_index INT NOT NULL,
        page_number INT DEFAULT 1,
        language VARCHAR(10) NOT NULL,
        metadata JSONB
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS sources (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        name TEXT NOT NULL,
        type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        config JSONB DEFAULT '{}'::jsonb,
        sync_schedule VARCHAR(100),
        last_sync_at VARCHAR(100),
        document_count INT DEFAULT 0,
        last_error TEXT,
        created_at VARCHAR(100) NOT NULL,
        collection_ids JSONB DEFAULT '[]'::jsonb
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        endpoint_url TEXT NOT NULL,
        protocol_version VARCHAR(50) NOT NULL,
        sandbox_tier VARCHAR(50) NOT NULL,
        enabled_tools JSONB DEFAULT '[]'::jsonb,
        require_confirmation_tools JSONB DEFAULT '[]'::jsonb,
        status VARCHAR(50) NOT NULL,
        latency_ms INT DEFAULT 0,
        last_checked VARCHAR(100) NOT NULL,
        headers JSONB DEFAULT '{}'::jsonb,
        category VARCHAR(100),
        url TEXT,
        auth_type VARCHAR(50),
        transport_type VARCHAR(50),
        config JSONB DEFAULT '{}'::jsonb,
        custom_tool_schemas JSONB DEFAULT '{}'::jsonb,
        created_at VARCHAR(100) DEFAULT ''
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        actor_id VARCHAR(100) NOT NULL,
        action TEXT NOT NULL,
        resource_type VARCHAR(100) NOT NULL,
        resource_id VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        details TEXT,
        timestamp VARCHAR(100) NOT NULL
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS tool_calls (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        conversation_id VARCHAR(100),
        scoped_tool_name TEXT NOT NULL,
        input_params JSONB DEFAULT '{}'::jsonb,
        output_result JSONB DEFAULT '{}'::jsonb,
        latency_ms INT DEFAULT 0,
        status VARCHAR(50) NOT NULL,
        has_side_effect BOOLEAN DEFAULT FALSE,
        user_confirmed BOOLEAN DEFAULT FALSE,
        timestamp VARCHAR(100) NOT NULL
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS conversations (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        title TEXT NOT NULL,
        mode VARCHAR(50) NOT NULL,
        model VARCHAR(100) NOT NULL,
        collection_ids JSONB DEFAULT '[]'::jsonb,
        enabled_mcp_servers JSONB DEFAULT '[]'::jsonb,
        created_at VARCHAR(100) NOT NULL,
        updated_at VARCHAR(100) NOT NULL
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        conversation_id VARCHAR(100) NOT NULL,
        role VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        citations JSONB DEFAULT '[]'::jsonb,
        model_used VARCHAR(100),
        tokens_used JSONB DEFAULT '{}'::jsonb,
        feedback VARCHAR(50),
        tool_calls JSONB DEFAULT '[]'::jsonb,
        has_pii_redacted BOOLEAN DEFAULT FALSE,
        created_at VARCHAR(100) NOT NULL
      );
    `);

    // Auth tables (Postgres-only auth — replaces Firebase Auth)
    ddl(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(100) PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        tenant_id VARCHAR(100) NOT NULL,
        created_at VARCHAR(100) NOT NULL
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS tenants (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        plan VARCHAR(50) NOT NULL DEFAULT 'starter',
        created_at VARCHAR(100) NOT NULL,
        settings JSONB
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS sessions (
        token VARCHAR(100) PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        tenant_id VARCHAR(100) NOT NULL,
        expires_at VARCHAR(100) NOT NULL,
        created_at VARCHAR(100) NOT NULL
      );
    `);

    // Platform tables (Phase 0): headless API keys + per-tenant AI provider
    // credentials. key_hash is the SHA-256 of the full key — plaintext is
    // never persisted. provider_credentials values are AES-256-GCM ciphertext.
    ddl(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        user_id VARCHAR(100) NOT NULL,
        name VARCHAR(200) NOT NULL,
        prefix VARCHAR(30) NOT NULL,
        key_hash VARCHAR(100) NOT NULL,
        scopes JSONB DEFAULT '[]'::jsonb,
        rate_limit_per_minute INTEGER,
        mcp_tools JSONB,
        expires_at VARCHAR(100),
        last_used_at VARCHAR(100),
        revoked_at VARCHAR(100),
        created_at VARCHAR(100) NOT NULL
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS provider_credentials (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        provider_id VARCHAR(100) NOT NULL,
        credentials JSONB DEFAULT '{}'::jsonb,
        base_url TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at VARCHAR(100) NOT NULL,
        updated_at VARCHAR(100) NOT NULL
      );
    `);

    // Teams, memberships, invitations, resource shares and SSO flows (Phase 5).
    // Timestamps stay varchar(100) ISO strings per the documented convention.
    ddl(`
      CREATE TABLE IF NOT EXISTS memberships (
        id VARCHAR(100) PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        tenant_id VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'viewer',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        invited_by VARCHAR(100),
        created_at VARCHAR(100) NOT NULL
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS invitations (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'viewer',
        token VARCHAR(100) NOT NULL,
        invited_by VARCHAR(100) NOT NULL,
        expires_at VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at VARCHAR(100) NOT NULL
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS teams (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        created_at VARCHAR(100) NOT NULL
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS team_members (
        id VARCHAR(100) PRIMARY KEY,
        team_id VARCHAR(100) NOT NULL,
        user_id VARCHAR(100) NOT NULL,
        added_by VARCHAR(100),
        created_at VARCHAR(100) NOT NULL
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS resource_shares (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        resource_type VARCHAR(50) NOT NULL,
        resource_id VARCHAR(100) NOT NULL,
        grantee_type VARCHAR(20) NOT NULL,
        grantee_id VARCHAR(100) NOT NULL,
        permission VARCHAR(20) NOT NULL DEFAULT 'read',
        link_token VARCHAR(100),
        shared_by VARCHAR(100) NOT NULL,
        expires_at VARCHAR(100),
        created_at VARCHAR(100) NOT NULL
      );
    `);

    ddl(`
      CREATE TABLE IF NOT EXISTS sso_flows (
        state VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        code_verifier VARCHAR(200) NOT NULL,
        redirect_uri TEXT NOT NULL,
        expires_at VARCHAR(100) NOT NULL,
        created_at VARCHAR(100) NOT NULL
      );
    `);

    // Outbound webhooks (Phase 6). `secret` stores AES-256-GCM ciphertext of
    // the HMAC signing secret (encryptToken format) — never plaintext.
    ddl(`
      CREATE TABLE IF NOT EXISTS webhook_endpoints (
        id VARCHAR(100) PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        name VARCHAR(200) NOT NULL,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events JSONB DEFAULT '[]'::jsonb,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        last_delivery_at VARCHAR(100),
        last_delivery_status VARCHAR(20),
        created_at VARCHAR(100) NOT NULL,
        updated_at VARCHAR(100) NOT NULL
      );
    `);

    // Inbound Bearer auth hashes the presented key and looks up key_hash —
    // without an index every API request would seq-scan the table. The
    // (tenant_id, provider_id) unique index enforces one credential row per
    // provider per tenant (upsert semantics in the credentials service).
    ddl(`CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys (key_hash);`);
    ddl(`CREATE INDEX IF NOT EXISTS api_keys_tenant_id_idx ON api_keys (tenant_id);`);
    ddl(`CREATE INDEX IF NOT EXISTS webhook_endpoints_tenant_id_idx ON webhook_endpoints (tenant_id);`);
    ddl(`CREATE UNIQUE INDEX IF NOT EXISTS provider_credentials_tenant_provider_idx
       ON provider_credentials (tenant_id, provider_id);`);

    // Phase 5 indexes: membership resolution runs on EVERY authenticated
    // request (resolveRole), so both lookup directions must be indexed.
    ddl(`CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_tenant_idx ON memberships (user_id, tenant_id);`);
    ddl(`CREATE INDEX IF NOT EXISTS memberships_tenant_id_idx ON memberships (tenant_id);`);
    ddl(`CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_idx ON invitations (token);`);
    ddl(`CREATE INDEX IF NOT EXISTS invitations_tenant_id_idx ON invitations (tenant_id);`);
    ddl(`CREATE INDEX IF NOT EXISTS teams_tenant_id_idx ON teams (tenant_id);`);
    ddl(`CREATE UNIQUE INDEX IF NOT EXISTS team_members_team_user_idx ON team_members (team_id, user_id);`);
    ddl(`CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON team_members (user_id);`);
    ddl(`CREATE UNIQUE INDEX IF NOT EXISTS resource_shares_grant_idx
       ON resource_shares (resource_type, resource_id, grantee_type, grantee_id);`);
    ddl(`CREATE INDEX IF NOT EXISTS resource_shares_tenant_id_idx ON resource_shares (tenant_id);`);
    ddl(`CREATE UNIQUE INDEX IF NOT EXISTS resource_shares_link_token_idx
       ON resource_shares (link_token) WHERE link_token IS NOT NULL;`);

    // Durable rate-limit windows: the in-memory limiter is per-process, so on
    // serverless the effective limit is N× instances and every cold start
    // wipes the counters (brute-force/share-token abuse). One upsert per
    // request, atomic via the single-statement CASE below. Timestamps follow
    // the repo-wide varchar(ISO-8601) convention (see schema.ts header).
    ddl(`
      CREATE TABLE IF NOT EXISTS rate_limit_windows (
        bucket_id VARCHAR(300) PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 1,
        window_start VARCHAR(100) NOT NULL
      );
    `);
    ddl(`CREATE INDEX IF NOT EXISTS rate_limit_windows_window_start_idx ON rate_limit_windows (window_start);`);

    // Cold-start fast-path marker (see SCHEMA_REVISION above): stamped after a
    // successful full pass, checked before every subsequent run.
    ddl(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key VARCHAR(100) PRIMARY KEY,
        value VARCHAR(200) NOT NULL
      );
    `);

    // Monthly per-tenant token accounting (Phase 4): plan budgets are enforced
    // against this counter — a single atomic upsert per completion, no locks.
    // period is 'YYYY-MM'; the row is deleted/rewritten when the month rolls.
    ddl(`
      CREATE TABLE IF NOT EXISTS usage_counters (
        tenant_id VARCHAR(100) NOT NULL,
        period VARCHAR(7) NOT NULL,
        tokens_used BIGINT NOT NULL DEFAULT 0,
        updated_at VARCHAR(100) NOT NULL,
        PRIMARY KEY (tenant_id, period)
      );
    `);

    // Ensure all Drizzle-specific table schema upgrades (missing columns) are fully processed
    ddl(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) NOT NULL DEFAULT 'file';`);
    ddl(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_count INT DEFAULT 0;`);
    ddl(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS collection_ids JSONB;`);
    ddl(`ALTER TABLE chunks ADD COLUMN IF NOT EXISTS document_title TEXT NOT NULL DEFAULT '';`);
    ddl(`ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS created_at VARCHAR(100) DEFAULT '';`);
    ddl(`ALTER TABLE sources ADD COLUMN IF NOT EXISTS collection_ids JSONB DEFAULT '[]'::jsonb;`);
    ddl(`ALTER TABLE sources ADD COLUMN IF NOT EXISTS document_count INT DEFAULT 0;`);
    ddl(`ALTER TABLE collections ADD COLUMN IF NOT EXISTS document_count INT DEFAULT 0;`);
    // Phase 6: per-API-key rate limit ceiling (requests/minute; NULL = default)
    // and outbound MCP tool whitelist (NULL = all tenant tools).
    ddl(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER;`);
    ddl(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS mcp_tools JSONB;`);
    // Backfill tenant_id onto any pre-existing users table from a prior
    // deployment — CREATE TABLE IF NOT EXISTS won't add the column if the
    // table already exists. DEFAULT '' satisfies NOT NULL for legacy rows.
    ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT '';`);

    // ── Performance indexes (Phase 4 audit) ─────────────────────────────────
    // Lexical search runs `to_tsvector($1, content) @@ to_tsquery($1, $2)`
    // with $1 ∈ {arabic, english}; without a matching expression index the
    // planner seq-scans every tenant chunk per query. One GIN index per
    // dictionary config keeps the expression byte-identical so the planner
    // can use it.
    ddl(`CREATE INDEX IF NOT EXISTS chunks_fts_arabic_gin
         ON chunks USING gin (to_tsvector('arabic'::regconfig, content));`);
    ddl(`CREATE INDEX IF NOT EXISTS chunks_fts_english_gin
         ON chunks USING gin (to_tsvector('english'::regconfig, content));`);
    // Hot-path composite: nearly every chunk query filters both dimensions.
    ddl(`CREATE INDEX IF NOT EXISTS chunks_tenant_document_idx ON chunks (tenant_id, document_id);`);
    // Conversation history ordering (list conversations, latest messages).
    ddl(`CREATE INDEX IF NOT EXISTS messages_tenant_conversation_idx
         ON messages (tenant_id, conversation_id);`);

    // ── RLS activation (v0.12.10) — shared single source of truth ────────
    TENANT_RLS_DDL.forEach((stmt) => ddl(stmt));

    // One round-trip per batch; Postgres executes the joined statements
    // sequentially and aborts the whole transaction on the first error.
    for (let i = 0; i < ddlStatements.length; i += DDL_BATCH_SIZE) {
      await client.query(ddlStatements.slice(i, i + DDL_BATCH_SIZE).join('\n'));
    }
    // Give omnirag_app login capability when APP_DB_PASSWORD is configured
    // (docker compose sets it; managed-cloud operators create the role
    // themselves with LOGIN instead).
    await applyAppRoleLoginPassword(client);
    // Stamp the revision INSIDE the transaction: a failed DDL batch rolls the
    // stamp back too, so the next cold start retries instead of skipping.
    await client.query(
      `INSERT INTO schema_meta (key, value) VALUES ('schema_revision', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [SCHEMA_REVISION],
    );
    await client.query('COMMIT');
    log.info('[Drizzle] Schema tables validated and migrated successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    log.error('[Drizzle] Schema migrations failed:', error);
    throw error;
  } finally {
    client.release();
  }

  // 2. Drizzle ORM Seeding Implementation
  try {
    const db = getDrizzle();

    // Seed all tables concurrently: the inserts target independent tables and
    // are idempotent (onConflictDoNothing), so they share no ordering
    // constraint — and each sequentially awaited insert cost another full
    // pooler round-trip (~2.5 s of the cold-start budget).
    const seedOps: PromiseLike<unknown>[] = [];

    log.info('[Drizzle] Seeding initial collections...');
    if (INITIAL_COLLECTIONS.length > 0) {
      seedOps.push(
        db
          .insert(collections)
          .values(
            INITIAL_COLLECTIONS.map((col) => ({
              id: col.id,
              tenantId: col.tenantId,
              name: col.name,
              description: col.description || '',
              documentCount: col.documentCount || 0,
              createdAt: col.createdAt,
            })),
          )
          .onConflictDoNothing(),
      );
    }

    log.info('[Drizzle] Seeding initial documents...');
    if (INITIAL_DOCUMENTS.length > 0) {
      seedOps.push(
        db
          .insert(documents)
          .values(
            INITIAL_DOCUMENTS.map((docObj) => ({
              id: docObj.id,
              tenantId: docObj.tenantId,
              title: docObj.title,
              content: docObj.content,
              sourceType: docObj.sourceType || 'file',
              language: docObj.language,
              status: docObj.status,
              chunkCount: docObj.chunkCount || 0,
              createdAt: docObj.createdAt,
              metadata: docObj.metadata || {},
              collectionIds: docObj.collectionIds || [],
            })),
          )
          .onConflictDoNothing(),
      );
    }

    log.info('[Drizzle] Seeding initial chunks...');
    if (INITIAL_CHUNKS.length > 0) {
      seedOps.push(
        db
          .insert(chunks)
          .values(
            INITIAL_CHUNKS.map((chunk) => ({
              id: chunk.id,
              tenantId: chunk.tenantId,
              documentId: chunk.documentId,
              documentTitle: chunk.documentTitle || '',
              content: chunk.content,
              chunkIndex: chunk.chunkIndex,
              pageNumber: chunk.pageNumber || 1,
              language: chunk.language,
              metadata: chunk.metadata || {},
            })),
          )
          .onConflictDoNothing(),
      );
    }

    log.info('[Drizzle] Seeding initial MCP servers...');
    if (INITIAL_MCP_SERVERS.length > 0) {
      seedOps.push(
        db
          .insert(mcpServers)
          .values(
            INITIAL_MCP_SERVERS.map((s) => ({
              id: s.id,
              tenantId: s.tenantId,
              name: s.name,
              description: s.description || '',
              endpointUrl: s.endpointUrl,
              protocolVersion: s.protocolVersion,
              sandboxTier: s.sandboxTier,
              enabledTools: s.enabledTools || [],
              requireConfirmationTools: s.requireConfirmationTools || [],
              status: s.status,
              latencyMs: s.latencyMs || 0,
              lastChecked: s.lastChecked,
              headers: s.headers || {},
              category: s.category || '',
              url: s.url || '',
              authType: s.authType || 'none',
              transportType: s.transportType || 'http',
              config: s.config || {},
              customToolSchemas: s.customToolSchemas || {},
              createdAt: '',
            })),
          )
          .onConflictDoNothing(),
      );
    }

    log.info('[Drizzle] Seeding initial sources...');
    if (INITIAL_SOURCES.length > 0) {
      seedOps.push(
        db
          .insert(sources)
          .values(
            INITIAL_SOURCES.map((s) => ({
              id: s.id,
              tenantId: s.tenantId,
              name: s.name,
              type: s.type,
              status: s.status,
              config: s.config || {},
              syncSchedule: s.syncSchedule || '',
              lastSyncAt: s.lastSyncAt || '',
              documentCount: s.documentCount || 0,
              lastError: s.lastError || '',
              createdAt: s.createdAt,
              collectionIds: s.collectionIds || [],
            })),
          )
          .onConflictDoNothing(),
      );
    }

    log.info('[Drizzle] Seeding initial audit logs...');
    if (INITIAL_AUDIT_LOGS.length > 0) {
      seedOps.push(
        db
          .insert(auditLogs)
          .values(
            INITIAL_AUDIT_LOGS.map((log) => ({
              id: log.id,
              tenantId: log.tenantId,
              actorId: log.actorId,
              action: log.action,
              resourceType: log.resourceType,
              resourceId: log.resourceId,
              status: log.status,
              details: log.details || '',
              timestamp: log.timestamp,
            })),
          )
          .onConflictDoNothing(),
      );
    }

    await Promise.all(seedOps);
    log.info('[Drizzle] Database seeding and schema migrations complete.');
  } catch (seedErr) {
    log.error('[Drizzle] Seeding failed:', seedErr);
    throw seedErr;
  }
}
