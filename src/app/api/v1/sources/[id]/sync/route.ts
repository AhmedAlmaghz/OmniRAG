import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';

export const POST = withAuthAndRateLimit(async (req, authCtx, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const tenantId = authCtx.tenantId;

  const source = await db.getSourceById(id, tenantId);
  if (!source) {
    return NextResponse.json({ error: 'Source connector not found' }, { status: 404 });
  }

  const result = await db.syncSource(id, tenantId);

  return NextResponse.json({
    message: `المزامنة مكتملة للمصدر ${source.name}`,
    result,
    source: await db.getSourceById(id, tenantId),
  });
});
