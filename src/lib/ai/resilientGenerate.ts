import { generateText, type ModelMessage } from 'ai';
import { getAiModel, getFallbackModels } from '../config/aiModels';
import { google } from '../rag/googleProvider';

/**
 * Central AI SDK v7 generation entry point with model-chain resilience.
 *
 * This is THE way server code should talk to Gemini in OmniRAG: it walks the
 * configured primary model plus the fallback chain (per-request model config
 * aware via aiModels), letting the AI SDK's built-in retry/backoff handle
 * transient errors per model before moving to the next fallback.
 *
 * Replaces the old hand-rolled @google/genai `generateContentWithResilience`.
 * The native SDK remains ONLY for the Gemini Files API (upload/poll/delete)
 * which the AI SDK does not cover.
 */
export interface ResilientTextOptions {
  /** Primary model id; defaults to the request-bound chatModel config. */
  model?: string;
  /** Explicit fallback chain; defaults to the configured fallback models. */
  fallbackModels?: string[];
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  /** AI SDK retries per model (default 2). */
  maxRetries?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

export interface ResilientTextResult {
  text: string;
  modelUsed: string;
}

/**
 * Generates text walking the model chain. Returns null when no API key is
 * configured or every model in the chain failed — callers apply their own
 * honest-failure policy.
 */
export async function generateTextResilient(options: ResilientTextOptions = {}): Promise<ResilientTextResult | null> {
  const primary = options.model || getAiModel('chatModel');
  const fallbacks = options.fallbackModels ?? getFallbackModels();
  const modelsToTry = [primary, ...fallbacks].filter((m, i, arr) => m && arr.indexOf(m) === i);

  let lastError = '';
  for (const modelId of modelsToTry) {
    try {
      const params: Record<string, unknown> = {
        model: google(modelId),
        maxRetries: options.maxRetries ?? 2,
      };
      if (options.system) params.system = options.system;
      if (options.messages) params.messages = options.messages;
      if (options.prompt) params.prompt = options.prompt;
      if (options.temperature != null) params.temperature = options.temperature;
      if (options.abortSignal) params.abortSignal = options.abortSignal;

      const { text } = await generateText(params as any);

      if (text && text.trim().length > 0) {
        return { text: text.trim(), modelUsed: modelId };
      }
      lastError = `${modelId}: empty response`;
    } catch (err: any) {
      lastError = `${modelId}: ${err?.message || err}`;
    }
  }

  if (lastError) {
    console.warn('[AI Resilient] All models failed:', lastError);
  }
  return null;
}
