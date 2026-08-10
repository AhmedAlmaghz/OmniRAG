import { NextRequest, NextResponse } from 'next/server';
import { google } from '@/lib/rag/googleProvider';
import { streamText } from 'ai';
import { HookHarness } from '@/lib/harness/hook-harness';
import { performHybridSearch } from '@/lib/rag/engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = body.tenantId || req.headers.get('x-tenant-id') || 'tenant-acme-01';
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
      targetModel = 'gemini-3.6-flash';
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

    const contextText = searchResult.chunks
      .map((c, i) => `[المصدر ${i + 1} - ${c.documentTitle}]: ${c.content}`)
      .join('\n\n');

    const result = streamText({
      model: google(targetModel),
      system: `أنت مساعد ذكي لمنصة OmniRAG. استعن بالمستندات المرفقة أدناه للإجابة على استفسار المستخدم بوضوح ودقة عالية:\n\nالمستندات:\n${contextText}`,
      prompt,
    });

    return result.toTextStreamResponse();
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Streaming execution failed' }, { status: 500 });
  }
}
