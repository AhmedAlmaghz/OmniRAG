/**
 * Vector store abstraction — the storage side of the "adapters + registries"
 * pattern (mirrors src/lib/ai/registry for AI providers).
 *
 * Every semantic-search backend (Qdrant, pgvector, in-memory) implements
 * {@link IVectorStore}. Call sites (ingestion in db.ts, hybrid search in
 * engine.ts, MCP tools) obtain an instance through the factory
 * (`getVectorStore` / `getVectorStoreForTenant`) instead of importing a
 * concrete driver — so each tenant can pick where its vectors live without
 * any pipeline change. Adding a backend = one adapter file + one registry
 * entry.
 *
 * Honest degradation contract (same spirit as the provider layer):
 *  - `isConfigured()` is a cheap, synchronous "is this backend reachable at
 *    all" check used to gate code paths (no silent no-op writes).
 *  - `upsertPoints()` returns false when the batch did NOT land — callers
 *    flip document status to failed and offer reindex.
 *  - `search()` returns [] when the backend is down — the hybrid engine then
 *    leans on the lexical side and says so.
 */

/** Payload stored alongside every vector point. Tenant isolation lives here. */
export interface VectorChunkPayload {
  tenantId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  chunkIndex: number;
  pageNumber: number;
  language: string;
  collectionIds?: string[];
  [key: string]: unknown;
}

/** A single vector point to upsert. */
export interface VectorPoint {
  /** Chunk id — stores must map it to a deterministic backend point id. */
  id: string;
  vector: number[];
  payload: VectorChunkPayload;
}

export interface VectorSearchParams {
  vector: number[];
  /** Mandatory isolation predicate — never optional. */
  tenantId: string;
  /** Optional: restrict to chunks whose collectionIds intersect this list. */
  collectionIds?: string[];
  limit: number;
  /** Minimum similarity score (cosine, 0..1); backend may pre-filter. */
  scoreThreshold?: number;
}

/** A normalized search hit, regardless of backend. */
export interface VectorSearchHit {
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  chunkIndex: number;
  pageNumber: number;
  language: string;
  /** Cosine similarity in 0..1 (higher = closer). */
  semanticScore: number;
}

export type VectorMetric = 'cosine' | 'dot' | 'euclid';

export interface IVectorStore {
  /** Stable registry id (`qdrant`, `pgvector`, `memory`). */
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;

  /**
   * Cheap synchronous check: is this backend configured at all (env/creds)?
   * Used to gate search/ingestion paths. Does NOT verify connectivity.
   */
  isConfigured(): boolean;

  /**
   * Ensures the backing collection/table exists with the given dimension.
   * Idempotent; must be safe to call on every write path. Backends that fix
   * dimensions per collection derive a per-dimension namespace.
   */
  ensureCollection(dimension: number, metric?: VectorMetric): Promise<void>;

  /**
   * Upserts many points in one backend round-trip where possible.
   * Returns true ONLY when the batch actually landed.
   */
  upsertPoints(points: VectorPoint[]): Promise<boolean>;

  /** Similarity search. Mandatory tenant isolation; [] on any failure. */
  search(params: VectorSearchParams): Promise<VectorSearchHit[]>;

  /** Deletes every point belonging to a document (tenant-scoped). */
  deleteByDocument(documentId: string, tenantId: string): Promise<void>;

  /** Deletes a single point by chunk id. */
  deletePoint(id: string): Promise<void>;

  /**
   * Updates mutable payload fields for all of a document's points. Backends
   * apply the fields they can persist (collectionIds at minimum).
   */
  updateDocumentPayload(documentId: string, tenantId: string, updates: Partial<VectorChunkPayload>): Promise<void>;
}

/** Client-safe descriptor for the settings UI (no behavior, just facts). */
export interface VectorStoreDescriptor {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  /** e.g. "requires QDRANT_URL" — what makes this backend configured. */
  requirement: string;
}
