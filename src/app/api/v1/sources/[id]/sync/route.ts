import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let tenantId = 'tenant-acme-01';

  try {
    const body = await req.json().catch(() => ({}));
    if (body.tenantId) tenantId = body.tenantId;
  } catch (e) {
    // Ignore JSON parse if empty body
  }

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
}
