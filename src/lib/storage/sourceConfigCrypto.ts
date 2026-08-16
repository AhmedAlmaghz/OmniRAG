import { encryptToken, decryptToken } from '../mcp/auth/encryption';

/**
 * Keys within a SourceConnector.config object that hold secrets and must be
 * encrypted at rest. Match is case-insensitive on substring for robustness.
 */
const SENSITIVE_KEY_PATTERNS = [
  'apikey',
  'token',
  'password',
  'secret',
  'connectionstring',
  'accesstoken',
  'refreshtoken',
];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p));
}

/**
 * Encrypt every sensitive field in a connector config for at-rest storage.
 * Non-sensitive fields are left untouched. Returns a new object.
 */
export function encryptSourceConfig<T extends Record<string, any>>(config: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = typeof v === 'string' && v.trim() !== '' && isSensitiveKey(k) ? encryptToken(v) : v;
  }
  return out as T;
}

/**
 * Decrypt sensitive fields so the sync worker can use them. Called lazily in
 * the trusted server execution path only; never expose decrypted values via API
 * responses.
 */
export function decryptSourceConfig<T extends Record<string, any>>(config: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string' && isSensitiveKey(k) && v.includes(':')) {
      try {
        out[k] = decryptToken(v);
      } catch {
        // Value was not encrypted (or tampered); keep as-is for legacy data.
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/**
 * Strip sensitive fields entirely from a config before returning it to the
 * client. Used in any API response shape that serializes connector config.
 */
export function redactSourceConfig<T extends Record<string, any>>(config: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = typeof v === 'string' && isSensitiveKey(k) ? '••••••••' : v;
  }
  return out as T;
}
