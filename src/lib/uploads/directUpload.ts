import crypto from 'crypto';

/**
 * Storage-agnostic direct-upload layer for LARGE files.
 *
 * Problem: many hosting platforms cap the request body a serverless function
 * accepts (Vercel: 4.5 MB → FUNCTION_PAYLOAD_TOO_LARGE). A 14 MB PDF can
 * therefore never reach the parse route through a normal POST.
 *
 * Solution: negotiate a provider that lets the BROWSER upload the file bytes
 * directly to object storage, then hand the server a tiny reference:
 *
 *   1. `s3`          — any S3-compatible store (Tigris, AWS S3, Cloudflare
 *                      R2, MinIO…). Presigned PUT/GET/DELETE URLs are signed
 *                      here with SigV4 (node:crypto only — no AWS SDK). Works
 *                      on ANY host, Vercel included.
 *   2. `vercel-blob` — Vercel Blob store. OPTIONAL, and only selected when
 *                      the app is actually hosted on Vercel (VERCEL=1) and a
 *                      Blob store is connected. Loaded lazily so non-Vercel
 *                      deployments never pull it in.
 *   3. `null`        — no provider configured: the client falls back to the
 *                      legacy direct upload, which is fine on hosts without
 *                      body limits (Cloud Run, Docker, self-hosted…).
 *
 * Security model:
 *  - Object keys are namespaced `uploads/{tenantId}/…`; presigned URLs and
 *    server-side reads are only ever issued for the caller's own prefix.
 *  - Presigned PUTs bind Content-Type and expire in minutes.
 *  - The parse route re-validates the tenant prefix and the byte size before
 *    processing anything.
 */

export type DirectUploadMethod = 's3' | 'vercel-blob';

export const DIRECT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024; // mirrors the parse route cap

/** Extension allow-list shared by the session route; the parse route re-checks. */
export const UPLOAD_ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'docx',
  'doc',
  'pptx',
  'ppt',
  'xlsx',
  'xls',
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'py',
  'js',
  'jsx',
  'ts',
  'tsx',
  'go',
  'html',
  'css',
  'xml',
  'yaml',
  'yml',
  'sql',
  'c',
  'cpp',
  'h',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'mp3',
  'wav',
  'm4a',
  'flac',
  'mp4',
  'mov',
  'webm',
  'ogg',
]);

export interface S3Config {
  endpoint: string; // e.g. https://t3.storage.dev (Tigris)
  region: string; // e.g. auto (Tigris), us-east-1 (AWS)
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/**
 * Reads the S3-compatible configuration from the environment. Returns null
 * unless every required key is present, so a partial configuration never
 * half-activates the provider.
 */
export function getS3Config(): S3Config | null {
  const endpoint = (process.env.S3_ENDPOINT || '').trim().replace(/\/+$/, '');
  const bucket = (process.env.S3_BUCKET || '').trim();
  const accessKeyId = (process.env.S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY || '').trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return null;
  }
  if (endpointUrl.protocol !== 'https:' && endpointUrl.protocol !== 'http:') return null;

  return {
    endpoint,
    region: (process.env.S3_REGION || 'auto').trim(),
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true').trim().toLowerCase() !== 'false',
  };
}

/**
 * Resolves which direct-upload provider is active, in priority order:
 * S3-compatible (portable, any host) → Vercel Blob (Vercel-only option) → none.
 */
export function getUploadProvider(): DirectUploadMethod | null {
  if (getS3Config()) return 's3';
  if (process.env.BLOB_READ_WRITE_TOKEN && process.env.VERCEL) return 'vercel-blob';
  return null;
}

// ---------------------------------------------------------------------------
// Tenant-scoped object keys
// ---------------------------------------------------------------------------

/** Builds `uploads/{tenantId}/{uuid}-{sanitizedName}` — unguessable + isolated. */
export function buildTenantObjectKey(tenantId: string, fileName: string): string {
  const safe = (fileName || 'document.bin').replace(/[^\w.\-() ]/g, '_').slice(-120);
  return `uploads/${tenantId}/${crypto.randomUUID()}-${safe}`;
}

/**
 * Validates that a client-supplied storage key belongs to the given tenant.
 * Rejects path traversal and absolute keys.
 */
export function isTenantObjectKey(key: string, tenantId: string): boolean {
  if (!key || key.includes('..') || key.startsWith('/')) return false;
  return key.startsWith(`uploads/${tenantId}/`) && key.length > `uploads/${tenantId}/`.length;
}

// ---------------------------------------------------------------------------
// SigV4 presigned URLs (no AWS SDK — works with any S3-compatible store)
// ---------------------------------------------------------------------------

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/** AWS-flavoured URI encoding: unreserved chars stay, everything else %-encodes per byte. */
function awsUriEncode(value: string, keepSlash = false): string {
  const bytes = Buffer.from(value, 'utf8');
  let out = '';
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9._~-]/.test(c)) out += c;
    else if (c === '/' && keepSlash) out += '/';
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

export interface PresignOptions {
  method: 'PUT' | 'GET' | 'DELETE';
  key: string;
  expiresInSeconds: number;
  /** Required for PUT: binds the signature to this exact Content-Type header. */
  contentType?: string;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

/**
 * Produces a presigned URL for the configured S3-compatible store.
 * Implements AWS Signature Version 4 query-string signing with an
 * UNSIGNED-PAYLOAD trailer, as presigned URLs conventionally do.
 */
export function presignS3Url(options: PresignOptions): string {
  const cfg = getS3Config();
  if (!cfg) throw new Error('S3-compatible storage is not configured');

  const endpointUrl = new URL(cfg.endpoint);
  const hostHeader = cfg.forcePathStyle ? endpointUrl.host : `${cfg.bucket}.${endpointUrl.host}`;
  const objectPath = cfg.forcePathStyle
    ? `/${awsUriEncode(cfg.bucket)}/${awsUriEncode(options.key, true)}`
    : `/${awsUriEncode(options.key, true)}`;

  const now = options.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;

  const bindContentType = options.method === 'PUT' && options.contentType;
  const signedHeaders = bindContentType ? 'content-type;host' : 'host';
  const canonicalHeaders = bindContentType
    ? `content-type:${options.contentType}\nhost:${hostHeader}\n`
    : `host:${hostHeader}\n`;

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.min(Math.max(options.expiresInSeconds, 1), 604800)),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${awsUriEncode(k)}=${awsUriEncode(query[k])}`)
    .join('&');

  const canonicalRequest = [
    options.method,
    objectPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `${endpointUrl.protocol}//${hostHeader}${objectPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// ---------------------------------------------------------------------------
// Server-side object access (download / cleanup)
// ---------------------------------------------------------------------------

/** Downloads an object via a short-lived presigned GET. Returns null on failure. */
export async function downloadS3Object(key: string): Promise<Buffer | null> {
  const cfg = getS3Config();
  if (!cfg) return null;
  try {
    const url = presignS3Url({ method: 'GET', key, expiresInSeconds: 300 });
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[directUpload] GET ${key} failed: HTTP ${res.status}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    console.warn(`[directUpload] GET ${key} errored:`, err?.message);
    return null;
  }
}

/** Best-effort cleanup of a transient upload; never throws. */
export async function deleteS3Object(key: string): Promise<void> {
  try {
    const url = presignS3Url({ method: 'DELETE', key, expiresInSeconds: 120 });
    await fetch(url, { method: 'DELETE' });
  } catch (err: any) {
    console.warn(`[directUpload] DELETE ${key} failed:`, err?.message);
  }
}
