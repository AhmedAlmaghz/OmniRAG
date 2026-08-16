import crypto from 'crypto';

/**
 * Encryption key for OAuth tokens and connector credentials (AES-256-GCM).
 *
 * In production the key MUST be provided via MCP_OAUTH_ENCRYPTION_KEY. A
 * deterministic dev-only fallback keeps local workflows running, but it is
 * *rejected in production builds*: silently encrypting credentials with a key
 * that is published in this repository would expose every tenant's tokens to
 * anyone reading the source — exactly the failure mode this module exists to
 * prevent.
 */
const DEV_FALLBACK_KEY = 'omnirag-dev-encryption-key-2026-08-not-for-prod-32b';

function resolveEncryptionKey(): string {
  const envKey = process.env.MCP_OAUTH_ENCRYPTION_KEY;
  if (envKey && envKey.trim() !== '') return envKey;

  if (process.env.NODE_ENV === 'production') {
    // Hard-fail rather than silently weakening at-rest encryption in prod.
    throw new Error(
      'MCP_OAUTH_ENCRYPTION_KEY must be set in production. Refusing to encrypt credentials with the public development fallback key.',
    );
  }
  return DEV_FALLBACK_KEY;
}

let _keyCache: Buffer | null = null;
let _keySource = '';
function getEncryptionKey(): Buffer {
  const source = resolveEncryptionKey();
  if (_keyCache && _keySource === source) return _keyCache;
  _keyCache = crypto.scryptSync(source, 'mcp-salt', 32);
  _keySource = source;
  return _keyCache;
}

/**
 * Encrypt sensitive OAuth tokens / credentials using AES-256-GCM.
 * On failure the caller MUST treat storage as refused: we throw rather than
 * silently persisting plaintext.
 */
export function encryptToken(plainText: string): string {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt sensitive OAuth tokens / credentials.
 * Returns the original plaintext only if the auth tag verifies; an
 * unparseable / tampered payload throws.
 */
export function decryptToken(encryptedText: string): string {
  if (!encryptedText || !encryptedText.includes(':')) return encryptedText;

  const parts = encryptedText.split(':');
  if (parts.length !== 3) return encryptedText;

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
