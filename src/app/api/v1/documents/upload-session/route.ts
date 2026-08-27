import { NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import {
  DIRECT_UPLOAD_MAX_BYTES,
  UPLOAD_ALLOWED_EXTENSIONS,
  buildTenantObjectKey,
  getUploadProvider,
  presignS3Url,
} from '@/lib/uploads/directUpload';
import { guardPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

/**
 * Provider-negotiation endpoint for large-file direct uploads.
 *
 * The client asks "how should I upload this big file?" BEFORE sending any
 * bytes. The answer depends on what the host has configured:
 *
 *  - `s3`          → presigned PUT URL (Tigris / AWS S3 / R2 / MinIO — any host)
 *  - `vercel-blob` → client-sdk token flow against /api/v1/documents/upload-token
 *                     (Vercel-hosted deployments with a Blob store only)
 *  - `none`        → no provider: the client falls back to the normal direct
 *                     POST, which is fine on hosts without body-size limits.
 *
 * Presigned PUTs are scoped to `uploads/{tenantId}/…`, bind the declared
 * Content-Type, and expire after 15 minutes.
 */

const PUT_EXPIRY_SECONDS = 15 * 60;

export const POST = withAuthAndRateLimit(
  async (req, authCtx) => {
    const denied = await guardPermission(authCtx, 'documents:write');
    if (denied) return denied;

    const body = await req.json().catch(() => null);
    const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : '';
    const rawMime =
      typeof body?.mimeType === 'string' && body.mimeType.trim() ? body.mimeType.trim() : 'application/octet-stream';
    const sizeBytes = Number(body?.sizeBytes) || 0;

    if (!fileName) {
      return NextResponse.json(
        { error: 'اسم الملف مطلوب (fileName is required)', code: '400_MISSING_FILE_NAME' },
        { status: 400 },
      );
    }

    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext && !UPLOAD_ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: `صيغة الملف (.${ext}) غير مدعومة (Unsupported file type)`, code: '415_UNSUPPORTED_TYPE' },
        { status: 415 },
      );
    }

    if (sizeBytes > DIRECT_UPLOAD_MAX_BYTES) {
      return NextResponse.json(
        {
          error: `حجم الملف يتجاوز الحد الأقصى (${Math.round(DIRECT_UPLOAD_MAX_BYTES / (1024 * 1024))} ميجابايت)`,
          code: '413_FILE_TOO_LARGE',
        },
        { status: 413 },
      );
    }

    const provider = getUploadProvider();
    if (!provider) {
      // Graceful: the client keeps using the classic direct upload path.
      return NextResponse.json({ method: 'none' });
    }

    if (provider === 's3') {
      const storageKey = buildTenantObjectKey(authCtx.tenantId, fileName);
      const uploadUrl = presignS3Url({
        method: 'PUT',
        key: storageKey,
        expiresInSeconds: PUT_EXPIRY_SECONDS,
        contentType: rawMime,
      });
      return NextResponse.json({
        method: 's3',
        storageKey,
        uploadUrl,
        contentType: rawMime,
        expiresInMs: PUT_EXPIRY_SECONDS * 1000,
      });
    }

    // vercel-blob: the browser SDK fetches its own token from handleUploadUrl.
    return NextResponse.json({
      method: 'vercel-blob',
      handleUploadUrl: '/api/v1/documents/upload-token',
      expiresInMs: PUT_EXPIRY_SECONDS * 1000,
    });
  },
  { limit: 20, windowMs: 60000 },
);
