import { getDrizzle } from '../../db';
import { 
  collections, 
  documents, 
  chunks, 
  mcpServers, 
  sources, 
  auditLogs 
} from '../../db/schema';
import { 
  INITIAL_COLLECTIONS, 
  INITIAL_DOCUMENTS, 
  INITIAL_CHUNKS, 
  INITIAL_MCP_SERVERS, 
  INITIAL_SOURCES, 
  INITIAL_AUDIT_LOGS 
} from '../storage/constants';
import { getPostgresPool } from '../storage/postgres';

export async function migrateAndSeedWithDrizzle() {
  const pool = getPostgresPool();
  if (!pool) {
    console.warn('[Drizzle] Postgres is not configured. Skipping Drizzle migrations and seeding.');
    return;
  }

  console.log('[Drizzle] Initializing database migration with Drizzle ORM...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Drizzle Schema Tables Creation (Ensuring all exists)
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
        next_sync_at VARCHAR(100),
        document_count INT DEFAULT 0,
        total_bytes BIGINT DEFAULT 0,
        last_error TEXT,
        created_at VARCHAR(100) NOT NULL,
        collection_ids JSONB DEFAULT '[]'::jsonb
      );
    `);

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

    // Ensure all Drizzle-specific table schema upgrades (missing columns) are fully processed
    await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) NOT NULL DEFAULT 'file';`);
    await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_count INT DEFAULT 0;`);
    await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS collection_ids JSONB;`);
    await client.query(`ALTER TABLE chunks ADD COLUMN IF NOT EXISTS document_title TEXT NOT NULL DEFAULT '';`);
    await client.query(`ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS created_at VARCHAR(100) DEFAULT '';`);
    await client.query(`ALTER TABLE sources ADD COLUMN IF NOT EXISTS collection_ids JSONB DEFAULT '[]'::jsonb;`);
    await client.query(`ALTER TABLE sources ADD COLUMN IF NOT EXISTS document_count INT DEFAULT 0;`);
    await client.query(`ALTER TABLE sources ADD COLUMN IF NOT EXISTS next_sync_at VARCHAR(100);`);
    await client.query(`ALTER TABLE sources ADD COLUMN IF NOT EXISTS total_bytes BIGINT DEFAULT 0;`);
    await client.query(`ALTER TABLE collections ADD COLUMN IF NOT EXISTS document_count INT DEFAULT 0;`);

    await client.query('COMMIT');
    console.log('[Drizzle] Schema tables validated and migrated successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Drizzle] Schema migrations failed:', error);
    throw error;
  } finally {
    client.release();
  }

  // 2. Drizzle ORM Seeding Implementation
  try {
    const db = getDrizzle();
    console.log('[Drizzle] Seeding initial collections...');
    for (const col of INITIAL_COLLECTIONS) {
      await db.insert(collections).values({
        id: col.id,
        tenantId: col.tenantId,
        name: col.name,
        description: col.description || '',
        documentCount: col.documentCount || 0,
        createdAt: col.createdAt,
      }).onConflictDoNothing();
    }

    console.log('[Drizzle] Seeding initial documents...');
    for (const docObj of INITIAL_DOCUMENTS) {
      await db.insert(documents).values({
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
      }).onConflictDoNothing();
    }

    console.log('[Drizzle] Seeding initial chunks...');
    for (const chunk of INITIAL_CHUNKS) {
      await db.insert(chunks).values({
        id: chunk.id,
        tenantId: chunk.tenantId,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle || '',
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber || 1,
        language: chunk.language,
        metadata: chunk.metadata || {},
      }).onConflictDoNothing();
    }

    console.log('[Drizzle] Seeding initial MCP servers...');
    for (const s of INITIAL_MCP_SERVERS) {
      await db.insert(mcpServers).values({
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
      }).onConflictDoNothing();
    }

    console.log('[Drizzle] Seeding initial sources...');
    for (const s of INITIAL_SOURCES) {
      await db.insert(sources).values({
        id: s.id,
        tenantId: s.tenantId,
        name: s.name,
        type: s.type,
        status: s.status,
        config: s.config || {},
        syncSchedule: s.syncSchedule || '',
        lastSyncAt: s.lastSyncAt || '',
        nextSyncAt: s.nextSyncAt || null,
        documentCount: s.documentCount || 0,
        totalBytes: s.totalBytes || 0,
        lastError: s.lastError || '',
        createdAt: s.createdAt,
        collectionIds: s.collectionIds || [],
      }).onConflictDoNothing();
    }

    console.log('[Drizzle] Seeding initial audit logs...');
    for (const log of INITIAL_AUDIT_LOGS) {
      await db.insert(auditLogs).values({
        id: log.id,
        tenantId: log.tenantId,
        actorId: log.actorId,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        status: log.status,
        details: log.details || '',
        timestamp: log.timestamp,
      }).onConflictDoNothing();
    }

    console.log('[Drizzle] Database seeding and schema migrations complete.');
  } catch (seedErr) {
    console.error('[Drizzle] Seeding failed:', seedErr);
    throw seedErr;
  }
}
