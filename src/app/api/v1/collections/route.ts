import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { Collection } from '@/lib/types/omnirag';
import { getEnv } from '@/lib/env/runtimeEnv';
import { serverErrorResponse } from '@/lib/api/safeError';

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
    const collections = await db.getCollections(tenantId);
    return NextResponse.json({ collections });
  } catch (err: any) {
    console.error('API Error in collections GET:', err);
    return NextResponse.json(
      { collections: [], error: 'حدث خطأ داخلي في الخادم. يرجى المحاولة مرة أخرى لاحقاً.', code: 'INTERNAL_ERROR' },
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
    return serverErrorResponse('collections POST', err);
  }
});
