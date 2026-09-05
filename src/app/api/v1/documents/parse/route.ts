import { createLogger } from '@/lib/logging/logger';

const log = createLogger('AppApiV1DocumentsParse');

import crypto from 'crypto';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { isTenantObjectKey, downloadS3Object, deleteS3Object } from '@/lib/uploads/directUpload';
import { getEnv } from '@/lib/env/runtimeEnv';
import { processFileBuffer, archiveUploadedFile, normalizeMimeType } from '@/lib/services/unstructuredService';
import { serverErrorResponse } from '@/lib/api/safeError';
import { parseModelConfigFromRequest } from '@/lib/config/aiModels';
import { runWithModelConfig } from '@/lib/config/aiModelsServer';
import { getObjectStoreSelection } from '@/lib/storage/objects/registry';
import { guardPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

// Function run-time ceiling (seconds) for this route. Next.js requires a
// literal here — env-driven values fail the segment-config analyzer.
// 60 deploys on EVERY Vercel plan (Hobby's hard ceiling). To allow the
// long cloud extractions measured in testing (full-book OCR ≈ 7.4 min,
// PPTX via Unstructured Jobs ≈ 6.5 min), raise this on Pro Fluid to 800.
// Self-hosted / Cloud Run ignore the value entirely (no platform timeout).
export const maxDuration = 60;

interface ServerOcrCacheEntry {
  text: string;
  charCount: number;
  wordCount: number;
  totalPages: number;
  chunksProcessed: number;
  engineUsed: string;
  fileSizeMb: string;
  cachedAt: number;
  hits: number;
}

/**
 * Bounded LRU cache for server-side OCR results.
 *
 * The previous implementation was a plain `Map` with NO eviction: every parsed
 * upload (up to 50MB of extracted text each) was cached forever, so a busy
 * tenant could grow process memory without limit until the server OOM'd.
 *
 * This LRU enforces two ceilings — a maximum entry count AND a maximum total
 * character volume — evicting least-recently-used entries first. `get`
 * refreshes recency so hot documents stay cached.
 */
class BoundedOcrCache {
  private readonly map = new Map<string, ServerOcrCacheEntry>();

  constructor(
    private readonly maxEntries: number = 25,
    private readonly maxTotalChars: number = 8_000_000,
  ) {}

  private totalChars = 0;

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): ServerOcrCacheEntry | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    // Refresh recency: re-insert so this key becomes the newest.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key: string, entry: ServerOcrCacheEntry): void {
    // Never cache a single entry larger than the whole budget.
    if (entry.charCount > this.maxTotalChars) return;

    if (this.map.has(key)) {
      const old = this.map.get(key)!;
      this.totalChars -= old.charCount;
      this.map.delete(key);
    }

    this.map.set(key, entry);
    this.totalChars += entry.charCount;
    this.evict();
  }

  private evict(): void {
    // Evict least-recently-used (first key in insertion order) until both
    // ceilings are satisfied.
    while (this.map.size > this.maxEntries || this.totalChars > this.maxTotalChars) {
      const oldestKey = this.map.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.map.get(oldestKey)!;
      this.totalChars -= oldest.charCount;
      this.map.delete(oldestKey);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

const SERVER_OCR_CACHE = new BoundedOcrCache();

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'audio/mp3',
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
  'audio/aac',
  'audio/flac',
  'audio/mp4',
  'audio/x-m4a',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/ogg',
  'video/avi',
]);

const ALLOWED_EXTENSIONS = new Set([
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
  'webm',
  'ogg',
  'aac',
  'flac',
  'm4a',
  'mp4',
  'mov',
  'avi',
]);

// Default 10MB per upload; 50MB is the server-enforced hard cap. The cap is
// intentionally NOT controllable by client headers to prevent DoS abuse.
const DEFAULT_MAX_FILE_SIZE_MB = 10;
const MAX_ALLOWED_FILE_SIZE_MB_CAP = 50;

/**
 * Fetches a file the client uploaded directly to an S3-compatible store
 * (Tigris / AWS S3 / R2 / MinIO) and returns its bytes. The client sends only
 * the tenant-scoped object key, so this path bypasses any hosting body limit.
 * The transient object is deleted after reading (best-effort).
 */
async function fetchS3StoredFile(
  storageKey: string,
  tenantId: string,
): Promise<{ buffer: Buffer } | { error: string; code: string }> {
  if (!isTenantObjectKey(storageKey, tenantId)) {
    return { error: 'مفتاح التخزين غير مسموح (Storage key not permitted)', code: '403_STORAGE_KEY_FORBIDDEN' };
  }

  const buffer = await downloadS3Object(storageKey);
  if (!buffer || buffer.length === 0) {
    return { error: 'تعذر قراءة الملف من التخزين (Could not read file from storage)', code: '404_OBJECT_NOT_FOUND' };
  }

  // Best-effort cleanup — the bytes are already in memory.
  deleteS3Object(storageKey).catch(() => {});

  return { buffer };
}

/**
 * Fetches a file previously uploaded directly to Vercel Blob storage (the
 * optional Vercel-hosted path) and returns its bytes. The SDK is imported
 * dynamically so deployments without a Blob store never load it.
 *
 * SSRF guard: only URLs on the tenant's own Blob store host are accepted.
 * The blob is deleted after reading (best-effort) so transient uploads do not
 * accumulate storage cost.
 */
async function fetchBlobFile(
  blobUrl: string,
  tenantId: string,
): Promise<{ buffer: Buffer; fileName: string; mimeType: string } | { error: string; code: string }> {
  let parsed: URL;
  try {
    parsed = new URL(blobUrl);
  } catch {
    return { error: 'رابط التخزين غير صالح (Invalid blob URL)', code: '400_INVALID_BLOB_URL' };
  }

  // Only accept Vercel Blob store hosts, and only the tenant's own namespace.
  const isVercelBlobHost = parsed.hostname.endsWith('.public.blob.vercel-storage.com');
  const tenantPrefix = `/uploads/${tenantId}/`;
  if (!isVercelBlobHost || !parsed.pathname.startsWith(tenantPrefix)) {
    return { error: 'رابط التخزين غير مسموح (Blob URL not permitted)', code: '403_BLOB_URL_FORBIDDEN' };
  }

  try {
    const { get, del } = await import('@vercel/blob');
    const result = await get(blobUrl, { access: 'public' });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return { error: 'تعذر قراءة الملف من التخزين (Could not read file from storage)', code: '404_BLOB_NOT_FOUND' };
    }

    const chunks: Uint8Array[] = [];
    const reader = result.stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const buffer = Buffer.concat(chunks);

    const fileName = decodeURIComponent(parsed.pathname.split('/').pop() || 'document.bin');
    const mimeType = result.blob.contentType || 'application/octet-stream';

    // Best-effort cleanup of the transient upload.
    del(blobUrl, {}).catch((delErr) => {
      log.warn('[Document Ingestion] Failed to delete transient blob:', delErr?.message);
    });

    return { buffer, fileName, mimeType };
  } catch (err: any) {
    log.error('[Document Ingestion] Blob fetch failed:', err?.message);
    return {
      error: 'فشل تحميل الملف من التخزين المؤقت (Failed to load file from storage)',
      code: '502_BLOB_FETCH_FAILED',
    };
  }
}

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  // The wrapper already applied rate limiting and verified auth; authCtx is the
  // single source of identity. No redundant inner checks here.

  // Load client-supplied dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('GROQ_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  // Bind the client's configured models to this request so the document-
  // parsing services (Gemini multimodal / Mistral OCR / Groq Whisper / default
  // Gemini fallback) resolve the user's choices via getAiModel instead of
  // module-level literals.
  const modelConfig = parseModelConfigFromRequest(req);

  return await runWithModelConfig(modelConfig, async () => {
    try {
      const parseDenied = await guardPermission(authCtx, 'documents:write');
      if (parseDenied) return parseDenied;

      let fileName = 'document.txt';
      let fileBuffer: Buffer | null = null;
      let cleanBase64 = '';
      let mimeType = 'text/plain';
      let requestedModel: string | undefined = undefined;
      let requestedEngine = 'auto';
      let mistralApiKey: string | undefined = undefined;
      let unstructuredApiKey: string | undefined = undefined;
      let groqApiKey: string | undefined = undefined;
      let requestedMaxFileSizeMb = DEFAULT_MAX_FILE_SIZE_MB;
      let requestedPagesPerChunk = 25;

      const contentType = req.headers.get('content-type') || '';
      const headerMaxFileSize = req.headers.get('x-max-file-size-mb');
      const headerPagesPerChunk = req.headers.get('x-pages-per-chunk');

      if (headerMaxFileSize && !isNaN(Number(headerMaxFileSize))) {
        requestedMaxFileSizeMb = Math.min(Math.max(Number(headerMaxFileSize), 1), MAX_ALLOWED_FILE_SIZE_MB_CAP);
      }
      if (headerPagesPerChunk && !isNaN(Number(headerPagesPerChunk))) {
        requestedPagesPerChunk = Math.min(Math.max(Number(headerPagesPerChunk), 1), 200);
      }

      if (contentType.includes('application/json')) {
        try {
          const jsonBody = await req.json();
          if (jsonBody && jsonBody.storageKey) {
            // Large-file path (portable): the file was uploaded directly to an
            // S3-compatible store (Tigris / AWS S3 / R2 / MinIO). Fetch the
            // bytes here and continue with the normal pipeline.
            const stored = await fetchS3StoredFile(jsonBody.storageKey, authCtx.tenantId);
            if ('error' in stored) {
              return NextResponse.json({ error: stored.error, code: stored.code }, { status: 400 });
            }
            fileBuffer = stored.buffer;
            fileName = jsonBody.fileName || 'document.bin';
            mimeType = jsonBody.mimeType || 'application/octet-stream';
            requestedEngine = jsonBody.engine || 'auto';
            requestedModel = jsonBody.model || undefined;
            mistralApiKey = jsonBody.mistralApiKey || undefined;
            unstructuredApiKey = jsonBody.unstructuredApiKey || undefined;
            groqApiKey = jsonBody.groqApiKey || undefined;

            if (jsonBody.maxFileSizeMb && !isNaN(Number(jsonBody.maxFileSizeMb))) {
              requestedMaxFileSizeMb = Math.min(
                Math.max(Number(jsonBody.maxFileSizeMb), 1),
                MAX_ALLOWED_FILE_SIZE_MB_CAP,
              );
            }
            if (jsonBody.pagesPerChunk && !isNaN(Number(jsonBody.pagesPerChunk))) {
              requestedPagesPerChunk = Math.min(Math.max(Number(jsonBody.pagesPerChunk), 1), 200);
            }
          } else if (jsonBody && jsonBody.blobUrl) {
            // Large-file path (Vercel-hosted option): the file was uploaded
            // directly to Vercel Blob by the client. Fetch the bytes here and
            // continue with the normal pipeline.
            const blobResult = await fetchBlobFile(jsonBody.blobUrl, authCtx.tenantId);
            if ('error' in blobResult) {
              return NextResponse.json({ error: blobResult.error, code: blobResult.code }, { status: 400 });
            }
            fileBuffer = blobResult.buffer;
            fileName = jsonBody.fileName || blobResult.fileName;
            mimeType = jsonBody.mimeType || blobResult.mimeType;
            requestedEngine = jsonBody.engine || 'auto';
            requestedModel = jsonBody.model || undefined;
            mistralApiKey = jsonBody.mistralApiKey || undefined;
            unstructuredApiKey = jsonBody.unstructuredApiKey || undefined;
            groqApiKey = jsonBody.groqApiKey || undefined;

            if (jsonBody.maxFileSizeMb && !isNaN(Number(jsonBody.maxFileSizeMb))) {
              requestedMaxFileSizeMb = Math.min(
                Math.max(Number(jsonBody.maxFileSizeMb), 1),
                MAX_ALLOWED_FILE_SIZE_MB_CAP,
              );
            }
            if (jsonBody.pagesPerChunk && !isNaN(Number(jsonBody.pagesPerChunk))) {
              requestedPagesPerChunk = Math.min(Math.max(Number(jsonBody.pagesPerChunk), 1), 200);
            }
          } else if (jsonBody && jsonBody.fileData) {
            fileName = jsonBody.fileName || 'document.txt';
            mimeType = jsonBody.mimeType || 'text/plain';
            cleanBase64 = jsonBody.fileData.includes(',') ? jsonBody.fileData.split(',')[1] : jsonBody.fileData;
            fileBuffer = Buffer.from(cleanBase64, 'base64');
            requestedEngine = jsonBody.engine || 'auto';
            requestedModel = jsonBody.model || undefined;
            mistralApiKey = jsonBody.mistralApiKey || undefined;
            unstructuredApiKey = jsonBody.unstructuredApiKey || undefined;
            groqApiKey = jsonBody.groqApiKey || undefined;

            if (jsonBody.maxFileSizeMb && !isNaN(Number(jsonBody.maxFileSizeMb))) {
              requestedMaxFileSizeMb = Math.min(
                Math.max(Number(jsonBody.maxFileSizeMb), 1),
                MAX_ALLOWED_FILE_SIZE_MB_CAP,
              );
            }
            if (jsonBody.pagesPerChunk && !isNaN(Number(jsonBody.pagesPerChunk))) {
              requestedPagesPerChunk = Math.min(Math.max(Number(jsonBody.pagesPerChunk), 1), 200);
            }
          }
        } catch (jsonErr: any) {
          log.error('[Document Ingestion API] Error parsing JSON body:', jsonErr);
        }
      } else if (contentType.includes('multipart/form-data')) {
        try {
          const formData = await req.formData();
          if (formData) {
            let fileObj = formData.get('file') || formData.get('document') || formData.get('upload');
            if (!fileObj) {
              for (const [key, val] of formData.entries()) {
                if (val && typeof val === 'object') {
                  fileObj = val;
                  break;
                }
              }
            }

            if (fileObj && typeof fileObj === 'object') {
              const file = fileObj as any;
              fileName = (formData.get('fileName') as string) || file.name || 'document.txt';
              mimeType = (formData.get('mimeType') as string) || file.type || 'application/octet-stream';

              if (typeof file.arrayBuffer === 'function') {
                const arrayBuf = await file.arrayBuffer();
                fileBuffer = Buffer.from(arrayBuf);
              } else if (typeof file.stream === 'function') {
                const chunks = [];
                for await (const chunk of file.stream()) {
                  chunks.push(chunk);
                }
                fileBuffer = Buffer.concat(chunks);
              } else if (file._buffer) {
                fileBuffer = file._buffer;
              }

              if (fileBuffer) {
                cleanBase64 = fileBuffer.toString('base64');
              }
            } else {
              const fileDataStr = (formData.get('fileData') as string) || (formData.get('file_data') as string);
              if (fileDataStr) {
                fileName = (formData.get('fileName') as string) || 'document.txt';
                mimeType = (formData.get('mimeType') as string) || 'text/plain';
                cleanBase64 = fileDataStr.includes(',') ? fileDataStr.split(',')[1] : fileDataStr;
                fileBuffer = Buffer.from(cleanBase64, 'base64');
              }
            }

            requestedModel = (formData.get('model') as string) || undefined;
            requestedEngine = (formData.get('engine') as string) || 'auto';
            mistralApiKey = (formData.get('mistralApiKey') as string) || undefined;
            unstructuredApiKey = (formData.get('unstructuredApiKey') as string) || undefined;
            groqApiKey = (formData.get('groqApiKey') as string) || undefined;

            const formMaxFile = formData.get('maxFileSizeMb');
            if (formMaxFile && !isNaN(Number(formMaxFile))) {
              requestedMaxFileSizeMb = Math.min(Math.max(Number(formMaxFile), 1), MAX_ALLOWED_FILE_SIZE_MB_CAP);
            }
            const formPagesPerChunk = formData.get('pagesPerChunk');
            if (formPagesPerChunk && !isNaN(Number(formPagesPerChunk))) {
              requestedPagesPerChunk = Math.min(Math.max(Number(formPagesPerChunk), 1), 200);
            }
          }
        } catch (formErr: any) {
          log.error('[Document Ingestion API] Error parsing formData from request:', formErr);
        }
      } else {
        // Fallback for raw stream text
        try {
          const rawBody = await req.text();
          if (rawBody && rawBody.trim().length > 0) {
            fileBuffer = Buffer.from(rawBody);
            cleanBase64 = fileBuffer.toString('base64');
          }
        } catch (e) {}
      }

      // Merged presence + emptiness check (previously two consecutive blocks).
      if (!fileBuffer || fileBuffer.length === 0) {
        return NextResponse.json(
          {
            error: 'فشل تحليل الملف المرفوع أو أن محتواه فارغ. يرجى التأكد من اختيار ملف صحيح.',
            code: '400_BAD_FORM_DATA',
          },
          { status: 400 },
        );
      }

      // Size limit check
      const maxSizeBytes = requestedMaxFileSizeMb * 1024 * 1024;
      if (fileBuffer.length > maxSizeBytes) {
        return NextResponse.json(
          {
            error: `حجم الملف يتجاوز الحد الأقصى المسموح به (${requestedMaxFileSizeMb} ميجابايت)`,
            code: '413_FILE_TOO_LARGE',
          },
          { status: 413 },
        );
      }

      // Extension & MIME type check. The MIME is first normalized from the
      // file extension so a generic `application/octet-stream` from the
      // browser cannot vouch for an unknown extension: the previous
      // "reject only when BOTH ext AND mime are disallowed" rule let any
      // arbitrary file through whenever the client sent octet-stream. Policy
      // now: allow when the extension is allowlisted OR the normalized MIME
      // is an explicitly-known type — generic octet-stream alone proves
      // nothing.
      const fileExt = fileName.split('.').pop()?.toLowerCase() || '';
      const resolvedMime = normalizeMimeType(fileName, mimeType || '').toLowerCase();
      const mimeAllowed = resolvedMime !== 'application/octet-stream' && ALLOWED_MIME_TYPES.has(resolvedMime);
      const extAllowed = !!fileExt && ALLOWED_EXTENSIONS.has(fileExt);
      if (!extAllowed && !mimeAllowed) {
        return NextResponse.json(
          {
            error: `صيغة الملف (.${fileExt}) غير مدعومة. الصيغ المدعومة هي: PDF, DOCX, PPTX, TXT, Markdown, JSON, CSV, وشفرات البرمجة.`,
            code: '415_UNSUPPORTED_TYPE',
          },
          { status: 415 },
        );
      }

      // Server-side SHA-256 OCR Cache Check
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const skipCache = req.headers.get('x-skip-cache') === 'true';

      // Optional raw-file archiving, OFF by default. The unconditional local
      // disk write ran even on cache hits and grew without bound (PII
      // retention liability on multi-tenant hosts); enable explicitly with
      // ARCHIVE_UPLOADS=true when a retention policy exists. When enabled,
      // the original is archived through the tenant's chosen object store
      // (S3 / Vercel Blob / local) so it survives parsing instead of being
      // deleted with the transient upload.
      if (process.env.ARCHIVE_UPLOADS === 'true') {
        try {
          const tenantIdForArchive = authCtx.tenantId;
          const { store: archiveStore } = await getObjectStoreSelection(tenantIdForArchive);
          if (archiveStore.id === 'local') {
            // Historical archive directory for existing self-hosted deployments.
            const archivedPath = archiveUploadedFile(fileBuffer, fileName, tenantIdForArchive, fileHash);
            log.info(`[Document Ingestion] File archived to disk: ${archivedPath}`);
          } else {
            const dateStr = new Date().toISOString().slice(0, 10);
            const safeName = (fileName || 'document.bin').replace(/[^\w.\-() ]/g, '_').slice(-120);
            const archiveKey = `archive/${tenantIdForArchive}/${dateStr}/${fileHash.substring(0, 16)}_${safeName}`;
            const archived = await archiveStore.put(archiveKey, fileBuffer, resolvedMime);
            if (archived) {
              log.info(`[Document Ingestion] File archived to ${archiveStore.id}: ${archiveKey}`);
            } else {
              log.warn(`[Document Ingestion] Archiving to ${archiveStore.id} failed (non-fatal)`);
            }
          }
        } catch (archiveErr: any) {
          log.warn('[Document Ingestion] Archiving failed (non-fatal):', archiveErr?.message);
        }
      }

      const tenantId = authCtx.tenantId;
      // Cache key is scoped by tenantId: two tenants uploading identical bytes
      // must NOT share each other's extracted text. The previous file-hash-only
      // key leaked tenant A's OCR output to tenant B on an identical upload.
      const ocrCacheKey = `${tenantId}:${fileHash}`;
      if (!skipCache && SERVER_OCR_CACHE.has(ocrCacheKey)) {
        const cached = SERVER_OCR_CACHE.get(ocrCacheKey)!;
        cached.hits += 1;
        log.info(
          `[Document Ingestion Cache] Server OCR Cache Hit for ${fileName} (Tenant: ${tenantId}, Hash: ${fileHash.substring(0, 10)}..., Hits: ${cached.hits})`,
        );
        return NextResponse.json(
          {
            text: cached.text,
            charCount: cached.charCount,
            wordCount: cached.wordCount,
            totalPages: cached.totalPages,
            chunksProcessed: cached.chunksProcessed,
            engineUsed: `${cached.engineUsed} (Server Cache Hit ⚡)`,
            fileSizeMb: cached.fileSizeMb,
            isCacheHit: true,
            fileHash,
          },
          { headers: { 'X-OCR-Cache': 'HIT' } },
        );
      }

      let extractedText = '';
      let engineUsed = 'native-parser';
      let totalPages = 1;
      let chunksProcessed = 1;

      const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
      log.info(
        `[Document Ingestion] Processing ${isPdf ? 'PDF' : 'document'} (${fileName}, ${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB) via the shared file pipeline (engine: ${requestedEngine})...`,
      );

      // Shared pipeline with the web-file connector: PDFs go through the
      // batched page pipeline, everything else through dispatchFile.
      const processResult = await processFileBuffer(fileBuffer, fileName, mimeType, {
        preferredEngine: requestedEngine as any,
        pagesPerChunk: requestedPagesPerChunk,
        mistralApiKey,
        unstructuredApiKey,
        groqApiKey,
        model: requestedModel,
      });

      extractedText = processResult.text;
      totalPages = processResult.totalPages;
      chunksProcessed = processResult.chunksProcessed;
      engineUsed = processResult.engineUsed;

      if (isPdf && (!extractedText || extractedText.trim().length === 0)) {
        return NextResponse.json(
          {
            error:
              'تعذر استخراج النصوص من ملف PDF. يرجى التأكد من أن الملف يحتوي على نصوص قابلة للقراءة أو ليس محميًا بكلمة مرور.',
            code: '422_PDF_UNREADABLE',
          },
          { status: 422 },
        );
      }

      // Sanitize extracted text (strip null bytes and bad control characters)
      if (extractedText) {
        extractedText = extractedText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
      }

      if (!extractedText || extractedText.length === 0) {
        return NextResponse.json(
          {
            error: 'لم يتم استخراج أي نص من الملف. يرجى التأكد من أن الملف غير فارغ ويحتوي على نصوص قابلة للقراءة.',
            code: '422_UNREADABLE_DOCUMENT',
          },
          { status: 422 },
        );
      }

      // Cache successful OCR result in server memory (scoped by tenantId + fileHash)
      SERVER_OCR_CACHE.set(ocrCacheKey, {
        text: extractedText,
        charCount: extractedText.length,
        wordCount: extractedText.trim().split(/\s+/).length,
        totalPages,
        chunksProcessed,
        engineUsed,
        fileSizeMb: (fileBuffer.length / (1024 * 1024)).toFixed(2),
        cachedAt: Date.now(),
        hits: 0,
      });

      return NextResponse.json({
        text: extractedText,
        charCount: extractedText.length,
        wordCount: extractedText.trim().split(/\s+/).length,
        totalPages,
        chunksProcessed,
        engineUsed,
        fileSizeMb: (fileBuffer.length / (1024 * 1024)).toFixed(2),
        isCacheHit: false,
        fileHash,
      });
    } catch (error: any) {
      return serverErrorResponse('documents/parse POST', error);
    }
  }); // runWithModelConfig
});
