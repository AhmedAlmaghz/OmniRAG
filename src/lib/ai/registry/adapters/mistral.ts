import { createMistral } from '@ai-sdk/mistral';
import type { ProviderDescriptor, ProviderCredentials, ModelDescriptor } from '../types';
import { getCachedProviderInstance, providerCacheKey } from '../instanceCache';

/**
 * Mistral adapter — chat + embeddings + Voxtral transcription.
 * Note: Mistral's specialized Document-AI OCR endpoint is a REST integration
 * (see unstructuredService.mistralOcr) and is not part of the AI SDK provider.
 */

function buildProvider(creds: ProviderCredentials) {
  return getCachedProviderInstance(providerCacheKey('mistral', creds), () =>
    createMistral({ apiKey: creds.apiKey || '' }),
  );
}

const MODELS: ModelDescriptor[] = [
  { id: 'mistral-large-latest', name: 'Mistral Large', capabilities: ['chat'], contextWindow: 128000 },
  { id: 'mistral-small-latest', name: 'Mistral Small', capabilities: ['chat'], contextWindow: 32000 },
  { id: 'open-mistral-nemo', name: 'Mistral Nemo', capabilities: ['chat'], contextWindow: 128000 },
  { id: 'ministral-8b-latest', name: 'Ministral 8B', capabilities: ['chat'], contextWindow: 128000 },
  { id: 'mistral-embed', name: 'Mistral Embed', capabilities: ['embedding'], embeddingDimensions: 1024 },
  { id: 'voxtral-mini-latest', name: 'Voxtral Mini', capabilities: ['speech-to-text'] },
];

export const mistralProviderDescriptor: ProviderDescriptor = {
  id: 'mistral',
  nameAr: 'ميسترال',
  nameEn: 'Mistral AI',
  capabilities: ['chat', 'embedding', 'ocr', 'speech-to-text'],
  credentialFields: [
    {
      key: 'apiKey',
      labelAr: 'مفتاح Mistral API',
      labelEn: 'Mistral API Key',
      secret: true,
      required: true,
      envVar: 'MISTRAL_API_KEY',
      placeholder: '…',
    },
  ],
  baseUrlConfigurable: false,
  models: MODELS,
  createLanguageModel: (modelId, creds) => buildProvider(creds)(modelId),
  createEmbeddingModel: (modelId, creds) => (buildProvider(creds) as any).embeddingModel(modelId),
  createTranscriptionModel: (modelId, creds) => (buildProvider(creds) as any).transcriptionModel(modelId),
};
