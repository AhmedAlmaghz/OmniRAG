import pg from 'pg';
const { Pool } = pg;

export async function runMigrations() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    console.warn('PostgreSQL Connection string (DATABASE_URL or POSTGRES_URL) is missing. Skipping migrations.');
    return;
  }

  console.log('Starting PostgreSQL schema migrations...');
  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  const strictTls = process.env.PG_TLS_REJECT_UNAUTHORIZED !== 'false';
  const pool = new Pool({
    connectionString,
    ssl: isLocal ? false : strictTls ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
    max: 1,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    // Ensure documents columns exist
    await client.query(`
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) NOT NULL DEFAULT 'file';
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

    // Ensure chunks columns exist
    await client.query(`
      ALTER TABLE chunks ADD COLUMN IF NOT EXISTS document_title TEXT NOT NULL DEFAULT '';
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

    // Ensure mcp_servers columns exist
    await client.query(`
      ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS created_at VARCHAR(100) DEFAULT '';
    `);

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

    await client.query('COMMIT');
    console.log('PostgreSQL schema migrations completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('PostgreSQL schema migrations failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
