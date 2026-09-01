import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import {
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  type UIMessage,
  type UIMessageChunk,
  type ToolSet,
  type ModelMessage,
  type JSONValue,
} from 'ai';
import { resolveLanguageModel, isModelRefConfigured } from '@/lib/ai/registry/resolve';
import { HookHarness } from '@/lib/harness/hook-harness';
import {
  performHybridSearch,
  runToolSafely,
  buildCitations,
  buildContextBlock,
  collectTenantMcpTools,
  buildAgenticSystemInstruction,
} from '@/lib/rag/engine';
import { getEnv } from '@/lib/env/runtimeEnv';
import { createPIIStreamRedactor } from '@/lib/security/piiStreamRedactor';
import { parseModelConfigFromRequest, getAiModel, getFallbackModels } from '@/lib/config/aiModels';
import { runWithModelConfig } from '@/lib/config/aiModelsServer';
import { buildTenantMcpTools } from '@/lib/mcp/aiSdkTools';
import { generateTextResilient } from '@/lib/ai/resilientGenerate';
import { guardPermission } from '@/lib/auth/permissions';
import { getTokenBudgetStatus, recordTokenUsage } from '@/lib/services/planService';
import type { MCPToolCall } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

// Route segment configs (maxDuration) must be statically analyzable at build
// time — Next.js rejects expressions over process.env here, so the export is
// a plain constant (Vercel enforces its own platform ceiling on top of it:
// Hobby hard-kills at 60s regardless of this value). The RUNTIME generation
// budget below is env-driven, which keeps the in-stream abort UNDER the
// platform ceiling on Vercel and extends freely on self-hosted deployments.
export const maxDuration = 300;

/** Internal generation budget — must stay BELOW maxDuration when running on
 *  Vercel so a slow/failed provider surfaces as a clean in-stream error before
 *  the platform kills us. Self-hosted deployments have no platform ceiling, so
 *  the budget extends (default: 5 minutes) letting long comprehensive answers
 *  finish instead of being clipped mid-stream. Override with
 *  CHAT_GENERATION_TIMEOUT_MS (milliseconds) on any deployment. */
const GENERATION_TIMEOUT_MS = Number(process.env.CHAT_GENERATION_TIMEOUT_MS) || (process.env.VERCEL ? 55_000 : 300_000);

/**
 * Agentic RAG streaming endpoint (Phase 4).
 *
 * Speaks the AI SDK UI-message-stream protocol (SSE) so ChatStudio can attach
 * through useChat (@ai-sdk/react): real token-by-token streaming, tool parts,
 * and structured data parts carrying citations / pending approvals / executed
 * tool calls / suggestions / model metadata.
 *
 * Security parity with chat/completions is preserved:
 *  - HookHarness pre_auth / pre_inference / pre_generation gates
 *  - PII redaction applied to every streamed text delta (buffered redactor)
 *  - post_inference audit hook over the full text after the stream ends
 *  - side-effect tools never execute without the human-approval round trip
 */

/** Emits a hook-blocked reply INSIDE the stream protocol so the client renders it like any message. */
function blockedStreamResponse(reason: string): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'data-blocked', data: { reason } });
      writer.write({ type: 'text-start', id: 'blocked-text' });
      writer.write({ type: 'text-delta', id: 'blocked-text', delta: `🛑 [درع أمن OmniRAG]: ${reason}` });
      writer.write({ type: 'text-end', id: 'blocked-text' });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

/**
 * Pipes UI message chunks through the buffered PII redactor: text-delta
 * chunks are deferred-redacted exactly like the legacy plain-text stream, all
 * other chunk kinds pass through untouched. `done` resolves when the source
 * stream ends so callers can append trailing data parts afterwards.
 */
function redactPiiChunks(source: ReadableStream<UIMessageChunk>): {
  transformed: ReadableStream<UIMessageChunk>;
  done: Promise<void>;
} {
  const redactor = createPIIStreamRedactor();
  let resolveDone: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const reader = source.getReader();
  const transformed = new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        const { value, done: ended } = await reader.read();
        if (ended) {
          const tail = redactor.end();
          if (tail) {
            controller.enqueue({ type: 'text-delta', id: 'pii-tail', delta: tail } as UIMessageChunk);
          }
          controller.close();
          resolveDone();
          return;
        }
        if (value && (value as any).type === 'text-delta') {
          const safe = redactor.push(String((value as any).delta || ''));
          if (safe) controller.enqueue({ ...(value as any), delta: safe } as UIMessageChunk);
        } else {
          controller.enqueue(value);
        }
      } catch (err) {
        controller.error(err);
        resolveDone();
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
      resolveDone();
    },
  });

  return { transformed, done };
}

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  // Load client-supplied dynamic environment keys (parity with completions +
  // the Phase-4 skill/integration credentials).
  for (const key of [
    'GEMINI_API_KEY',
    'UNSTRUCTURED_API_KEY',
    'MISTRAL_API_KEY',
    'TAVILY_API_KEY',
    'SERPER_API_KEY',
    'BRAVE_API_KEY',
    'SLACK_BOT_TOKEN',
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'RESEND_API_KEY',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
    'RESEND_FROM',
    'EMAIL_FROM',
    'DATABASE_URL',
    'POSTGRES_URL',
    'QDRANT_URL',
    'QDRANT_API_KEY',
  ]) {
    getEnv(key, req);
  }

  const modelConfig = parseModelConfigFromRequest(req);

  try {
    const chatDenied = await guardPermission(authCtx, 'chat:use');
    if (chatDenied) return chatDenied;

    // Monthly token budget (Phase 4): hard-stop when the workspace exhausted
    // its plan's LLM allowance for the current month.
    const budget = await getTokenBudgetStatus(authCtx.tenantId);
    if (budget.exhausted) {
      return NextResponse.json(
        {
          error: `تم استهلاك حصة الرموز الشهرية للخطة (${budget.budget} token). سيتم تجديدها مطلع الشهر القادم (Monthly token budget exhausted)`,
          code: '429_TOKEN_BUDGET_EXHAUSTED',
          budget: { used: budget.used, limit: budget.budget },
        },
        { status: 429 },
      );
    }

    const body = await req.json();
    const tenantId = authCtx.tenantId;
    const {
      prompt,
      mode = 'hybrid',
      collectionIds,
      model: requestedModel,
      approvedToolCall,
      conversationId,
      messages: clientMessages,
    } = body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'نص السؤال مطلوب (Prompt is required)', code: '400_MISSING_PROMPT' },
        { status: 400 },
      );
    }

    // Resolve model: explicit body field > x-ai-model-config header > settings.
    let targetModel = requestedModel;
    if (!targetModel) {
      const customConfigHeader = req.headers.get('x-ai-model-config');
      if (customConfigHeader) {
        try {
          targetModel = JSON.parse(customConfigHeader).chatStreamModel;
        } catch {}
      }
    }
    if (!targetModel) targetModel = getAiModel('chatStreamModel');

    // Stage 1: Auth check
    const authCheck = await HookHarness.run('pre_auth', { tenantId, userId: authCtx.userId });
    if (!authCheck.allow) {
      return blockedStreamResponse(authCheck.reason || 'غير مصرح');
    }

    // Stage 2: Inference Check (Prompt injection defense)
    const inferenceCheck = await HookHarness.run('pre_inference', { tenantId, mode, prompt });
    if (!inferenceCheck.allow) {
      return blockedStreamResponse(inferenceCheck.reason || 'تم حظر الطلب');
    }

    return await runWithModelConfig(modelConfig, async () => {
      const searchResult = await performHybridSearch({
        query: prompt,
        tenantId,
        collectionIds,
        // Parity with /chat/completions: auto-rerank in analysis mode.
        rerank: mode === 'analysis',
      });

      // Stage 2b: Pre-Generation — indirect prompt injection scan over chunks.
      const preGenCheck = await HookHarness.run('pre_generation', {
        tenantId,
        userId: authCtx.userId,
        retrievedChunks: searchResult.chunks.map((c) => ({
          content: c.content,
          documentTitle: c.documentTitle,
        })),
      });
      if (!preGenCheck.allow) {
        return blockedStreamResponse(preGenCheck.reason || 'تم حظر المحتوى');
      }

      const citations = buildCitations(searchResult.chunks);
      // Shared builder (single-document reading-order map included).
      const contextText = buildContextBlock(searchResult.chunks);

      const modelAlias = targetModel || getAiModel('chatStreamModel');
      const providerConfigured = await isModelRefConfigured(modelAlias);

      const stream = createUIMessageStream<UIMessage>({
        originalMessages: Array.isArray(clientMessages) ? clientMessages : undefined,
        onError: () => 'حدث خطأ أثناء البث. حاول مرة أخرى.',
        execute: async ({ writer }) => {
          // Citations first so the UI can attach them as soon as text starts.
          writer.write({ type: 'data-citations', data: citations as unknown as JSONValue });

          if (!providerConfigured) {
            // Honest degradation — same contract as the completions fallback.
            const notice = `بناءً على المستندات المسترجعة من النظام (${searchResult.chunks.length} قطعة):\n\n${
              searchResult.chunks[0]?.content || 'تم استرجاع السجلات المطلوبة بنجاح.'
            }\n\n[إشعار المحرك: لا يوجد مزود نماذج مهيأ لهذا المستأجر — أضف مفتاح مزود من الإعدادات لتفعيل التوليد الحي.]`;
            writer.write({ type: 'text-start', id: 'fallback-text' });
            writer.write({ type: 'text-delta', id: 'fallback-text', delta: notice });
            writer.write({ type: 'text-end', id: 'fallback-text' });
            writer.write({
              type: 'data-meta',
              data: { modelUsed: modelAlias, tokensUsed: { input: 0, output: 0 }, configured: false },
            });
            return;
          }

          // Conversation memory from the client's UIMessage history (last 10),
          // converted to model messages; falls back to an empty transcript.
          let historyMessages: ModelMessage[] = [];
          if (Array.isArray(clientMessages) && clientMessages.length > 1) {
            try {
              historyMessages = await convertToModelMessages(clientMessages.slice(0, -1).slice(-10));
            } catch {
              historyMessages = [];
            }
          }

          const docsBlock = `المستندات المسترجعة (${searchResult.chunks.length} مقطعاً — كلها اجتازت البحث والاسترجاع حسب المصادر والصلاحيات المحددة):
${contextText || 'لا توجد مستندات مسترجعة.'}
[تعليمات إلزامية: استخدم كل المقاطع المسترجعة أعلاه في بناء الإجابة بحيث تغطي إجابتك كل ما يرتبط بالسؤال منها بشكل مفصل وواضح، مع استشهاد مضمّن [رقم] لكل معلومة، ولا تختصر الإجابة]`;
          let userContent = `${docsBlock}\n\nسؤال المستخدم: ${prompt}`;

          const alreadyExecutedToolCalls: MCPToolCall[] = [];

          // Human-approved side-effect call — executed through the unified MCP
          // dispatcher (audit/timeouts/simulation stamping identical everywhere).
          if (approvedToolCall) {
            const outcome = await runToolSafely(
              tenantId,
              approvedToolCall.scopedToolName,
              approvedToolCall.inputParams,
              approvedToolCall.conversationId || conversationId,
            );
            alreadyExecutedToolCalls.push({
              ...approvedToolCall,
              status: outcome.isError ? 'failed' : 'completed',
              outputResult: outcome.result,
              latencyMs: outcome.latencyMs,
              timestamp: new Date().toISOString(),
            });
            userContent += `\n\n[تأكيد تنفيذ أداة الـ MCP]: تمت الموافقة البشرية بنجاح وتم إرجاع نتيجة الأداة (${approvedToolCall.scopedToolName}):\n${JSON.stringify(outcome.result, null, 2)}\n\nيرجى دمج هذه البيانات وصياغة الرد النهائي للمستخدم.${
              outcome.isError ? '\nملاحظة: فشل تنفيذ الأداة — وضّح ذلك للمستخدم بلطف واقترح بديلا.' : ''
            }`;
          }

          // Tenant tool surface (shared with the completions path).
          const { toolsToOffer, requireApprovalTools, customSchemas } = await collectTenantMcpTools(tenantId, mode);

          let aiTools: ToolSet | undefined;
          const pendingApprovalRef: { value: MCPToolCall | null } = { value: null };
          // Set when the provider rate-limited the main generation — skips the
          // follow-up suggestions call so a quota-limited key isn't hit twice.
          const quotaHitRef = { value: false };
          if (!approvedToolCall && toolsToOffer.length > 0) {
            aiTools = buildTenantMcpTools(toolsToOffer, customSchemas, {
              tenantId,
              requireApprovalTools,
              runSafely: (toolName, args) => runToolSafely(tenantId, toolName, args),
              onAutoExecuted: (info) => {
                alreadyExecutedToolCalls.push({
                  id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  tenantId,
                  scopedToolName: info.toolName,
                  inputParams: info.args,
                  outputResult: info.outputResult,
                  latencyMs: info.latencyMs,
                  status: info.isError ? 'failed' : 'completed',
                  hasSideEffect: info.hasSideEffect,
                  timestamp: new Date().toISOString(),
                });
              },
              onPendingApproval: (toolName, args) => {
                pendingApprovalRef.value = {
                  id: `tc-${Date.now()}`,
                  tenantId,
                  scopedToolName: toolName,
                  inputParams: args,
                  latencyMs: 0,
                  status: 'pending',
                  hasSideEffect: true,
                  timestamp: new Date().toISOString(),
                };
              },
            });
          }

          // ── Cross-provider streaming with fallback ────────────────────────
          // streamText takes ONE model; when that provider is down (e.g. the
          // recurring global "high demand" on free-tier Gemini) the whole
          // turn failed. Walk a fallback chain: try the primary; if it fails
          // BEFORE streaming a single character (nothing delivered yet), retry
          // the next configured model. Models whose provider has no API key
          // are skipped via isModelRefConfigured — the chain degrades to
          // primary-only when no other provider is set up.
          const buildFallbackChain = (): string[] => {
            const chain = [modelAlias, ...getFallbackModels()].filter((m, i, arr) => m && arr.indexOf(m) === i);
            return chain;
          };

          const attemptStream = async (aliasToTry: string) => {
            const result = streamText({
              model: await resolveLanguageModel(aliasToTry),
              system: buildAgenticSystemInstruction(aliasToTry, mode, toolsToOffer),
              messages: [...historyMessages, { role: 'user', content: userContent }],
              ...(aiTools && Object.keys(aiTools).length > 0 ? { tools: aiTools, toolChoice: 'auto' as const } : {}),
              stopWhen: stepCountIs(5),
              temperature: 0.2,
              // Abort generation at GENERATION_TIMEOUT_MS (55s), UNDER the 60s
              // Vercel Hobby ceiling: keeps failures inside the stream protocol
              // instead of the platform hard-killing the SSE connection.
              timeout: GENERATION_TIMEOUT_MS,
              abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
            });
            // Await the FIRST element to know whether this provider can serve
            // us at all; a failure here means nothing was streamed yet and we
            // can safely fall through to the next model.
            const first = await result.textStream[Symbol.asyncIterator]().next();
            return { result, first };
          };

          let result!: Awaited<ReturnType<typeof attemptStream>>['result'];
          let firstChunk: Awaited<ReturnType<typeof attemptStream>>['first'];
          let usedModel = modelAlias;
          const chain = buildFallbackChain();
          let lastFailReason = '';
          let delivered = false;

          for (let i = 0; i < chain.length; i++) {
            const aliasToTry = chain[i];
            if (!(await isModelRefConfigured(aliasToTry))) continue; // no key → skip
            try {
              const attempt = await attemptStream(aliasToTry);
              result = attempt.result;
              firstChunk = attempt.first;
              if (!firstChunk.done) {
                usedModel = aliasToTry;
                delivered = true;
                if (aliasToTry !== modelAlias) {
                  console.log(`[chat/stream] primary "${modelAlias}" unavailable — serving via "${aliasToTry}".`);
                }
                break;
              }
              // Empty stream completed without content — treat as a failure.
              lastFailReason = `${aliasToTry}: empty response`;
            } catch (err: any) {
              lastFailReason = `${aliasToTry}: ${(err?.data?.error?.message || err?.message || err || '').toString().slice(0, 200)}`;
              console.error(`[chat/stream] model "${aliasToTry}" failed:`, lastFailReason);
            }
          }

          // Every configured model failed → emit the classified error.
          if (!delivered) {
            const raw = lastFailReason;
            console.error('[chat/stream] all models failed:', raw);
            const isQuota = /quota|RESOURCE_EXHAUSTED|exceeded your current quota|429/i.test(raw);
            const isTimeout = /timeout|timed out|TimeoutError|AbortError|aborted/i.test(raw);
            const message = isQuota
              ? 'استُهلكت حصة مزوّد الذكاء الاصطناعي مؤقتًا (429 RESOURCE_EXHAUSTED) — انتظر دقيقة أو اضبط مفتاحًا مدفوعًا/نموذجًا آخر من الإعدادات (AI provider quota exhausted — configure a paid key or another model).'
              : isTimeout
                ? 'تجاوز التوليد المهلة المسموحة (55 ثانية) دون اكتمال — قد يكون المزود بطيئًا أو الحصة مستنزفة؛ أعد المحاولة أو اختر نموذجًا آخر (Generation timed out — retry or pick another model).'
                : `تعذّر التوليد من مزوّد النموذج: ${raw.slice(0, 200) || 'unknown provider error'}`;
            if (isQuota) quotaHitRef.value = true;
            writer.write({ type: 'error', errorText: message });
            return;
          }

          // We have a working provider with the first text element in hand —
          // stream the remainder DIRECTLY through the outer writer (the same
          // pattern blockedStreamResponse uses successfully). Synthesizing a
          // chunk stream + writer.merge tripped the SDK's stream protocol
          // ("حدث خطأ أثناء البث") because merge expects a full well-formed
          // UIMessage stream; writing parts directly avoids that entirely.
          // PII redaction still applies via the buffered redactor per delta.
          {
            const redactor = createPIIStreamRedactor();
            writer.write({ type: 'text-start', id: 'txt' });
            const firstText = String(firstChunk!.value || '');
            if (firstText) {
              const safeFirst = redactor.push(firstText);
              if (safeFirst) writer.write({ type: 'text-delta', id: 'txt', delta: safeFirst });
            }
            for await (const delta of result.textStream) {
              const safe = redactor.push(String(delta || ''));
              if (safe) writer.write({ type: 'text-delta', id: 'txt', delta: safe });
            }
            const tail = redactor.end();
            if (tail) writer.write({ type: 'text-delta', id: 'txt', delta: tail });
            writer.write({ type: 'text-end', id: 'txt' });
          }

          // Trailing structured parts (consumed by ChatStudio's mapper).
          if (pendingApprovalRef.value) {
            writer.write({
              type: 'data-pending-tool',
              data: pendingApprovalRef.value as unknown as JSONValue,
            });
          }
          if (alreadyExecutedToolCalls.length > 0) {
            writer.write({
              type: 'data-tool-calls',
              data: alreadyExecutedToolCalls as unknown as JSONValue,
            });
          }

          let fullText = '';
          let tokensUsed = { input: 0, output: 0 };
          try {
            fullText = await result.text;
            const usage = await result.usage;
            tokensUsed = { input: usage?.inputTokens ?? 0, output: usage?.outputTokens ?? 0 };
          } catch {
            // Stream aborted/consumed — metadata stays zeroed.
          }

          // Atomic monthly counter increment (fail-open — accounting must not
          // break the stream).
          const totalTokens = tokensUsed.input + tokensUsed.output;
          if (totalTokens > 0) {
            await recordTokenUsage(tenantId, totalTokens);
          }

          writer.write({
            type: 'data-meta',
            data: { modelUsed: usedModel, tokensUsed, configured: true },
          });

          // Audit parity with /chat/completions (H9 post-inference over full text).
          await HookHarness.run('post_inference', {
            tenantId,
            userId: authCtx.userId,
            output: fullText,
          });

          // Best-effort AI follow-up suggestions after the answer completes.
          // NOTE: this is a SECOND provider call per user message — on free-tier
          // keys (e.g. Gemini 20 RPM) it doubles quota pressure, so it silently
          // no-ops when the provider is already rate-limited.
          if (fullText && !fullText.includes('RESOURCE_EXHAUSTED') && !quotaHitRef.value) {
            try {
              const suggestionsResult = await generateTextResilient({
                model: modelAlias,
                system:
                  'أنت مساعد يولد أسئلة متابعة سياقية ذكية. أجب بـ 3 أسئلة فقط، كل سؤال في سطر منفصل، بدون أي نص إضافي أو ترقيم أو رموز.',
                prompt: `بناءً على الإجابة التالية والمحادثة، اقترح 3 أسئلة متابعة سياقية قصيرة ومفيدة يمكن للمستخدم أن يسألها. أعد الأسئلة فقط، كل سؤال في سطر منفصل، بدون ترقيم أو نقاط:\n\nالإجابة: ${fullText.substring(0, 500)}\n\nسؤال المستخدم: ${prompt}`,
                temperature: 0.7,
                maxRetries: 1,
              });
              const suggestions = (suggestionsResult?.text || '')
                .split('\n')
                .map((s) => s.replace(/^[\d.\-*\s]+/, '').trim())
                .filter((s) => s.length > 10 && s.length < 150)
                .slice(0, 4);
              if (suggestions.length > 0) {
                writer.write({ type: 'data-suggestions', data: suggestions });
              }
            } catch {
              // Suggestions are an optional enhancement — never break the stream.
            }
          }
        },
      });

      return createUIMessageStreamResponse({ stream });
    });
  } catch (err: unknown) {
    console.error('API Error in /api/v1/chat/stream:', err);
    return NextResponse.json(
      { error: 'حدث خطأ داخلي في المعالجة (Internal Processing Error)', code: '500_INTERNAL_ERROR' },
      { status: 500 },
    );
  }
});
