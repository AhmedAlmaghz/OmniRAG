import { createLogger } from '@/lib/logging/logger';

const log = createLogger('LibAiRegistryCredentials');

import { getEnv } from '../../env/runtimeEnv';
import { getActiveTenantId } from '../../config/requestContext';
import { decryptToken } from '../../mcp/auth/encryption';
import { getProviderDescriptor } from './registry';
import type { ProviderCredentials } from './types';

/**
 * Provider credential resolution (server-only).
 *
 * Resolution order, per provider, per request:
 *   1. The active tenant's stored credentials (provider_credentials, decrypted).
 *   2. Host environment fallback via each credential field's `envVar`.
 *
 * This keeps existing single-key deployments working unchanged (env keys) while
 * letting any tenant supply its own keys through the settings UI. Decrypted
 * values are held in a short-TTL in-memory cache keyed by tenant+provider so a
 * chat turn that resolves several models doesn't re-query and re-decrypt on
 * every call. Plaintext never leaves the server process.
 */

interface CacheEntry {
  creds: ProviderCredentials;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const MAX_CACHE = 512;

function cacheKey(tenantId: string, providerId: string): string {
  return `${tenantId}::${providerId}`;
}

function readCache(key: string): ProviderCredentials | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.creds;
}

function writeCache(key: string, creds: ProviderCredentials): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { creds, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Test/rotation escape hatch. */
export function clearProviderCredentialCache(): void {
  cache.clear();
}

function decryptCredentials(stored: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(stored || {})) {
    if (typeof v !== 'string' || v === '') {
      out[k] = v;
      continue;
    }
    try {
      out[k] = v.includes(':') ? decryptToken(v) : v;
    } catch {
      out[k] = v; // Not encrypted (legacy) — use as-is.
    }
  }
  return out;
}

/**
 * Resolves credentials for a provider in the current request scope. Returns an
 * object that may have an empty apiKey when nothing is configured — callers
 * decide how to degrade (the resolver falls back to honest failure).
 */
export async function resolveProviderCredentials(providerId: string): Promise<ProviderCredentials> {
  const descriptor = getProviderDescriptor(providerId);
  const tenantId = getActiveTenantId();
  const key = cacheKey(tenantId || '__no_tenant__', providerId);

  const cached = readCache(key);
  if (cached) return cached;

  let creds: ProviderCredentials = {};

  // 1. Tenant-stored credentials (encrypted at rest). The storage singleton is
  //    imported lazily to break a module-load cycle:
  //    db.ts → embedding.ts → resolve.ts → credentials.ts → db.ts.
  if (tenantId) {
    try {
      const { db } = await import('../../storage/db');
      const record = await db.getProviderCredentials(tenantId, providerId);
      if (record && record.enabled !== false && record.credentials) {
        const decrypted = decryptCredentials(record.credentials);
        creds = { ...decrypted, baseUrl: record.baseUrl || decrypted.baseUrl || undefined };
      }
    } catch (e) {
      log.warn('[providerCredentials] tenant lookup failed, falling back to env:', (e as Error)?.message);
    }
  }

  // 2. Environment fallback for any field still missing.
  if (descriptor) {
    for (const field of descriptor.credentialFields) {
      const current = creds[field.key];
      if ((current === undefined || current === '') && field.envVar) {
        const envVal = getEnv(field.envVar);
        if (envVal) creds[field.key] = envVal;
      }
    }
    // Base URL: prefer tenant value, then descriptor default.
    if (!creds.baseUrl && descriptor.defaultBaseUrl) {
      creds.baseUrl = descriptor.defaultBaseUrl;
    }
  }

  writeCache(key, creds);
  return creds;
}

/**
 * Whether a provider has any usable credential configured (tenant or env).
 * Used for honest-degradation checks (e.g. skip embedding API when no key).
 */
export async function isProviderConfigured(providerId: string): Promise<boolean> {
  const creds = await resolveProviderCredentials(providerId);
  const descriptor = getProviderDescriptor(providerId);
  if (!descriptor) return false;
  // Providers that require no secret (e.g. local Ollama) count as configured
  // if they have a base URL or no required secret fields at all.
  const requiresSecret = descriptor.credentialFields.some((f) => f.secret && f.required);
  if (!requiresSecret) return true;
  return Boolean(creds.apiKey && creds.apiKey.trim() !== '');
}
