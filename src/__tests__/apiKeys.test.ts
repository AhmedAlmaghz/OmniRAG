import { describe, it, expect } from 'vitest';
import {
  API_KEY_PREFIX,
  hashApiKey,
  generateApiKeyMaterial,
  looksLikeApiKey,
  extractBearerApiKey,
  isApiKeyActive,
  toApiKeyPublicView,
} from '@/lib/auth/apiKeys';
import type { ApiKeyRecord } from '@/lib/types/omnirag';

// Tenant API keys secure all headless/external access (REST + MCP). The
// security invariants tested here are load-bearing: plaintext is never
// persisted, hash lookup is deterministic, and revoked/expired keys are dead.
describe('apiKeys — generation and hashing', () => {
  it('generates a well-formed key: prefix, 96 hex chars, matching hash', () => {
    const { plainKey, prefix, keyHash } = generateApiKeyMaterial();
    expect(plainKey.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(plainKey.slice(API_KEY_PREFIX.length)).toMatch(/^[0-9a-f]{96}$/);
    expect(prefix).toBe(`${API_KEY_PREFIX}${plainKey.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8)}`);
    expect(keyHash).toBe(hashApiKey(plainKey));
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  it('never generates the same key twice', () => {
    const a = generateApiKeyMaterial();
    const b = generateApiKeyMaterial();
    expect(a.plainKey).not.toBe(b.plainKey);
    expect(a.keyHash).not.toBe(b.keyHash);
  });

  it('hashApiKey is deterministic and collision-resistant for distinct inputs', () => {
    expect(hashApiKey('omnirag_live_x')).toBe(hashApiKey('omnirag_live_x'));
    expect(hashApiKey('omnirag_live_x')).not.toBe(hashApiKey('omnirag_live_y'));
  });
});

describe('apiKeys — shape detection and Bearer extraction', () => {
  it('looksLikeApiKey accepts generated keys and rejects short/foreign strings', () => {
    const { plainKey } = generateApiKeyMaterial();
    expect(looksLikeApiKey(plainKey)).toBe(true);
    expect(looksLikeApiKey(API_KEY_PREFIX + 'short')).toBe(false);
    expect(looksLikeApiKey('eyJhbGciOiJIUzI1NiJ9.payload.sig')).toBe(false);
    expect(looksLikeApiKey('')).toBe(false);
    expect(looksLikeApiKey(undefined as unknown as string)).toBe(false);
  });

  function reqWithAuth(authorization: string | null) {
    const headers = new Headers();
    if (authorization !== null) headers.set('authorization', authorization);
    return { headers } as { headers: { get(name: string): string | null } };
  }

  it('extractBearerApiKey pulls OmniRAG-shaped Bearer tokens (case-insensitive scheme)', () => {
    const { plainKey } = generateApiKeyMaterial();
    expect(extractBearerApiKey(reqWithAuth(`Bearer ${plainKey}`))).toBe(plainKey);
    expect(extractBearerApiKey(reqWithAuth(`bearer   ${plainKey}`))).toBe(plainKey);
  });

  it('extractBearerApiKey ignores foreign tokens so browser sessions stay authoritative', () => {
    expect(extractBearerApiKey(reqWithAuth('Bearer eyJhbGciOiJIUzI1NiJ9.x.y'))).toBeUndefined();
    expect(extractBearerApiKey(reqWithAuth('Basic dXNlcjpwYXNz'))).toBeUndefined();
    expect(extractBearerApiKey(reqWithAuth(null))).toBeUndefined();
  });
});

describe('apiKeys — lifecycle and public view', () => {
  function makeRecord(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
    return {
      id: 'key-1',
      tenantId: 'tenant-acme',
      userId: 'user-1',
      name: 'CI key',
      prefix: `${API_KEY_PREFIX}abcd1234`,
      keyHash: hashApiKey('omnirag_live_' + 'a'.repeat(96)),
      scopes: ['read'],
      rateLimitPerMinute: null,
      mcpTools: null,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('isApiKeyActive: active by default, dead when revoked or expired', () => {
    expect(isApiKeyActive(makeRecord())).toBe(true);
    expect(isApiKeyActive(makeRecord({ revokedAt: new Date().toISOString() }))).toBe(false);
    expect(isApiKeyActive(makeRecord({ expiresAt: new Date(Date.now() - 1000).toISOString() }))).toBe(false);
    expect(isApiKeyActive(makeRecord({ expiresAt: new Date(Date.now() + 3600_000).toISOString() }))).toBe(true);
  });

  it('toApiKeyPublicView never leaks the hash or tenant internals', () => {
    const record = makeRecord();
    const view = toApiKeyPublicView(record) as Record<string, unknown>;
    expect(view.keyHash).toBeUndefined();
    expect(view.tenantId).toBeUndefined();
    expect(view.userId).toBeUndefined();
    expect(view.id).toBe('key-1');
    expect(view.prefix).toBe(record.prefix);
    expect(view.active).toBe(true);
    expect(JSON.stringify(view)).not.toContain(record.keyHash);
  });
});
