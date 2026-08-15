import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { HookHarness } from '@/lib/harness/hook-harness';
import { performHybridSearch } from '@/lib/rag/engine';
import { SearchQuery } from '@/lib/types/omnirag';
import { getEnv } from '@/lib/env/runtimeEnv';

export const dynamic = 'force-dynamic';

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
    const body: SearchQuery = await req.json();
    const tenantId = body.tenantId || req.headers.get('x-tenant-id') || 'tenant-acme-01';

    // Run Pre-Auth & Pre-Inference Hooks
    const authResult = await HookHarness.run('pre_auth', { tenantId });
    if (!authResult.allow) {
      return NextResponse.json({ error: authResult.reason, code: authResult.code }, { status: 403 });
    }

    const inferenceResult = await HookHarness.run('pre_inference', {
      tenantId,
      prompt: body.query,
    });
    if (!inferenceResult.allow) {
      return NextResponse.json({ error: inferenceResult.reason, code: inferenceResult.code }, { status: 400 });
    }

    const searchResults = await performHybridSearch({
      ...body,
      tenantId,
    });

    return NextResponse.json(searchResults);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
});
