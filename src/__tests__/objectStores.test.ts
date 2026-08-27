import { describe, it, expect, afterEach } from 'vitest';
import { localFsObjectStore } from '@/lib/storage/objects/adapters/localFs';
import { s3ObjectStore } from '@/lib/storage/objects/adapters/s3';
import { vercelBlobObjectStore } from '@/lib/storage/objects/adapters/vercelBlob';
import {
  OBJECT_STORE_REGISTRY,
  getObjectStore,
  getObjectStoreById,
  getDefaultObjectStore,
  toObjectStoreCatalog,
} from '@/lib/storage/objects/registry';

// Phase 2 object store abstraction: localFs round-trip through the real
// filesystem, key-traversal rejection, and registry resolution order that
// mirrors the historical getUploadProvider() chain.

const TEST_KEYS: string[] = [];

function trackKey(key: string): string {
  TEST_KEYS.push(key);
  return key;
}

afterEach(async () => {
  while (TEST_KEYS.length > 0) {
    const key = TEST_KEYS.pop();
    if (key) await localFsObjectStore.delete(key);
  }
});

describe('localFs object store — round-trip', () => {
  it('put → get returns the exact bytes, delete removes the object', async () => {
    const key = trackKey(`uploads/tenant-test/${Date.now()}-roundtrip.bin`);
    const payload = Buffer.from('محتوى ثنائي للتجربة — OmniRAG', 'utf8');

    await expect(localFsObjectStore.put(key, payload, 'text/plain')).resolves.toBe(true);

    const read = await localFsObjectStore.get(key);
    expect(read).not.toBeNull();
    expect(read!.toString('utf8')).toBe(payload.toString('utf8'));

    await localFsObjectStore.delete(key);
    await expect(localFsObjectStore.get(key)).resolves.toBeNull();
  });

  it('rejects traversal and absolute keys', async () => {
    await expect(localFsObjectStore.put('../escape.txt', Buffer.from('x'))).resolves.toBe(false);
    await expect(localFsObjectStore.put('/etc/passwd', Buffer.from('x'))).resolves.toBe(false);
    await expect(localFsObjectStore.get('../../secret')).resolves.toBeNull();
  });

  it('get on a missing key returns null (honest absence)', async () => {
    await expect(localFsObjectStore.get(`uploads/tenant-test/missing-${Date.now()}.bin`)).resolves.toBeNull();
  });

  it('delete on a missing key never throws', async () => {
    await expect(localFsObjectStore.delete(`uploads/tenant-test/ghost-${Date.now()}.bin`)).resolves.toBeUndefined();
  });
});

describe('object store registry — resolution order', () => {
  it('registers s3, vercel-blob, and local with unique ids', () => {
    const ids = OBJECT_STORE_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['s3', 'vercel-blob', 'local']));
  });

  it('catalog declares presign support only where implemented', () => {
    const catalog = toObjectStoreCatalog();
    const byId = new Map(catalog.map((c) => [c.id, c]));
    expect(byId.get('s3')?.supportsPresignPut).toBe(true);
    expect(byId.get('local')?.supportsPresignPut).toBe(false);
    expect(byId.get('vercel-blob')?.supportsPresignPut).toBe(false);
    for (const entry of catalog) {
      expect(entry.requirement.trim().length).toBeGreaterThan(0);
    }
  });

  it('unconfigured cloud backends report false and fall through to local', () => {
    // No S3_* env and no BLOB_READ_WRITE_TOKEN in the test environment.
    if (!process.env.S3_ENDPOINT) expect(s3ObjectStore.isConfigured()).toBe(false);
    if (!process.env.BLOB_READ_WRITE_TOKEN) expect(vercelBlobObjectStore.isConfigured()).toBe(false);
    if (!process.env.S3_ENDPOINT && !process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL) {
      expect(getDefaultObjectStore().id).toBe('local');
    }
  });

  it('honors explicit tenant selection and rejects unknown ids gracefully', () => {
    expect(getObjectStore({ objectStoreId: 'local' }).id).toBe('local');
    expect(getObjectStore({ objectStoreId: 's3' }).id).toBe('s3'); // chosen even if unconfigured
    expect(getObjectStore({ objectStoreId: 'azure-blob' }).id).toBe(getDefaultObjectStore().id);
  });

  it('getObjectStoreById resolves every registered store', () => {
    for (const store of OBJECT_STORE_REGISTRY) {
      expect(getObjectStoreById(store.id)).toBe(store);
    }
    expect(getObjectStoreById('nope')).toBeUndefined();
  });
});
