import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import {
  resetMembershipMemoryStore,
  upsertMembership,
  getMembership,
  listUserMemberships,
  resolveMembershipRole,
  countTenantOwners,
  createInvitation,
  getInvitationByToken,
  acceptInvitation,
  isInvitationUsable,
  newInvitationToken,
  INVITATION_TTL_MS,
  createTeam,
  addTeamMember,
  listUserTeamIds,
  upsertResourceShare,
  canAccessResource,
  createSsoFlow,
  consumeSsoFlow,
  type Invitation,
  type ResourceShare,
} from '@/lib/services/membershipService';
import { roleHasPermission, requirePermission } from '@/lib/auth/permissions';
import { generatePkce, generateState, emailFromClaims, verifyIdToken, resetOidcCaches } from '@/lib/auth/sso/oidc';
import type { SsoOidcConfig } from '@/lib/services/tenantConfigService';

/**
 * Phase 5 — teams, sharing, RBAC, and SSO.
 *
 * These run against the in-memory fallback store (no DATABASE_URL in the test
 * env), so each test resets the store for isolation. The OIDC tests exercise the
 * real RS256 verification path with a generated keypair and a mocked fetch for
 * discovery + JWKS.
 */

const TENANT = 'tenant-phase5';

beforeEach(() => {
  resetMembershipMemoryStore();
});

describe('memberships & role resolution', () => {
  it('upserts a membership and reads it back', async () => {
    await upsertMembership({
      id: 'mem-1',
      userId: 'user-a',
      tenantId: TENANT,
      role: 'editor',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    const m = await getMembership(TENANT, 'user-a');
    expect(m?.role).toBe('editor');
    // Upsert replaces rather than duplicates.
    await upsertMembership({ ...(m as any), role: 'admin' });
    const again = await getMembership(TENANT, 'user-a');
    expect(again?.role).toBe('admin');
  });

  it('resolveMembershipRole returns the membership role for active members', async () => {
    await upsertMembership({
      id: 'mem-2',
      userId: 'user-b',
      tenantId: TENANT,
      role: 'viewer',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    expect(await resolveMembershipRole(TENANT, 'user-b')).toBe('viewer');
  });

  it('resolveMembershipRole returns null for non-members (deny)', async () => {
    expect(await resolveMembershipRole(TENANT, 'user-stranger')).toBeNull();
  });

  it('resolveMembershipRole denies deactivated memberships', async () => {
    await upsertMembership({
      id: 'mem-3',
      userId: 'user-c',
      tenantId: TENANT,
      role: 'admin',
      status: 'deactivated',
      createdAt: new Date().toISOString(),
    });
    expect(await resolveMembershipRole(TENANT, 'user-c')).toBeNull();
  });

  it('listUserMemberships returns all workspaces for a user', async () => {
    await upsertMembership({
      id: 'm1',
      userId: 'user-d',
      tenantId: 'tenant-x',
      role: 'owner',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    await upsertMembership({
      id: 'm2',
      userId: 'user-d',
      tenantId: 'tenant-y',
      role: 'viewer',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    const list = await listUserMemberships('user-d');
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.tenantId).sort()).toEqual(['tenant-x', 'tenant-y']);
  });

  it('countTenantOwners counts only owner roles', async () => {
    await upsertMembership({
      id: 'o1',
      userId: 'u1',
      tenantId: TENANT,
      role: 'owner',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    await upsertMembership({
      id: 'o2',
      userId: 'u2',
      tenantId: TENANT,
      role: 'owner',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    await upsertMembership({
      id: 'o3',
      userId: 'u3',
      tenantId: TENANT,
      role: 'editor',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    expect(await countTenantOwners(TENANT)).toBe(2);
  });
});

describe('RBAC permission matrix', () => {
  it('owner has every permission including billing', () => {
    expect(roleHasPermission('owner', 'billing:manage')).toBe(true);
    expect(roleHasPermission('owner', 'members:manage')).toBe(true);
  });

  it('admin has everything except billing', () => {
    expect(roleHasPermission('admin', 'members:manage')).toBe(true);
    expect(roleHasPermission('admin', 'billing:manage')).toBe(false);
  });

  it('editor can write knowledge but not platform config or members', () => {
    expect(roleHasPermission('editor', 'documents:write')).toBe(true);
    expect(roleHasPermission('editor', 'mcp:manage')).toBe(false);
    expect(roleHasPermission('editor', 'members:manage')).toBe(false);
  });

  it('viewer is read + chat only', () => {
    expect(roleHasPermission('viewer', 'documents:read')).toBe(true);
    expect(roleHasPermission('viewer', 'chat:use')).toBe(true);
    expect(roleHasPermission('viewer', 'documents:write')).toBe(false);
    expect(roleHasPermission('viewer', 'members:read')).toBe(false);
  });

  it('requirePermission denies non-members (null role)', async () => {
    const res = await requirePermission({ tenantId: TENANT, userId: 'user-nobody' }, 'documents:read');
    expect(res.allowed).toBe(false);
    expect(res.role).toBeNull();
  });

  it('requirePermission allows a viewer to read documents', async () => {
    await upsertMembership({
      id: 'rv',
      userId: 'user-viewer',
      tenantId: TENANT,
      role: 'viewer',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    const res = await requirePermission({ tenantId: TENANT, userId: 'user-viewer' }, 'documents:read');
    expect(res.allowed).toBe(true);
    expect(res.role).toBe('viewer');
  });
});

describe('invitations lifecycle', () => {
  const makeInvitation = (overrides: Partial<Invitation> = {}): Invitation => ({
    id: `inv-${crypto.randomUUID()}`,
    tenantId: TENANT,
    email: 'invitee@example.com',
    role: 'editor',
    token: newInvitationToken(),
    invitedBy: 'owner-1',
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it('creates and retrieves an invitation by token', async () => {
    const inv = makeInvitation();
    await createInvitation(inv);
    const found = await getInvitationByToken(inv.token);
    expect(found?.email).toBe('invitee@example.com');
    expect(isInvitationUsable(found!)).toBe(true);
  });

  it('acceptInvitation creates a membership for the matching email', async () => {
    const inv = makeInvitation();
    await createInvitation(inv);
    const membership = await acceptInvitation(inv.token, 'user-new', 'invitee@example.com');
    expect(membership.tenantId).toBe(TENANT);
    expect(membership.role).toBe('editor');
    // Invitation is consumed.
    const after = await getInvitationByToken(inv.token);
    expect(after?.status).toBe('accepted');
  });

  it('acceptInvitation rejects a mismatched email', async () => {
    const inv = makeInvitation();
    await createInvitation(inv);
    await expect(acceptInvitation(inv.token, 'user-x', 'someone-else@example.com')).rejects.toThrow();
  });

  it('acceptInvitation rejects an expired invitation', async () => {
    const inv = makeInvitation({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    await createInvitation(inv);
    await expect(acceptInvitation(inv.token, 'user-y', 'invitee@example.com')).rejects.toThrow();
  });

  it('isInvitationUsable is false for revoked invitations', () => {
    const inv = makeInvitation({ status: 'revoked' });
    expect(isInvitationUsable(inv)).toBe(false);
  });
});

describe('teams', () => {
  it("resolves a user's team ids within a tenant", async () => {
    await createTeam({ id: 'team-1', tenantId: TENANT, name: 'Engineering', createdAt: new Date().toISOString() });
    await createTeam({ id: 'team-2', tenantId: TENANT, name: 'Research', createdAt: new Date().toISOString() });
    await addTeamMember({ id: 'tm-1', teamId: 'team-1', userId: 'user-t', createdAt: new Date().toISOString() });
    const ids = await listUserTeamIds('user-t', TENANT);
    expect(ids).toEqual(['team-1']);
  });
});

describe('resource sharing (canAccessResource)', () => {
  const share = (overrides: Partial<ResourceShare>): ResourceShare => ({
    id: `share-${crypto.randomUUID()}`,
    tenantId: TENANT,
    resourceType: 'collection',
    resourceId: 'col-1',
    granteeType: 'user',
    granteeId: 'user-1',
    permission: 'read',
    sharedBy: 'owner-1',
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it('grants read access to a directly-shared user', async () => {
    await upsertResourceShare(share({ granteeId: 'user-1', permission: 'read' }));
    expect(await canAccessResource('user-1', TENANT, 'collection', 'col-1', 'read')).toBe(true);
    // read grant does NOT satisfy edit
    expect(await canAccessResource('user-1', TENANT, 'collection', 'col-1', 'edit')).toBe(false);
  });

  it('an edit grant satisfies both read and edit', async () => {
    await upsertResourceShare(share({ granteeId: 'user-2', permission: 'edit' }));
    expect(await canAccessResource('user-2', TENANT, 'collection', 'col-1', 'read')).toBe(true);
    expect(await canAccessResource('user-2', TENANT, 'collection', 'col-1', 'edit')).toBe(true);
  });

  it('grants access through team membership', async () => {
    await createTeam({ id: 'team-share', tenantId: TENANT, name: 'Shared Team', createdAt: new Date().toISOString() });
    await addTeamMember({ id: 'tm-s', teamId: 'team-share', userId: 'user-3', createdAt: new Date().toISOString() });
    await upsertResourceShare(share({ granteeType: 'team', granteeId: 'team-share', permission: 'read' }));
    expect(await canAccessResource('user-3', TENANT, 'collection', 'col-1', 'read')).toBe(true);
    expect(await canAccessResource('user-not-in-team', TENANT, 'collection', 'col-1', 'read')).toBe(false);
  });

  it('expired shares deny access', async () => {
    await upsertResourceShare(share({ granteeId: 'user-4', expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(await canAccessResource('user-4', TENANT, 'collection', 'col-1', 'read')).toBe(false);
  });
});

describe('SSO flows (single-use state)', () => {
  it('consumeSsoFlow returns the flow once, then null', async () => {
    await createSsoFlow({
      state: 'state-abc',
      tenantId: TENANT,
      codeVerifier: 'verifier',
      redirectUri: 'https://app.example.com/api/v1/auth/sso/callback',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    const first = await consumeSsoFlow('state-abc');
    expect(first?.tenantId).toBe(TENANT);
    const second = await consumeSsoFlow('state-abc');
    expect(second).toBeNull();
  });

  it('consumeSsoFlow rejects expired flows', async () => {
    await createSsoFlow({
      state: 'state-old',
      tenantId: TENANT,
      codeVerifier: 'v',
      redirectUri: 'https://app.example.com/cb',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    expect(await consumeSsoFlow('state-old')).toBeNull();
  });
});

describe('OIDC primitives', () => {
  it('generatePkce produces a valid S256 challenge', () => {
    const { codeVerifier, codeChallenge } = generatePkce();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    const expected = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(codeChallenge).toBe(expected);
  });

  it('generateState is unique and non-empty', () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it('emailFromClaims normalizes and validates', () => {
    expect(emailFromClaims({ email: '  User@Example.com ' })).toBe('user@example.com');
    expect(emailFromClaims({ preferred_username: 'bob@site.io' })).toBe('bob@site.io');
    expect(emailFromClaims({ email: 'not-an-email' })).toBeNull();
    expect(emailFromClaims({})).toBeNull();
  });
});

describe('OIDC id_token verification (RS256)', () => {
  const ISSUER = 'https://idp.example.com/realms/test';
  const CLIENT_ID = 'omnirag-client';
  const JWKS_URI = `${ISSUER}/jwks`;

  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof fetch;

  function b64url(obj: object): string {
    return Buffer.from(JSON.stringify(obj)).toString('base64url');
  }

  beforeEach(() => {
    resetOidcCaches();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchFor(jwk: any) {
    fetchMock = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('.well-known/openid-configuration')) {
        return new Response(
          JSON.stringify({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/authorize`,
            token_endpoint: `${ISSUER}/token`,
            jwks_uri: JWKS_URI,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url === JWKS_URI) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });
    global.fetch = fetchMock as any;
  }

  function signIdToken(privateKey: crypto.KeyObject, payload: object, kid = 'test-key'): string {
    const header = b64url({ alg: 'RS256', typ: 'JWT', kid });
    const body = b64url(payload);
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url');
    return `${header}.${body}.${signature}`;
  }

  it('accepts a validly-signed id_token with correct iss/aud/exp', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
    mockFetchFor(jwk);

    const config: SsoOidcConfig = { enabled: true, issuer: ISSUER, clientId: CLIENT_ID };
    const idToken = signIdToken(privateKey, {
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'user-123',
      email: 'alice@company.com',
      exp: Math.floor(Date.now() / 1000) + 600,
      iat: Math.floor(Date.now() / 1000),
    });

    const claims = await verifyIdToken({ idToken, config });
    expect(claims.email).toBe('alice@company.com');
    expect(claims.sub).toBe('user-123');
  });

  it('rejects an id_token signed by a different key', async () => {
    const real = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...real.publicKey.export({ format: 'jwk' }), kid: 'test-key' };
    mockFetchFor(jwk);

    const config: SsoOidcConfig = { enabled: true, issuer: ISSUER, clientId: CLIENT_ID };
    const forged = signIdToken(attacker.privateKey, {
      iss: ISSUER,
      aud: CLIENT_ID,
      email: 'evil@company.com',
      exp: Math.floor(Date.now() / 1000) + 600,
    });

    await expect(verifyIdToken({ idToken: forged, config })).rejects.toThrow();
  });

  it('rejects an expired id_token', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key' };
    mockFetchFor(jwk);

    const config: SsoOidcConfig = { enabled: true, issuer: ISSUER, clientId: CLIENT_ID };
    const expired = signIdToken(privateKey, {
      iss: ISSUER,
      aud: CLIENT_ID,
      email: 'alice@company.com',
      exp: Math.floor(Date.now() / 1000) - 3600,
    });

    await expect(verifyIdToken({ idToken: expired, config })).rejects.toThrow();
  });

  it('rejects an id_token with the wrong audience', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key' };
    mockFetchFor(jwk);

    const config: SsoOidcConfig = { enabled: true, issuer: ISSUER, clientId: CLIENT_ID };
    const wrongAud = signIdToken(privateKey, {
      iss: ISSUER,
      aud: 'some-other-client',
      email: 'alice@company.com',
      exp: Math.floor(Date.now() / 1000) + 600,
    });

    await expect(verifyIdToken({ idToken: wrongAud, config })).rejects.toThrow();
  });
});
