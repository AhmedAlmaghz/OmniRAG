import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { getEnv } from '@/lib/env/runtimeEnv';
import { serverErrorResponse } from '@/lib/api/safeError';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/documents/[id]/reindex
 *
 * Rebuilds a document's chunk grid and vector index from its stored content.
 * This is the REAL backend for the knowledge UI's reindex action — the old UI
 * ran a 1-second setTimeout and never touched the backend, so "reindexing"
 * changed nothing. It also serves as the recovery path for documents stuck in
 * `failed` after a transient vector-store outage.
 *
 * Response:
 *   200 { success, document, indexing: { indexed, failed, total, errors } }
 *   404 when the document does not belong to the caller's tenant.
 */
export const POST = withAuthAndRateLimit(async (req, authCtx, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const tenantId = authCtx.tenantId;

  // Load dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  try {
    const existing = await db.getDocumentById(id, tenantId);
    if (!existing) {
      return NextResponse.json({ error: 'المستند غير موجود', code: 'NOT_FOUND' }, { status: 404 });
    }

    const outcome = await db.reindexDocument(id, tenantId);
    if (!outcome) {
      return NextResponse.json(
        { error: 'تعذرت إعادة الفهرسة: المستند لا يحتوي على محتوى', code: 'EMPTY_CONTENT' },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: outcome.result.success,
      message: outcome.result.success
        ? `تمت إعادة فهرسة "${outcome.document.title}" بنجاح (${outcome.result.indexed} مقطع)`
        : `اكتملت إعادة الفهرسة مع أخطاء: ${outcome.result.errors.join('؛ ')}`,
      document: outcome.document,
      indexing: outcome.result,
    });
  } catch (err: any) {
    return serverErrorResponse('documents reindex POST', err);
  }
});
