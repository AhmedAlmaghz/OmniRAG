let pool: any = null;
let initialized = false;

export function getPostgresPool(): any {
  if (typeof window !== 'undefined') return null; // Safe guard for client-side compilation
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    console.warn('PostgreSQL Connection string (DATABASE_URL or POSTGRES_URL) is missing. Postgres Lexical search will be bypassed.');
    return null;
  }

  try {
    const pg = require('pg');
    const { Pool } = pg;
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false, // Required for secure Neon connections
      },
      max: 10,
      idleTimeoutMillis: 30000,
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
    const client = await p.connect();
    try {
      // Create schema if not exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS documents (
          id VARCHAR(100) PRIMARY KEY,
          tenant_id VARCHAR(100) NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          language VARCHAR(10) NOT NULL,
          status VARCHAR(50) NOT NULL,
          created_at VARCHAR(100) NOT NULL,
          metadata JSONB
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS chunks (
          id VARCHAR(100) PRIMARY KEY,
          tenant_id VARCHAR(100) NOT NULL,
          document_id VARCHAR(100) NOT NULL,
          content TEXT NOT NULL,
          chunk_index INT NOT NULL,
          page_number INT DEFAULT 1,
          language VARCHAR(10) NOT NULL,
          metadata JSONB
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

      initialized = true;
      console.log('PostgreSQL OmniRAG tables verified/created successfully.');
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error ensuring PostgreSQL tables exist:', err);
  }
}

export async function insertPostgresDocument(doc: {
  id: string;
  tenantId: string;
  title: string;
  content: string;
  language: string;
  status: string;
  createdAt: string;
  metadata?: any;
}) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  try {
    await p.query(
      `INSERT INTO documents (id, tenant_id, title, content, language, status, created_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE 
       SET title = EXCLUDED.title, content = EXCLUDED.content, language = EXCLUDED.language, 
           status = EXCLUDED.status, metadata = EXCLUDED.metadata;`,
      [doc.id, doc.tenantId, doc.title, doc.content, doc.language, doc.status, doc.createdAt, JSON.stringify(doc.metadata || {})]
    );
  } catch (error) {
    console.error('Failed to insert document into Postgres:', error);
  }
}

export async function insertPostgresChunk(chunk: {
  id: string;
  tenantId: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  pageNumber: number;
  language: string;
  metadata?: any;
}) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  try {
    await p.query(
      `INSERT INTO chunks (id, tenant_id, document_id, content, chunk_index, page_number, language, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE 
       SET content = EXCLUDED.content, chunk_index = EXCLUDED.chunk_index, 
           page_number = EXCLUDED.page_number, language = EXCLUDED.language, metadata = EXCLUDED.metadata;`,
      [chunk.id, chunk.tenantId, chunk.documentId, chunk.content, chunk.chunkIndex, chunk.pageNumber, chunk.language, JSON.stringify(chunk.metadata || {})]
    );
  } catch (error) {
    console.error('Failed to insert chunk into Postgres:', error);
  }
}

export async function deletePostgresDocument(documentId: string, tenantId: string) {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return;

  try {
    await p.query('DELETE FROM chunks WHERE document_id = $1 AND tenant_id = $2', [documentId, tenantId]);
    await p.query('DELETE FROM documents WHERE id = $1 AND tenant_id = $2', [documentId, tenantId]);
  } catch (error) {
    console.error('Failed to delete document from Postgres:', error);
  }
}

export async function searchPostgresLexical(
  queryText: string,
  tenantId: string,
  limitVal: number = 10
): Promise<Array<{
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  pageNumber: number;
  language: string;
  lexicalScore: number;
}>> {
  await ensurePostgresTables();
  const p = getPostgresPool();
  if (!p) return [];

  try {
    // We clean query text from special TSQuery characters to prevent syntax errors
    const cleanQuery = queryText.replace(/['"&|!()*:<>\s]+/g, ' ').trim();
    if (!cleanQuery) return [];

    // Format for English/Arabic full-text-search match
    // Fallback: ILIKE matching if tsquery is too restrictive
    const ftsQuery = cleanQuery.split(' ').map(w => `${w}:*`).join(' & ');

    let result;
    try {
      // First attempt: FTS using to_tsvector with english or arabic dictionary depending on content/query
      const isArabic = /[\u0600-\u06FF]/.test(cleanQuery);
      const dict = isArabic ? 'arabic' : 'english';

      result = await p.query(
        `SELECT id, document_id, content, chunk_index, page_number, language,
                ts_rank(to_tsvector($1, content), to_tsquery($1, $2)) as rank
         FROM chunks
         WHERE tenant_id = $3 AND to_tsvector($1, content) @@ to_tsquery($1, $2)
         ORDER BY rank DESC
         LIMIT $4`,
        [dict, ftsQuery, tenantId, limitVal]
      );
    } catch (ftsError) {
      console.warn('FTS query failed, falling back to ILIKE text search:', ftsError);
      // Fallback query: ILIKE or standard rank using substring occurrences
      result = await p.query(
        `SELECT id, document_id, content, chunk_index, page_number, language,
                1.0 as rank
         FROM chunks
         WHERE tenant_id = $1 AND (content ILIKE $2 OR content ILIKE $3)
         LIMIT $4`,
        [tenantId, `%${cleanQuery}%`, `%${cleanQuery.split(' ')[0]}%`, limitVal]
      );
    }

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
    console.error('PostgreSQL lexical search failed:', error);
    return [];
  }
}
