import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { SourceConnector } from '@/lib/types/omnirag';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId') || 'tenant-acme-01';
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

  return NextResponse.json({
    tenantId,
    totalSources: sources.length,
    sources,
    syncLogs,
    mcpResources,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId = 'tenant-acme-01', name, type, config = {}, syncSchedule = 'manual', collectionIds = [] } = body;

    if (!name || !type) {
      return NextResponse.json({ error: 'Name and type are required fields' }, { status: 400 });
    }

    const id = `src-${type}-${Date.now().toString().slice(-6)}`;
    const newSource: SourceConnector = {
      id,
      tenantId,
      name,
      type,
      status: 'healthy',
      config,
      syncSchedule,
      lastSyncAt: new Date().toISOString(),
      documentCount: 1,
      collectionIds,
      createdAt: new Date().toISOString(),
    };

    await db.addSource(newSource);

    // Also trigger initial ingestion for this source to populate documents
    await db.syncSource(id, tenantId);

    return NextResponse.json({
      message: 'Source connector registered and indexed successfully',
      source: await db.getSourceById(id, tenantId),
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to create source connector' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, tenantId = 'tenant-acme-01', ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Source ID is required' }, { status: 400 });
    }

    const updated = await db.updateSource(id, updates, tenantId);
    if (!updated) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Source updated successfully', source: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update source' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const tenantId = searchParams.get('tenantId') || 'tenant-acme-01';
  const purgeDocs = searchParams.get('purgeDocs') !== 'false';

  if (!id) {
    return NextResponse.json({ error: 'Source ID is required' }, { status: 400 });
  }

  await db.deleteSource(id, tenantId, purgeDocs);

  return NextResponse.json({ message: 'Source connector removed and associated data purged', id });
}
