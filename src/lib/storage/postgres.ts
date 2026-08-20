import {
  Tenant,
  User,
  SessionRecord,
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
    console.warn(
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
    console.error('Failed to initialize PostgreSQL connection pool:', error);
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
    console.log('PostgreSQL Drizzle tables verified, created, and seeded successfully.');
    return;
  } catch (drizzleErr) {
    console.warn('Drizzle migration failed, falling back to legacy SQL setup:', drizzleErr);
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
        console.warn('Postgres ALTER COLUMN migration skipped or failed:', migrateErr);
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
        console.warn('Postgres ALTER users.tenant_id migration skipped or failed:', e);
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

      // Try creating GIN text indexes for English and Arabic FTS
      try {
        await client.query(`
          CREATE INDEX IF NOT EXISTS chunks_content_fts_idx ON chunks 
          USING gin(to_tsvector('english', content));
        `);
      } catch (e) {
        console.warn('FTS index creation skipped or not supported:', e);
      }

      // Btree index on tenant_id for both chunks and documents. Every tenant-
      // scoped query filters by tenant_id; without an index these are full
      // seq-scans. Required in particular by searchPostgresLexical, which now
      // enforces tenant isolation via an explicit `tenant_id = $N` predicate.
      try {
        await client.query(`CREATE INDEX IF NOT EXISTS chunks_tenant_id_idx ON chunks (tenant_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS documents_tenant_id_idx ON documents (tenant_id);`);
      } catch (e) {
        console.warn('tenant_id index creation skipped:', e);
      }

      // Row Level Security is intentionally disabled. Tenant isolation is
      // enforced at the APPLICATION layer: every persistence handler emits an
      // explicit `WHERE tenant_id = $1` predicate and binds the server-derived
      // tenantId (sourced from the authenticated session, never from client
      // input). The README's claim of RLS-backed isolation is therefore
      // aspirational, not deployed. A future hardening pass may enable RLS
      // with `USING (tenant_id = current_setting('app.current_tenant', true))`
      // once every query path sets the session var — re-enabling RLS now
      // without that would silently zero-out all tenant reads.
      try {
        await client.query(`ALTER TABLE documents DISABLE ROW LEVEL SECURITY;`);
        await client.query(`ALTER TABLE chunks DISABLE ROW LEVEL SECURITY;`);
        await client.query(`DROP POLICY IF EXISTS tenant_isolation_documents ON documents;`);
        await client.query(`DROP POLICY IF EXISTS tenant_isolation_chunks ON chunks;`);
      } catch (rlsError) {
        console.warn('RLS cleanup skipped:', rlsError);
      }

      // Seed Initial Data into Postgres
      await seedPostgresData(client);

      initialized = true;
      console.log('PostgreSQL OmniRAG tables verified, created, and seeded successfully.');
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error ensuring PostgreSQL tables exist:', err);
  }
}

async function seedPostgresData(client: any) {
  try {
    // 1. Seed Collections
    const colCountRes = await client.query('SELECT COUNT(*) FROM collections');
    if (parseInt(colCountRes.rows[0].count) === 0) {
      console.log('Seeding initial collections into Postgres...');
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
      console.log('Seeding initial documents into Postgres...');
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
      console.log('Seeding initial chunks into Postgres...');
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
      console.log('Seeding initial MCP servers into Postgres...');
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
      console.log('Seeding initial sources into Postgres...');
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
      console.log('Seeding initial sync logs into Postgres...');
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
      console.log('Seeding initial audit logs into Postgres...');
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
    console.error('Failed to seed Postgres tables:', seedErr);
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
    console.error('Failed to get Postgres documents:', error);
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
    console.error('Failed to get Postgres document by ID:', error);
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
    console.error('Failed to insert document into Postgres:', error);
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
    console.error('Failed to delete document from Postgres:', error);
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
    console.error('Failed to get Postgres chunks:', error);
    throw error;
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
    console.error('Failed to insert chunk into Postgres:', error);
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
    console.error('Failed to get Postgres sources:', error);
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
    console.error('Failed to get Postgres source by ID:', error);
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
    console.error('Failed to insert Postgres source:', error);
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
    console.error('Failed to delete Postgres source:', error);
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
    console.error('Failed to get Postgres sync logs:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function insertPostgresSyncLog(log: SyncLogEntry) {
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
  } catch (error) {
    console.error('Failed to insert Postgres sync log:', error);
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
    console.error('Failed to get Postgres collections:', error);
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
    console.error('Failed to insert Postgres collection:', error);
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
    console.error('Failed to get Postgres MCP servers:', error);
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
    console.error('Failed to insert Postgres MCP server:', error);
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
    console.error('Failed to delete Postgres MCP server:', error);
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
    console.error('Failed to get Postgres audit logs:', error);
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
    console.error('Failed to insert Postgres audit log:', error);
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
    console.error('Failed to get Postgres tool calls:', error);
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
    console.error('Failed to insert Postgres tool call:', error);
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
    console.error('Failed to get Postgres conversations:', error);
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
    console.error('Failed to get Postgres conversation by ID:', error);
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
    console.error('Failed to insert Postgres conversation:', error);
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
    console.error('Failed to delete Postgres conversation:', error);
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
    console.error('Failed to get Postgres messages:', error);
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
    console.error('Failed to insert Postgres message:', error);
  } finally {
    client.release();
  }
}

// Lexical search
export async function searchPostgresLexical(
  queryText: string,
  tenantId: string,
  limitVal: number = 10,
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

    const cleanQuery = queryText.replace(/['"&|!()*:<>\s]+/g, ' ').trim();
    if (!cleanQuery) {
      await client.query('COMMIT');
      return [];
    }

    const ftsQuery = cleanQuery
      .split(' ')
      .map((w) => `${w}:*`)
      .join(' & ');

    let result;
    try {
      const isArabic = /[\u0600-\u06FF]/.test(cleanQuery);
      const dict = isArabic ? 'arabic' : 'english';

      // tenant_id filter is mandatory and authoritative. RLS is disabled at
      // present, so without this predicate the FTS arm would return chunks
      // from ALL tenants — a cross-tenant data leak. Bind tenantId as $3 and
      // push LIMIT to $4.
      result = await client.query(
        `SELECT id, document_id, content, chunk_index, page_number, language,
                ts_rank(to_tsvector($1, content), to_tsquery($1, $2)) as rank
         FROM chunks
         WHERE tenant_id = $3 AND to_tsvector($1, content) @@ to_tsquery($1, $2)
         ORDER BY rank DESC
         LIMIT $4`,
        [dict, ftsQuery, tenantId, limitVal],
      );
    } catch (ftsError) {
      console.warn('FTS query failed, falling back to ILIKE text search:', ftsError);
      // Same mandatory tenant_id predicate on the fallback path.
      result = await client.query(
        `SELECT id, document_id, content, chunk_index, page_number, language,
                1.0 as rank
         FROM chunks
         WHERE tenant_id = $3 AND (content ILIKE $1 OR content ILIKE $2)
         LIMIT $4`,
        [`%${cleanQuery}%`, `%${cleanQuery.split(' ')[0]}%`, tenantId, limitVal],
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
    console.error('PostgreSQL lexical search failed:', error);
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
    console.error('Failed to get Postgres user by email:', error);
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
    console.error('Failed to insert user into Postgres:', error);
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
    console.error('Failed to get Postgres user by id:', error);
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
    console.error('Failed to get Postgres tenant:', error);
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
    console.error('Failed to insert tenant into Postgres:', error);
    throw error;
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
    console.error('Failed to get Postgres session:', error);
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
    console.error('Failed to insert session into Postgres:', error);
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
    console.error('Failed to delete Postgres session:', error);
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
    console.error('Failed to delete expired Postgres sessions:', error);
  } finally {
    client.release();
  }
}
