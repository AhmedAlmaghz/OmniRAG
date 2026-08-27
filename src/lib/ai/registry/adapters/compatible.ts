import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ProviderDescriptor, ProviderCredentials, ModelDescriptor } from '../types';
import { getCachedProviderInstance, providerCacheKey } from '../instanceCache';

/**
 * OpenAI-compatible endpoints — one factory, three presets.
 *
 * `createOpenAICompatible` speaks the /chat/completions + /models contract, so
 * it covers Ollama, OpenRouter, vLLM, LM Studio, text-generation-inference,
 * and any custom gateway. The generic `openai-compatible` descriptor lets a
 * tenant point at an arbitrary base URL; Ollama and OpenRouter are convenience
 * presets over the same machinery with sensible defaults and discovery.
 */

function buildProvider(id: string, creds: ProviderCredentials, fallbackBaseUrl: string) {
  const baseURL = creds.baseUrl || fallbackBaseUrl;
  return getCachedProviderInstance(providerCacheKey(id, { ...creds, baseUrl: baseURL }), () =>
    createOpenAICompatible({
      name: id,
      baseURL,
      ...(creds.apiKey ? { apiKey: creds.apiKey } : {}),
    }),
  );
}

/**
 * Generic /v1/models discovery shared by the compatible presets. Returns []
 * on any failure so an offline local server never breaks the settings UI.
 */
async function discoverViaModelsEndpoint(creds: ProviderCredentials, baseUrl: string): Promise<ModelDescriptor[]> {
  const url = `${(creds.baseUrl || baseUrl).replace(/\/$/, '')}/models`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: creds.apiKey ? { Authorization: `Bearer ${creds.apiKey}` } : {},
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    const ids: string[] = Array.isArray(data?.data)
      ? data.data.map((m: any) => m?.id).filter(Boolean)
      : Array.isArray(data?.models)
        ? data.models.map((m: any) => (typeof m === 'string' ? m : m?.name)).filter(Boolean)
        : [];
    return ids.slice(0, 200).map((id) => ({ id, name: id, capabilities: ['chat'] as const }));
  } catch {
    return [];
  }
}

// --- Ollama (local, no key) -------------------------------------------------
export const ollamaProviderDescriptor: ProviderDescriptor = {
  id: 'ollama',
  nameAr: 'أولاما (محلي)',
  nameEn: 'Ollama (local)',
  capabilities: ['chat', 'embedding'],
  credentialFields: [
    {
      key: 'baseUrl',
      labelAr: 'عنوان خادم Ollama',
      labelEn: 'Ollama server URL',
      secret: false,
      required: false,
      placeholder: 'http://localhost:11434/v1',
    },
  ],
  baseUrlConfigurable: true,
  defaultBaseUrl: 'http://localhost:11434/v1',
  models: [
    { id: 'llama3.1', name: 'Llama 3.1', capabilities: ['chat'] },
    { id: 'qwen2.5', name: 'Qwen 2.5', capabilities: ['chat'] },
    { id: 'mistral', name: 'Mistral', capabilities: ['chat'] },
    { id: 'nomic-embed-text', name: 'Nomic Embed Text', capabilities: ['embedding'], embeddingDimensions: 768 },
  ],
  discoverModels: (creds) => discoverViaModelsEndpoint(creds, 'http://localhost:11434/v1'),
  createLanguageModel: (modelId, creds) =>
    buildProvider('ollama', creds, 'http://localhost:11434/v1').chatModel(modelId),
  createEmbeddingModel: (modelId, creds) =>
    buildProvider('ollama', creds, 'http://localhost:11434/v1').embeddingModel(modelId),
};

// --- OpenRouter -------------------------------------------------------------
export const openrouterProviderDescriptor: ProviderDescriptor = {
  id: 'openrouter',
  nameAr: 'أوبن راوتر',
  nameEn: 'OpenRouter',
  capabilities: ['chat'],
  credentialFields: [
    {
      key: 'apiKey',
      labelAr: 'مفتاح OpenRouter',
      labelEn: 'OpenRouter API Key',
      secret: true,
      required: true,
      envVar: 'OPENROUTER_API_KEY',
      placeholder: 'sk-or-…',
    },
  ],
  baseUrlConfigurable: false,
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  models: [
    { id: 'openai/gpt-4o', name: 'GPT-4o (via OpenRouter)', capabilities: ['chat'] },
    { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5 (via OpenRouter)', capabilities: ['chat'] },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash (via OpenRouter)', capabilities: ['chat'] },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B (via OpenRouter)', capabilities: ['chat'] },
  ],
  discoverModels: (creds) => discoverViaModelsEndpoint(creds, 'https://openrouter.ai/api/v1'),
  createLanguageModel: (modelId, creds) =>
    buildProvider('openrouter', creds, 'https://openrouter.ai/api/v1').chatModel(modelId),
};

// --- Generic OpenAI-compatible ----------------------------------------------
export const compatibleProviderDescriptor: ProviderDescriptor = {
  id: 'openai-compatible',
  nameAr: 'خادم متوافق مع OpenAI',
  nameEn: 'OpenAI-compatible server',
  capabilities: ['chat', 'embedding'],
  credentialFields: [
    {
      key: 'baseUrl',
      labelAr: 'عنوان الأساس (v1)',
      labelEn: 'Base URL (v1)',
      secret: false,
      required: true,
      placeholder: 'http://localhost:8000/v1',
    },
    {
      key: 'apiKey',
      labelAr: 'مفتاح API (اختياري)',
      labelEn: 'API Key (optional)',
      secret: true,
      required: false,
    },
  ],
  baseUrlConfigurable: true,
  models: [],
  discoverModels: (creds) => discoverViaModelsEndpoint(creds, creds.baseUrl || ''),
  createLanguageModel: (modelId, creds) =>
    buildProvider('openai-compatible', creds, creds.baseUrl || '').chatModel(modelId),
  createEmbeddingModel: (modelId, creds) =>
    buildProvider('openai-compatible', creds, creds.baseUrl || '').embeddingModel(modelId),
};
