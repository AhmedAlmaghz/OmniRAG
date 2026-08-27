import { createAnthropic } from '@ai-sdk/anthropic';
import type { ProviderDescriptor, ProviderCredentials, ModelDescriptor } from '../types';
import { getCachedProviderInstance, providerCacheKey } from '../instanceCache';

/** Anthropic (Claude) adapter. */

function buildProvider(creds: ProviderCredentials) {
  return getCachedProviderInstance(providerCacheKey('anthropic', creds), () =>
    createAnthropic({
      apiKey: creds.apiKey || '',
      ...(creds.baseUrl ? { baseURL: creds.baseUrl } : {}),
    }),
  );
}

const MODELS: ModelDescriptor[] = [
  { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', capabilities: ['chat'], contextWindow: 200000 },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', capabilities: ['chat'], contextWindow: 200000 },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', capabilities: ['chat'], contextWindow: 200000 },
  { id: 'claude-3-7-sonnet-latest', name: 'Claude 3.7 Sonnet', capabilities: ['chat'], contextWindow: 200000 },
  { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', capabilities: ['chat'], contextWindow: 200000 },
];

export const anthropicProviderDescriptor: ProviderDescriptor = {
  id: 'anthropic',
  nameAr: 'أنثروبيك كلود',
  nameEn: 'Anthropic Claude',
  capabilities: ['chat'],
  credentialFields: [
    {
      key: 'apiKey',
      labelAr: 'مفتاح Anthropic API',
      labelEn: 'Anthropic API Key',
      secret: true,
      required: true,
      envVar: 'ANTHROPIC_API_KEY',
      placeholder: 'sk-ant-…',
    },
  ],
  baseUrlConfigurable: true,
  defaultBaseUrl: 'https://api.anthropic.com/v1',
  models: MODELS,
  createLanguageModel: (modelId, creds) => buildProvider(creds)(modelId),
};
