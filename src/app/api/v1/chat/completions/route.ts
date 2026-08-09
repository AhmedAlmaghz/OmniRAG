import { NextRequest, NextResponse } from 'next/server';
import { HookHarness } from '@/lib/harness/hook-harness';
import { performHybridSearch, generateRagCompletion } from '@/lib/rag/engine';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = body.tenantId || req.headers.get('x-tenant-id') || 'tenant-acme-01';
    const { prompt, mode = 'hybrid', collectionIds, modelOverride } = body;

    // Hook Stage 1: Pre-Auth
    const authCheck = await HookHarness.run('pre_auth', { tenantId });
    if (!authCheck.allow) {
      return NextResponse.json({ error: authCheck.reason, code: authCheck.code }, { status: 403 });
    }

    // Hook Stage 2: Pre-Inference (Prompt Injection Defense & Mode Guard)
    const inferenceCheck = await HookHarness.run('pre_inference', {
      tenantId,
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
    });

    // Step 2: RAG Generation
    const ragResponse = await generateRagCompletion({
      tenantId,
      query: prompt,
      mode,
      modelOverride,
      contextChunks: searchResult.chunks,
    });

    // Hook Stage 3: Post-Inference (PII Redaction & Citation Verification)
    const postCheck = await HookHarness.run('post_inference', {
      tenantId,
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
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
