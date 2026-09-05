import {
  Tenant,
  User,
  SessionRecord,
  ApiKeyRecord,
  ProviderCredentialRecord,
  WebhookEndpoint,
  WebhookEventName,
  Document,
  DocumentChunk,
  Collection,
  MCPServerConfig,
  AuditLogEntry,
  SourceConnector,
  SyncLogEntry,
  MCPToolCall,
  Conversation,
  Message,
} from '../types/omnirag';
import {
  INITIAL_COLLECTIONS,
  INITIAL_DOCUMENTS,
  INITIAL_CHUNKS,
  INITIAL_MCP_SERVERS,
  INITIAL_SOURCES,
  INITIAL_SYNC_LOGS,
  INITIAL_AUDIT_LOGS,
} from './constants';
import { migrateAndSeedWithDrizzle } from '../db/migrateAndSeedDrizzle';
import { resetDrizzle } from '../../db';
import pg from 'pg';
const { Pool } = pg;

import { createLogger } from '@/lib/logging/logger';

const log = createLogger('PostgresStorage');

import { getEnv } from '../env/runtimeEnv';
import { DEFAULT_AI_MODELS } from '../config/aiModels';

let pool: any = null;
let initialized = false;

export function resetPostgresPool() {
  if (pool) {
    try {
      pool.end();
    } catch (e) {}
  }
  pool = null;
  initialized = false;
  try {
    resetDrizzle();
  } catch (e) {}
}

export function getPostgresPool(req?: any): any {
  if (typeof window !== 'undefined') return null; // Safe guard for client-side compilation
  if (pool) return pool;

  const connectionString = getEnv('DATABASE_URL', req) || getEnv('POSTGRES_URL', req);
  if (!connectionString) {
    log.warn(
      'PostgreSQL Connection string (DATABASE_URL or POSTGRES_URL) is missing. Postgres storage will be bypassed.',
    );
    return null;
  }

  try {
    const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
    const sslMode = new URL(connectionString).searchParams.get('sslmode');
    const strictTls = process.env.PG_TLS_REJECT_UNAUTHORIZED !== 'false';
    pool = new Pool({
      connectionString,
      // Local dev: no TLS. Managed clouds (Supabase/Neon) advertise their own
      // CA via the driver's bundled certs; only loosen verification when
      // explicitly allowed via env (rare, staged migrations only).
      ssl: isLocal ? false : strictTls ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
    return pool;
  } catch (error) {
    log.error('Failed to initialize PostgreSQL connection pool:', error);
    return null;
  }
}

export async function ensurePostgresTables() {
  if (initialized) return;
  const p = getPostgresPool();
  if (!p) return;

  try {
    await migrateAndSeedWithDrizzle();
    initialized = true;
    log.info('PostgreSQL Drizzle tables verified, created, and seeded successfully.');
    return;
  } catch (drizzleErr) {
    log.warn('Drizzle migration failed, falling back to legacy SQL setup:', drizzleErr);
  }

  try {
    const client = await p.connect();
    try {
      // 1. Documents Table
      await client.query(`
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

      // 2. Chunks Table
      await client.query(`
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

      // 3. Sources Table
      await client.query(`
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

      // 4. Sync Logs Table
      await client.query(`
        CREATE TABLE IF NOT EXISTS sync_logs (
          id VARCHAR(100) PRIMARY KEY,
          tenant_id VARCHAR(100) NOT NULL,
          source_id VARCHAR(100) NOT NULL,
          source_name TEXT NOT NULL,
          status VARCHAR(50) NOT NULL,
          items_processed INT DEFAULT 0,
          duration_ms INT DEFAULT 0,
          message TEXT,
          timestamp VARCHAR(100) NOT NULL
        );
      `);

      // 5. Collections Table
      await client.query(`
        CREATE TABLE IF NOT EXISTS collections (
          id VARCHAR(100) PRIMARY KEY,
          tenant_id VARCHAR(100) NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          document_count INT DEFAULT 0,
          created_at VARCHAR(100) NOT NULL
        );
      `);

      // 6. MCP Servers Table
      await client.query(`
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

      // Run instant migrations to fix any missing columns on existing tables in PostgreSQL
      try {
        await client.query(
          `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) NOT NULL DEFAULT 'file';`,
        );
        await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_count INT DEFAULT 0;`);
        await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS collection_ids JSONB;`);
        await client.query(`ALTER TABLE chunks ADD COLUMN IF NOT EXISTS document_title TEXT NOT NULL DEFAULT '';`);
        await client.query(`ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS created_at VARCHAR(100) DEFAULT '';`);
        await client.query(`ALTER TABLE sources ADD COLUMN IF NOT EXISTS collection_ids JSONB DEFAULT '[]'::jsonb;`);
        await client.query(`ALTER TABLE sources ADD COLUMN IF NOT EXISTS document_count INT DEFAULT 0;`);
        await client.query(`ALTER TABLE collections ADD COLUMN IF NOT EXISTS document_count INT DEFAULT 0;`);
      } catch (migrateErr) {
        log.warn('Postgres ALTER COLUMN migration skipped or failed:', migrateErr);
      }

      // 7. Audit Logs Table
      await client.query(`
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

      // 8. Tool Calls Table
      await client.query(`
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

      // 9. Conversations Table
      await client.query(`
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

      // 10. Messages Table
      await client.query(`
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

      // 11. Auth tables (Postgres-only auth — replaces Firebase Auth)
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(100) PRIMARY KEY,
          email VARCHAR(255) NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          tenant_id VARCHAR(100) NOT NULL,
          created_at VARCHAR(100) NOT NULL
        );
      `);

      // Backfill tenant_id onto any pre-existing users table from a prior
      // deployment. CREATE TABLE IF NOT EXISTS is a no-op when the table
      // already exists, so it wouldn't add the column; this ALTER does. The
      // DEFAULT '' satisfies NOT NULL for legacy rows that had no tenant.
      try {
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT '';`);
      } catch (e) {
        log.warn('Postgres ALTER users.tenant_id migration skipped or failed:', e);
      }

      await client.query(`
        CREATE TABLE IF NOT EXISTS tenants (
          id VARCHAR(100) PRIMARY KEY,
          name VARCHAR(200) NOT NULL,
          plan VARCHAR(50) NOT NULL DEFAULT 'starter',
          created_at VARCHAR(100) NOT NULL,
          settings JSONB
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          token VARCHAR(100) PRIMARY KEY,
          user_id VARCHAR(100) NOT NULL,
          tenant_id VARCHAR(100) NOT NULL,
          expires_at VARCHAR(100) NOT NULL,
          created_at VARCHAR(100) NOT NULL
        );
      `);

      // Try creating GIN text indexes for English and Arabic FTS. The lexical
      // arm picks the dictionary per query language, so BOTH indexes must
      // exist — with only the english index, every Arabic query (the app's
      // primary language) degenerated to a sequential scan.
      try {
        await client.query(`
          CREATE INDEX IF NOT EXISTS chunks_content_fts_idx ON chunks
          USING gin(to_tsvector('english', content));
        `);
        await client.query(`
          CREATE INDEX IF NOT EXISTS chunks_content_fts_arabic_idx ON chunks
          USING gin(to_tsvector('arabic', content));
        `);
        // Version/reindex paths purge chunks by document_id — previously a
        // full tenant scan because only tenant_id was indexed.
        await client.query(`CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks (document_id);`);
      } catch (e) {
        log.warn('FTS index creation skipped or not supported:', e);
      }

      // Btree index on tenant_id for both chunks and documents. Every tenant-
      // scoped query filters by tenant_id; without an index these are full
      // seq-scans. Required in particular by searchPostgresLexical, which now
      // enforces tenant isolation via an explicit `tenant_id = $N` predicate.
      try {
        await client.query(`CREATE INDEX IF NOT EXISTS chunks_tenant_id_idx ON chunks (tenant_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS documents_tenant_id_idx ON documents (tenant_id);`);
      } catch (e) {
        log.warn('tenant_id index creation skipped:', e);
      }

      // Row Level Security policies (v0.12.9): fail-closed second line of
      // defense behind the app-layer `WHERE tenant_id = $N` predicates
      // (server-derived tenantId, never client input — see
      // docs/06-security/overview.md). ENABLE without FORCE keeps the table
      // OWNER (the role the app connects as in every current deployment)
      // bypassing the policies, so behavior is unchanged; the moment a
      // non-owner app role is used the policies activate: rows are visible
      // only when app.current_tenant matches, and an unset var compares NULL
      // → zero rows, never allow-all. Probe contract: `npm run db:verify-rls`.
      try {
        for (const t of ['documents', 'chunks']) {
          await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
          await client.query(`DROP POLICY IF EXISTS tenant_isolation_${t} ON ${t};`);
          await client.query(
            `CREATE POLICY tenant_isolation_${t} ON ${t}
             USING (tenant_id = current_setting('app.current_tenant', true))
             WITH CHECK (tenant_id = current_setting('app.current_tenant', true));`,
          );
        }
      } catch (rlsError) {
        log.warn('RLS policy installation skipped:', rlsError);
      }

      // Seed Initial Data into Postgres
      await seedPostgresData(client);

      initialized = true;
      log.info('PostgreSQL OmniRAG tables verified, created, and seeded successfully.');
    } finally {
      client.release();
    }
  } catch (err) {
    log.error('Error ensuring PostgreSQL tables exist:', err);
  }
}

async function seedPostgresData(client: any) {
  try {
    // 1. Seed Collections
    const colCountRes = await client.query('SELECT COUNT(*) FROM collections');
    if (parseInt(colCountRes.rows[0].count) === 0) {
      log.info('Seeding initial collections into Postgres...');
      for (const col of INITIAL_COLLECTIONS) {
        await client.query(
          `INSERT INTO collections (id, tenant_id, name, description, document_count, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [col.id, col.tenantId, col.name, col.description, col.documentCount, col.createdAt],
        );
      }
    }

    // 2. Seed Documents
    const docCountRes = await client.query('SELECT COUNT(*) FROM documents');
    if (parseInt(docCountRes.rows[0].count) === 0) {
      log.info('Seeding initial documents into Postgres...');
      for (const docObj of INITIAL_DOCUMENTS) {
        await client.query(
          `INSERT INTO documents (id, tenant_id, title, content, source_type, language, status, chunk_count, created_at, metadata, collection_ids)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            docObj.id,
            docObj.tenantId,
            docObj.title,
            docObj.content,
            docObj.sourceType,
            docObj.language,
            docObj.status,
            docObj.chunkCount,
            docObj.createdAt,
            JSON.stringify(docObj.metadata || {}),
            JSON.stringify(docObj.collectionIds || []),
          ],
        );
      }
    }

    // 3. Seed Chunks
    const chunkCountRes = await client.query('SELECT COUNT(*) FROM chunks');
    if (parseInt(chunkCountRes.rows[0].count) === 0) {
      log.info('Seeding initial chunks into Postgres...');
      for (const chunk of INITIAL_CHUNKS) {
        await client.query(
          `INSERT INTO chunks (id, tenant_id, document_id, document_title, content, chunk_index, page_number, language, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            chunk.id,
            chunk.tenantId,
            chunk.documentId,
            chunk.documentTitle,
            chunk.content,
            chunk.chunkIndex,
            chunk.pageNumber || 1,
            chunk.language,
            JSON.stringify(chunk.metadata || {}),
          ],
        );
      }
    }

    // 4. Seed MCP Servers
    const mcpCountRes = await client.query('SELECT COUNT(*) FROM mcp_servers');
    if (parseInt(mcpCountRes.rows[0].count) === 0) {
      log.info('Seeding initial MCP servers into Postgres...');
      for (const s of INITIAL_MCP_SERVERS) {
        await client.query(
          `INSERT INTO mcp_servers (id, tenant_id, name, description, endpoint_url, protocol_version, sandbox_tier, enabled_tools, require_confirmation_tools, status, latency_ms, last_checked, headers, category, url, auth_type, transport_type, config, custom_tool_schemas)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [
            s.id,
            s.tenantId,
            s.name,
            s.description,
            s.endpointUrl,
            s.protocolVersion,
            s.sandboxTier,
            JSON.stringify(s.enabledTools || []),
            JSON.stringify(s.requireConfirmationTools || []),
            s.status,
            s.latencyMs,
            s.lastChecked,
            JSON.stringify(s.headers || {}),
            s.category || '',
            s.url || '',
            s.authType || 'none',
            s.transportType || 'http',
            JSON.stringify(s.config || {}),
            JSON.stringify(s.customToolSchemas || {}),
          ],
        );
      }
    }

    // 5. Seed Sources
    const srcCountRes = await client.query('SELECT COUNT(*) FROM sources');
    if (parseInt(srcCountRes.rows[0].count) === 0) {
      log.info('Seeding initial sources into Postgres...');
      for (const s of INITIAL_SOURCES) {
        await client.query(
          `INSERT INTO sources (id, tenant_id, name, type, status, config, sync_schedule, last_sync_at, document_count, last_error, created_at, collection_ids)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            s.id,
            s.tenantId,
            s.name,
            s.type,
            s.status,
            JSON.stringify(s.config || {}),
            s.syncSchedule || '',
            s.lastSyncAt || '',
            s.documentCount || 0,
            s.lastError || '',
            s.createdAt,
            JSON.stringify(s.collectionIds || []),
          ],
        );
      }
    }

    // 6. Seed Sync Logs
    const syncCountRes = await client.query('SELECT COUNT(*) FROM sync_logs');
    if (parseInt(syncCountRes.rows[0].count) === 0) {
      log.info('Seeding initial sync logs into Postgres...');
      for (const log of INITIAL_SYNC_LOGS) {
        await client.query(
          `INSERT INTO sync_logs (id, tenant_id, source_id, source_name, status, items_processed, duration_ms, message, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            log.id,
            log.tenantId,
            log.sourceId,
            log.sourceName,
            log.status,
            log.itemsProcessed,
            log.durationMs,
            log.message,
            log.timestamp,
          ],
        );
      }
    }

    // 7. Seed Audit Logs
    const auditCountRes = await client.query('SELECT COUNT(*) FROM audit_logs');
    if (parseInt(auditCountRes.rows[0].count) === 0) {
      log.info('Seeding initial audit logs into Postgres...');
      for (const entry of INITIAL_AUDIT_LOGS) {
        await client.query(
          `INSERT INTO audit_logs (id, tenant_id, actor_id, action, resource_type, resource_id, status, details, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            entry.id,
            entry.tenantId,
            entry.actorId,
            entry.action,
            entry.resourceType,
            entry.resourceId,
            entry.status,
            entry.details,
            entry.timestamp,
          ],
        );
      }
    }
  } catch (seedErr) {
    log.error('Failed to seed Postgres tables:', seedErr);
  }
}

// -----------------------------------------------------------------
// Postgres Data Handlers
// -----------------------------------------------------------------

// Documents
export async function getPostgresDocuments(tenantId: string): Promise<Document[]> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];

  const client = await p.connect();
  try {
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const res = await client.query('SELECT * FROM documents WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId]);
    return res.rows.map((row: any) => {
      const meta = row.metadata || {};
      return {
        id: row.id,
        tenantId: row.tenant_id,
        title: row.title,
        content: row.content,
        sourceType: row.source_type,
        language: row.language,
        status: row.status,
        chunkCount: row.chunk_count,
        createdAt: row.created_at,
        updatedAt: meta.updatedAt || row.created_at,
        version: meta.version || row.version || 1,
        versions: meta.versions || [],
        metadata: meta,
        collectionIds: row.collection_ids || [],
      };
    });
  } catch (error) {
    log.error('Failed to get Postgres documents:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPostgresDocumentById(id: string, tenantId: string): Promise<Document | undefined> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return undefined;

  const client = await p.connect();
  try {
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const res = await client.query('SELECT * FROM documents WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (res.rows.length === 0) return undefined;
    const row = res.rows[0];
    const meta = row.metadata || {};
    return {
      id: row.id,
      tenantId: row.tenant_id,
      title: row.title,
      content: row.content,
      sourceType: row.source_type,
      language: row.language,
      status: row.status,
      chunkCount: row.chunk_count,
      createdAt: row.created_at,
      updatedAt: meta.updatedAt || row.created_at,
      version: meta.version || row.version || 1,
      versions: meta.versions || [],
      metadata: meta,
      collectionIds: row.collection_ids || [],
    };
  } catch (error) {
    log.error('Failed to get Postgres document by ID:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function insertPostgresDocument(doc: {
  id: string;
  tenantId: string;
  title: string;
  content: string;
  sourceType?: string;
  language: string;
  status: string;
  chunkCount?: number;
  createdAt: string;
  updatedAt?: string;
  version?: number;
  versions?: any[];
  metadata?: any;
  collectionIds?: string[];
}) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [doc.tenantId]);
    const enrichedMetadata = {
      ...(doc.metadata || {}),
      version: doc.version || 1,
      versions: doc.versions || [],
      updatedAt: doc.updatedAt || doc.createdAt,
    };
    await client.query(
      `INSERT INTO documents (id, tenant_id, title, content, source_type, language, status, chunk_count, created_at, metadata, collection_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE 
       SET title = EXCLUDED.title, content = EXCLUDED.content, source_type = EXCLUDED.source_type,
           language = EXCLUDED.language, status = EXCLUDED.status, chunk_count = EXCLUDED.chunk_count,
           metadata = EXCLUDED.metadata, collection_ids = EXCLUDED.collection_ids;`,
      [
        doc.id,
        doc.tenantId,
        doc.title,
        doc.content,
        doc.sourceType || 'file',
        doc.language,
        doc.status,
        doc.chunkCount || 0,
        doc.createdAt,
        JSON.stringify(enrichedMetadata),
        JSON.stringify(doc.collectionIds || []),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    log.error('Failed to insert document into Postgres:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePostgresDocument(documentId: string, tenantId: string) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    await client.query('DELETE FROM chunks WHERE document_id = $1 AND tenant_id = $2', [documentId, tenantId]);
    await client.query('DELETE FROM documents WHERE id = $1 AND tenant_id = $2', [documentId, tenantId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    log.error('Failed to delete document from Postgres:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Chunks
export async function getPostgresChunks(tenantId: string): Promise<DocumentChunk[]> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];

  const client = await p.connect();
  try {
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const res = await client.query('SELECT * FROM chunks WHERE tenant_id = $1', [tenantId]);
    return res.rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      content: row.content,
      chunkIndex: row.chunk_index,
      pageNumber: row.page_number || 1,
      language: row.language,
      metadata: row.metadata || {},
    }));
  } catch (error) {
    log.error('Failed to get Postgres chunks:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Tenant- and document-scoped chunk fetch with pagination. The documents GET
 * route previously loaded ALL tenant chunks and filtered in JS; the hot
 * (tenant_id, document_id) composite index makes this a single indexed query.
 */
export async function getPostgresChunksByDocument(
  tenantId: string,
  documentId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ chunks: DocumentChunk[]; total: number }> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return { chunks: [], total: 0 };

  const { limit = 200, offset = 0 } = opts;
  const client = await p.connect();
  try {
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const countRes = await client.query(
      'SELECT COUNT(*)::int AS total FROM chunks WHERE tenant_id = $1 AND document_id = $2',
      [tenantId, documentId],
    );
    const res = await client.query(
      'SELECT * FROM chunks WHERE tenant_id = $1 AND document_id = $2 ORDER BY chunk_index ASC LIMIT $3 OFFSET $4',
      [tenantId, documentId, limit, offset],
    );
    return {
      chunks: res.rows.map((row: any) => ({
        id: row.id,
        tenantId: row.tenant_id,
        documentId: row.document_id,
        documentTitle: row.document_title,
        content: row.content,
        chunkIndex: row.chunk_index,
        pageNumber: row.page_number || 1,
        language: row.language,
        metadata: row.metadata || {},
      })),
      total: countRes.rows[0]?.total ?? 0,
    };
  } catch (error) {
    log.error('Failed to get Postgres chunks by document:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete all lexical chunk rows belonging to one document. Used by the
 * version/revert/reindex paths, which replace a document's entire chunk grid:
 * without this, rows from superseded versions accumulate in Postgres forever
 * (the Qdrant side is purged via deleteQdrantDocument).
 */
export async function deletePostgresChunksByDocument(documentId: string, tenantId: string) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    await client.query('DELETE FROM chunks WHERE document_id = $1 AND tenant_id = $2', [documentId, tenantId]);
  } catch (error) {
    log.error('Failed to delete Postgres chunks for document:', error);
  } finally {
    client.release();
  }
}

export async function insertPostgresChunk(chunk: {
  id: string;
  tenantId: string;
  documentId: string;
  documentTitle?: string;
  content: string;
  chunkIndex: number;
  pageNumber: number;
  language: string;
  metadata?: any;
}) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [chunk.tenantId]);
    await client.query(
      `INSERT INTO chunks (id, tenant_id, document_id, document_title, content, chunk_index, page_number, language, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE 
       SET content = EXCLUDED.content, chunk_index = EXCLUDED.chunk_index, 
           document_title = EXCLUDED.document_title,
           page_number = EXCLUDED.page_number, language = EXCLUDED.language, metadata = EXCLUDED.metadata;`,
      [
        chunk.id,
        chunk.tenantId,
        chunk.documentId,
        chunk.documentTitle || '',
        chunk.content,
        chunk.chunkIndex,
        chunk.pageNumber,
        chunk.language,
        JSON.stringify(chunk.metadata || {}),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    log.error('Failed to insert chunk into Postgres:', error);
  } finally {
    client.release();
  }
}

// Sources
export async function getPostgresSources(tenantId: string): Promise<SourceConnector[]> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];

  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM sources WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId]);
    return res.rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      type: row.type,
      status: row.status,
      config: row.config || {},
      syncSchedule: row.sync_schedule || '',
      lastSyncAt: row.last_sync_at || '',
      documentCount: row.document_count || 0,
      lastError: row.last_error || undefined,
      createdAt: row.created_at,
      collectionIds: row.collection_ids || [],
    }));
  } catch (error) {
    log.error('Failed to get Postgres sources:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPostgresSourceById(id: string, tenantId: string): Promise<SourceConnector | undefined> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return undefined;

  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM sources WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (res.rows.length === 0) return undefined;
    const row = res.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      type: row.type,
      status: row.status,
      config: row.config || {},
      syncSchedule: row.sync_schedule || '',
      lastSyncAt: row.last_sync_at || '',
      documentCount: row.document_count || 0,
      lastError: row.last_error || undefined,
      createdAt: row.created_at,
      collectionIds: row.collection_ids || [],
    };
  } catch (error) {
    log.error('Failed to get Postgres source by ID:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Cross-tenant list of connectors that carry a real cron schedule (anything
 * other than 'manual'). Used by the job scheduler to reconcile pg-boss cron
 * entries — returns only the fields scheduling needs, never connector config.
 */
export async function getPostgresScheduledSources(): Promise<
  Array<{ id: string; tenantId: string; syncSchedule: string }>
> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];

  const client = await p.connect();
  try {
    const res = await client.query(
      `SELECT id, tenant_id, sync_schedule FROM sources
       WHERE sync_schedule IS NOT NULL AND sync_schedule <> '' AND sync_schedule <> 'manual'`,
    );
    return res.rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      syncSchedule: row.sync_schedule,
    }));
  } catch (error) {
    log.error('Failed to list scheduled Postgres sources:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function insertPostgresSource(source: SourceConnector) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO sources (id, tenant_id, name, type, status, config, sync_schedule, last_sync_at, document_count, last_error, created_at, collection_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE 
       SET name = EXCLUDED.name, type = EXCLUDED.type, status = EXCLUDED.status, config = EXCLUDED.config,
           sync_schedule = EXCLUDED.sync_schedule, last_sync_at = EXCLUDED.last_sync_at,
           document_count = EXCLUDED.document_count, last_error = EXCLUDED.last_error,
           collection_ids = EXCLUDED.collection_ids;`,
      [
        source.id,
        source.tenantId,
        source.name,
        source.type,
        source.status,
        JSON.stringify(source.config || {}),
        source.syncSchedule || '',
        source.lastSyncAt || '',
        source.documentCount || 0,
        source.lastError || '',
        source.createdAt,
        JSON.stringify(source.collectionIds || []),
      ],
    );
  } catch (error) {
    log.error('Failed to insert Postgres source:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePostgresSource(id: string, tenantId: string) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query('DELETE FROM sources WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  } catch (error) {
    log.error('Failed to delete Postgres source:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Sync Logs
export async function getPostgresSyncLogs(tenantId: string, sourceId?: string): Promise<SyncLogEntry[]> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];

  const client = await p.connect();
  try {
    let queryText = 'SELECT * FROM sync_logs WHERE tenant_id = $1';
    const params = [tenantId];
    if (sourceId) {
      queryText += ' AND source_id = $2';
      params.push(sourceId);
    }
    queryText += ' ORDER BY timestamp DESC';
    const res = await client.query(queryText, params);
    return res.rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      sourceId: row.source_id,
      sourceName: row.source_name,
      status: row.status,
      itemsProcessed: row.items_processed,
      durationMs: row.duration_ms,
      message: row.message || '',
      timestamp: row.timestamp,
    }));
  } catch (error) {
    log.error('Failed to get Postgres sync logs:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function insertPostgresSyncLog(entry: SyncLogEntry) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO sync_logs (id, tenant_id, source_id, source_name, status, items_processed, duration_ms, message, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status, items_processed = EXCLUDED.items_processed,
           duration_ms = EXCLUDED.duration_ms, message = EXCLUDED.message, timestamp = EXCLUDED.timestamp;`,
      [
        entry.id,
        entry.tenantId,
        entry.sourceId,
        entry.sourceName,
        entry.status,
        entry.itemsProcessed,
        entry.durationMs,
        entry.message,
        entry.timestamp,
      ],
    );
  } catch (error) {
    log.error('Failed to insert Postgres sync log:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Collections
export async function getPostgresCollections(tenantId: string): Promise<Collection[]> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];

  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM collections WHERE tenant_id = $1 ORDER BY created_at DESC', [
      tenantId,
    ]);
    return res.rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      description: row.description || '',
      documentCount: row.document_count || 0,
      createdAt: row.created_at,
    }));
  } catch (error) {
    log.error('Failed to get Postgres collections:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function insertPostgresCollection(col: Collection) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO collections (id, tenant_id, name, description, document_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE 
       SET name = EXCLUDED.name, description = EXCLUDED.description, document_count = EXCLUDED.document_count;`,
      [col.id, col.tenantId, col.name, col.description, col.documentCount, col.createdAt],
    );
  } catch (error) {
    log.error('Failed to insert Postgres collection:', error);
    throw error;
  } finally {
    client.release();
  }
}

// MCP Servers
export async function getPostgresMcpServers(tenantId: string): Promise<MCPServerConfig[]> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];

  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM mcp_servers WHERE tenant_id = $1 ORDER BY created_at DESC', [
      tenantId,
    ]);
    return res.rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      description: row.description || '',
      endpointUrl: row.endpoint_url,
      protocolVersion: row.protocol_version,
      sandboxTier: row.sandbox_tier,
      enabledTools: row.enabled_tools || [],
      requireConfirmationTools: row.require_confirmation_tools || [],
      status: row.status,
      latencyMs: row.latency_ms || 0,
      lastChecked: row.last_checked,
      headers: row.headers || {},
      category: row.category || '',
      url: row.url || '',
      authType: row.auth_type || 'none',
      transportType: row.transport_type || 'http',
      config: row.config || {},
      customToolSchemas: row.custom_tool_schemas || {},
    }));
  } catch (error) {
    log.error('Failed to get Postgres MCP servers:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function insertPostgresMcpServer(s: MCPServerConfig) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO mcp_servers (id, tenant_id, name, description, endpoint_url, protocol_version, sandbox_tier, enabled_tools, require_confirmation_tools, status, latency_ms, last_checked, headers, category, url, auth_type, transport_type, config, custom_tool_schemas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (id) DO UPDATE 
       SET name = EXCLUDED.name, description = EXCLUDED.description, endpoint_url = EXCLUDED.endpoint_url,
           protocol_version = EXCLUDED.protocol_version, sandbox_tier = EXCLUDED.sandbox_tier,
           enabled_tools = EXCLUDED.enabled_tools, require_confirmation_tools = EXCLUDED.require_confirmation_tools,
           status = EXCLUDED.status, latency_ms = EXCLUDED.latency_ms, last_checked = EXCLUDED.last_checked,
           headers = EXCLUDED.headers, category = EXCLUDED.category, url = EXCLUDED.url,
           auth_type = EXCLUDED.auth_type, transport_type = EXCLUDED.transport_type,
           config = EXCLUDED.config, custom_tool_schemas = EXCLUDED.custom_tool_schemas;`,
      [
        s.id,
        s.tenantId,
        s.name,
        s.description || '',
        s.endpointUrl,
        s.protocolVersion,
        s.sandboxTier,
        JSON.stringify(s.enabledTools || []),
        JSON.stringify(s.requireConfirmationTools || []),
        s.status,
        s.latencyMs || 0,
        s.lastChecked,
        JSON.stringify(s.headers || {}),
        s.category || '',
        s.url || '',
        s.authType || 'none',
        s.transportType || 'http',
        JSON.stringify(s.config || {}),
        JSON.stringify(s.customToolSchemas || {}),
      ],
    );
  } catch (error) {
    log.error('Failed to insert Postgres MCP server:', error);
  } finally {
    client.release();
  }
}

export async function deletePostgresMcpServer(serverId: string, tenantId: string) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query('DELETE FROM mcp_servers WHERE id = $1 AND tenant_id = $2', [serverId, tenantId]);
  } catch (error) {
    log.error('Failed to delete Postgres MCP server:', error);
  } finally {
    client.release();
  }
}

// Audit Logs
export async function getPostgresAuditLogs(tenantId: string): Promise<AuditLogEntry[]> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];

  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM audit_logs WHERE tenant_id = $1 ORDER BY timestamp DESC', [tenantId]);
    return res.rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      actorId: row.actor_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      status: row.status,
      details: row.details || '',
      timestamp: row.timestamp,
    }));
  } catch (error) {
    log.error('Failed to get Postgres audit logs:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function insertPostgresAuditLog(entry: AuditLogEntry) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO audit_logs (id, tenant_id, actor_id, action, resource_type, resource_id, status, details, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.id,
        entry.tenantId,
        entry.actorId,
        entry.action,
        entry.resourceType,
        entry.resourceId,
        entry.status,
        entry.details || '',
        entry.timestamp,
      ],
    );
  } catch (error) {
    log.error('Failed to insert Postgres audit log:', error);
  } finally {
    client.release();
  }
}

// Tool Calls
export async function getPostgresToolCalls(tenantId: string): Promise<MCPToolCall[]> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];

  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM tool_calls WHERE tenant_id = $1 ORDER BY timestamp DESC', [tenantId]);
    return res.rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      conversationId: row.conversation_id || undefined,
      scopedToolName: row.scoped_tool_name,
      inputParams: row.input_params || {},
      outputResult: row.output_result || undefined,
      latencyMs: row.latency_ms || 0,
      status: row.status,
      hasSideEffect: row.has_side_effect || false,
      userConfirmed: row.user_confirmed || false,
      timestamp: row.timestamp,
    }));
  } catch (error) {
    log.error('Failed to get Postgres tool calls:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function insertPostgresToolCall(tc: MCPToolCall) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO tool_calls (id, tenant_id, conversation_id, scoped_tool_name, input_params, output_result, latency_ms, status, has_side_effect, user_confirmed, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE 
       SET status = EXCLUDED.status, output_result = EXCLUDED.output_result, 
           latency_ms = EXCLUDED.latency_ms, user_confirmed = EXCLUDED.user_confirmed;`,
      [
        tc.id,
        tc.tenantId,
        tc.conversationId || '',
        tc.scopedToolName,
        JSON.stringify(tc.inputParams || {}),
        JSON.stringify(tc.outputResult || {}),
        tc.latencyMs || 0,
        tc.status,
        tc.hasSideEffect || false,
        tc.userConfirmed || false,
        tc.timestamp,
      ],
    );
  } catch (error) {
    log.error('Failed to insert Postgres tool call:', error);
  } finally {
    client.release();
  }
}

// Conversations
export async function getPostgresConversations(tenantId: string): Promise<Conversation[]> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];

  const client = await p.connect();
  try {
    // A single LATERAL join fetches each conversation's first user message so
    // the sidebar can preview the original request without N+1 queries.
    const res = await client.query(
      `SELECT c.*, fum.first_user_message
       FROM conversations c
       LEFT JOIN LATERAL (
         SELECT content AS first_user_message
         FROM messages m
         WHERE m.conversation_id = c.id AND m.tenant_id = c.tenant_id AND m.role = 'user'
         ORDER BY m.created_at ASC
         LIMIT 1
       ) fum ON TRUE
       WHERE c.tenant_id = $1
       ORDER BY c.updated_at DESC`,
      [tenantId],
    );
    return res.rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      title: row.title,
      mode: row.mode,
      model: row.model,
      collectionIds: row.collection_ids || [],
      enabledMcpServers: row.enabled_mcp_servers || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      firstUserMessage: row.first_user_message || undefined,
    }));
  } catch (error) {
    log.error('Failed to get Postgres conversations:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function getPostgresConversationById(id: string, tenantId: string): Promise<Conversation | null> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return null;

  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      title: row.title,
      mode: row.mode,
      model: row.model,
      collectionIds: row.collection_ids || [],
      enabledMcpServers: row.enabled_mcp_servers || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    log.error('Failed to get Postgres conversation by ID:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function insertPostgresConversation(conv: Conversation) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO conversations (id, tenant_id, title, mode, model, collection_ids, enabled_mcp_servers, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE 
       SET title = EXCLUDED.title, mode = EXCLUDED.mode, model = EXCLUDED.model, 
           collection_ids = EXCLUDED.collection_ids, enabled_mcp_servers = EXCLUDED.enabled_mcp_servers,
           updated_at = EXCLUDED.updated_at;`,
      [
        conv.id,
        conv.tenantId,
        conv.title,
        conv.mode,
        conv.model,
        JSON.stringify(conv.collectionIds || []),
        JSON.stringify(conv.enabledMcpServers || []),
        conv.createdAt,
        conv.updatedAt,
      ],
    );
  } catch (error) {
    log.error('Failed to insert Postgres conversation:', error);
  } finally {
    client.release();
  }
}

export async function deletePostgresConversation(id: string, tenantId: string) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM messages WHERE conversation_id = $1 AND tenant_id = $2', [id, tenantId]);
    await client.query('DELETE FROM conversations WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    log.error('Failed to delete Postgres conversation:', error);
  } finally {
    client.release();
  }
}

// Messages
export async function getPostgresMessages(conversationId: string, tenantId: string): Promise<Message[]> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];

  const client = await p.connect();
  try {
    const res = await client.query(
      'SELECT * FROM messages WHERE conversation_id = $1 AND tenant_id = $2 ORDER BY created_at ASC',
      [conversationId, tenantId],
    );
    return res.rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      citations: row.citations || [],
      modelUsed: row.model_used || undefined,
      tokensUsed: row.tokens_used || undefined,
      feedback: row.feedback || undefined,
      toolCalls: row.tool_calls || [],
      hasPiiRedacted: row.has_pii_redacted || false,
      createdAt: row.created_at,
    }));
  } catch (error) {
    log.error('Failed to get Postgres messages:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function insertPostgresMessage(msg: Message) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO messages (id, tenant_id, conversation_id, role, content, citations, model_used, tokens_used, feedback, tool_calls, has_pii_redacted, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE 
       SET feedback = EXCLUDED.feedback, content = EXCLUDED.content;`,
      [
        msg.id,
        msg.tenantId,
        msg.conversationId,
        msg.role,
        msg.content,
        JSON.stringify(msg.citations || []),
        msg.modelUsed || '',
        JSON.stringify(msg.tokensUsed || {}),
        msg.feedback || '',
        JSON.stringify(msg.toolCalls || []),
        msg.hasPiiRedacted || false,
        msg.createdAt,
      ],
    );
  } catch (error) {
    log.error('Failed to insert Postgres message:', error);
  } finally {
    client.release();
  }
}

// Lexical search

/**
 * Light Arabic normalization for the LEXICAL query arm (never applied to
 * stored content): strips diacritics/tatweel and unifies alef/waw-hamza forms
 * so "الأسئلة" matches "الأسئله" and "مُستند" matches "مستند". This closes a
 * real recall gap — hamza/diacritic variants previously missed exact FTS and
 * ILIKE hits.
 */
export function normalizeArabicForSearch(input: string): string {
  return input
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // harakat + dagger alif + tatweel
    .replace(/[\u0622\u0623\u0625\u0627]/g, '\u0627') // آ أ إ ـا → ا
    .replace(/\u0649/g, '\u064A') // ى → ي
    .replace(/\u0624/g, '\u0648'); // ؤ → و
}

export async function searchPostgresLexical(
  queryText: string,
  tenantId: string,
  limitVal: number = 10,
  collectionIds?: string[],
): Promise<
  Array<{
    id: string;
    documentId: string;
    content: string;
    chunkIndex: number;
    pageNumber: number;
    language: string;
    lexicalScore: number;
  }>
> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];
  if (!tenantId) return [];

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    // Kept for forward-compatibility with a future RLS rollout; the ACTUAL
    // tenant isolation here is the explicit `tenant_id = $N` predicate in
    // the queries below, NOT this session variable (RLS is currently
    // disabled — see ensurePostgresTables).
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

    const cleanQuery = normalizeArabicForSearch(queryText)
      .replace(/['"&|!()*:<>\s]+/g, ' ')
      .trim();
    if (!cleanQuery) {
      await client.query('COMMIT');
      return [];
    }

    // FTS matching strategy: OR between query terms, NOT AND. A long natural
    // question ("ما هي الدروس والوحدات التي في كتاب الرياضيات") under AND
    // requires EVERY word to appear in one 1280-char chunk — chapter-title
    // fragments ("الفصل الثالث: النسب") matched almost nothing and the
    // lexical arm collapsed to near-zero recall. OR casts a wide net; the
    // fusion stage (RRF) + optional reranker sort quality afterwards.
    const ftsQuery = cleanQuery
      .split(' ')
      .map((w) => `${w}:*`)
      .join(' | ');

    // Optional collection containment: when the user scoped the chat to
    // specific collections, the lexical arm must honor the same scope as the
    // semantic arm (documents.collection_ids ?| [...]) — otherwise chunks from
    // unselected collections leak into the fused context via the lexical path.
    // Scoped filtering binds its params AFTER the fixed positional contract
    // ($1,$2,$3,$4), so the un-scoped query shape stays byte-identical to the
    // pinned regression contract in lexicalTenantIsolation.test.ts.
    const hasCollectionScope = Array.isArray(collectionIds) && collectionIds.length > 0;
    const collFilter = hasCollectionScope
      ? ` AND document_id IN (
           SELECT id FROM documents WHERE tenant_id = $1 AND collection_ids ?| $5::text[]
         )`
      : '';

    let result;
    try {
      const isArabic = /[\u0600-\u06FF]/.test(cleanQuery);
      const dict = isArabic ? 'arabic' : 'english';

      // tenant_id filter is mandatory and authoritative. RLS is disabled at
      // present, so without this predicate the FTS arm would return chunks
      // from ALL tenants — a cross-tenant data leak.
      //
      // BINDING CONTRACT (regression-tested in lexicalTenantIsolation.test.ts):
      //   $1 = tenantId   $2 = ftsQuery   $3 = dict   $4 = LIMIT
      //   $5 = collectionIds (ONLY when collection-scoped)
      // The v0.12.2 rework accidentally bound `tenant_id = $3` ($3 was the
      // DICT) — every lexical query returned zero rows, silently crippling
      // the lexical arm. A test now asserts the BINDING (params order), not
      // just the SQL text, so this class of mistake can never pass CI again.
      result = await client.query(
        `SELECT id, document_id, content, chunk_index, page_number, language,
                ts_rank(to_tsvector($3, content), to_tsquery($3, $2)) as rank
         FROM chunks
         WHERE tenant_id = $1${collFilter}
           AND to_tsvector($3, content) @@ to_tsquery($3, $2)
         ORDER BY rank DESC
         LIMIT $4`,
        hasCollectionScope ? [tenantId, ftsQuery, dict, limitVal, collectionIds] : [tenantId, ftsQuery, dict, limitVal],
      );
    } catch (ftsError) {
      log.warn('FTS query failed, falling back to ILIKE text search:', ftsError);
      // Same mandatory tenant_id predicate + collection scope on the fallback
      // path (contract: $1/$2=ILIKE patterns, $3=tenant, $4=LIMIT, $5=scope).
      result = await client.query(
        `SELECT id, document_id, content, chunk_index, page_number, language,
                1.0 as rank
         FROM chunks
         WHERE tenant_id = $3
           AND (content ILIKE $1 OR content ILIKE $2)
           ${hasCollectionScope ? 'AND document_id IN (SELECT id FROM documents WHERE tenant_id = $3 AND collection_ids ?| $5::text[])' : ''}
         LIMIT $4`,
        hasCollectionScope
          ? [`%${cleanQuery}%`, `%${cleanQuery.split(' ')[0]}%`, tenantId, limitVal, collectionIds]
          : [`%${cleanQuery}%`, `%${cleanQuery.split(' ')[0]}%`, tenantId, limitVal],
      );
    }

    await client.query('COMMIT');

    return result.rows.map((row: any) => ({
      id: row.id,
      documentId: row.document_id,
      content: row.content,
      chunkIndex: row.chunk_index,
      pageNumber: row.page_number || 1,
      language: row.language,
      lexicalScore: row.rank || 0.5,
    }));
  } catch (error) {
    await client.query('ROLLBACK');
    log.error('PostgreSQL lexical search failed:', error);
    return [];
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------
// Postgres Auth Handlers (Postgres-only auth — replaces Firebase Auth)
// -----------------------------------------------------------------

const DEFAULT_TENANT_SETTINGS = {
  chunkSize: 500,
  chunkOverlap: 50,
  hybridWeights: { semantic: 0.7, lexical: 0.3 },
  defaultModel: DEFAULT_AI_MODELS.chatModel,
  dataRetentionDays: 90,
  enablePiiRedaction: true,
  enablePromptSanitizer: true,
};

export async function getPostgresUserByEmail(email: string): Promise<User | undefined> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return undefined;
  const client = await p.connect();
  try {
    const res = await client.query(
      'SELECT id, email, password_hash, tenant_id, created_at FROM users WHERE email = $1 LIMIT 1',
      [email.toLowerCase()],
    );
    if (res.rows.length === 0) return undefined;
    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      tenantId: row.tenant_id,
      createdAt: row.created_at,
    };
  } catch (error) {
    log.error('Failed to get Postgres user by email:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function insertPostgresUser(user: User): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO users (id, email, password_hash, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING;`,
      [user.id, user.email.toLowerCase(), user.passwordHash, user.tenantId, user.createdAt],
    );
  } catch (error) {
    log.error('Failed to insert user into Postgres:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPostgresUserById(id: string): Promise<User | undefined> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return undefined;
  const client = await p.connect();
  try {
    const res = await client.query(
      'SELECT id, email, password_hash, tenant_id, created_at FROM users WHERE id = $1 LIMIT 1',
      [id],
    );
    if (res.rows.length === 0) return undefined;
    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      tenantId: row.tenant_id,
      createdAt: row.created_at,
    };
  } catch (error) {
    log.error('Failed to get Postgres user by id:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPostgresTenant(tenantId: string): Promise<Tenant | undefined> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return undefined;
  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
    if (res.rows.length === 0) return undefined;
    const row = res.rows[0];
    return {
      id: row.id,
      name: row.name,
      plan: row.plan || 'starter',
      createdAt: row.created_at,
      settings: row.settings || DEFAULT_TENANT_SETTINGS,
    };
  } catch (error) {
    log.error('Failed to get Postgres tenant:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function insertPostgresTenant(tenant: Tenant): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO tenants (id, name, plan, created_at, settings)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, plan = EXCLUDED.plan, settings = EXCLUDED.settings;`,
      [
        tenant.id,
        tenant.name,
        tenant.plan || 'starter',
        tenant.createdAt,
        JSON.stringify(tenant.settings || DEFAULT_TENANT_SETTINGS),
      ],
    );
  } catch (error) {
    log.error('Failed to insert tenant into Postgres:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Finds a tenant that has OIDC SSO enabled and bound to the given email
 * domain. Used by the unauthenticated SSO initiate flow to resolve which
 * workspace a corporate email belongs to. Returns only the tenant id (no
 * settings leak). Scan is bounded by the tenants table size.
 */
export async function findPostgresTenantIdBySsoDomain(domain: string): Promise<string | undefined> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return undefined;
  const client = await p.connect();
  try {
    const res = await client.query(
      `SELECT id FROM tenants
       WHERE settings->'ssoOidc'->>'enabled' = 'true'
         AND lower(settings->'ssoOidc'->>'emailDomain') = lower($1)
       LIMIT 1`,
      [domain],
    );
    return res.rows[0]?.id;
  } catch (error) {
    log.error('Failed to find tenant by SSO domain:', error);
    return undefined;
  } finally {
    client.release();
  }
}

export async function getPostgresSession(token: string): Promise<SessionRecord | undefined> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return undefined;
  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM sessions WHERE token = $1 LIMIT 1', [token]);
    if (res.rows.length === 0) return undefined;
    const row = res.rows[0];
    return {
      token: row.token,
      userId: row.user_id,
      tenantId: row.tenant_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  } catch (error) {
    log.error('Failed to get Postgres session:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function insertPostgresSession(session: SessionRecord): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO sessions (token, user_id, tenant_id, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (token) DO NOTHING;`,
      [session.token, session.userId, session.tenantId, session.expiresAt, session.createdAt],
    );
  } catch (error) {
    log.error('Failed to insert session into Postgres:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePostgresSession(token: string): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query('DELETE FROM sessions WHERE token = $1', [token]);
  } catch (error) {
    log.error('Failed to delete Postgres session:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Deletes every session a user holds for ONE tenant. Used when a member is
 * removed from a workspace: their other workspace sessions stay intact.
 */
export async function deletePostgresSessionsForTenantUser(tenantId: string, userId: string): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query('DELETE FROM sessions WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId]);
  } catch (error) {
    log.error('Failed to delete Postgres sessions for tenant user:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteExpiredPostgresSessions(): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query('DELETE FROM sessions WHERE expires_at < $1', [new Date().toISOString()]);
  } catch (error) {
    log.error('Failed to delete expired Postgres sessions:', error);
  } finally {
    client.release();
  }
}

// --- API keys (headless/external access) -----------------------------------

function mapApiKeyRow(row: any): ApiKeyRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    name: row.name,
    prefix: row.prefix,
    keyHash: row.key_hash,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    rateLimitPerMinute:
      row.rate_limit_per_minute === null || row.rate_limit_per_minute === undefined
        ? null
        : Number(row.rate_limit_per_minute),
    mcpTools: Array.isArray(row.mcp_tools) ? row.mcp_tools : null,
    expiresAt: row.expires_at || null,
    lastUsedAt: row.last_used_at || null,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at,
  };
}

export async function insertPostgresApiKey(key: ApiKeyRecord): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO api_keys (id, tenant_id, user_id, name, prefix, key_hash, scopes, rate_limit_per_minute, mcp_tools, expires_at, last_used_at, revoked_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO NOTHING;`,
      [
        key.id,
        key.tenantId,
        key.userId,
        key.name,
        key.prefix,
        key.keyHash,
        JSON.stringify(key.scopes || []),
        key.rateLimitPerMinute ?? null,
        key.mcpTools ? JSON.stringify(key.mcpTools) : null,
        key.expiresAt,
        key.lastUsedAt,
        key.revokedAt,
        key.createdAt,
      ],
    );
  } catch (error) {
    log.error('Failed to insert Postgres API key:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPostgresApiKeys(tenantId: string): Promise<ApiKeyRecord[]> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId]);
    return res.rows.map(mapApiKeyRow);
  } catch (error) {
    log.error('Failed to list Postgres API keys:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPostgresApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | undefined> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return undefined;
  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM api_keys WHERE key_hash = $1 LIMIT 1', [keyHash]);
    if (res.rows.length === 0) return undefined;
    return mapApiKeyRow(res.rows[0]);
  } catch (error) {
    log.error('Failed to look up Postgres API key by hash:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokePostgresApiKey(id: string, tenantId: string): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query('UPDATE api_keys SET revoked_at = $1 WHERE id = $2 AND tenant_id = $3', [
      new Date().toISOString(),
      id,
      tenantId,
    ]);
  } catch (error) {
    log.error('Failed to revoke Postgres API key:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function touchPostgresApiKeyLastUsed(id: string, timestamp: string): Promise<void> {
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query('UPDATE api_keys SET last_used_at = $1 WHERE id = $2', [timestamp, id]);
  } catch (error) {
    // Best-effort stamp — never fail the auth path over telemetry.
    log.warn('Failed to stamp API key last_used_at:', (error as Error)?.message);
  } finally {
    client.release();
  }
}

// --- Webhook endpoints (Phase 6 — outbound event notifications) -------------

function mapWebhookEndpointRow(row: any): WebhookEndpoint {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    url: row.url,
    secretEncrypted: row.secret,
    events: Array.isArray(row.events) ? (row.events as WebhookEventName[]) : [],
    enabled: row.enabled !== false,
    lastDeliveryAt: row.last_delivery_at || null,
    lastDeliveryStatus:
      row.last_delivery_status === 'success' || row.last_delivery_status === 'failed' ? row.last_delivery_status : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertPostgresWebhookEndpoint(endpoint: WebhookEndpoint): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO webhook_endpoints (id, tenant_id, name, url, secret, events, enabled, last_delivery_at, last_delivery_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING;`,
      [
        endpoint.id,
        endpoint.tenantId,
        endpoint.name,
        endpoint.url,
        endpoint.secretEncrypted,
        JSON.stringify(endpoint.events || []),
        endpoint.enabled,
        endpoint.lastDeliveryAt,
        endpoint.lastDeliveryStatus,
        endpoint.createdAt,
        endpoint.updatedAt,
      ],
    );
  } catch (error) {
    log.error('Failed to insert Postgres webhook endpoint:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPostgresWebhookEndpoints(tenantId: string): Promise<WebhookEndpoint[]> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at DESC', [
      tenantId,
    ]);
    return res.rows.map(mapWebhookEndpointRow);
  } catch (error) {
    log.error('Failed to list Postgres webhook endpoints:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPostgresWebhookEndpointById(
  id: string,
  tenantId: string,
): Promise<WebhookEndpoint | undefined> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return undefined;
  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2 LIMIT 1', [
      id,
      tenantId,
    ]);
    return res.rows[0] ? mapWebhookEndpointRow(res.rows[0]) : undefined;
  } catch (error) {
    log.error('Failed to fetch Postgres webhook endpoint:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePostgresWebhookEndpoint(
  id: string,
  tenantId: string,
  patch: Partial<
    Pick<
      WebhookEndpoint,
      'name' | 'url' | 'secretEncrypted' | 'events' | 'enabled' | 'lastDeliveryAt' | 'lastDeliveryStatus'
    >
  >,
): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) sets.push(`name = $${values.push(patch.name)}`);
  if (patch.url !== undefined) sets.push(`url = $${values.push(patch.url)}`);
  if (patch.secretEncrypted !== undefined) sets.push(`secret = $${values.push(patch.secretEncrypted)}`);
  if (patch.events !== undefined) sets.push(`events = $${values.push(JSON.stringify(patch.events))}`);
  if (patch.enabled !== undefined) sets.push(`enabled = $${values.push(patch.enabled)}`);
  if (patch.lastDeliveryAt !== undefined) sets.push(`last_delivery_at = $${values.push(patch.lastDeliveryAt)}`);
  if (patch.lastDeliveryStatus !== undefined)
    sets.push(`last_delivery_status = $${values.push(patch.lastDeliveryStatus)}`);
  if (sets.length === 0) return;
  sets.push(`updated_at = $${values.push(new Date().toISOString())}`);
  values.push(id, tenantId);
  const client = await p.connect();
  try {
    await client.query(
      `UPDATE webhook_endpoints SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND tenant_id = $${values.length}`,
      values,
    );
  } catch (error) {
    log.error('Failed to update Postgres webhook endpoint:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePostgresWebhookEndpoint(id: string, tenantId: string): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query('DELETE FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  } catch (error) {
    log.error('Failed to delete Postgres webhook endpoint:', error);
    throw error;
  } finally {
    client.release();
  }
}

// --- Provider credentials (per-tenant AI provider keys, encrypted) ----------

function mapProviderCredentialRow(row: any): ProviderCredentialRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    providerId: row.provider_id,
    credentials: row.credentials || {},
    baseUrl: row.base_url || '',
    enabled: row.enabled !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertPostgresProviderCredentials(record: ProviderCredentialRecord): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query(
      `INSERT INTO provider_credentials (id, tenant_id, provider_id, credentials, base_url, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, provider_id) DO UPDATE
       SET credentials = EXCLUDED.credentials,
           base_url = EXCLUDED.base_url,
           enabled = EXCLUDED.enabled,
           updated_at = EXCLUDED.updated_at;`,
      [
        record.id,
        record.tenantId,
        record.providerId,
        JSON.stringify(record.credentials || {}),
        record.baseUrl || null,
        record.enabled !== false,
        record.createdAt,
        record.updatedAt,
      ],
    );
  } catch (error) {
    log.error('Failed to upsert Postgres provider credentials:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPostgresProviderCredentials(
  tenantId: string,
  providerId: string,
): Promise<ProviderCredentialRecord | undefined> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return undefined;
  const client = await p.connect();
  try {
    const res = await client.query(
      'SELECT * FROM provider_credentials WHERE tenant_id = $1 AND provider_id = $2 LIMIT 1',
      [tenantId, providerId],
    );
    if (res.rows.length === 0) return undefined;
    return mapProviderCredentialRow(res.rows[0]);
  } catch (error) {
    log.error('Failed to get Postgres provider credentials:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPostgresProviderCredentialsList(tenantId: string): Promise<ProviderCredentialRecord[]> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    const res = await client.query('SELECT * FROM provider_credentials WHERE tenant_id = $1 ORDER BY provider_id', [
      tenantId,
    ]);
    return res.rows.map(mapProviderCredentialRow);
  } catch (error) {
    log.error('Failed to list Postgres provider credentials:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePostgresProviderCredentials(tenantId: string, providerId: string): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query('DELETE FROM provider_credentials WHERE tenant_id = $1 AND provider_id = $2', [
      tenantId,
      providerId,
    ]);
  } catch (error) {
    log.error('Failed to delete Postgres provider credentials:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePostgresTenantSettings(tenantId: string, settingsJson: string): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query('UPDATE tenants SET settings = $1 WHERE id = $2', [settingsJson, tenantId]);
  } catch (error) {
    log.error('Failed to update Postgres tenant settings:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePostgresTenantPlan(tenantId: string, plan: string): Promise<void> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await client.query('UPDATE tenants SET plan = $1 WHERE id = $2', [plan, tenantId]);
  } catch (error) {
    log.error('Failed to update Postgres tenant plan:', error);
    throw error;
  } finally {
    client.release();
  }
}
