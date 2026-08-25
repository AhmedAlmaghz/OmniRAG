const globalServerEnvStore: Record<string, string> = {};

/**
 * Allow-list of environment keys that may be managed through the runtime
 * configuration surface (UI, x-env-* headers, /api/v1/env-config). Any key
 * outside this set is rejected at write time so an authenticated tenant cannot
 * invent arbitrary process.env entries (log poisoning, library behaviour
 * toggles, covert config channels).
 */
export const ALLOWED_RUNTIME_ENV_KEYS = new Set<string>([
  'DATABASE_URL',
  'POSTGRES_URL',
  'QDRANT_URL',
  'QDRANT_API_KEY',
  'MISTRAL_API_KEY',
  'GROQ_API_KEY',
  'UNSTRUCTURED_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  // Optional MCP web-search provider keys (web_live_search tool)
  'TAVILY_API_KEY',
  'SERPER_API_KEY',
  'BRAVE_API_KEY',
  'APP_URL',
  'ALLOWED_ORIGINS',
  'PG_TLS_REJECT_UNAUTHORIZED',
]);

/**
 * Secrets that, if changed by one tenant, would re-route every other tenant's
 * traffic or storage on the same process. These MUST NOT be writable via the
 * API in production; they are provisioned exclusively by the host runtime
 * (Cloud Run / Vercel environment). Writing them from a request body would
 * let any authenticated tenant redirect database, vector, or LLM traffic for
 * the entire process — a full cross-tenant compromise vector.
 */
const SENSITIVE_RUNTIME_ENV_KEYS = new Set<string>([
  'DATABASE_URL',
  'POSTGRES_URL',
  'QDRANT_URL',
  'QDRANT_API_KEY',
  'MISTRAL_API_KEY',
  'GROQ_API_KEY',
  'UNSTRUCTURED_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
]);

/**
 * Header-supplied environment variables are a client-side credential injection
 * vector (e.g. redirecting DATABASE_URL to an attacker server). They are only
 * honored in development, or when explicitly enabled via ALLOW_CLIENT_ENV.
 */
function isClientEnvAllowed(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return process.env.ALLOW_CLIENT_ENV === 'true';
  }
  return true;
}

/**
 * Whether the server-side runtime env store may be MUTATED by an API request.
 * Platform secrets must come from the host runtime, not from request bodies.
 * In production this returns false unless an operator explicitly opts in with
 * ALLOW_CLIENT_ENV=true. The x-env-* read path independently honours the same
 * gate, but writes from /api/v1/env-config additionally require this check.
 */
export function isRuntimeEnvWriteAllowed(): boolean {
  return isClientEnvAllowed();
}

export type SetEnvResult =
  | { ok: true; key: string }
  | {
      ok: false;
      key: string;
      reason: 'empty_key' | 'key_not_allowed' | 'masked_placeholder' | 'write_blocked_in_production';
    };

/**
 * Get an environment variable from:
 * 1. Request headers (x-env-<key>) — non-production only, see isClientEnvAllowed.
 *    Only keys in ALLOWED_RUNTIME_ENV_KEYS are honoured, and the value is never
 *    tainted by masked (•) placeholders.
 * 2. In-memory runtime store (globalServerEnvStore)
 * 3. System process.env
 *
 * The header path writes to globalServerEnvStore (and process.env for dev
 * ergonomics when the key is allowed) but is gated to non-production, so an
 * unauthenticated cross-tenant mutation is not reachable in prod.
 */
export function getEnv(key: string, reqOrHeaders?: any): string {
  if (typeof window !== 'undefined') {
    // Client side: read from localStorage if available
    try {
      const localVal = localStorage.getItem(`omnirag_env_${key}`);
      if (localVal && !localVal.includes('•') && localVal.trim() !== '') {
        return localVal.trim();
      }
    } catch (e) {}
    return '';
  }

  const headerKey = `x-env-${key.toLowerCase().replace(/_/g, '-')}`;

  // 1. Check request headers (blocked in production unless explicitly enabled)
  if (reqOrHeaders && isClientEnvAllowed() && ALLOWED_RUNTIME_ENV_KEYS.has(key)) {
    let headerVal: string | null = null;
    try {
      if (reqOrHeaders.headers && typeof reqOrHeaders.headers.get === 'function') {
        headerVal = reqOrHeaders.headers.get(headerKey) || reqOrHeaders.headers.get(headerKey.toUpperCase());
      } else if (typeof reqOrHeaders.get === 'function') {
        headerVal = reqOrHeaders.get(headerKey) || reqOrHeaders.get(headerKey.toUpperCase());
      } else if (typeof reqOrHeaders === 'object') {
        headerVal = reqOrHeaders[headerKey] || reqOrHeaders[headerKey.toUpperCase()];
      }
    } catch (e) {}

    if (headerVal && typeof headerVal === 'string' && headerVal.trim() !== '') {
      try {
        const decoded = decodeURIComponent(headerVal.trim());
        if (decoded && !decoded.includes('•')) {
          globalServerEnvStore[key] = decoded;
          // Dev ergonomics: mirror to process.env so libraries that read it
          // directly (e.g. module-load GEMINI_API_KEY consumers) still work.
          // Gated to non-production by isClientEnvAllowed() above.
          process.env[key] = decoded;
          return decoded;
        }
      } catch (e) {
        if (!headerVal.includes('•')) {
          globalServerEnvStore[key] = headerVal;
          process.env[key] = headerVal;
          return headerVal;
        }
      }
    }
  }

  // 2. Check in-memory store
  if (globalServerEnvStore[key] && !globalServerEnvStore[key].includes('•')) {
    return globalServerEnvStore[key];
  }

  // 3. Check process.env
  const sysVal = process.env[key] || process.env[key.toUpperCase()] || '';
  if (sysVal && !sysVal.includes('•')) {
    return sysVal;
  }

  return '';
}

/**
 * Update an environment variable dynamically at runtime on the Node.js server.
 *
 * Enforces:
 * - Key must be in ALLOWED_RUNTIME_ENV_KEYS (no arbitrary process.env entries).
 * - Masked (•) placeholders are ignored to avoid clobbering real secrets with
 *   redacted UI values.
 * - Sensitive keys (DB/vector/LLM endpoints) are REFUSED in production unless
 *   the operator opted in with ALLOW_CLIENT_ENV=true. They must be provisioned
 *   by the host runtime, never by an authenticated tenant request body.
 */
export function setServerEnv(key: string, value: string): SetEnvResult {
  if (!key) return { ok: false, key: '', reason: 'empty_key' };
  if (!ALLOWED_RUNTIME_ENV_KEYS.has(key)) {
    return { ok: false, key, reason: 'key_not_allowed' };
  }

  const cleanVal = (value || '').trim();
  if (cleanVal.includes('•')) {
    return { ok: false, key, reason: 'masked_placeholder' };
  }

  // Production guard: refuse to persist sensitive platform secrets via the API.
  if (SENSITIVE_RUNTIME_ENV_KEYS.has(key) && !isRuntimeEnvWriteAllowed()) {
    return { ok: false, key, reason: 'write_blocked_in_production' };
  }

  if (cleanVal) {
    globalServerEnvStore[key] = cleanVal;
    process.env[key] = cleanVal;
    return { ok: true, key };
  } else {
    delete globalServerEnvStore[key];
    return { ok: true, key };
  }
}

// Narrowed rejection type — only the `ok: false` branch of SetEnvResult.
type SetEnvRejection = Extract<SetEnvResult, { ok: false }>;

export type SetEnvsResult = { updated: string[]; blocked: SetEnvRejection[] };

export function setServerEnvs(envs: Record<string, string>): SetEnvsResult {
  const updated: string[] = [];
  const blocked: SetEnvRejection[] = [];
  if (!envs || typeof envs !== 'object') return { updated, blocked };

  Object.entries(envs).forEach(([k, v]) => {
    if (typeof v !== 'string') return;
    const res = setServerEnv(k, v);
    if (res.ok) {
      updated.push(k);
    } else if (res.reason !== 'masked_placeholder' && res.reason !== 'empty_key') {
      // Don't report masked/empty as blocked — those are explicit no-ops the UI
      // sends to preserve existing values. Only surface real refusals.
      blocked.push(res);
    }
  });

  return { updated, blocked };
}

export function getAllRuntimeEnvs(): Record<string, string> {
  const keys = [
    'DATABASE_URL',
    'POSTGRES_URL',
    'QDRANT_URL',
    'QDRANT_API_KEY',
    'MISTRAL_API_KEY',
    'GROQ_API_KEY',
    'UNSTRUCTURED_API_KEY',
    'GEMINI_API_KEY',
    'APP_URL',
  ];
  const res: Record<string, string> = {};
  keys.forEach((k) => {
    res[k] = getEnv(k);
  });
  return res;
}
