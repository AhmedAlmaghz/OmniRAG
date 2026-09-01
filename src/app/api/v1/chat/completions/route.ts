import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { HookHarness } from '@/lib/harness/hook-harness';
import { performHybridSearch, generateRagCompletion } from '@/lib/rag/engine';
import { getEnv } from '@/lib/env/runtimeEnv';
import { parseModelConfigFromRequest } from '@/lib/config/aiModels';
import { runWithModelConfig } from '@/lib/config/aiModelsServer';
import { guardPermission } from '@/lib/auth/permissions';
import { db } from '@/lib/storage/db';

export const dynamic = 'force-dynamic';

// Route segment configs (maxDuration) must be statically analyzable at build
// time — Next.js rejects expressions over process.env here. Vercel caps at
// the Hobby ceiling anyway; self-hosted deployments ignore this export, so a
// constant 300 never truncates them while keeping the Vercel build green.
export const maxDuration = 300;

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  // The wrapper already enforced rate limits and verified auth; authCtx is the
  // single source of identity (tenantId, userId). No redundant inner calls.

  // Load client-supplied dynamic environment keys into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('TAVILY_API_KEY', req);
  getEnv('SERPER_API_KEY', req);
  getEnv('BRAVE_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  // Bind the client's configured models to this request so getAiModel inside
  // the RAG engine (embedding/HyDE/reranker/selectSmartModel) resolves the
  // user's choices instead of DEFAULT_AI_MODELS.
  const modelConfig = parseModelConfigFromRequest(req);

  return await runWithModelConfig(modelConfig, async () => {
    try {
      const chatDenied = await guardPermission(authCtx, 'chat:use');
      if (chatDenied) return chatDenied;

      const body = await req.json();
      const tenantId = authCtx.tenantId;
      const {
        prompt,
        mode = 'hybrid',
        collectionIds,
        modelOverride,
        approvedToolCall,
        rerank,
        conversationId,
        conversationHistory,
        generateSuggestions = true,
      } = body;

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

      // Step 1: Hybrid Retrieval — topK is left to the engine (semantic-filter
      // based, no fixed cap); see lib/rag/engine.ts.
      const searchResult = await performHybridSearch({
        query: prompt,
        tenantId,
        collectionIds,
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

      // Step 2: RAG Generation with conversation memory
      // If conversationHistory is not provided but conversationId exists,
      // fetch recent messages from the database for context
      let history = conversationHistory || [];
      if ((!history || history.length === 0) && conversationId) {
        try {
          const historyMessages = await db.getMessages(conversationId, tenantId);
          history = historyMessages.slice(-10).map((m: any) => ({
            role: m.role,
            content: m.content,
          }));
        } catch {
          // Silently fall back to no history
        }
      }

      const ragResponse = await generateRagCompletion({
        tenantId,
        query: prompt,
        mode,
        modelOverride,
        contextChunks: searchResult.chunks,
        approvedToolCall,
        conversationHistory: history,
        generateSuggestions,
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
        suggestions: ragResponse.suggestions,
      });
    } catch (err: unknown) {
      console.error('API Error in /api/v1/chat/completions:', err);
      return NextResponse.json(
        { error: 'حدث خطأ داخلي في المعالجة (Internal Processing Error)', code: '500_INTERNAL_ERROR' },
        { status: 500 },
      );
    }
  });
});
