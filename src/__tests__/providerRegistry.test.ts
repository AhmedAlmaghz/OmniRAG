import { describe, it, expect, vi, beforeEach } from 'vitest';

// The provider registry is the single source of truth for every selectable AI
// backend. These tests pin the UNIFORM CONTRACT all adapters must satisfy
// (self-description, capabilities, client-safe serialization) plus the
// resolution behavior of resolveLanguageModel/resolveEmbeddingModel, with the
// credential layer mocked so no DB or host env is touched.
vi.mock('@/lib/ai/registry/credentials', () => ({
  resolveProviderCredentials: vi.fn(async () => ({ apiKey: 'test-key' })),
  isProviderConfigured: vi.fn(async () => true),
  clearProviderCredentialCache: vi.fn(),
}));

import {
  PROVIDER_REGISTRY,
  listProviderDescriptors,
  providersWithCapability,
  findModelById,
  toProviderCatalog,
} from '@/lib/ai/registry/registry';
import { resolveLanguageModel, resolveEmbeddingModel, isModelRefConfigured } from '@/lib/ai/registry/resolve';
import { resolveProviderCredentials } from '@/lib/ai/registry/credentials';

const mockedCreds = vi.mocked(resolveProviderCredentials);

/**
 * AI SDK v7 types LanguageModel/EmbeddingModel as unions that also accept
 * plain string model references. Our adapters always return model objects, so
 * narrow before reading `modelId`.
 */
function modelIdOf(model: unknown): string {
  expect(model).toBeDefined();
  expect(typeof model).toBe('object');
  return (model as { modelId: string }).modelId;
}

describe('provider registry — uniform adapter contract', () => {
  it('registers the expected provider set with unique ids', () => {
    const ids = PROVIDER_REGISTRY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const expected of [
      'google',
      'openai',
      'anthropic',
      'groq',
      'mistral',
      'ollama',
      'openrouter',
      'openai-compatible',
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it('every descriptor self-describes: names, capabilities, credential fields', () => {
    for (const p of listProviderDescriptors()) {
      expect(p.nameAr.trim().length, `${p.id} nameAr`).toBeGreaterThan(0);
      expect(p.nameEn.trim().length, `${p.id} nameEn`).toBeGreaterThan(0);
      expect(p.capabilities.length, `${p.id} capabilities`).toBeGreaterThan(0);
      expect(typeof p.createLanguageModel, `${p.id} createLanguageModel`).toBe('function');
      for (const field of p.credentialFields) {
        expect(field.key.trim().length, `${p.id} field key`).toBeGreaterThan(0);
        expect(typeof field.secret, `${p.id} field secret`).toBe('boolean');
        expect(typeof field.required, `${p.id} field required`).toBe('boolean');
      }
    }
  });

  it('every cataloged model declares id, name, and at least one capability', () => {
    for (const p of listProviderDescriptors()) {
      for (const m of p.models) {
        expect(m.id.trim().length, `${p.id}/${m.id} id`).toBeGreaterThan(0);
        expect(m.name.trim().length, `${p.id}/${m.id} name`).toBeGreaterThan(0);
        expect(m.capabilities.length, `${p.id}/${m.id} capabilities`).toBeGreaterThan(0);
      }
    }
  });

  it('declares embedding capability for the expected providers', () => {
    const ids = providersWithCapability('embedding').map((p) => p.id);
    for (const expected of ['google', 'openai', 'mistral', 'ollama', 'openai-compatible']) {
      expect(ids).toContain(expected);
    }
    // Anthropic has no embedding models — the registry must say so.
    expect(ids).not.toContain('anthropic');
  });

  it('findModelById locates models across providers', () => {
    const found = findModelById('gpt-4o');
    expect(found?.provider.id).toBe('openai');
    expect(findModelById('no-such-model-anywhere')).toBeUndefined();
  });

  it('toProviderCatalog is client-safe: no factory functions, no envVar leaks', () => {
    const catalog = toProviderCatalog();
    expect(catalog.length).toBe(PROVIDER_REGISTRY.length);
    for (const entry of catalog) {
      for (const value of Object.values(entry)) {
        expect(typeof value, `catalog ${entry.id} leaks a function`).not.toBe('function');
      }
      for (const field of entry.credentialFields) {
        expect((field as Record<string, unknown>).envVar).toBeUndefined();
      }
    }
  });
});

describe('model resolution — resolveLanguageModel / resolveEmbeddingModel', () => {
  beforeEach(() => {
    mockedCreds.mockClear();
  });

  it('resolves a qualified ref through the right provider adapter', async () => {
    const model = await resolveLanguageModel('openai/gpt-4o');
    expect(modelIdOf(model)).toBe('gpt-4o');
    expect(mockedCreds).toHaveBeenCalledWith('openai');
  });

  it('resolves legacy bare ids through Google (backward compatibility)', async () => {
    const model = await resolveLanguageModel('gemini-3.7-flash');
    expect(modelIdOf(model)).toBe('gemini-3.7-flash');
    expect(mockedCreds).toHaveBeenCalledWith('google');
  });

  it('falls back to the Google adapter for unknown provider ids (honest degradation)', async () => {
    const model = await resolveLanguageModel('nonexistent-provider/some-model');
    expect(modelIdOf(model)).toBe('some-model');
    expect(mockedCreds).toHaveBeenCalledWith('google');
  });

  it('resolves embedding models when the provider supports them', async () => {
    const model = await resolveEmbeddingModel('openai/text-embedding-3-small');
    expect(modelIdOf(model)).toBe('text-embedding-3-small');
    expect(mockedCreds).toHaveBeenCalledWith('openai');
  });

  it('returns undefined for embedding refs on providers without the capability', async () => {
    const model = await resolveEmbeddingModel('anthropic/claude-sonnet-4-5');
    expect(model).toBeUndefined();
  });

  it('isModelRefConfigured delegates to the credential layer per provider', async () => {
    await expect(isModelRefConfigured('openai/gpt-4o')).resolves.toBe(true);
  });
});
