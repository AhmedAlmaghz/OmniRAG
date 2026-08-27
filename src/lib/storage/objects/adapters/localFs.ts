import fs from 'node:fs';
import path from 'node:path';
import type { IObjectStore } from '../types';

/**
 * Local filesystem object store — the self-hosted/Docker default and the
 * successor to the ad-hoc `uploads/archive` writer. Objects live under
 * `{cwd}/storage/objects/{key}`.
 *
 * Honest limitation: serverless platforms (Vercel) have an ephemeral
 * filesystem, so this backend reports itself unconfigured there — tenants on
 * Vercel should use S3-compatible storage or Vercel Blob.
 */

const ROOT_DIR = path.join(process.cwd(), 'storage', 'objects');

/** Rejects traversal/absolute keys and resolves safely under the root. */
function resolveKey(key: string): string | null {
  if (!key || key.includes('..') || key.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(key)) return null;
  const resolved = path.join(ROOT_DIR, key);
  if (!resolved.startsWith(ROOT_DIR + path.sep)) return null;
  return resolved;
}

export const localFsObjectStore: IObjectStore = {
  id: 'local',
  nameAr: 'التخزين المحلي (الملفات)',
  nameEn: 'Local Filesystem',

  isConfigured(): boolean {
    if (typeof window !== 'undefined') return false;
    // Ephemeral filesystem — objects would silently vanish on redeploy.
    return !process.env.VERCEL;
  },

  async put(key: string, data: Buffer | Uint8Array): Promise<boolean> {
    const target = resolveKey(key);
    if (!target) return false;
    try {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, data);
      return true;
    } catch (err) {
      console.error(`[objectStore:local] put failed for ${key}:`, (err as Error)?.message);
      return false;
    }
  },

  async get(key: string): Promise<Buffer | null> {
    const target = resolveKey(key);
    if (!target) return null;
    try {
      return await fs.promises.readFile(target);
    } catch {
      return null; // missing or unreadable — honest null
    }
  },

  async delete(key: string): Promise<void> {
    const target = resolveKey(key);
    if (!target) return;
    try {
      await fs.promises.unlink(target);
    } catch {
      // Best-effort: deleting a missing object is not an error.
    }
  },
};
