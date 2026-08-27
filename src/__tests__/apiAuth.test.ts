import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// verifyApiAuth authorizes against the persisted `sessions` table via the `db`
// singleton (Postgres in prod, in-memory in dev). These unit tests exercise the
// cookie/session gate AND the Bearer API-key gate in isolation by mocking only
// the lifecycle methods they touch — everything else (cookie read, header
// parse, hash lookup, expiry check, NextResponse) runs real.
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
import { SESSION_COOKIE } from '@/lib/auth/session';
import { generateApiKeyMaterial, hashApiKey } from '@/lib/auth/apiKeys';
import type { SessionRecord, ApiKeyRecord } from '@/lib/types/omnirag';

// Minimal request double: verifyApiAuth only reads req.cookies.get(SESSION_COOKIE)
// and req.headers.get('authorization').
function makeReq(sessionToken?: string, authorization?: string): NextRequest {
  const token = sessionToken;
  const headers = new Headers();
  if (authorization) headers.set('authorization', authorization);
  return {
    cookies: {
      get(name: string) {
        return name === SESSION_COOKIE && token !== undefined ? { value: token } : undefined;
      },
    },
    headers,
  } as unknown as NextRequest;
}

function futureSession(token = 'sess-valid'): SessionRecord {
  return {
    token,
    userId: 'user-123',
    tenantId: 'tenant-acme',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
}

describe('apiAuth — verifyApiAuth (cookie/session, Postgres-only)', () => {
  const getSession = vi.mocked(db.getSession);
  const deleteSession = vi.mocked(db.deleteSession);

  beforeEach(() => {
    getSession.mockReset();
    deleteSession.mockReset().mockResolvedValue(undefined);
  });

  it('rejects a missing session cookie with 401 (no bypass/demo path)', async () => {
    const ctx = await verifyApiAuth(makeReq());
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
    expect(ctx.authMethod).toBe('session');
    expect(getSession).not.toHaveBeenCalled();
  });

  it('treats a blank/whitespace cookie as absent (401)', async () => {
    const ctx = await verifyApiAuth(makeReq('   '));
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('authenticates a valid, unexpired session and surfaces its tenant/user id', async () => {
    getSession.mockResolvedValue(futureSession());
    const ctx = await verifyApiAuth(makeReq('sess-valid'));
    expect(ctx.authenticated).toBe(true);
    expect(ctx.tenantId).toBe('tenant-acme');
    expect(ctx.userId).toBe('user-123');
    expect(ctx.authMethod).toBe('session');
    expect(ctx.response).toBeUndefined();
    expect(getSession).toHaveBeenCalledWith('sess-valid');
  });

  it('rejects an expired session with 401 and best-effort purges the row', async () => {
    const expired: SessionRecord = {
      ...futureSession(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    getSession.mockResolvedValue(expired);
    const ctx = await verifyApiAuth(makeReq('sess-valid'));
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(deleteSession).toHaveBeenCalledWith('sess-valid');
  });

  it('rejects a tampered / unknown token with 401 (no silent fallback)', async () => {
    getSession.mockResolvedValue(undefined);
    const ctx = await verifyApiAuth(makeReq('forged-or-revoked'));
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the session lookup itself throws', async () => {
    getSession.mockRejectedValue(new Error('db connection lost'));
    const ctx = await verifyApiAuth(makeReq('sess-valid'));
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
    expect(deleteSession).not.toHaveBeenCalled();
  });
});

describe('apiAuth — verifyApiAuth (Bearer API key, headless access)', () => {
  const getApiKeyByHash = vi.mocked(db.getApiKeyByHash);
  const touchApiKeyLastUsed = vi.mocked(db.touchApiKeyLastUsed);
  const getSession = vi.mocked(db.getSession);

  // Fresh material per test — the plaintext key is what the client presents.
  const material = generateApiKeyMaterial();

  function makeKeyRecord(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
    return {
      id: 'key-row-1',
      tenantId: 'tenant-acme',
      userId: 'user-api',
      name: 'External integration',
      prefix: material.prefix,
      keyHash: material.keyHash,
      scopes: ['documents:read', 'chat'],
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
    getApiKeyByHash.mockReset();
    touchApiKeyLastUsed.mockReset().mockResolvedValue(undefined);
    getSession.mockReset();
  });

  it('authenticates a valid Bearer key by hash lookup and surfaces tenant/scopes', async () => {
    getApiKeyByHash.mockResolvedValue(makeKeyRecord());
    const ctx = await verifyApiAuth(makeReq(undefined, `Bearer ${material.plainKey}`));

    expect(ctx.authenticated).toBe(true);
    expect(ctx.authMethod).toBe('apiKey');
    expect(ctx.tenantId).toBe('tenant-acme');
    expect(ctx.userId).toBe('user-api');
    expect(ctx.apiKeyScopes).toEqual(['documents:read', 'chat']);
    expect(ctx.apiKeyId).toBe('key-row-1');
    // Lookup happens by SHA-256 hash — the plaintext key is never stored.
    expect(getApiKeyByHash).toHaveBeenCalledWith(hashApiKey(material.plainKey));
    // Best-effort last-used stamp for auditing.
    expect(touchApiKeyLastUsed).toHaveBeenCalledWith('key-row-1', expect.any(String));
    // The session path must not run once a Bearer key is presented.
    expect(getSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown key hash with 401', async () => {
    getApiKeyByHash.mockResolvedValue(undefined);
    const ctx = await verifyApiAuth(makeReq(undefined, `Bearer ${material.plainKey}`));
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
    expect(touchApiKeyLastUsed).not.toHaveBeenCalled();
  });

  it('rejects a revoked key with 401', async () => {
    getApiKeyByHash.mockResolvedValue(makeKeyRecord({ revokedAt: new Date().toISOString() }));
    const ctx = await verifyApiAuth(makeReq(undefined, `Bearer ${material.plainKey}`));
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
  });

  it('rejects an expired key with 401', async () => {
    getApiKeyByHash.mockResolvedValue(makeKeyRecord({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    const ctx = await verifyApiAuth(makeReq(undefined, `Bearer ${material.plainKey}`));
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
  });

  it('ignores foreign Bearer tokens and falls through to the session path', async () => {
    // A JWT-shaped token is not an OmniRAG key: the cookie path stays
    // authoritative for browser traffic carrying other Authorization headers.
    const ctx = await verifyApiAuth(makeReq(undefined, 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y'));
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
    expect(ctx.authMethod).toBe('session');
    expect(getApiKeyByHash).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the key lookup itself throws', async () => {
    getApiKeyByHash.mockRejectedValue(new Error('db connection lost'));
    const ctx = await verifyApiAuth(makeReq(undefined, `Bearer ${material.plainKey}`));
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
    expect(touchApiKeyLastUsed).not.toHaveBeenCalled();
  });
});
