import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { HookHarness } from '@/lib/harness/hook-harness';
import { performHybridSearch, generateRagCompletion } from '@/lib/rag/engine';
import { verifyApiAuth } from '@/lib/auth/apiAuth';
import { checkRateLimit } from '@/lib/security/rateLimiter';

export const dynamic = 'force-dynamic';

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  // Rate Limit check
  const rateLimit = checkRateLimit(req, 30, 60000);
  if (!rateLimit.success && rateLimit.response) {
    return rateLimit.response;
  }

  // Auth & Tenant check
  const auth = await verifyApiAuth(req);
  if (!auth.authenticated && auth.response) {
    return auth.response;
  }

  try {
    const body = await req.json();
    const tenantId = auth.tenantId;
    const { prompt, mode = 'hybrid', collectionIds, modelOverride, approvedToolCall } = body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'نص السؤال مطلوب (Prompt is required)', code: '400_MISSING_PROMPT' },
        { status: 400 }
      );
    }

    // Hook Stage 1: Pre-Auth
    const authCheck = await HookHarness.run('pre_auth', { tenantId, userId: auth.userId });
    if (!authCheck.allow) {
      return NextResponse.json({ error: authCheck.reason, code: authCheck.code }, { status: 403 });
    }

    // Hook Stage 2: Pre-Inference (Prompt Injection Defense & Mode Guard)
    const inferenceCheck = await HookHarness.run('pre_inference', {
      tenantId,
      userId: auth.userId,
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
      approvedToolCall,
    });

    // Hook Stage 3: Post-Inference (PII Redaction & Citation Verification)
    const postCheck = await HookHarness.run('post_inference', {
      tenantId,
      userId: auth.userId,
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
  } catch (err: any) {
    console.error('API Error in /api/v1/chat/completions:', err);
    return NextResponse.json(
      { error: 'حدث خطأ داخلي في المعالجة (Internal Processing Error)', code: '500_INTERNAL_ERROR' },
      { status: 500 }
    );
  }
});
