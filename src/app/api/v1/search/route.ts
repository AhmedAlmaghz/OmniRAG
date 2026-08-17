import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { HookHarness } from '@/lib/harness/hook-harness';
import { performHybridSearch } from '@/lib/rag/engine';
import { SearchQuery } from '@/lib/types/omnirag';
import { getEnv } from '@/lib/env/runtimeEnv';
import { parseModelConfigFromRequest } from '@/lib/config/aiModels';
import { runWithModelConfig } from '@/lib/config/aiModelsServer';

export const dynamic = 'force-dynamic';

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  // Load client-supplied dynamic environment keys into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  // Bind the client's configured models to this request so the RAG engine
  // (embedding/HyDE/reranker) resolves the user's choices.
  const modelConfig = parseModelConfigFromRequest(req);

  return await runWithModelConfig(modelConfig, async () => {
    try {
      const body: SearchQuery = await req.json();
      // Tenant identity is derived exclusively from the verified auth context
      const tenantId = authCtx.tenantId;

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
      console.error('[api/v1/search] Error:', err);
      return NextResponse.json({ error: 'فشل تنفيذ البحث (Search request failed)' }, { status: 500 });
    }
  });
});
