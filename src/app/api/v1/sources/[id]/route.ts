import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';

export const GET = withAuthAndRateLimit(async (req, authCtx, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const tenantId = authCtx.tenantId;

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
});

export const PUT = withAuthAndRateLimit(async (req, authCtx, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const tenantId = authCtx.tenantId;

  const updated = await db.updateSource(id, body, tenantId);
  if (!updated) {
    return NextResponse.json({ error: 'Source connector not found' }, { status: 404 });
  }

  return NextResponse.json({ message: 'Source config updated', source: updated });
});

export const DELETE = withAuthAndRateLimit(async (req, authCtx, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const tenantId = authCtx.tenantId;

  await db.deleteSource(id, tenantId, true);

  return NextResponse.json({ message: 'Source deleted and documents purged', id });
});
