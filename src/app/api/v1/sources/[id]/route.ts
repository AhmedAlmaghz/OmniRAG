import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId') || 'tenant-acme-01';

  const source = await db.getSourceById(id, tenantId);
  if (!source) {
    return NextResponse.json({ error: 'Source connector not found' }, { status: 404 });
  }

  const logs = await db.getSyncLogs(tenantId, id);
  const documents = (await db.getDocuments(tenantId)).filter((d) => d.metadata?.sourceId === id);

  return NextResponse.json({
    source,
    logs,
    documents,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const tenantId = body.tenantId || 'tenant-acme-01';

  const updated = await db.updateSource(id, body, tenantId);
  if (!updated) {
    return NextResponse.json({ error: 'Source connector not found' }, { status: 404 });
  }

  return NextResponse.json({ message: 'Source config updated', source: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId') || 'tenant-acme-01';

  await db.deleteSource(id, tenantId, true);

  return NextResponse.json({ message: 'Source deleted and documents purged', id });
}
