import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  return NextResponse.json({
    mistralActive: !!process.env.MISTRAL_API_KEY,
    unstructuredActive: !!process.env.UNSTRUCTURED_API_KEY,
    geminiActive: !!process.env.GEMINI_API_KEY,
    qdrantActive: !!process.env.QDRANT_API_KEY || !!process.env.QDRANT_URL,
  });
});
