import { createLogger } from '@/lib/logging/logger';

const log = createLogger('LibStorageObjectsRegistry');

import type { IObjectStore, ObjectStoreDescriptor } from './types';
import { s3ObjectStore } from './adapters/s3';
import { vercelBlobObjectStore } from './adapters/vercelBlob';
import { localFsObjectStore } from './adapters/localFs';

/**
 * Object store registry + factory (mirrors the vector store registry).
 *
 * Resolution order for a tenant:
 *   1. Explicit `tenantConfig.objectStoreId`.
 *   2. S3-compatible storage, when configured (S3_ENDPOINT + credentials).
 *   3. Vercel Blob, when BLOB_READ_WRITE_TOKEN is present.
 *   4. Local filesystem (self-hosted default; unconfigured on Vercel).
 *
 * The default chain mirrors the historical getUploadProvider() order, so
 * existing deployments keep the exact same backend after the abstraction.
 *
 * Circular-dependency note: tenantConfigService is imported LAZILY because
 * it imports db.ts, and db.ts consumers may import this factory.
 */

export const OBJECT_STORE_REGISTRY: IObjectStore[] = [s3ObjectStore, vercelBlobObjectStore, localFsObjectStore];

const byId = new Map<string, IObjectStore>(OBJECT_STORE_REGISTRY.map((s) => [s.id, s]));

const STORE_METADATA: Record<string, Pick<ObjectStoreDescriptor, 'descriptionAr' | 'descriptionEn' | 'requirement'>> = {
  s3: {
    descriptionAr: 'أي مخزن متوافق مع S3 (AWS، Cloudflare R2، MinIO، Supabase) — توقيع SigV4 بلا حزم إضافية.',
    descriptionEn: 'Any S3-compatible store (AWS, Cloudflare R2, MinIO, Supabase) — SigV4 signed, no extra SDKs.',
    requirement: 'S3_ENDPOINT + S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY',
  },
  'vercel-blob': {
    descriptionAr: 'التخزين السحابي الأصلي لنشر Vercel — بلا أي إعداد إضافي على المنصة.',
    descriptionEn: 'Native cloud storage for Vercel deployments — zero extra setup on the platform.',
    requirement: 'BLOB_READ_WRITE_TOKEN',
  },
  local: {
    descriptionAr: 'ملفات على قرص الخادم (storage/objects) — الافتراضي للنشر الذاتي عبر Docker. غير متاح على Vercel.',
    descriptionEn:
      'Files on the server disk (storage/objects) — the self-hosted Docker default. Unavailable on Vercel.',
    requirement: 'قرص دائم (غير متاح على Vercel)',
  },
};

export function getObjectStoreById(id: string): IObjectStore | undefined {
  return byId.get(id);
}

export function listObjectStores(): IObjectStore[] {
  return [...OBJECT_STORE_REGISTRY];
}

/** Client-safe catalog for the settings UI. */
export function toObjectStoreCatalog(): ObjectStoreDescriptor[] {
  return OBJECT_STORE_REGISTRY.map((s) => ({
    id: s.id,
    nameAr: s.nameAr,
    nameEn: s.nameEn,
    supportsPresignPut: typeof s.presignPut === 'function',
    ...(STORE_METADATA[s.id] || { descriptionAr: '', descriptionEn: '', requirement: '' }),
  }));
}

/** Default backend for deployments without an explicit tenant selection. */
export function getDefaultObjectStore(): IObjectStore {
  if (s3ObjectStore.isConfigured()) return s3ObjectStore;
  if (vercelBlobObjectStore.isConfigured()) return vercelBlobObjectStore;
  return localFsObjectStore;
}

/** Synchronous resolution when the caller already holds a tenant config. */
export function getObjectStore(tenantConfig?: { objectStoreId?: string } | null): IObjectStore {
  const wanted = tenantConfig?.objectStoreId;
  if (wanted) {
    const store = byId.get(wanted);
    if (store) return store;
    log.warn(`[objectStore] unknown objectStoreId "${wanted}" — using deployment default`);
  }
  return getDefaultObjectStore();
}

export interface ObjectStoreSelection {
  store: IObjectStore;
  explicit: boolean;
}

interface CacheEntry {
  selection: ObjectStoreSelection;
  expiresAt: number;
}
const selectionCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const MAX_CACHE = 256;

/** Invalidate cached selections (called after a tenant saves storage settings). */
export function clearObjectStoreSelectionCache(): void {
  selectionCache.clear();
}

/** Resolves the effective object store for a tenant (cached 60s, never throws). */
export async function getObjectStoreSelection(tenantId: string): Promise<ObjectStoreSelection> {
  const cached = selectionCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.selection;

  let selection: ObjectStoreSelection = { store: getDefaultObjectStore(), explicit: false };
  try {
    const { getTenantConfig } = await import('../../services/tenantConfigService');
    const config = await getTenantConfig(tenantId);
    if (config.objectStoreId) {
      const store = byId.get(config.objectStoreId);
      if (store) selection = { store, explicit: true };
    }
  } catch (e) {
    log.warn('[objectStore] tenant config lookup failed, using default:', (e as Error)?.message);
  }

  if (selectionCache.size >= MAX_CACHE) {
    const oldest = selectionCache.keys().next().value;
    if (oldest !== undefined) selectionCache.delete(oldest);
  }
  selectionCache.set(tenantId, { selection, expiresAt: Date.now() + CACHE_TTL_MS });
  return selection;
}

/** Convenience: the effective store for a tenant (no explicit flag). */
export async function getObjectStoreForTenant(tenantId: string): Promise<IObjectStore> {
  const { store } = await getObjectStoreSelection(tenantId);
  return store;
}
