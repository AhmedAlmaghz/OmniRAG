import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { getEnv } from '@/lib/env/runtimeEnv';
import { serverErrorResponse } from '@/lib/api/safeError';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/documents/status
 *
 * Lightweight status snapshot used by the knowledge UI to poll while documents
 * are being processed. Returns ONLY the fields the UI needs to render live
 * status (id, status, chunkCount, error reasons) instead of the full document
 * list with content bodies — which is what a full refetch would transfer.
 *
 * The UI polls this endpoint every few seconds while any document is in
 * `processing`/`pending` state, then stops. This replaces the previous
 * behavior where a processing document stayed "جاري الفهرسة" forever until
 * the user manually hit refresh.
 */
export const GET = withAuthAndRateLimit(async (req, authCtx) => {
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);

  try {
    const tenantId = authCtx.tenantId;
    const docs = await db.getDocuments(tenantId);

    const statuses = docs.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      chunkCount: d.chunkCount || 0,
      updatedAt: d.updatedAt || d.createdAt,
      indexErrors: Array.isArray(d.metadata?.indexErrors) ? d.metadata.indexErrors : undefined,
    }));

    const processingCount = statuses.filter((s) => s.status === 'processing' || s.status === 'pending').length;

    return NextResponse.json({
      statuses,
      processingCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return serverErrorResponse('documents status GET', err);
  }
});
