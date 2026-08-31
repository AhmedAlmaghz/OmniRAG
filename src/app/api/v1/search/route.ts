import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { HookHarness } from '@/lib/harness/hook-harness';
import { performHybridSearch } from '@/lib/rag/engine';
import { SearchQuery } from '@/lib/types/omnirag';
import { getEnv } from '@/lib/env/runtimeEnv';
import { parseModelConfigFromRequest } from '@/lib/config/aiModels';
import { runWithModelConfig } from '@/lib/config/aiModelsServer';
import { guardPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

// Vercel Hobby execution ceiling — without this the platform default
// (~10s for unspecified routes) kills the function before slow provider
// calls finish, surfacing as raw connection errors.
export const maxDuration = 60;

/**
 * Search request validation. The body was previously cast straight to
 * SearchQuery, letting a client set `scoreThreshold: 0` (flooding results),
 * an unbounded `topK`, or arbitrary weights. All knobs are now bounded.
 */
const searchQuerySchema = z.object({
  query: z.string().trim().min(1, 'نص البحث مطلوب').max(4000, 'استعلام البحث طويل جدا'),
  language: z.enum(['ar', 'en', 'auto']).optional(),
  collectionIds: z.array(z.string().min(1)).max(50).optional(),
  topK: z.number().int().min(1).max(100).optional(),
  scoreThreshold: z.number().min(0.01).max(1).optional(),
  semanticWeight: z.number().min(0).max(1).optional(),
  lexicalWeight: z.number().min(0).max(1).optional(),
  rerank: z.boolean().optional(),
  useHyde: z.boolean().optional(),
});

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
      const searchDenied = await guardPermission(authCtx, 'chat:use');
      if (searchDenied) return searchDenied;

      const rawBody = await req.json();
      // Tenant identity is derived exclusively from the verified auth context
      const tenantId = authCtx.tenantId;

      const parsed = searchQuerySchema.safeParse(rawBody);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        return NextResponse.json(
          { error: firstIssue?.message || 'استعلام البحث غير صالح', code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }

      // Run Pre-Auth & Pre-Inference Hooks
      const authResult = await HookHarness.run('pre_auth', { tenantId });
      if (!authResult.allow) {
        return NextResponse.json({ error: authResult.reason, code: authResult.code }, { status: 403 });
      }

      const inferenceResult = await HookHarness.run('pre_inference', {
        tenantId,
        prompt: parsed.data.query,
      });
      if (!inferenceResult.allow) {
        return NextResponse.json({ error: inferenceResult.reason, code: inferenceResult.code }, { status: 400 });
      }

      const searchResults = await performHybridSearch({
        ...parsed.data,
        tenantId,
      } as SearchQuery);

      return NextResponse.json(searchResults);
    } catch (err: any) {
      console.error('[api/v1/search] Error:', err);
      return NextResponse.json({ error: 'فشل تنفيذ البحث (Search request failed)' }, { status: 500 });
    }
  });
});
