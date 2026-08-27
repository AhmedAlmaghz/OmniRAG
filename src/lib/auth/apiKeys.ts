import crypto from 'crypto';
import { randomHex } from '../crypto/webRandom';
import type { ApiKeyRecord } from '../types/omnirag';

/**
 * Tenant API keys for headless access (external REST clients, MCP clients,
 * automation). Design:
 *
 * - Plaintext format: `omnirag_live_<96 hex chars>` (48 random bytes).
 * - Storage: only the SHA-256 hash (`keyHash`) plus a short non-secret
 *   `prefix` for UI listing. The plaintext is returned exactly once from the
 *   create endpoint and can never be retrieved again.
 * - Verification: hash the presented Bearer key, look the hash up — constant
 *   work regardless of how many keys a tenant has, and a leaked DB row does
 *   not leak usable keys.
 */

export const API_KEY_PREFIX = 'omnirag_live_';
/** Chars of the plaintext key kept for display, e.g. `omnirag_live_ab3f9c21…` */
const DISPLAY_PREFIX_CHARS = 8;

export function hashApiKey(plainKey: string): string {
  return crypto.createHash('sha256').update(plainKey, 'utf8').digest('hex');
}

export interface GeneratedApiKey {
  /** Shown once to the user; never persisted. */
  plainKey: string;
  /** Non-secret display prefix, persisted for listing. */
  prefix: string;
  /** SHA-256 of plainKey, persisted for lookup. */
  keyHash: string;
}

export function generateApiKeyMaterial(): GeneratedApiKey {
  const plainKey = `${API_KEY_PREFIX}${randomHex(48)}`;
  return {
    plainKey,
    prefix: `${API_KEY_PREFIX}${plainKey.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + DISPLAY_PREFIX_CHARS)}`,
    keyHash: hashApiKey(plainKey),
  };
}

/** True when the string is shaped like an OmniRAG API key (not a validity check). */
export function looksLikeApiKey(value: string): boolean {
  return typeof value === 'string' && value.startsWith(API_KEY_PREFIX) && value.length > API_KEY_PREFIX.length + 8;
}

/**
 * Extracts the Bearer token from an Authorization header, if present and
 * shaped like an OmniRAG API key. Returns undefined for other schemes so the
 * cookie/session path stays authoritative for browser traffic.
 */
export function extractBearerApiKey(req: { headers: { get(name: string): string | null } }): string | undefined {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return undefined;
  const token = match[1].trim();
  return looksLikeApiKey(token) ? token : undefined;
}

/** Expiry/revocation check shared by the auth gate and the management API. */
export function isApiKeyActive(key: ApiKeyRecord, now: number = Date.now()): boolean {
  if (key.revokedAt) return false;
  if (key.expiresAt) {
    const expires = new Date(key.expiresAt).getTime();
    if (Number.isFinite(expires) && expires <= now) return false;
  }
  return true;
}

/** Shape returned by management endpoints — never includes keyHash. */
export function toApiKeyPublicView(key: ApiKeyRecord) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    rateLimitPerMinute: key.rateLimitPerMinute ?? null,
    mcpTools: key.mcpTools ?? null,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
    active: isApiKeyActive(key),
  };
}
