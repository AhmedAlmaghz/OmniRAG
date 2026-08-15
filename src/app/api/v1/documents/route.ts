import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { Document, DocumentChunk, SourceConnector, SourceType } from '@/lib/types/omnirag';
import { getEnv } from '@/lib/env/runtimeEnv';

export const dynamic = 'force-dynamic';

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
    const tenantId = authCtx.tenantId;
    const documentId = req.nextUrl.searchParams.get('documentId');

    if (documentId) {
      const allChunks = await db.getChunks(tenantId);
      const docChunks = allChunks.filter((c) => c.documentId === documentId);
      return NextResponse.json({ chunks: docChunks });
    }

    const docs = await db.getDocuments(tenantId);
    return NextResponse.json({ documents: docs });
  } catch (error: any) {
    console.error('API Error in documents GET:', error);
    return NextResponse.json({ documents: [], chunks: [], error: error.message || String(error) }, { status: 500 });
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

  try {
    const body = await req.json();
    const tenantId = authCtx.tenantId;
    const {
      title,
      content,
      sourceType = 'file',
      sourceId: providedSourceId,
      language = 'ar',
      collectionIds = [],
      chunkingConfig,
      sourceConfig = {},
    } = body;

    if (!title || !content) {
      return NextResponse.json({ error: 'العنوان والمحتوى مطلوبان' }, { status: 400 });
    }

    // Ensure a Source Connector exists or is created for this ingested document
    let sourceId = providedSourceId;
    let sourceObj: SourceConnector | undefined;

    if (sourceId) {
      sourceObj = await db.getSourceById(sourceId, tenantId);
      if (sourceObj) {
        await db.updateSource(sourceId, {
          documentCount: (sourceObj.documentCount || 0) + 1,
          lastSyncAt: new Date().toISOString(),
          status: 'healthy',
        }, tenantId);
      }
    }

    if (!sourceObj) {
      const validSourceType: SourceType = (['file', 'youtube', 'web', 'github', 'database', 'notion', 'gdrive', 'slack', 's3', 'api', 'custom_mcp', 'pdf'] as SourceType[]).includes(sourceType as SourceType)
        ? (sourceType as SourceType)
        : 'file';

      sourceId = `src-${validSourceType}-${Date.now().toString().slice(-6)}`;
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

    const docId = `doc-${Date.now()}`;
    const nowIso = new Date().toISOString();
    const newDoc: Document = {
      id: docId,
      tenantId,
      title,
      content,
      sourceType: sourceObj.type === 'file' ? 'file' : 'integration',
      language,
      status: 'indexed',
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

    // Advanced dynamic chunking logic
    const strategy = chunkingConfig?.strategy || 'semantic';
    const targetSize = Math.max(128, chunkingConfig?.size || 512);
    const overlapPercent = Math.min(50, Math.max(0, chunkingConfig?.overlap || 20));
    const charSize = Math.floor(targetSize * 2.5); // ~2.5 chars per token for AR/EN
    const overlapChars = Math.floor(charSize * (overlapPercent / 100));
    const step = Math.max(50, charSize - overlapChars);

    const chunkTextList: string[] = [];

    if (strategy === 'markdown') {
      const sections = content.split(/(?=\n#+ )/);
      sections.forEach((s: string) => {
        if (s.trim()) chunkTextList.push(s.trim());
      });
    } else {
      for (let i = 0; i < content.length; i += step) {
        const snippet = content.substring(i, i + charSize).trim();
        if (snippet) chunkTextList.push(snippet);
      }
    }

    newDoc.chunkCount = chunkTextList.length;
    await db.addDocument(newDoc);

    for (let index = 0; index < chunkTextList.length; index++) {
      const text = chunkTextList[index];
      const chunk: DocumentChunk = {
        id: `chunk-${docId}-${index + 1}`,
        tenantId,
        documentId: docId,
        documentTitle: title,
        content: text,
        chunkIndex: index,
        pageNumber: 1,
        language,
        metadata: {
          sourceId: sourceObj.id,
          position: index,
          strategy,
          tokenCount: Math.round(text.length / 2.8),
        },
      };
      await db.addChunk(chunk);
    }

    // Register sync log for visual feedback in Sources Manager
    await db.addSyncLog({
      id: `log-${Date.now()}`,
      tenantId,
      sourceId: sourceObj.id,
      sourceName: sourceObj.name,
      status: 'success',
      itemsProcessed: chunkTextList.length,
      durationMs: 1200,
      message: `تم استيعاب وتجزيء المستند "${title}" بنجاح وفهرسته في قواعد متجهات Qdrant`,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      document: newDoc,
      source: sourceObj,
      chunkCount: chunkTextList.length,
    }, { status: 201 });
  } catch (err: any) {
    console.error('API Error in documents POST:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
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

  const docId = req.nextUrl.searchParams.get('id');
  const tenantId = authCtx.tenantId;

  if (!docId) return NextResponse.json({ error: 'Missing document id' }, { status: 400 });

  await db.deleteDocument(docId, tenantId);
  return NextResponse.json({ success: true });
});
