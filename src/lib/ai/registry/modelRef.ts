/**
 * Qualified model references: `providerId/modelId`.
 *
 * OmniRAG historically stored bare Gemini model ids (`gemini-3.7-flash`).
 * With multiple providers, a model is identified by BOTH its provider and its
 * id. The qualified form `openai/gpt-4o` removes ambiguity. Backward
 * compatibility: a ref WITHOUT a slash is treated as a Google (Gemini) model,
 * so every existing config, cookie, and persisted row keeps working.
 */

export interface ModelRef {
  providerId: string;
  modelId: string;
}

/** Provider assumed for legacy unqualified refs (pre-multi-provider Gemini). */
export const LEGACY_DEFAULT_PROVIDER = 'google';

/**
 * Parses a model reference into provider + model id.
 *
 * - `openai/gpt-4o`        → { providerId: 'openai', modelId: 'gpt-4o' }
 * - `gemini-3.7-flash`     → { providerId: 'google', modelId: 'gemini-3.7-flash' }
 * - `google/gemini-3.7…`   → { providerId: 'google', modelId: 'gemini-3.7…' }
 *
 * Model ids may themselves contain slashes in rare provider naming schemes;
 * only the FIRST slash separates provider from model. Empty/invalid input
 * falls back to the legacy default provider with the raw string as model id.
 */
export function parseModelRef(ref: string): ModelRef {
  const trimmed = (ref || '').trim();
  if (!trimmed) return { providerId: LEGACY_DEFAULT_PROVIDER, modelId: '' };
  const slash = trimmed.indexOf('/');
  if (slash <= 0) {
    // No slash, or a leading slash → legacy bare model id (Google).
    return { providerId: LEGACY_DEFAULT_PROVIDER, modelId: trimmed.replace(/^\//, '') };
  }
  return { providerId: trimmed.slice(0, slash), modelId: trimmed.slice(slash + 1) };
}

/** Builds the canonical qualified ref string. */
export function formatModelRef(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

/** True when the ref already carries an explicit provider prefix. */
export function isQualifiedRef(ref: string): boolean {
  const slash = (ref || '').indexOf('/');
  return slash > 0;
}
