import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryDatabase } from '@/lib/storage/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import type { Tenant, User, SessionRecord } from '@/lib/types/omnirag';

// End-to-end auth roundtrip against the real in-memory backend (the same code
// path production falls back to when Postgres is unavailable): register a
// tenant + user with a real Argon2id hash, issue a session, and verify the
// session → user → tenant cross-reference holds. No `db` mocking here — every
// call hits the genuine in-memory implementation.

function makeTenant(id: string, name: string): Tenant {
  return {
    id,
    name,
    plan: 'enterprise',
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    settings: {
      chunkSize: 1000,
      chunkOverlap: 200,
      hybridWeights: { semantic: 0.7, lexical: 0.3 },
      defaultModel: 'gemini-3.6-flash',
      dataRetentionDays: 90,
      enablePiiRedaction: true,
      enablePromptSanitizer: true,
    },
  };
}

describe('auth roundtrip — MemoryDatabase + Argon2id + sessions', () => {
  let mem: MemoryDatabase;
  const PLAIN = 'Tr0ub4dor&3';
  let user: User;

  beforeEach(async () => {
    mem = new MemoryDatabase();
    await mem.createTenant(makeTenant('tenant-acme', 'Acme'));
    user = {
      id: 'user-1',
      email: 'owner@acme.io',
      passwordHash: await hashPassword(PLAIN),
      tenantId: 'tenant-acme',
      createdAt: new Date().toISOString(),
    };
    await mem.createUser(user);
  });

  it('authenticates by email then maps the session row back to its user and tenant', async () => {
    // Login lookup is case-insensitive.
    const found = await mem.getUserByEmail('OWNER@ACME.IO');
    expect(found).toBeDefined();
    expect(found!.id).toBe('user-1');
    expect(found!.tenantId).toBe('tenant-acme');

    // The submitted plaintext must verify against the stored Argon2id hash.
    expect(await verifyPassword(PLAIN, found!.passwordHash)).toBe(true);

    // Issue a session bound to this user/tenant.
    const session: SessionRecord = {
      token: 'tok-valid',
      userId: found!.id,
      tenantId: found!.tenantId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    await mem.createSession(session);

    const byToken = await mem.getSession('tok-valid');
    expect(byToken).toBeDefined();
    expect(byToken!.tenantId).toBe('tenant-acme');

    // session.user → user → user.tenantId cross-reference integrity.
    const owner = await mem.getUserById(byToken!.userId);
    const tenant = await mem.getTenant(byToken!.tenantId);
    expect(owner).toBeDefined();
    expect(owner!.id).toBe('user-1');
    expect(tenant).toBeDefined();
    expect(tenant!.name).toBe('Acme');
  });

  it('revokes a session immediately on logout (deleteSession → getSession undefined)', async () => {
    const session: SessionRecord = {
      token: 'tok-rev',
      userId: 'user-1',
      tenantId: 'tenant-acme',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    await mem.createSession(session);
    expect(await mem.getSession('tok-rev')).toBeDefined();
    await mem.deleteSession('tok-rev');
    expect(await mem.getSession('tok-rev')).toBeUndefined();
  });

  it('re-issuing a session for the same token replaces, never duplicates', async () => {
    const a: SessionRecord = {
      token: 'tok-x',
      userId: 'user-1',
      tenantId: 'tenant-acme',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    const b: SessionRecord = { ...a, expiresAt: new Date(Date.now() + 7200_000).toISOString() };
    await mem.createSession(a);
    await mem.createSession(b);
    const got = await mem.getSession('tok-x');
    expect(got).toBeDefined();
    expect(got!.expiresAt).toBe(b.expiresAt);
  });

  it('getUserById is exact and unknown ids resolve to undefined', async () => {
    expect((await mem.getUserById('user-1'))?.email).toBe('owner@acme.io');
    expect(await mem.getUserById('user-2')).toBeUndefined();
  });
});
