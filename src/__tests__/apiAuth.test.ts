import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Mock the auth backend so tests don't touch Firebase.
vi.mock('@/lib/auth/firebaseAdmin', () => ({
  adminAuth: { verifyIdToken: vi.fn() },
}));

import { verifyApiAuth } from '@/lib/auth/apiAuth';
import { adminAuth } from '@/lib/auth/firebaseAdmin';

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers(headers),
    url: 'http://localhost/api/v1/test',
    nextUrl: { pathname: '/api/v1/test' },
  } as unknown as NextRequest;
}

describe('apiAuth — verifyApiAuth (strict, Firebase-only)', () => {
  const mockedVerify = vi.mocked(adminAuth.verifyIdToken);

  beforeEach(() => {
    mockedVerify.mockReset();
  });

  it('rejects a missing Authorization header with 401', async () => {
    const ctx = await verifyApiAuth(makeReq());
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
  });

  it('rejects an empty Bearer token with 401', async () => {
    const ctx = await verifyApiAuth(makeReq({ authorization: 'Bearer ' }));
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
  });

  it('rejects any tenant-* Bearer (including the former demo allowlist entry) — no demo path exists, so Firebase verification fails and a 401 is returned', async () => {
    mockedVerify.mockRejectedValue(new Error('not a Firebase token'));
    const ctx = await verifyApiAuth(makeReq({ authorization: 'Bearer tenant-acme-01' }));
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
    expect(ctx.authMethod).toBe('firebase');
  });

  it('accepts a verified Firebase ID token and derives tenant from uid', async () => {
    mockedVerify.mockResolvedValue({ uid: 'user-123', email: 'u@example.com' } as any);
    const ctx = await verifyApiAuth(makeReq({ authorization: 'Bearer firebase-id-token' }));
    expect(ctx.authenticated).toBe(true);
    expect(ctx.tenantId).toBe('tenant-user-123');
    expect(ctx.authMethod).toBe('firebase');
    expect(ctx.userId).toBe('user-123');
    expect(ctx.userEmail).toBe('u@example.com');
  });

  it('honors a custom tenantId claim when present on the decoded token', async () => {
    mockedVerify.mockResolvedValue({
      uid: 'user-456',
      email: 'p@example.com',
      firebase: { claims: { tenantId: 'tenant-custom-org' } },
    } as any);
    const ctx = await verifyApiAuth(makeReq({ authorization: 'Bearer firebase-id-token' }));
    expect(ctx.authenticated).toBe(true);
    expect(ctx.tenantId).toBe('tenant-custom-org');
    expect(ctx.authMethod).toBe('firebase');
  });

  it('rejects when Firebase token verification throws (no silent fallback)', async () => {
    mockedVerify.mockRejectedValue(new Error('invalid token'));
    const ctx = await verifyApiAuth(makeReq({ authorization: 'Bearer forged-or-expired' }));
    expect(ctx.authenticated).toBe(false);
    expect(ctx.response?.status).toBe(401);
  });
});
