import { NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { getObjectStoreForTenant } from '@/lib/storage/objects/registry';
import { isArtifactKeyForTenant } from '@/lib/skills/artifactStore';
import { isTenantObjectKey } from '@/lib/uploads/directUpload';
import { guardPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

/**
 * Serves tenant-owned objects (skill-generated artifacts under `generated/`
 * and ingestion uploads under `uploads/`) from the tenant's selected object
 * store. Auth is mandatory (cookie session or Bearer API key) and the key's
 * tenant prefix must match the authenticated tenant — a caller can never read
 * another tenant's objects even with a guessed key.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

/** Images render inline; everything else downloads as an attachment. */
const INLINE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);

export const GET = withAuthAndRateLimit(
  async (req, authCtx, { params }: { params: Promise<{ key: string[] }> }) => {
    const denied = await guardPermission(authCtx, 'documents:read');
    if (denied) return denied;

    const { key: segments } = await params;
    const key = (segments || []).map((s) => decodeURIComponent(s)).join('/');

    const belongsToTenant = isArtifactKeyForTenant(key, authCtx.tenantId) || isTenantObjectKey(key, authCtx.tenantId);
    if (!belongsToTenant) {
      return NextResponse.json(
        { error: 'مسار الملف غير صالح أو غير تابع للمستأجر', code: '404_NOT_FOUND' },
        { status: 404 },
      );
    }

    const store = await getObjectStoreForTenant(authCtx.tenantId);
    if (!store.isConfigured()) {
      return NextResponse.json(
        { error: `مخزن الكائنات (${store.nameAr}) غير مهيأ في هذا النشر`, code: '503_UNAVAILABLE' },
        { status: 503 },
      );
    }

    const data = await store.get(key);
    if (!data) {
      return NextResponse.json({ error: 'الملف غير موجود', code: '404_NOT_FOUND' }, { status: 404 });
    }

    const fileName = key.split('/').pop() || 'file';
    // Keys are `{uuid}-{sanitizedName}`; strip the uuid prefix for the user.
    const displayName = fileName.replace(/^[0-9a-f-]{36}-/i, '');
    const extension = (displayName.split('.').pop() || '').toLowerCase();
    const contentType = MIME_BY_EXTENSION[extension] || 'application/octet-stream';
    const inline = INLINE_EXTENSIONS.has(extension);

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(data.byteLength),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(displayName)}`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  },
  { limit: 120, windowMs: 60000 },
);
