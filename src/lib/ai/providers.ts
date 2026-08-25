import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { getEnv } from '../env/runtimeEnv';

/**
 * Unified AI SDK v7 provider registry for OmniRAG.
 *
 * Every provider instance is lazily built and rebuilt whenever its API key
 * changes, so keys provisioned at runtime (x-env-* headers / the runtime env
 * store / host secrets via process.env) always take effect without a cold
 * restart. All call sites MUST go through these factories instead of importing
 * '@ai-sdk/groq' / '@ai-sdk/mistral' directly — divergent instances would
 * silently disagree about credentials and headers.
 *
 * (Google lives in lib/rag/googleProvider.ts and follows the same pattern.)
 */

// --- Groq -------------------------------------------------------------------

let groqProviderInstance: ReturnType<typeof createGroq> | null = null;
let currentGroqKey: string | null = null;

export function resolveGroqApiKey(): string {
  return getEnv('GROQ_API_KEY') || process.env.GROQ_API_KEY || '';
}

export function getGroqProvider(): ReturnType<typeof createGroq> {
  const apiKey = resolveGroqApiKey();
  if (!groqProviderInstance || currentGroqKey !== apiKey) {
    groqProviderInstance = createGroq({ apiKey });
    currentGroqKey = apiKey;
  }
  return groqProviderInstance;
}

/** Shared Groq speech-to-text model handle (defaults to the configured Whisper model). */
export function groqTranscriptionModel(modelId?: string) {
  return getGroqProvider().transcription(modelId || 'whisper-large-v3');
}

// --- Mistral ----------------------------------------------------------------

let mistralProviderInstance: ReturnType<typeof createMistral> | null = null;
let currentMistralKey: string | null = null;

export function resolveMistralApiKey(): string {
  return getEnv('MISTRAL_API_KEY') || process.env.MISTRAL_API_KEY || '';
}

export function getMistralProvider(): ReturnType<typeof createMistral> {
  const apiKey = resolveMistralApiKey();
  if (!mistralProviderInstance || currentMistralKey !== apiKey) {
    mistralProviderInstance = createMistral({ apiKey });
    currentMistralKey = apiKey;
  }
  return mistralProviderInstance;
}

/**
 * Shared Mistral speech-to-text model handle (Voxtral). Note: Mistral's
 * specialized OCR endpoint is NOT covered by the AI SDK provider — that call
 * stays a documented REST integration in unstructuredService/pdfChunker.
 */
export function mistralTranscriptionModel(modelId?: string) {
  return getMistralProvider().transcription(modelId || 'voxtral-mini-latest');
}
