import type { LanguageModel, EmbeddingModel, ImageModel } from 'ai';
import { parseModelRef, LEGACY_DEFAULT_PROVIDER } from './modelRef';
import { getProviderDescriptor } from './registry';
import { resolveProviderCredentials } from './credentials';

/**
 * Model resolution — turns a qualified model ref (`provider/modelId`, or a
 * legacy bare Gemini id) into a concrete AI SDK model instance built with the
 * active tenant's credentials.
 *
 * This is THE entry point server code uses to obtain a model. It replaces the
 * old Gemini-only `google(modelId)` shim. All functions are async because
 * credential resolution may read the tenant credential store.
 *
 * Honest degradation: when a provider or its credentials are missing, we still
 * return a model instance built with whatever credentials resolved (possibly an
 * empty key). The AI SDK then fails at call time, and the existing resilient
 * wrappers (generateTextResilient, embedding fallback) surface the failure the
 * same way they do today. We never silently substitute a different provider.
 */

/**
 * Resolves a language/chat model from a ref. Unknown provider ids fall back to
 * the legacy default (Google) so a mis-typed ref degrades to the historical
 * behavior instead of throwing during request setup.
 */
export async function resolveLanguageModel(ref: string): Promise<LanguageModel> {
  const { providerId, modelId } = parseModelRef(ref);
  const descriptor = getProviderDescriptor(providerId) || getProviderDescriptor(LEGACY_DEFAULT_PROVIDER)!;
  const creds = await resolveProviderCredentials(descriptor.id);
  return descriptor.createLanguageModel(modelId, creds);
}

/**
 * Resolves an embedding model from a ref. Returns undefined when the provider
 * has no embedding capability — callers apply their fallback policy.
 */
export async function resolveEmbeddingModel(ref: string): Promise<EmbeddingModel | undefined> {
  const { providerId, modelId } = parseModelRef(ref);
  const descriptor = getProviderDescriptor(providerId) || getProviderDescriptor(LEGACY_DEFAULT_PROVIDER)!;
  if (!descriptor.createEmbeddingModel) return undefined;
  const creds = await resolveProviderCredentials(descriptor.id);
  return descriptor.createEmbeddingModel(modelId, creds);
}

/** Resolves an image-generation model from a ref, or undefined if unsupported. */
export async function resolveImageModel(ref: string): Promise<ImageModel | undefined> {
  const { providerId, modelId } = parseModelRef(ref);
  const descriptor = getProviderDescriptor(providerId);
  if (!descriptor?.createImageModel) return undefined;
  const creds = await resolveProviderCredentials(descriptor.id);
  return descriptor.createImageModel(modelId, creds);
}

/**
 * Whether the provider backing a ref has usable credentials configured.
 * Cheap (cached) — used for honest-degradation checks before API calls.
 */
export async function isModelRefConfigured(ref: string): Promise<boolean> {
  const { providerId } = parseModelRef(ref);
  const { isProviderConfigured } = await import('./credentials');
  return isProviderConfigured(providerId);
}
