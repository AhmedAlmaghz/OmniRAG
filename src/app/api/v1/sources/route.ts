import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '@/lib/storage/db';
import { SourceConnector, SOURCE_TYPE_VALUES, SourceType } from '@/lib/types/omnirag';
import { getEnv } from '@/lib/env/runtimeEnv';
import { encryptSourceConfig, redactSourceConfig } from '@/lib/storage/sourceConfigCrypto';

export const dynamic = 'force-dynamic';

// Covers the post-response background ingestion on serverless hosts, where
// the initial sync (download + OCR + embedding) can run for minutes.
export const maxDuration = 300;

/**
 * Source connector creation payload. `type` was previously accepted as any
 * string, so a typo'd type produced a connector that no sync handler
 * understands. It is now restricted to the SourceType union — sourced from the
 * single SOURCE_TYPE_VALUES list in omnirag.ts instead of a route-local copy.
 */
const SOURCE_TYPES: SourceType[] = SOURCE_TYPE_VALUES;

const createSourceSchema = z.object({
  name: z.string().trim().min(1, 'اسم الموصل مطلوب').max(300, 'اسم الموصل طويل جدا'),
  type: z.enum(SOURCE_TYPES as [SourceType, ...SourceType[]], {
    message: 'نوع الموصل غير مدعوم',
  }),
  config: z.record(z.string(), z.any()).default({}),
  syncSchedule: z.string().trim().max(100).default('manual'),
  collectionIds: z.array(z.string().min(1)).max(50).default([]),
});

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  // Load client-supplied dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  const tenantId = authCtx.tenantId;
  try {
    const { searchParams } = new URL(req.url);
    const typeFilter = searchParams.get('type');
    const statusFilter = searchParams.get('status');

    let sources = await db.getSources(tenantId);

    if (typeFilter) {
      sources = sources.filter((s) => s.type === typeFilter);
    }

    if (statusFilter) {
      sources = sources.filter((s) => s.status === statusFilter);
    }

    const syncLogs = await db.getSyncLogs(tenantId);
    const mcpResources = await db.getMcpResources(tenantId);

    // Never expose connector secrets in API responses.
    const redactedSources = sources.map((s) => ({ ...s, config: redactSourceConfig(s.config) }));

    return NextResponse.json({
      tenantId,
      totalSources: redactedSources.length,
      sources: redactedSources,
      syncLogs,
      mcpResources,
    });
  } catch (error: any) {
    console.error('API Error in sources GET:', error);
    return NextResponse.json(
      {
        tenantId,
        totalSources: 0,
        sources: [],
        syncLogs: [],
        mcpResources: [],
        error: 'فشل تحميل مصادر البيانات (Failed to load sources)',
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

  try {
    const body = await req.json();
    // Tenant identity is derived exclusively from the verified auth context
    const tenantId = authCtx.tenantId;

    const parsed = createSourceSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message || 'بيانات الموصل غير صالحة', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    const { name, type, config, syncSchedule, collectionIds } = parsed.data;

    const id = `src-${type}-${randomUUID().slice(0, 8)}`;
    // Encrypt any credential-bearing fields before persistence.
    const encryptedConfig = encryptSourceConfig(config);
    const newSource: SourceConnector = {
      id,
      tenantId,
      name,
      type,
      status: 'healthy',
      config: encryptedConfig,
      configEncrypted: true,
      syncSchedule,
      lastSyncAt: new Date().toISOString(),
      documentCount: 1,
      collectionIds,
      createdAt: new Date().toISOString(),
    };

    await db.addSource(newSource);

    // Initial ingestion runs AFTER the response: connector syncs can download
    // remote files and run OCR/transcription/embedding pipelines that take
    // minutes on large or scanned files. Blocking the creation request that
    // long makes gateways/proxies time out and answer with HTML error pages
    // (surfaced in the UI as "Non-JSON response from server"). The UI follows
    // progress via source status ('syncing' → 'healthy'/'degraded') and logs.
    after(async () => {
      try {
        await db.syncSource(id, tenantId);
      } catch (err) {
        console.error(`[sources POST] Background initial sync failed for ${id}:`, err);
        try {
          await db.updateSource(id, { status: 'error', lastError: (err as Error)?.message || String(err) }, tenantId);
        } catch {
          /* best effort */
        }
      }
    });

    return NextResponse.json(
      {
        message: 'Source connector registered — initial indexing started in the background',
        syncStarted: true,
        source: { ...newSource, config: redactSourceConfig(newSource.config) },
      },
      { status: 201 },
    );
  } catch (error: any) {
    console.error('API Error in sources POST:', error);
    return NextResponse.json({ error: 'فشل إنشاء مصدر البيانات (Failed to create source connector)' }, { status: 500 });
  }
});

export const PUT = withAuthAndRateLimit(async (req, authCtx, props) => {
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
    const { id, ...updates } = body;
    const tenantId = authCtx.tenantId;

    if (!id) {
      return NextResponse.json({ error: 'Source ID is required' }, { status: 400 });
    }

    // Encrypt any credential-bearing fields supplied in the update payload.
    if (updates.config && typeof updates.config === 'object') {
      updates.config = encryptSourceConfig(updates.config);
      updates.configEncrypted = true;
    }

    const updated = await db.updateSource(id, updates, tenantId);
    if (!updated) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    return NextResponse.json({
      message: 'Source updated successfully',
      source: { ...updated, config: redactSourceConfig(updated.config) },
    });
  } catch (error: any) {
    console.error('API Error in sources PUT:', error);
    return NextResponse.json({ error: 'فشل تحديث مصدر البيانات (Failed to update source)' }, { status: 500 });
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

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const tenantId = authCtx.tenantId;
  const purgeDocs = searchParams.get('purgeDocs') !== 'false';

  if (!id) {
    return NextResponse.json({ error: 'Source ID is required' }, { status: 400 });
  }

  await db.deleteSource(id, tenantId, purgeDocs);

  return NextResponse.json({ message: 'Source connector removed and associated data purged', id });
});
