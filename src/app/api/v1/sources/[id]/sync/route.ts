import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { getEnv } from '@/lib/env/runtimeEnv';

// Syncs can download remote files and run OCR/transcription pipelines
// (web_file / youtube connectors), which takes minutes on large media.
export const maxDuration = 300;

export const POST = withAuthAndRateLimit(async (req, authCtx, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const tenantId = authCtx.tenantId;

  // Load dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

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
