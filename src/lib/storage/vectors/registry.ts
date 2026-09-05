import { createLogger } from '@/lib/logging/logger';

const log = createLogger('LibStorageVectorsRegistry');

import type { IVectorStore, VectorStoreDescriptor } from './types';
import { qdrantVectorStore } from './adapters/qdrant';
import { pgvectorStore } from './adapters/pgvector';
import { memoryVectorStore } from './adapters/memory';

/**
 * Vector store registry + factory.
 *
 * Resolution order for a tenant:
 *   1. Explicit `tenantConfig.vectorStoreId` (the tenant chose a backend).
 *   2. Qdrant, when QDRANT_URL is configured (historical default).
 *   3. pgvector, when Postgres is configured (reuses existing infrastructure).
 *   4. In-memory (dev only — vectors die with the process).
 *
 * The default chain preserves pre-abstraction behavior exactly: deployments
 * with QDRANT_URL keep using Qdrant; deployments with nothing configured
 * still skip semantic search (the memory backend is write-only unless a
 * tenant explicitly selects it — see getVectorStoreSelection).
 *
 * Circular-dependency note: db.ts imports this factory, and this factory
 * needs tenant config — so tenantConfigService is imported LAZILY inside
 * getVectorStoreSelection (same pattern as ai/registry/credentials.ts).
 */

export const VECTOR_STORE_REGISTRY: IVectorStore[] = [qdrantVectorStore, pgvectorStore, memoryVectorStore];

const byId = new Map<string, IVectorStore>(VECTOR_STORE_REGISTRY.map((s) => [s.id, s]));

const STORE_METADATA: Record<string, Pick<VectorStoreDescriptor, 'descriptionAr' | 'descriptionEn' | 'requirement'>> = {
  qdrant: {
    descriptionAr: 'قاعدة متجهات مستقلة عالية الأداء مع فلترة payload أصلية — الخيار المعتمد للمؤسسات.',
    descriptionEn: 'Dedicated high-performance vector database with native payload filtering — the enterprise default.',
    requirement: 'QDRANT_URL (+ QDRANT_API_KEY اختياريًا)',
  },
  pgvector: {
    descriptionAr: 'بحث متجهي داخل Postgres القائم بلا بنية إضافية — مثالي للأفراد والمنشآت الصغيرة.',
    descriptionEn:
      'Vector search inside your existing Postgres (requires the vector extension) — ideal for individuals and small teams.',
    requirement: 'DATABASE_URL + امتداد vector',
  },
  memory: {
    descriptionAr: 'تخزين مؤقت في الذاكرة للتطوير والاختبارات فقط — لا يستخدم في الإنتاج.',
    descriptionEn: 'In-process storage for development and tests only — not for production.',
    requirement: 'متوفر دائمًا',
  },
};

export function getVectorStoreById(id: string): IVectorStore | undefined {
  return byId.get(id);
}

export function listVectorStores(): IVectorStore[] {
  return [...VECTOR_STORE_REGISTRY];
}

/** Client-safe catalog for the settings UI. */
export function toVectorStoreCatalog(): VectorStoreDescriptor[] {
  return VECTOR_STORE_REGISTRY.map((s) => ({
    id: s.id,
    nameAr: s.nameAr,
    nameEn: s.nameEn,
    ...(STORE_METADATA[s.id] || { descriptionAr: '', descriptionEn: '', requirement: '' }),
  }));
}

/** Default backend for deployments without an explicit tenant selection. */
export function getDefaultVectorStore(): IVectorStore {
  if (qdrantVectorStore.isConfigured()) return qdrantVectorStore;
  if (pgvectorStore.isConfigured()) return pgvectorStore;
  return memoryVectorStore;
}

/**
 * Synchronous resolution when the caller already holds a tenant config
 * (or wants the deployment default with no config at all).
 */
export function getVectorStore(tenantConfig?: { vectorStoreId?: string } | null): IVectorStore {
  const wanted = tenantConfig?.vectorStoreId;
  if (wanted) {
    const store = byId.get(wanted);
    if (store) return store;
    log.warn(`[vectorStore] unknown vectorStoreId "${wanted}" — using deployment default`);
  }
  return getDefaultVectorStore();
}

export interface VectorStoreSelection {
  store: IVectorStore;
  /** True when the tenant explicitly chose this backend. */
  explicit: boolean;
}

interface CacheEntry {
  selection: VectorStoreSelection;
  expiresAt: number;
}
const selectionCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const MAX_CACHE = 256;

/** Invalidate cached selections (called after a tenant saves new storage settings). */
export function clearVectorStoreSelectionCache(): void {
  selectionCache.clear();
}

/**
 * Resolves the effective vector store for the active tenant, reading its
 * persisted config (cached 60s). Never throws into request handlers — any
 * config lookup failure degrades to the deployment default.
 */
export async function getVectorStoreSelection(tenantId: string): Promise<VectorStoreSelection> {
  const cached = selectionCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.selection;

  let selection: VectorStoreSelection = { store: getDefaultVectorStore(), explicit: false };
  try {
    const { getTenantConfig } = await import('../../services/tenantConfigService');
    const config = await getTenantConfig(tenantId);
    if (config.vectorStoreId) {
      const store = byId.get(config.vectorStoreId);
      if (store) selection = { store, explicit: true };
    }
  } catch (e) {
    log.warn('[vectorStore] tenant config lookup failed, using default:', (e as Error)?.message);
  }

  if (selectionCache.size >= MAX_CACHE) {
    const oldest = selectionCache.keys().next().value;
    if (oldest !== undefined) selectionCache.delete(oldest);
  }
  selectionCache.set(tenantId, { selection, expiresAt: Date.now() + CACHE_TTL_MS });
  return selection;
}

/** Convenience: the effective store for a tenant (no explicit flag). */
export async function getVectorStoreForTenant(tenantId: string): Promise<IVectorStore> {
  const { store } = await getVectorStoreSelection(tenantId);
  return store;
}
