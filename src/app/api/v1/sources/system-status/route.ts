import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env/runtimeEnv';

export const dynamic = 'force-dynamic';

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  return NextResponse.json({
    mistralActive: !!getEnv('MISTRAL_API_KEY', req),
    unstructuredActive: !!getEnv('UNSTRUCTURED_API_KEY', req),
    geminiActive: !!getEnv('GEMINI_API_KEY', req),
    qdrantActive: !!getEnv('QDRANT_API_KEY', req) || !!getEnv('QDRANT_URL', req),
    postgresActive: !!getEnv('DATABASE_URL', req) || !!getEnv('POSTGRES_URL', req),
  });
});
