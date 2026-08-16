const globalServerEnvStore: Record<string, string> = {};

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
 * Get an environment variable from:
 * 1. Request headers (x-env-<key>) — non-production only, see isClientEnvAllowed
 * 2. In-memory runtime store (globalServerEnvStore)
 * 3. System process.env
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
  if (reqOrHeaders && isClientEnvAllowed()) {
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
          process.env[key] = decoded;
          globalServerEnvStore[key] = decoded;
          return decoded;
        }
      } catch (e) {
        if (!headerVal.includes('•')) {
          process.env[key] = headerVal;
          globalServerEnvStore[key] = headerVal;
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
 * Update environment variables dynamically at runtime on Node.js server
 */
export function setServerEnv(key: string, value: string): void {
  if (!key) return;
  const cleanVal = (value || '').trim();
  if (cleanVal.includes('•')) return; // ignore masked placeholders

  if (cleanVal) {
    globalServerEnvStore[key] = cleanVal;
    process.env[key] = cleanVal;
  } else {
    delete globalServerEnvStore[key];
  }
}

export function setServerEnvs(envs: Record<string, string>): void {
  if (!envs || typeof envs !== 'object') return;
  Object.entries(envs).forEach(([k, v]) => {
    if (typeof v === 'string') {
      setServerEnv(k, v);
    }
  });
}

export function getAllRuntimeEnvs(): Record<string, string> {
  const keys = [
    'DATABASE_URL',
    'POSTGRES_URL',
    'QDRANT_URL',
    'QDRANT_API_KEY',
    'MISTRAL_API_KEY',
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
