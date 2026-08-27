/**
 * Object store abstraction — where original files and generated artifacts
 * (reports, images, Office exports) are kept.
 *
 * Same "adapters + registries" pattern as the AI provider registry and the
 * vector store registry: every backend implements {@link IObjectStore}, the
 * factory resolves the tenant's choice, and adding a backend is one adapter
 * file + one registry entry.
 *
 * Keys are tenant-scoped opaque paths (`uploads/{tenantId}/{uuid}-{name}`,
 * see buildTenantObjectKey). Stores must treat keys as opaque and never
 * allow traversal outside their root.
 */

export interface IObjectStore {
  /** Stable registry id (`s3`, `vercel-blob`, `local`). */
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;

  /** Cheap synchronous check: is this backend usable in this deployment? */
  isConfigured(): boolean;

  /** Stores an object. Returns true only when the write actually landed. */
  put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<boolean>;

  /** Reads an object back; null when missing or on failure. */
  get(key: string): Promise<Buffer | null>;

  /** Best-effort delete; never throws. */
  delete(key: string): Promise<void>;

  /**
   * Optional presigned PUT URL for direct browser→store uploads. Backends
   * without presigning return null and callers fall back to server upload.
   */
  presignPut?(key: string, expiresInSeconds?: number, contentType?: string): string | null;
}

/** Client-safe descriptor for the settings UI. */
export interface ObjectStoreDescriptor {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  requirement: string;
  supportsPresignPut: boolean;
}
