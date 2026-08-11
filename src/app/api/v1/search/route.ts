import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { HookHarness } from '@/lib/harness/hook-harness';
import { performHybridSearch } from '@/lib/rag/engine';
import { SearchQuery } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
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
