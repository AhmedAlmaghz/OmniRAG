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

/**
 * Placeholder substituted for secrets in every API response (see
 * redactSourceConfig). When a client round-trips a config — e.g. the edit
 * modal seeds its JSON editor from a redacted GET and PUTs it back — this
 * value means "keep the stored secret", never "overwrite with the placeholder".
 */
export const REDACTED_SECRET_PLACEHOLDER = '••••••••';

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p));
}

function isRedactedPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === REDACTED_SECRET_PLACEHOLDER;
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
 * Merges an incoming config update with the existing stored config for a
 * source, then encrypts — used by update (PUT) paths.
 *
 * Secret handling follows the masked-placeholder convention:
 *  - incoming sensitive value is a REAL secret  → encrypt & store it;
 *  - incoming sensitive value is the redaction placeholder or blank → keep the
 *    existing stored (already-encrypted) value, so editing unrelated fields in
 *    a redacted config never clobbers the secret; if nothing is stored, the
 *    placeholder is dropped rather than persisted.
 *
 * Existing values are copied through verbatim (they are already encrypted),
 * so this never double-encrypts.
 */
export function mergeAndEncryptSourceConfig(
  existingConfig: Record<string, any> | undefined,
  incomingConfig: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(incomingConfig)) {
    if (isSensitiveKey(k)) {
      const blank = typeof v === 'string' && v.trim() === '';
      if (isRedactedPlaceholder(v) || blank) {
        const stored = existingConfig?.[k];
        if (stored !== undefined && !isRedactedPlaceholder(stored)) {
          out[k] = stored; // already encrypted at rest
        } else if (!blank) {
          // Placeholder with nothing stored — drop it, never persist the mask.
          continue;
        } else {
          out[k] = v; // blank with no stored value: keep the (empty) value
        }
      } else {
        out[k] = typeof v === 'string' ? encryptToken(v) : v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
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
    out[k] = typeof v === 'string' && isSensitiveKey(k) ? REDACTED_SECRET_PLACEHOLDER : v;
  }
  return out as T;
}
