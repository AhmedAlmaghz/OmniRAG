import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { Collection } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId') || 'tenant-acme-01';
  const collections = db.getCollections(tenantId);
  return NextResponse.json({ collections });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = body.tenantId || 'tenant-acme-01';
    const { name, description } = body;

    const col: Collection = {
      id: `col-${Date.now()}`,
      tenantId,
      name,
      description,
      documentCount: 0,
      createdAt: new Date().toISOString(),
    };

    db.addCollection(col);
    return NextResponse.json({ collection: col }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
