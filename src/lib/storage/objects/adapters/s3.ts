import { getS3Config, presignS3Url, downloadS3Object, deleteS3Object } from '../../../uploads/directUpload';
import type { IObjectStore } from '../types';

/**
 * S3-compatible object store — reuses the dependency-free SigV4 signer in
 * src/lib/uploads/directUpload.ts (works with AWS S3, Cloudflare R2, MinIO,
 * Supabase Storage — anything S3-compatible via S3_ENDPOINT).
 */
export const s3ObjectStore: IObjectStore = {
  id: 's3',
  nameAr: 'تخزين S3 المتوافق',
  nameEn: 'S3-Compatible Storage',

  isConfigured(): boolean {
    return getS3Config() !== null;
  },

  async put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<boolean> {
    if (!getS3Config()) return false;
    try {
      const url = presignS3Url({
        method: 'PUT',
        key,
        expiresInSeconds: 300,
        contentType: contentType || 'application/octet-stream',
      });
      // Copy into a fresh ArrayBuffer-backed view: TS strict lib types reject
      // Buffer<ArrayBufferLike> as a fetch/Blob body otherwise.
      const bytes = new Uint8Array(data.byteLength);
      bytes.set(data);
      const res = await fetch(url, {
        method: 'PUT',
        body: new Blob([bytes], { type: contentType || 'application/octet-stream' }),
        headers: { 'Content-Type': contentType || 'application/octet-stream' },
      });
      if (!res.ok) {
        console.warn(`[objectStore:s3] PUT ${key} failed: HTTP ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[objectStore:s3] put failed for ${key}:`, (err as Error)?.message);
      return false;
    }
  },

  async get(key: string): Promise<Buffer | null> {
    return downloadS3Object(key);
  },

  async delete(key: string): Promise<void> {
    await deleteS3Object(key);
  },

  presignPut(key: string, expiresInSeconds = 900, contentType?: string): string | null {
    if (!getS3Config()) return null;
    try {
      return presignS3Url({
        method: 'PUT',
        key,
        expiresInSeconds,
        contentType: contentType || 'application/octet-stream',
      });
    } catch (err) {
      console.error(`[objectStore:s3] presignPut failed for ${key}:`, (err as Error)?.message);
      return null;
    }
  },
};
