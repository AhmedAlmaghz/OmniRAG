import { NextResponse } from 'next/server';
import { handleUpload } from '@vercel/blob/client';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { guardPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

/**
 * OPTIONAL Vercel-Blob path for large-file uploads.
 *
 * This endpoint only participates when the app is hosted on Vercel
 * (process.env.VERCEL) with a Blob store connected. The portable default is
 * the S3-compatible provider (Tigris / AWS S3 / R2 / MinIO) served by
 * /api/v1/documents/upload-session — it works on any host and takes
 * priority. The module is dynamically reachable only through that
 * negotiation, so non-Vercel deployments never depend on it.
 *
 * Security model:
 *  - Authenticated via the standard session cookie (withAuthAndRateLimit).
 *  - The issued client token is scoped to `uploads/{tenantId}/…` so a tenant
 *    can only write into its own namespace.
 *  - Size and content-type ceilings are enforced in the token itself, so the
 *    Blob API rejects oversized or disallowed uploads even if the client lies.
 */

const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB — mirrors the parse route cap

const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-powerpoint',
  'application/vnd.ms-excel',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/octet-stream',
];

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  const denied = await guardPermission(authCtx, 'documents:write');
  if (denied) return denied;

  if (!process.env.VERCEL || !process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error: 'مسار Vercel Blob غير مفعل على هذه الاستضافة (Vercel Blob path not active on this host)',
        code: '503_BLOB_NOT_CONFIGURED',
      },
      { status: 503 },
    );
  }

  try {
    const body = await req.json();
    const tenantId = authCtx.tenantId;

    const result = await handleUpload({
      request: req,
      body,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => {
        // Enforce tenant-scoped path prefix — prevents cross-tenant writes.
        const expectedPrefix = `uploads/${tenantId}/`;
        if (!pathname.startsWith(expectedPrefix)) {
          throw new Error(`Upload path must start with "${expectedPrefix}"`);
        }

        return {
          maximumSizeInBytes: MAX_UPLOAD_SIZE_BYTES,
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          // Short-lived token: enough for a 50 MB upload on a slow line.
          validUntil: Date.now() + 15 * 60 * 1000,
          tokenPayload: JSON.stringify({ tenantId }),
        };
      },
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[upload-token] Error generating client token:', error?.message);
    return NextResponse.json(
      {
        error: 'تعذر إنشاء رمز الرفع (Failed to generate upload token)',
        code: '500_UPLOAD_TOKEN_ERROR',
      },
      { status: 500 },
    );
  }
});
