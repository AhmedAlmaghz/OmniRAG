import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { SourceConnector } from '@/lib/types/omnirag';
import { getEnv } from '@/lib/env/runtimeEnv';
import { encryptSourceConfig, redactSourceConfig } from '@/lib/storage/sourceConfigCrypto';

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
    const { name, type, config = {}, syncSchedule = 'manual', collectionIds = [] } = body;
    // Tenant identity is derived exclusively from the verified auth context
    const tenantId = authCtx.tenantId;

    if (!name || !type) {
      return NextResponse.json({ error: 'Name and type are required fields' }, { status: 400 });
    }

    const id = `src-${type}-${Date.now().toString().slice(-6)}`;
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

    // Also trigger initial ingestion for this source to populate documents
    await db.syncSource(id, tenantId);

    return NextResponse.json(
      {
        message: 'Source connector registered and indexed successfully',
        source: {
          ...(await db.getSourceById(id, tenantId)),
          config: redactSourceConfig((await db.getSourceById(id, tenantId))?.config || {}),
        },
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
