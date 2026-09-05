import { createLogger } from '@/lib/logging/logger';

const log = createLogger('AppApiV1Documents');

import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '@/lib/storage/db';
import { Document, DocumentChunk, SourceConnector, SOURCE_TYPE_VALUES, SourceType } from '@/lib/types/omnirag';
import { getEnv } from '@/lib/env/runtimeEnv';
import { serverErrorResponse } from '@/lib/api/safeError';
import { guardPermission } from '@/lib/auth/permissions';
import { chunkDocumentWithPages, resolveChunkGeometry, estimateTokenCount } from '@/lib/rag/chunker';
import { dispatchWebhookEvent } from '@/lib/services/webhookService';
import { guardQuota } from '@/lib/services/planService';
import { parseModelConfigFromRequest } from '@/lib/config/aiModels';
import { runWithModelConfig } from '@/lib/config/aiModelsServer';

export const dynamic = 'force-dynamic';

/**
 * Request validation for document ingestion. Previously the body was
 * destructured with zero validation: content had no size limit, `language`
 * accepted anything, `collectionIds` could be a non-array, and
 * `chunkingConfig` was passed straight into the chunker. All of that is now
 * schema-checked with explicit, localized error messages.
 */
const MAX_CONTENT_CHARS = 4_000_000; // ~4M chars ≈ 10MB of UTF-8 text

const createDocumentSchema = z.object({
  title: z.string().trim().min(1, 'عنوان المستند مطلوب').max(500, 'العنوان طويل جداً (الحد 500 حرف)'),
  content: z
    .string()
    .min(1, 'محتوى المستند مطلوب')
    .max(MAX_CONTENT_CHARS, 'المحتوى يتجاوز الحد الأقصى المسموح (4 ملايين حرف)'),
  sourceType: z.string().optional(),
  sourceId: z.string().optional(),
  language: z.enum(['ar', 'en', 'auto']).default('ar'),
  collectionIds: z.array(z.string().min(1)).max(50).default([]),
  chunkingConfig: z
    .object({
      strategy: z.enum(['semantic', 'markdown', 'recursive']).optional(),
      size: z.number().int().min(64).max(8192).optional(),
      overlap: z.number().int().min(0).max(90).optional(),
    })
    .optional(),
  sourceConfig: z.record(z.string(), z.any()).default({}),
});

const VALID_SOURCE_TYPES = SOURCE_TYPE_VALUES;

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  // Load client-supplied dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  try {
    const denied = await guardPermission(authCtx, 'documents:read');
    if (denied) return denied;

    const tenantId = authCtx.tenantId;
    const documentId = req.nextUrl.searchParams.get('documentId');

    if (documentId) {
      // Scoped + paginated read (SQL filtering via the composite index) — the
      // previous behavior loaded every tenant chunk and filtered in JS.
      const limitParam = Number(req.nextUrl.searchParams.get('limit') || '200');
      const offsetParam = Number(req.nextUrl.searchParams.get('offset') || '0');
      const { chunks, total } = await db.getChunksByDocument(tenantId, documentId, {
        limit: Number.isFinite(limitParam) ? limitParam : 200,
        offset: Number.isFinite(offsetParam) ? offsetParam : 0,
      });
      return NextResponse.json({ chunks, total });
    }

    const docs = await db.getDocuments(tenantId);
    return NextResponse.json({ documents: docs });
  } catch (error: any) {
    log.error('API Error in documents GET:', error);
    return NextResponse.json(
      {
        documents: [],
        chunks: [],
        error: 'حدث خطأ داخلي في الخادم. يرجى المحاولة مرة أخرى لاحقاً.',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  // Load client-supplied dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  // Bind the client's configured models to this request: ingestion embeds every
  // chunk, which must use the user's embeddingModel choice — not the default.
  const modelConfig = parseModelConfigFromRequest(req);

  return await runWithModelConfig(modelConfig, async () => {
    try {
      const denied = await guardPermission(authCtx, 'documents:write');
      if (denied) return denied;

      // Plan quota (Phase 7): document ceiling for the workspace's plan.
      const quotaDenied = await guardQuota(authCtx.tenantId, 'maxDocuments');
      if (quotaDenied) return quotaDenied;

      const body = await req.json();
      const tenantId = authCtx.tenantId;

      const parsed = createDocumentSchema.safeParse(body);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        return NextResponse.json(
          {
            error: firstIssue?.message || 'بيانات المستند غير صالحة',
            code: 'VALIDATION_ERROR',
            issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          },
          { status: 400 },
        );
      }

      const {
        title,
        content,
        sourceType,
        sourceId: providedSourceId,
        language,
        collectionIds,
        chunkingConfig,
        sourceConfig,
      } = parsed.data;

      // Verify referenced collections actually exist for this tenant instead of
      // silently accepting dangling ids that would later filter out every chunk.
      if (collectionIds.length > 0) {
        const existingCols = await db.getCollections(tenantId);
        const existingIds = new Set(existingCols.map((c) => c.id));
        const missing = collectionIds.filter((id) => !existingIds.has(id));
        if (missing.length > 0) {
          return NextResponse.json(
            {
              error: `مجموعات غير موجودة: ${missing.join('، ')}`,
              code: 'UNKNOWN_COLLECTIONS',
            },
            { status: 400 },
          );
        }
      }

      const ingestionStartedAt = Date.now();

      // Ensure a Source Connector exists or is created for this ingested document
      let sourceId = providedSourceId;
      let sourceObj: SourceConnector | undefined;

      if (sourceId) {
        sourceObj = await db.getSourceById(sourceId, tenantId);
        if (sourceObj) {
          await db.updateSource(
            sourceId,
            {
              documentCount: (sourceObj.documentCount || 0) + 1,
              lastSyncAt: new Date().toISOString(),
              status: 'healthy',
            },
            tenantId,
          );
        }
      }

      if (!sourceObj) {
        const validSourceType: SourceType = VALID_SOURCE_TYPES.includes(sourceType as SourceType)
          ? (sourceType as SourceType)
          : 'file';

        sourceId = `src-${validSourceType}-${randomUUID().slice(0, 8)}`;
        sourceObj = {
          id: sourceId,
          tenantId,
          name: title,
          type: validSourceType,
          status: 'healthy',
          config: sourceConfig,
          syncSchedule: 'manual',
          lastSyncAt: new Date().toISOString(),
          documentCount: 1,
          collectionIds,
          createdAt: new Date().toISOString(),
        };
        await db.addSource(sourceObj);
      }

      const docId = `doc-${randomUUID()}`;
      const nowIso = new Date().toISOString();
      const newDoc: Document = {
        id: docId,
        tenantId,
        title,
        content,
        sourceType: sourceObj.type === 'file' || sourceObj.type === 'web_file' ? 'file' : 'integration',
        language,
        // Status lifecycle: the document starts as `processing` and only becomes
        // `indexed` after the vector store confirms the upsert (or `failed`).
        status: 'processing',
        chunkCount: 0,
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        metadata: {
          sourceId: sourceObj.id,
          sourceName: sourceObj.name,
          sourceType: sourceObj.type,
          chunkingConfig,
        },
        collectionIds,
        versions: [
          {
            id: `ver-${docId}-v1`,
            documentId: docId,
            versionNumber: 1,
            title,
            content,
            chunkCount: 0,
            createdAt: nowIso,
            createdBy: 'Ingestion Pipeline',
            changeSummary: 'الإصدار الأصلي المستوعب في قاعدة المعرفة',
          },
        ],
      };

      // Unified chunking — all ingestion paths go through chunkDocument so the
      // same document always produces the same chunk grid regardless of route.
      // Geometry (size/overlap/strategy) is validated and clamped inside.
      // The page-aware variant additionally extracts real page numbers from the
      // `[صفحة N]` markers embedded by the PDF/OCR pipelines, so citations cite
      // actual pages instead of a hardcoded "صفحة 1".
      const pageChunks = chunkDocumentWithPages(content, chunkingConfig);
      const chunkTextList = pageChunks.map((c) => c.text);
      const geometry = resolveChunkGeometry(chunkingConfig);
      const strategy = geometry.strategy;

      newDoc.chunkCount = chunkTextList.length;
      await db.addDocument(newDoc);

      // Chunks carry a concrete language ('ar'|'en'); 'auto' resolves to Arabic
      // as the app's default content language.
      const chunkLanguage: DocumentChunk['language'] = language === 'en' ? 'en' : 'ar';

      const chunks: DocumentChunk[] = pageChunks.map((pageChunk, index) => ({
        id: `chunk-${docId}-${index + 1}`,
        tenantId,
        documentId: docId,
        documentTitle: title,
        content: pageChunk.text,
        chunkIndex: index,
        // Real page from extraction markers when available; 1 only as the
        // neutral default for marker-less sources (plain text, paste, web).
        pageNumber: pageChunk.pageNumber ?? 1,
        language: chunkLanguage,
        metadata: {
          sourceId: sourceObj.id,
          position: index,
          strategy,
          tokenCount: estimateTokenCount(pageChunk.text),
          ...(pageChunk.pageNumber != null ? { extractedPage: true } : {}),
        },
      }));
      const indexResult = await db.addChunks(chunks);

      // Flip the document status based on the REAL indexing outcome and persist
      // the failure reasons (if any) so the UI can surface them.
      const finalStatus: Document['status'] = indexResult.success ? 'indexed' : 'failed';
      newDoc.status = finalStatus;
      newDoc.metadata = {
        ...newDoc.metadata,
        indexedAt: new Date().toISOString(),
        indexErrors: indexResult.errors.length > 0 ? indexResult.errors : undefined,
      };
      await db.updateDocument(docId, { status: finalStatus, metadata: newDoc.metadata }, tenantId);

      // Register sync log with the MEASURED duration for honest feedback.
      const durationMs = Date.now() - ingestionStartedAt;
      await db.addSyncLog({
        id: `log-${randomUUID()}`,
        tenantId,
        sourceId: sourceObj.id,
        sourceName: sourceObj.name,
        status: indexResult.success ? 'success' : 'failed',
        itemsProcessed: chunkTextList.length,
        durationMs,
        message: indexResult.success
          ? `تم استيعاب وتجزئة المستند "${title}" إلى ${chunkTextList.length} مقطع وفهرسته في قواعد المتجهات`
          : `تم استيعاب "${title}" لكن الفهرسة المتجهية فشلت: ${indexResult.errors.join('؛ ')}`,
        timestamp: new Date().toISOString(),
      });

      // Outbound webhook (Phase 6) — notify subscribers after the response.
      // Best-effort: dispatch never throws and must not affect ingestion.
      if (indexResult.success) {
        after(() =>
          dispatchWebhookEvent(tenantId, 'document.indexed', {
            documentId: docId,
            title,
            sourceId: sourceObj.id,
            chunkCount: chunkTextList.length,
            durationMs,
          }),
        );
      }

      return NextResponse.json(
        {
          success: indexResult.success,
          document: newDoc,
          source: sourceObj,
          chunkCount: chunkTextList.length,
          indexing: indexResult,
        },
        { status: 201 },
      );
    } catch (err: any) {
      return serverErrorResponse('documents POST', err);
    }
  });
});

export const DELETE = withAuthAndRateLimit(async (req, authCtx, props) => {
  // Load client-supplied dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  const denied = await guardPermission(authCtx, 'documents:delete');
  if (denied) return denied;

  const docId = req.nextUrl.searchParams.get('id');
  const tenantId = authCtx.tenantId;

  if (!docId) return NextResponse.json({ error: 'Missing document id' }, { status: 400 });

  await db.deleteDocument(docId, tenantId);

  // Outbound webhook (Phase 6) — best-effort, after the response.
  after(() => dispatchWebhookEvent(tenantId, 'document.deleted', { documentId: docId }));

  return NextResponse.json({ success: true });
});
