import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderDescriptor, ProviderCredentials, ModelDescriptor } from '../types';
import { getCachedProviderInstance, providerCacheKey } from '../instanceCache';

/**
 * OpenAI adapter. Also serves Azure OpenAI by overriding the base URL
 * (e.g. https://<resource>.openai.azure.com/openai) — the credential form
 * exposes an optional baseUrl for that purpose.
 */

function buildProvider(creds: ProviderCredentials) {
  return getCachedProviderInstance(providerCacheKey('openai', creds), () =>
    createOpenAI({
      apiKey: creds.apiKey || '',
      ...(creds.baseUrl ? { baseURL: creds.baseUrl } : {}),
      ...(creds.organizationId ? { organization: creds.organizationId } : {}),
      ...(creds.projectId ? { project: creds.projectId } : {}),
    }),
  );
}

const MODELS: ModelDescriptor[] = [
  { id: 'gpt-4o', name: 'GPT-4o', capabilities: ['chat'], contextWindow: 128000 },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', capabilities: ['chat'], contextWindow: 128000 },
  { id: 'gpt-4.1', name: 'GPT-4.1', capabilities: ['chat'], contextWindow: 1047576 },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', capabilities: ['chat'], contextWindow: 1047576 },
  { id: 'o3-mini', name: 'o3-mini', capabilities: ['chat'], contextWindow: 200000 },
  {
    id: 'text-embedding-3-small',
    name: 'Text Embedding 3 Small',
    capabilities: ['embedding'],
    embeddingDimensions: 1536,
  },
  {
    id: 'text-embedding-3-large',
    name: 'Text Embedding 3 Large',
    capabilities: ['embedding'],
    embeddingDimensions: 3072,
  },
  { id: 'dall-e-3', name: 'DALL·E 3', capabilities: ['image'] },
  { id: 'whisper-1', name: 'Whisper', capabilities: ['speech-to-text'] },
];

export const openaiProviderDescriptor: ProviderDescriptor = {
  id: 'openai',
  nameAr: 'أوبن إيه آي',
  nameEn: 'OpenAI',
  capabilities: ['chat', 'embedding', 'image', 'speech-to-text'],
  credentialFields: [
    {
      key: 'apiKey',
      labelAr: 'مفتاح OpenAI API',
      labelEn: 'OpenAI API Key',
      secret: true,
      required: true,
      envVar: 'OPENAI_API_KEY',
      placeholder: 'sk-…',
    },
    {
      key: 'baseUrl',
      labelAr: 'عنوان الأساس (اختياري — Azure)',
      labelEn: 'Base URL (optional — Azure)',
      secret: false,
      required: false,
      placeholder: 'https://api.openai.com/v1',
    },
    { key: 'organizationId', labelAr: 'المعرف التنظيمي', labelEn: 'Organization ID', secret: false, required: false },
    { key: 'projectId', labelAr: 'معرف المشروع', labelEn: 'Project ID', secret: false, required: false },
  ],
  baseUrlConfigurable: true,
  defaultBaseUrl: 'https://api.openai.com/v1',
  models: MODELS,
  createLanguageModel: (modelId, creds) => buildProvider(creds)(modelId),
  createEmbeddingModel: (modelId, creds) => (buildProvider(creds) as any).embeddingModel(modelId),
  createImageModel: (modelId, creds) => (buildProvider(creds) as any).imageModel(modelId),
  createTranscriptionModel: (modelId, creds) => (buildProvider(creds) as any).transcriptionModel(modelId),
};
