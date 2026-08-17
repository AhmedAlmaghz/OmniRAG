import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { HookHarness } from '@/lib/harness/hook-harness';
import { performHybridSearch, generateRagCompletion } from '@/lib/rag/engine';
import { getEnv } from '@/lib/env/runtimeEnv';

export const dynamic = 'force-dynamic';

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  // The wrapper already enforced rate limits and verified auth; authCtx is the
  // single source of identity (tenantId, userId). No redundant inner calls.

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
    const { prompt, mode = 'hybrid', collectionIds, modelOverride, approvedToolCall, rerank } = body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'نص السؤال مطلوب (Prompt is required)', code: '400_MISSING_PROMPT' },
        { status: 400 },
      );
    }

    // Hook Stage 1: Pre-Auth
    const authCheck = await HookHarness.run('pre_auth', { tenantId, userId: authCtx.userId });
    if (!authCheck.allow) {
      return NextResponse.json({ error: authCheck.reason, code: authCheck.code }, { status: 403 });
    }

    // Hook Stage 2: Pre-Inference (Prompt Injection Defense & Mode Guard)
    const inferenceCheck = await HookHarness.run('pre_inference', {
      tenantId,
      userId: authCtx.userId,
      mode,
      prompt,
    });
    if (!inferenceCheck.allow) {
      return NextResponse.json({ error: inferenceCheck.reason, code: inferenceCheck.code }, { status: 400 });
    }

    // Step 1: Hybrid Retrieval
    const searchResult = await performHybridSearch({
      query: prompt,
      tenantId,
      collectionIds,
      topK: 4,
      rerank: rerank ?? mode === 'analysis', // Auto-rerank in analysis mode
    });

    // Hook Stage 2b: Pre-Generation — scan retrieved chunks for indirect prompt
    // injection before they are injected into the model context. A hostile
    // document embedded in a tenant's corpus otherwise reaches the model with
    // the model's full trust, making retrieved content the dominant indirect
    // injection vector in a RAG system.
    const preGenCheck = await HookHarness.run('pre_generation', {
      tenantId,
      userId: authCtx.userId,
      retrievedChunks: searchResult.chunks.map((c) => ({
        content: c.content,
        documentTitle: c.documentTitle,
      })),
    });
    if (!preGenCheck.allow) {
      return NextResponse.json({ error: preGenCheck.reason, code: preGenCheck.code }, { status: 400 });
    }

    // Step 2: RAG Generation
    const ragResponse = await generateRagCompletion({
      tenantId,
      query: prompt,
      mode,
      modelOverride,
      contextChunks: searchResult.chunks,
      approvedToolCall,
    });

    // Hook Stage 3: Post-Inference (PII Redaction & Citation Verification)
    const postCheck = await HookHarness.run('post_inference', {
      tenantId,
      userId: authCtx.userId,
      output: ragResponse.text,
    });

    const finalText = postCheck.allow && postCheck.mutated ? postCheck.mutated : ragResponse.text;

    return NextResponse.json({
      text: finalText,
      citations: ragResponse.citations,
      modelUsed: ragResponse.modelUsed,
      tokensUsed: ragResponse.tokensUsed,
      chunksRetrieved: searchResult.chunks.length,
      latencyMs: searchResult.latencyMs,
      pendingToolCall: ragResponse.pendingToolCall,
      toolCalls: ragResponse.toolCalls,
    });
  } catch (err: unknown) {
    console.error('API Error in /api/v1/chat/completions:', err);
    return NextResponse.json(
      { error: 'حدث خطأ داخلي في المعالجة (Internal Processing Error)', code: '500_INTERNAL_ERROR' },
      { status: 500 },
    );
  }
});
