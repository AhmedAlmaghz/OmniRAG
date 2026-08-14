import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { Collection } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    const tenantId = authCtx.tenantId;
    const collections = await db.getCollections(tenantId);
    return NextResponse.json({ collections });
  } catch (err: any) {
    console.error('API Error in collections GET:', err);
    return NextResponse.json({ collections: [], error: err.message || String(err) }, { status: 500 });
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    const body = await req.json();
    const tenantId = authCtx.tenantId;
    const { name, description } = body;

    const col: Collection = {
      id: `col-${Date.now()}`,
      tenantId,
      name,
      description,
      documentCount: 0,
      createdAt: new Date().toISOString(),
    };

    await db.addCollection(col);
    return NextResponse.json({ collection: col }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
