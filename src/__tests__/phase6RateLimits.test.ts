import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Per-key rate limiting (Phase 6). The auth gate is exercised with a mocked db
// (same pattern as apiAuth.test.ts); the limiter itself is tested directly.
vi.mock('@/lib/storage/db', () => ({
  db: {
    getSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getApiKeyByHash: vi.fn(),
    touchApiKeyLastUsed: vi.fn().mockResolvedValue(undefined),
  },
}));

import { verifyApiAuth } from '@/lib/auth/apiAuth';
import { db } from '@/lib/storage/db';
import { generateApiKeyMaterial } from '@/lib/auth/apiKeys';
import { checkKeyedRateLimit, resetRateLimitStore } from '@/lib/security/rateLimiter';
import type { ApiKeyRecord } from '@/lib/types/omnirag';

function makeReq(authorization?: string): NextRequest {
  const headers = new Headers();
  if (authorization) headers.set('authorization', authorization);
  return {
    cookies: { get: () => undefined },
    headers,
  } as unknown as NextRequest;
}

describe('checkKeyedRateLimit — sliding window buckets', () => {
  beforeEach(() => resetRateLimitStore());

  it('allows requests up to the limit, then rejects with retryAfterMs', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkKeyedRateLimit('bucket-a', 5, 60000).success).toBe(true);
    }
    const blocked = checkKeyedRateLimit('bucket-a', 5, 60000);
    expect(blocked.success).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60000);
  });

  it('keeps independent buckets isolated', () => {
    for (let i = 0; i < 3; i++) checkKeyedRateLimit('bucket-b', 3, 60000);
    expect(checkKeyedRateLimit('bucket-b', 3, 60000).success).toBe(false);
    expect(checkKeyedRateLimit('bucket-c', 3, 60000).success).toBe(true);
  });

  it('resetRateLimitStore clears every bucket', () => {
    for (let i = 0; i < 3; i++) checkKeyedRateLimit('bucket-d', 3, 60000);
    expect(checkKeyedRateLimit('bucket-d', 3, 60000).success).toBe(false);
    resetRateLimitStore();
    expect(checkKeyedRateLimit('bucket-d', 3, 60000).success).toBe(true);
  });
});

describe('verifyApiAuth — per-key rate limit enforcement', () => {
  const getApiKeyByHash = vi.mocked(db.getApiKeyByHash);
  const touchApiKeyLastUsed = vi.mocked(db.touchApiKeyLastUsed);

  const material = generateApiKeyMaterial();

  function makeKeyRecord(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
    return {
      id: 'key-limited',
      tenantId: 'tenant-acme',
      userId: 'user-api',
      name: 'Limited key',
      prefix: material.prefix,
      keyHash: material.keyHash,
      scopes: [],
      rateLimitPerMinute: null,
      mcpTools: null,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  beforeEach(() => {
    resetRateLimitStore();
    getApiKeyByHash.mockReset();
    touchApiKeyLastUsed.mockReset().mockResolvedValue(undefined);
  });

  it('enforces rateLimitPerMinute: allows up to the ceiling, then answers 429', async () => {
    getApiKeyByHash.mockResolvedValue(makeKeyRecord({ rateLimitPerMinute: 3 }));

    for (let i = 0; i < 3; i++) {
      const ctx = await verifyApiAuth(makeReq(`Bearer ${material.plainKey}`));
      expect(ctx.authenticated).toBe(true);
      expect(ctx.authMethod).toBe('apiKey');
    }

    const blocked = await verifyApiAuth(makeReq(`Bearer ${material.plainKey}`));
    expect(blocked.authenticated).toBe(false);
    expect(blocked.response?.status).toBe(429);
    const body = await blocked.response!.json();
    expect(body.code).toBe('429_API_KEY_RATE_LIMITED');
    expect(blocked.response!.headers.get('Retry-After')).toBeTruthy();
  });

  it('keys without a ceiling are not throttled by the per-key limiter', async () => {
    getApiKeyByHash.mockResolvedValue(makeKeyRecord({ rateLimitPerMinute: null }));
    for (let i = 0; i < 25; i++) {
      const ctx = await verifyApiAuth(makeReq(`Bearer ${material.plainKey}`));
      expect(ctx.authenticated).toBe(true);
    }
  });

  it('buckets are per key id — exhausting one key leaves another untouched', async () => {
    const otherMaterial = generateApiKeyMaterial();
    const limited = makeKeyRecord({ rateLimitPerMinute: 1 });
    const other: ApiKeyRecord = {
      ...limited,
      id: 'key-other',
      prefix: otherMaterial.prefix,
      keyHash: otherMaterial.keyHash,
    };
    getApiKeyByHash.mockImplementation(async (hash: string) =>
      hash === limited.keyHash ? limited : hash === other.keyHash ? other : undefined,
    );

    expect((await verifyApiAuth(makeReq(`Bearer ${material.plainKey}`))).authenticated).toBe(true);
    expect((await verifyApiAuth(makeReq(`Bearer ${material.plainKey}`))).response?.status).toBe(429);
    expect((await verifyApiAuth(makeReq(`Bearer ${otherMaterial.plainKey}`))).authenticated).toBe(true);
  });

  it('surfaces the key mcpTools whitelist on the auth context', async () => {
    getApiKeyByHash.mockResolvedValue(makeKeyRecord({ mcpTools: ['slack_send_message'] }));
    const ctx = await verifyApiAuth(makeReq(`Bearer ${material.plainKey}`));
    expect(ctx.authenticated).toBe(true);
    expect(ctx.apiKeyMcpTools).toEqual(['slack_send_message']);
  });
});
