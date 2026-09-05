import { createLogger } from '@/lib/logging/logger';

const log = createLogger('LibStorageVectorsAdaptersPgvector');

import { getEnv } from '../../../env/runtimeEnv';
import { getPostgresPool, getOwnerPool } from '../../postgres';
import type {
  IVectorStore,
  VectorSearchParams,
  VectorSearchHit,
  VectorPoint,
  VectorChunkPayload,
  VectorMetric,
} from '../types';

/**
 * pgvector adapter — semantic search inside the SAME Postgres the platform
 * already runs (no extra infrastructure). Ideal for individuals and small
 * organizations; large deployments with heavy ANN traffic should prefer
 * Qdrant (dedicated indexes, payload filtering, horizontal scale).
 *
 * Honest degradation: the adapter requires the `vector` extension. When the
 * extension cannot be created (not installed / insufficient privileges), the
 * store marks itself unavailable — upserts return false and searches return
 * [], exactly like a Qdrant outage, so callers keep their failure semantics.
 *
 * Dimensions: pgvector fixes the dimension per column, so each dimension gets
 * its own table (`vector_chunks` for the 3072 platform default, otherwise
 * `vector_chunks_d<dim>`). The platform currently normalizes all embeddings
 * to 3072 (embedding.ts), so in practice one table is used.
 */

const DEFAULT_TABLE = 'vector_chunks';

/** Tracks which dimension tables were provisioned this process lifetime. */
const ensuredTables = new Set<string>();
/** Set once when the extension/table cannot be provisioned. */
let unavailable = false;
let unavailableLogged = false;

function tableForDimension(dimension: number): string {
  const dim = Math.max(1, Math.floor(dimension));
  return dim === 3072 ? DEFAULT_TABLE : `${DEFAULT_TABLE}_d${dim}`;
}

function markUnavailable(reason: string): void {
  unavailable = true;
  if (!unavailableLogged) {
    unavailableLogged = true;
    log.warn(`[pgvector] backend unavailable — semantic search/ingestion via pgvector disabled: ${reason}`);
  }
}

/** Test escape hatch. */
export function resetPgVectorState(): void {
  ensuredTables.clear();
  unavailable = false;
  unavailableLogged = false;
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/** Payload keys stored in dedicated columns; everything else goes to metadata. */
const KNOWN_PAYLOAD_KEYS = new Set([
  'tenantId',
  'documentId',
  'documentTitle',
  'content',
  'chunkIndex',
  'pageNumber',
  'language',
  'collectionIds',
]);

function splitPayload(payload: VectorChunkPayload): { known: VectorChunkPayload; metadata: Record<string, unknown> } {
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!KNOWN_PAYLOAD_KEYS.has(k)) metadata[k] = v;
  }
  return { known: payload, metadata };
}

async function ensureTable(dimension: number): Promise<boolean> {
  if (unavailable) return false;
  const table = tableForDimension(dimension);
  if (ensuredTables.has(table)) return true;

  // DDL belongs to the owner connection — under the runtime app role
  // (DATABASE_APP_URL) CREATE EXTENSION/TABLE would fail, and a table created
  // by the app role would be owned by it (RLS bypass for that table).
  const pool = getOwnerPool();
  if (!pool) {
    markUnavailable('no Postgres connection (DATABASE_URL/POSTGRES_URL missing)');
    return false;
  }

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        document_title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        chunk_index INTEGER NOT NULL DEFAULT 0,
        page_number INTEGER NOT NULL DEFAULT 1,
        language TEXT NOT NULL DEFAULT 'ar',
        collection_ids JSONB NOT NULL DEFAULT '[]',
        metadata JSONB NOT NULL DEFAULT '{}',
        embedding vector(${Math.floor(dimension)}) NOT NULL,
        created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${table}_tenant_idx ON ${table} (tenant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${table}_document_idx ON ${table} (document_id)`);
    ensuredTables.add(table);
    return true;
  } catch (err) {
    markUnavailable((err as Error)?.message || String(err));
    return false;
  }
}

export const pgvectorStore: IVectorStore = {
  id: 'pgvector',
  nameAr: 'بوستجريز المتجهي (pgvector)',
  nameEn: 'Postgres + pgvector',

  isConfigured(): boolean {
    return Boolean(getEnv('DATABASE_URL') || getEnv('POSTGRES_URL'));
  },

  async ensureCollection(dimension: number, _metric?: VectorMetric): Promise<void> {
    await ensureTable(dimension);
  },

  async upsertPoints(points: VectorPoint[]): Promise<boolean> {
    if (points.length === 0) return true;
    if (unavailable) return false;
    const dimension = points[0]?.vector?.length || 0;
    if (dimension === 0) return false;
    if (!(await ensureTable(dimension))) return false;

    const pool = getPostgresPool();
    if (!pool) return false;
    const table = tableForDimension(dimension);

    try {
      // One multi-row upsert round-trip for the whole batch.
      const values: unknown[] = [];
      const rows: string[] = [];
      for (const p of points) {
        if (!Array.isArray(p.vector) || p.vector.length !== dimension) continue;
        const { known, metadata } = splitPayload(p.payload);
        const base = values.length;
        values.push(
          p.id,
          known.tenantId,
          known.documentId,
          known.documentTitle || '',
          known.content || '',
          known.chunkIndex || 0,
          known.pageNumber || 1,
          known.language || 'ar',
          JSON.stringify(known.collectionIds || []),
          JSON.stringify(metadata),
          vectorLiteral(p.vector),
        );
        rows.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::jsonb, $${base + 10}::jsonb, $${base + 11}::vector)`,
        );
      }
      if (rows.length === 0) return false;

      await pool.query(
        `INSERT INTO ${table} (id, tenant_id, document_id, document_title, content, chunk_index, page_number, language, collection_ids, metadata, embedding)
         VALUES ${rows.join(', ')}
         ON CONFLICT (id) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           document_id = EXCLUDED.document_id,
           document_title = EXCLUDED.document_title,
           content = EXCLUDED.content,
           chunk_index = EXCLUDED.chunk_index,
           page_number = EXCLUDED.page_number,
           language = EXCLUDED.language,
           collection_ids = EXCLUDED.collection_ids,
           metadata = EXCLUDED.metadata,
           embedding = EXCLUDED.embedding`,
        values,
      );
      return true;
    } catch (err) {
      log.error(`[pgvector] upsert of ${points.length} point(s) failed:`, (err as Error)?.message);
      return false;
    }
  },

  async search(params: VectorSearchParams): Promise<VectorSearchHit[]> {
    if (unavailable) return [];
    const dimension = params.vector?.length || 0;
    if (dimension === 0) return [];
    if (!(await ensureTable(dimension))) return [];

    const pool = getPostgresPool();
    if (!pool) return [];
    const table = tableForDimension(dimension);

    try {
      const conditions = ['tenant_id = $2'];
      const values: unknown[] = [vectorLiteral(params.vector), params.tenantId];
      if (params.collectionIds && params.collectionIds.length > 0) {
        values.push(params.collectionIds);
        conditions.push(`collection_ids ?| $${values.length}::text[]`);
      }
      // Allow the full above-floor pool to come back in one round-trip; the
      // engine applies the single defensive CONTEXT_CHUNK_CAP after fusion.
      const limit = Math.max(1, Math.min(params.limit || 10, 1200));

      const res = await pool.query(
        `SELECT id, document_id, document_title, content, chunk_index, page_number, language,
                1 - (embedding <=> $1::vector) AS score
         FROM ${table}
         WHERE ${conditions.join(' AND ')}
         ORDER BY embedding <=> $1::vector
         LIMIT ${limit}`,
        values,
      );

      const threshold = params.scoreThreshold ?? 0;
      return (res.rows || [])
        .map((r: any) => ({
          id: String(r.id),
          documentId: r.document_id || '',
          documentTitle: r.document_title || '',
          content: r.content || '',
          chunkIndex: r.chunk_index || 0,
          pageNumber: r.page_number || 1,
          language: r.language || 'ar',
          semanticScore: Number(r.score) || 0,
        }))
        .filter((hit: VectorSearchHit) => hit.semanticScore >= threshold);
    } catch (err) {
      log.error('[pgvector] search failed:', (err as Error)?.message);
      return [];
    }
  },

  async deleteByDocument(documentId: string, tenantId: string): Promise<void> {
    if (unavailable) return;
    const pool = getPostgresPool();
    if (!pool) return;
    // The dimension is unknown at delete time — sweep every provisioned table.
    const tables = ensuredTables.size > 0 ? [...ensuredTables] : [DEFAULT_TABLE];
    for (const table of tables) {
      try {
        await pool.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND document_id = $2`, [tenantId, documentId]);
      } catch (err) {
        log.error(`[pgvector] deleteByDocument failed on ${table}:`, (err as Error)?.message);
      }
    }
  },

  async deletePoint(id: string): Promise<void> {
    if (unavailable) return;
    const pool = getPostgresPool();
    if (!pool) return;
    const tables = ensuredTables.size > 0 ? [...ensuredTables] : [DEFAULT_TABLE];
    for (const table of tables) {
      try {
        await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      } catch (err) {
        log.error(`[pgvector] deletePoint failed on ${table}:`, (err as Error)?.message);
      }
    }
  },

  async updateDocumentPayload(
    documentId: string,
    tenantId: string,
    updates: Partial<VectorChunkPayload>,
  ): Promise<void> {
    if (unavailable) return;
    const pool = getPostgresPool();
    if (!pool) return;

    // Only column-backed payload fields can be updated; unknown keys are
    // ignored (Qdrant's generic setPayload has no pgvector equivalent here).
    const setClauses: string[] = [];
    const values: unknown[] = [tenantId, documentId];
    if (updates.collectionIds !== undefined) {
      values.push(JSON.stringify(updates.collectionIds));
      setClauses.push(`collection_ids = $${values.length}::jsonb`);
    }
    if (typeof updates.documentTitle === 'string') {
      values.push(updates.documentTitle);
      setClauses.push(`document_title = $${values.length}`);
    }
    if (typeof updates.content === 'string') {
      values.push(updates.content);
      setClauses.push(`content = $${values.length}`);
    }
    if (typeof updates.language === 'string') {
      values.push(updates.language);
      setClauses.push(`language = $${values.length}`);
    }
    if (setClauses.length === 0) return;

    const tables = ensuredTables.size > 0 ? [...ensuredTables] : [DEFAULT_TABLE];
    for (const table of tables) {
      try {
        await pool.query(
          `UPDATE ${table} SET ${setClauses.join(', ')} WHERE tenant_id = $1 AND document_id = $2`,
          values,
        );
      } catch (err) {
        log.error(`[pgvector] updateDocumentPayload failed on ${table}:`, (err as Error)?.message);
      }
    }
  },
};
