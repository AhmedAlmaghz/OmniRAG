import { getObjectStoreForTenant } from '@/lib/storage/objects/registry';

/**
 * Skill artifacts (generated reports, Office documents, charts exports,
 * generated images) are stored in the tenant's selected object store under an
 * unguessable tenant-scoped key and served back through /api/v1/files/{key}.
 *
 * Same isolation model as ingestion uploads (buildTenantObjectKey in
 * directUpload.ts): the key carries the tenant id, and the download route
 * refuses to serve a key whose tenant prefix does not match the caller.
 */

export interface StoredArtifact {
  /** Opaque object-store key (`generated/{tenantId}/{uuid}-{name}`). */
  key: string;
  /** App-relative download URL handled by /api/v1/files/[...key]. */
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Which object store backend actually stored the file. */
  storeId: string;
}

/** Builds `generated/{tenantId}/{uuid}-{sanitizedName}` — unguessable + isolated. */
export function buildArtifactKey(tenantId: string, fileName: string): string {
  const safe = (fileName || 'artifact.bin').replace(/[^\w.\-() ]/g, '_').slice(-120);
  return `generated/${tenantId}/${crypto.randomUUID()}-${safe}`;
}

/** Validates that a generated-artifact key belongs to the given tenant. */
export function isArtifactKeyForTenant(key: string, tenantId: string): boolean {
  if (!key || key.includes('..') || key.startsWith('/')) return false;
  return key.startsWith(`generated/${tenantId}/`) && key.length > `generated/${tenantId}/`.length;
}

/**
 * Stores a generated artifact in the tenant's object store.
 * Throws a readable error when the write does not land — callers must report
 * the failure honestly instead of returning a dead download link.
 */
export async function storeSkillArtifact(
  tenantId: string,
  fileName: string,
  mimeType: string,
  data: Buffer | Uint8Array,
): Promise<StoredArtifact> {
  const store = await getObjectStoreForTenant(tenantId);
  if (!store.isConfigured()) {
    throw new Error(
      `مخزن الكائنات (${store.nameAr}) غير مهيأ في هذا النشر — لا يمكن حفظ الملفات المولدة. اختر خلفية تخزين مفعلة من الإعدادات.`,
    );
  }

  const key = buildArtifactKey(tenantId, fileName);
  const ok = await store.put(key, data, mimeType);
  if (!ok) {
    throw new Error(`تعذر حفظ الملف المولد في مخزن الكائنات (${store.nameAr}). حاول مرة أخرى.`);
  }

  return {
    key,
    url: `/api/v1/files/${key}`,
    fileName,
    mimeType,
    sizeBytes: data.byteLength,
    storeId: store.id,
  };
}
