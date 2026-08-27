import { describe, it, expect } from 'vitest';
import { parseModelRef, formatModelRef, isQualifiedRef, LEGACY_DEFAULT_PROVIDER } from '@/lib/ai/registry/modelRef';

// Qualified model refs (`provider/modelId`) are the backbone of the
// multi-provider layer. The backward-compatibility guarantee — bare ids keep
// resolving to Google — protects every persisted config, cookie, and row from
// the Gemini-only era, so it gets its own dedicated assertions.
describe('modelRef — qualified model references', () => {
  it('parses a qualified ref into provider + model', () => {
    expect(parseModelRef('openai/gpt-4o')).toEqual({ providerId: 'openai', modelId: 'gpt-4o' });
    expect(parseModelRef('anthropic/claude-sonnet-4-5')).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    });
  });

  it('treats legacy bare ids as Google models (backward compatibility)', () => {
    expect(parseModelRef('gemini-3.7-flash')).toEqual({
      providerId: LEGACY_DEFAULT_PROVIDER,
      modelId: 'gemini-3.7-flash',
    });
    expect(LEGACY_DEFAULT_PROVIDER).toBe('google');
  });

  it('splits only on the FIRST slash (model ids may contain slashes)', () => {
    expect(parseModelRef('openrouter/meta-llama/llama-3.3-70b')).toEqual({
      providerId: 'openrouter',
      modelId: 'meta-llama/llama-3.3-70b',
    });
  });

  it('handles explicit google/ prefix like any other provider', () => {
    expect(parseModelRef('google/gemini-3.7-flash')).toEqual({
      providerId: 'google',
      modelId: 'gemini-3.7-flash',
    });
  });

  it('trims whitespace and survives empty input without throwing', () => {
    expect(parseModelRef('  openai/gpt-4o  ')).toEqual({ providerId: 'openai', modelId: 'gpt-4o' });
    expect(parseModelRef('')).toEqual({ providerId: LEGACY_DEFAULT_PROVIDER, modelId: '' });
    expect(parseModelRef(undefined as unknown as string)).toEqual({
      providerId: LEGACY_DEFAULT_PROVIDER,
      modelId: '',
    });
  });

  it('treats a leading slash as a bare id, not an empty provider', () => {
    expect(parseModelRef('/gpt-4o')).toEqual({ providerId: LEGACY_DEFAULT_PROVIDER, modelId: 'gpt-4o' });
  });

  it('formatModelRef round-trips through parseModelRef', () => {
    const ref = formatModelRef('mistral', 'mistral-large-latest');
    expect(ref).toBe('mistral/mistral-large-latest');
    expect(parseModelRef(ref)).toEqual({ providerId: 'mistral', modelId: 'mistral-large-latest' });
  });

  it('isQualifiedRef detects explicit provider prefixes only', () => {
    expect(isQualifiedRef('openai/gpt-4o')).toBe(true);
    expect(isQualifiedRef('gemini-3.7-flash')).toBe(false);
    expect(isQualifiedRef('/leading-slash')).toBe(false);
    expect(isQualifiedRef('')).toBe(false);
  });
});
