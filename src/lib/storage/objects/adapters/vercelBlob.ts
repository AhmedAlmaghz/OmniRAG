import type { IObjectStore } from '../types';

/**
 * Vercel Blob object store — the natural backend for Vercel deployments.
 * The SDK is imported lazily so non-Vercel deployments never pay its cost
 * (and so tests can run without the token configured).
 *
 * Note: Vercel Blob objects are publicly readable by URL (access: 'public');
 * unguessable tenant-scoped keys (buildTenantObjectKey) provide the isolation,
 * matching how the existing upload-token flow already uses the store.
 */
export const vercelBlobObjectStore: IObjectStore = {
  id: 'vercel-blob',
  nameAr: 'Vercel Blob',
  nameEn: 'Vercel Blob',

  isConfigured(): boolean {
    return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  },

  async put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<boolean> {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return false;
    try {
      const { put } = await import('@vercel/blob');
      await put(key, Buffer.from(data), {
        access: 'public',
        contentType: contentType || 'application/octet-stream',
      });
      return true;
    } catch (err) {
      console.error(`[objectStore:vercel-blob] put failed for ${key}:`, (err as Error)?.message);
      return false;
    }
  },

  async get(key: string): Promise<Buffer | null> {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
    try {
      const { get } = await import('@vercel/blob');
      const result = await get(key, { access: 'public' });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const chunks: Uint8Array[] = [];
      const reader = result.stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      return Buffer.concat(chunks);
    } catch {
      return null; // missing or unreadable — honest null
    }
  },

  async delete(key: string): Promise<void> {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return;
    try {
      const { del } = await import('@vercel/blob');
      await del(key, {});
    } catch (err) {
      console.warn(`[objectStore:vercel-blob] delete failed for ${key}:`, (err as Error)?.message);
    }
  },
};
