import crypto from 'crypto';

/**
 * Instance cache for provider SDK objects.
 *
 * Provider factories (createOpenAI, createAnthropic, …) are cheap to call but
 * the resulting objects hold connection/header state we want to reuse across
 * requests. The historical pattern rebuilt a singleton whenever the API key
 * changed; with per-tenant credentials there is no single process-wide key, so
 * we instead cache instances keyed on (provider, key-hash, baseUrl). A tenant
 * rotating its key naturally gets a fresh instance; unchanged tenants reuse
 * the cached one. Keys are hashed in the cache key so plaintext never sits in
 * a long-lived Map.
 */

const cache = new Map<string, unknown>();
/** Bound the cache so many tenants/rotations can't grow it without limit. */
const MAX_ENTRIES = 256;

function shortHash(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value || '', 'utf8')
    .digest('hex')
    .slice(0, 16);
}

export function providerCacheKey(providerId: string, creds: { apiKey?: string; baseUrl?: string }): string {
  return `${providerId}::${shortHash(creds.apiKey || '')}::${creds.baseUrl || ''}`;
}

/**
 * Returns a cached instance for the key, or builds (and caches) one via the
 * factory. Insertion-order eviction keeps the map bounded.
 */
export function getCachedProviderInstance<T>(key: string, factory: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) return hit as T;
  const instance = factory();
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, instance);
  return instance;
}

/** Test/rotation escape hatch. */
export function clearProviderInstanceCache(): void {
  cache.clear();
}
