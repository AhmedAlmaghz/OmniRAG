import { randomBytes } from 'node:crypto';

/** Session lifetime in milliseconds (7 days). */
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** Generate a 32-byte opaque random session token, hex-encoded (64 chars). */
export function createSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** ISO timestamp `SESSION_LIFETIME_MS` from now. */
export function sessionExpiryIso(now = Date.now()): string {
  return new Date(now + SESSION_LIFETIME_MS).toISOString();
}
