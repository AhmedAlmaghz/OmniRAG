import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { getEnv } from '../env/runtimeEnv';

/**
 * Single shared @ai-sdk/google provider for the whole app (HyDE, reranker,
 * chat streaming, media transcription). The instance is rebuilt lazily whenever
 * the API key changes, mirroring lib/rag/embedding.ts so dev-time
 * header-injected keys and runtime env rotation take effect without a cold
 * restart. All AI-SDK call sites MUST go through this module instead of
 * importing '@ai-sdk/google' directly — two differently-configured providers
 * would silently diverge in headers and credentials.
 *
 * The key resolves through getEnv() so keys provisioned at runtime (x-env-*
 * headers in dev / ALLOW_CLIENT_ENV deployments, or the runtime env store) are
 * honored exactly like host-level process.env secrets.
 */
let providerInstance: ReturnType<typeof createGoogleGenerativeAI> | null = null;
let currentApiKey: string | null = null;

export function resolveGeminiApiKey(): string {
  return (
    getEnv('GEMINI_API_KEY') ||
    getEnv('GOOGLE_GENERATIVE_AI_API_KEY') ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ''
  );
}

export function getGoogleProvider(): ReturnType<typeof createGoogleGenerativeAI> {
  const apiKey = resolveGeminiApiKey();
  if (!providerInstance || currentApiKey !== apiKey) {
    providerInstance = createGoogleGenerativeAI({
      apiKey,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    });
    currentApiKey = apiKey;
  }
  return providerInstance;
}

/**
 * Call-signature-compatible replacement for the old eagerly-created singleton,
 * so existing `google(modelId)` call sites keep working unchanged.
 */
export function google(modelId: string) {
  return getGoogleProvider()(modelId);
}
