import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// verifyApiAuth authorizes against the persisted `sessions` table via the `db`
// singleton (Postgres in prod, in-memory in dev). These unit tests exercise the
// cookie/session gate in isolation by mocking only the two session lifecycle
// methods — everything else (cookie read, expiry check, NextResponse) runs real.
vi.mock('@/lib/storage/db', () => ({
  db: {
    getSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  },
}));

import { verifyApiAuth } from '@/lib/auth/apiAuth';
import { db } from '@/lib/storage/db';
import { SESSION_COOKIE } from '@/lib/auth/session';
import type { SessionRecord } from '@/lib/types/omnirag';

// Minimal request double: verifyApiAuth only reads req.cookies.get(SESSION_COOKIE).
function makeReq(sessionToken?: string): NextRequest {
  const token = sessionToken;
  return {
    cookies: {
      get(name: string) {
        return name === SESSION_COOKIE && token !== undefined ? { value: token } : undefined;
      },
    },
    headers: new Headers(),
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
