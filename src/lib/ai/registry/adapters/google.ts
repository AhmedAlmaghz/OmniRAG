import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ProviderDescriptor, ProviderCredentials, ModelDescriptor } from '../types';
import { getCachedProviderInstance, providerCacheKey } from '../instanceCache';

/**
 * Google (Gemini) adapter — the legacy default provider.
 *
 * Builds the @ai-sdk/google provider from resolved credentials (tenant store
 * → env fallback, applied by the resolver before this factory runs). The
 * env-based singleton in lib/rag/googleProvider.ts remains for Files-API and
 * transcription paths; this adapter owns the multi-provider language and
 * embedding path.
 */

function buildProvider(creds: ProviderCredentials) {
  return getCachedProviderInstance(providerCacheKey('google', creds), () =>
    createGoogleGenerativeAI({
      apiKey: creds.apiKey || '',
      headers: { 'User-Agent': 'aistudio-build' },
    }),
  );
}

const MODELS: ModelDescriptor[] = [
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    capabilities: ['chat', 'ocr'],
    descriptionAr: 'النموذج الأحدث والأسرع للأداء اليومي والمحادثات واستدعاء الأدوات.',
    descriptionEn: 'Fastest latest model for daily performance and agentic tool calls.',
    contextWindow: 1048576,
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    capabilities: ['chat', 'rerank'],
    descriptionAr: 'نموذج التفكير المتقدم والمنطق المعقد للتحليلات العميقة.',
    descriptionEn: 'Advanced reasoning model for deep analysis.',
    contextWindow: 1048576,
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    capabilities: ['chat'],
    descriptionAr: 'نموذج فائق الخفة والسرعة للمهام ذات الحجم الضخم.',
    descriptionEn: 'Ultra-lightweight model for high-volume tasks.',
  },
  {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash Latest',
    capabilities: ['chat'],
    descriptionAr: 'الإصدار القياسي لنموذج Flash السريع للمهام العامة.',
    descriptionEn: 'Standard latest Flash alias for general tasks.',
  },
  {
    id: 'text-embedding-004',
    name: 'Text Embedding 004',
    capabilities: ['embedding'],
    descriptionAr: 'نموذج التضمين المعتمد لبناء متجهات البحث الدلالي (768 بُعداً).',
    descriptionEn: 'Official embedding model for semantic vector search.',
    embeddingDimensions: 768,
  },
  {
    id: 'gemini-embedding-2',
    name: 'Gemini Embedding 2',
    capabilities: ['embedding'],
    descriptionAr: 'نموذج متجهات التضمين متعدد اللغات عالي الدقة.',
    descriptionEn: 'Advanced multilingual embedding model.',
    embeddingDimensions: 3072,
  },
  {
    id: 'gemini-embedding-2-preview',
    name: 'Gemini Embedding 2 Preview',
    capabilities: ['embedding'],
    descriptionAr: 'نموذج متجهات التضمين متعدد اللغات عالي الدقة.',
    descriptionEn: 'Advanced multilingual embedding model.',
    embeddingDimensions: 3072,
  },
];

export const googleProviderDescriptor: ProviderDescriptor = {
  id: 'google',
  nameAr: 'جوجل جيميني',
  nameEn: 'Google Gemini',
  capabilities: ['chat', 'embedding', 'image', 'ocr', 'rerank'],
  credentialFields: [
    {
      key: 'apiKey',
      labelAr: 'مفتاح Gemini API',
      labelEn: 'Gemini API Key',
      secret: true,
      required: true,
      envVar: 'GEMINI_API_KEY',
      placeholder: 'AIza…',
    },
  ],
  baseUrlConfigurable: false,
  models: MODELS,
  createLanguageModel: (modelId, creds) => buildProvider(creds)(modelId),
  createEmbeddingModel: (modelId, creds) => (buildProvider(creds) as any).embeddingModel(modelId),
  createImageModel: (modelId, creds) => (buildProvider(creds) as any).imageModel(modelId),
};
