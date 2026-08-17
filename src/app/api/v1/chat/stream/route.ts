import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { google } from '@/lib/rag/googleProvider';
import { streamText, createTextStreamResponse } from 'ai';
import { HookHarness } from '@/lib/harness/hook-harness';
import { performHybridSearch } from '@/lib/rag/engine';
import { getEnv } from '@/lib/env/runtimeEnv';
import { serverErrorResponse } from '@/lib/api/safeError';
import { createPIIStreamRedactor } from '@/lib/security/piiStreamRedactor';

export const dynamic = 'force-dynamic';

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
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
    const { prompt, mode = 'hybrid', collectionIds, model: requestedModel } = body;

    // Resolve model name from request or custom header
    let targetModel = requestedModel;
    if (!targetModel) {
      const customConfigHeader = req.headers.get('x-ai-model-config');
      if (customConfigHeader) {
        try {
          const parsed = JSON.parse(customConfigHeader);
          targetModel = parsed.chatStreamModel;
        } catch {}
      }
    }
    if (!targetModel) {
      targetModel = 'gemini-3.7-flash';
    }

    // Stage 1: Auth check
    const authCheck = await HookHarness.run('pre_auth', { tenantId });
    if (!authCheck.allow) {
      return NextResponse.json({ error: authCheck.reason, code: authCheck.code }, { status: 403 });
    }

    // Stage 2: Inference Check (Prompt injection defense)
    const inferenceCheck = await HookHarness.run('pre_inference', { tenantId, mode, prompt });
    if (!inferenceCheck.allow) {
      return NextResponse.json({ error: inferenceCheck.reason, code: inferenceCheck.code }, { status: 400 });
    }

    // Hybrid Search Retrieval
    const searchResult = await performHybridSearch({
      query: prompt,
      tenantId,
      collectionIds,
      topK: 4,
    });

    // Hook Stage 2b: Pre-Generation — scan retrieved chunks for indirect prompt
    // injection before they are injected into the model context. Mirrors the
    // chat/completions route so a hostile document in a tenant's corpus cannot
    // override the model's instructions once it reaches the streamed response.
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

    const contextText = searchResult.chunks
      .map((c, i) => `[المصدر ${i + 1} - ${c.documentTitle}]: ${c.content}`)
      .join('\n\n');

    // PII redaction on the streamed output. The chat/completions route runs the
    // post-inference H9 PIIRedactor over the full response as one string; this
    // route emits text deltas and would bypass H9, leaking emails/phones to
    // the client. We pipe each delta through a buffered redactor that defers
    // redaction of partial PII patterns until they terminate, so patterns that
    // are split across deltas are still intercepted without leaking trailing
    // characters.
    const redactor = createPIIStreamRedactor();

    const result = streamText({
      model: google(targetModel),
      system: `أنت مساعد ذكي لمنصة OmniRAG. استعن بالمستندات المرفقة أدناه للإجابة على استفسار المستخدم بوضوح ودقة عالية:\n\nالمستندات:\n${contextText}`,
      prompt,
      onEnd: async (event) => {
        // Re-run post-inference on the full LLM text so audit-log entries have
        // parity with /chat/completions. Redaction is already applied inline to
        // the streamed output above; this hook is for the audit trail only.
        await HookHarness.run('post_inference', {
          tenantId,
          userId: authCtx.userId,
          output: event.text,
        });
      },
    });

    const redactedTextStream = new ReadableStream<string>({
      async start(controller) {
        try {
          for await (const delta of result.textStream) {
            const safe = redactor.push(delta);
            if (safe) controller.enqueue(safe);
          }
          const tail = redactor.end();
          if (tail) controller.enqueue(tail);
        } catch (err) {
          controller.error(err);
          return;
        }
        controller.close();
      },
    });

    return createTextStreamResponse({ stream: redactedTextStream });
  } catch (err: unknown) {
    return serverErrorResponse('chat/stream', err);
  }
});
