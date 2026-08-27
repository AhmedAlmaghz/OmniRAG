import { createGroq } from '@ai-sdk/groq';
import type { ProviderDescriptor, ProviderCredentials, ModelDescriptor } from '../types';
import { getCachedProviderInstance, providerCacheKey } from '../instanceCache';

/** Groq adapter — fast inference + Whisper speech-to-text. */

function buildProvider(creds: ProviderCredentials) {
  return getCachedProviderInstance(providerCacheKey('groq', creds), () => createGroq({ apiKey: creds.apiKey || '' }));
}

const MODELS: ModelDescriptor[] = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', capabilities: ['chat'], contextWindow: 128000 },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', capabilities: ['chat'], contextWindow: 128000 },
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', capabilities: ['chat'], contextWindow: 128000 },
  { id: 'whisper-large-v3', name: 'Whisper Large v3', capabilities: ['speech-to-text'] },
];

export const groqProviderDescriptor: ProviderDescriptor = {
  id: 'groq',
  nameAr: 'جروك',
  nameEn: 'Groq',
  capabilities: ['chat', 'speech-to-text'],
  credentialFields: [
    {
      key: 'apiKey',
      labelAr: 'مفتاح Groq API',
      labelEn: 'Groq API Key',
      secret: true,
      required: true,
      envVar: 'GROQ_API_KEY',
      placeholder: 'gsk_…',
    },
  ],
  baseUrlConfigurable: false,
  models: MODELS,
  createLanguageModel: (modelId, creds) => buildProvider(creds)(modelId),
  createTranscriptionModel: (modelId, creds) => (buildProvider(creds) as any).transcriptionModel(modelId),
};
