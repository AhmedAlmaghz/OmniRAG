import type { ProviderDescriptor, ModelDescriptor, ModelCapability } from './types';
import { googleProviderDescriptor } from './adapters/google';
import { openaiProviderDescriptor } from './adapters/openai';
import { anthropicProviderDescriptor } from './adapters/anthropic';
import { groqProviderDescriptor } from './adapters/groq';
import { mistralProviderDescriptor } from './adapters/mistral';
import {
  ollamaProviderDescriptor,
  openrouterProviderDescriptor,
  compatibleProviderDescriptor,
} from './adapters/compatible';

/**
 * The provider registry — single source of truth for every selectable AI
 * backend. Order matters only for display. Registering a new provider =
 * add one adapter file and append it here; the settings UI, credential store,
 * and model resolver pick it up automatically.
 */
export const PROVIDER_REGISTRY: ProviderDescriptor[] = [
  googleProviderDescriptor,
  openaiProviderDescriptor,
  anthropicProviderDescriptor,
  groqProviderDescriptor,
  mistralProviderDescriptor,
  ollamaProviderDescriptor,
  openrouterProviderDescriptor,
  compatibleProviderDescriptor,
];

const byId = new Map<string, ProviderDescriptor>(PROVIDER_REGISTRY.map((p) => [p.id, p]));

export function getProviderDescriptor(providerId: string): ProviderDescriptor | undefined {
  return byId.get(providerId);
}

export function listProviderDescriptors(): ProviderDescriptor[] {
  return [...PROVIDER_REGISTRY];
}

/** All providers that declare a given capability. */
export function providersWithCapability(capability: ModelCapability): ProviderDescriptor[] {
  return PROVIDER_REGISTRY.filter((p) => p.capabilities.includes(capability));
}

/**
 * Finds the descriptor + model entry for a model id, searching every provider.
 * Used to enrich UI listings and to look up embedding dimensions. Returns the
 * first match; qualified refs should prefer getProviderDescriptor directly.
 */
export function findModelById(modelId: string): { provider: ProviderDescriptor; model: ModelDescriptor } | undefined {
  for (const provider of PROVIDER_REGISTRY) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return { provider, model };
  }
  return undefined;
}

/**
 * Serializes descriptors into a client-safe catalog (no factory functions).
 * Returned by /api/v1/providers so the UI never imports provider SDKs.
 */
export function toProviderCatalog() {
  return PROVIDER_REGISTRY.map((p) => ({
    id: p.id,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    capabilities: p.capabilities,
    credentialFields: p.credentialFields.map((f) => ({
      key: f.key,
      labelAr: f.labelAr,
      labelEn: f.labelEn,
      secret: f.secret,
      required: f.required,
      placeholder: f.placeholder,
      // envVar intentionally omitted client-side (host config is server-only).
    })),
    baseUrlConfigurable: p.baseUrlConfigurable,
    defaultBaseUrl: p.defaultBaseUrl,
    models: p.models,
    supportsDiscovery: typeof p.discoverModels === 'function',
  }));
}
