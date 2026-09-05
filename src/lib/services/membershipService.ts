import { createLogger } from '@/lib/logging/logger';

const log = createLogger('LibServicesMembershipService');

import { randomUUID, randomBytes } from 'node:crypto';
import { getPostgresPool } from '../storage/postgres';
import { db } from '../storage/db';
import type { Role } from '../auth/permissions';

/**
 * Memberships, invitations, teams and resource shares (Phase 5).
 *
 * Multi-tenant membership layer: a user can belong to many tenants with a
 * role per tenant (owner/admin/editor/viewer). The session's tenantId selects
 * the active workspace; `resolveMembershipRole` answers "what role does this
 * user hold HERE" on every authorized request.
 *
 * Backward compatibility: tenants created before Phase 5 have no membership
 * rows. Their creator (users.tenant_id === tenantId) resolves to `owner`
 * through the legacy fallback, and an owner membership row is backfilled
 * lazily so later role checks and member listings stay consistent.
 *
 * Persistence follows the platform duality: Postgres when configured,
 * in-memory otherwise (dev/test parity with the storage contract).
 */

export interface Membership {
  id: string;
  userId: string;
  tenantId: string;
  role: Role;
  status: 'active' | 'deactivated';
  invitedBy?: string;
  createdAt: string;
}

export interface Invitation {
  id: string;
  tenantId: string;
  email: string;
  role: Role;
  token: string;
  invitedBy: string;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  createdAt: string;
}

export interface Team {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  addedBy?: string;
  createdAt: string;
}

export type ShareResourceType = 'collection' | 'conversation' | 'document';
export type ShareGranteeType = 'user' | 'team';
export type SharePermission = 'read' | 'edit';

export interface ResourceShare {
  id: string;
  tenantId: string;
  resourceType: ShareResourceType;
  resourceId: string;
  granteeType: ShareGranteeType;
  granteeId: string;
  permission: SharePermission;
  linkToken?: string;
  sharedBy: string;
  expiresAt?: string;
  createdAt: string;
}

export interface SsoFlow {
  state: string;
  tenantId: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: string;
  createdAt: string;
}

/** Invitation lifetime: 7 days. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** OIDC authorization flow lifetime: 10 minutes. */
export const SSO_FLOW_TTL_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* In-memory fallback store (dev/test without Postgres)               */
/* ------------------------------------------------------------------ */

interface MemoryStore {
  memberships: Membership[];
  invitations: Invitation[];
  teams: Team[];
  teamMembers: TeamMember[];
  resourceShares: ResourceShare[];
  ssoFlows: SsoFlow[];
}

const memory: MemoryStore = {
  memberships: [],
  invitations: [],
  teams: [],
  teamMembers: [],
  resourceShares: [],
  ssoFlows: [],
};

/** Test helper — clears the in-memory fallback store. */
export function resetMembershipMemoryStore(): void {
  memory.memberships = [];
  memory.invitations = [];
  memory.teams = [];
  memory.teamMembers = [];
  memory.resourceShares = [];
  memory.ssoFlows = [];
}

function usePostgres(): boolean {
  return Boolean(getPostgresPool());
}

/* ------------------------------------------------------------------ */
/* Row mappers                                                        */
/* ------------------------------------------------------------------ */

function rowToMembership(r: any): Membership {
  return {
    id: r.id,
    userId: r.user_id ?? r.userId,
    tenantId: r.tenant_id ?? r.tenantId,
    role: r.role,
    status: r.status,
    invitedBy: r.invited_by ?? r.invitedBy ?? undefined,
    createdAt: r.created_at ?? r.createdAt,
  };
}

function rowToInvitation(r: any): Invitation {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    email: r.email,
    role: r.role,
    token: r.token,
    invitedBy: r.invited_by ?? r.invitedBy,
    expiresAt: r.expires_at ?? r.expiresAt,
    status: r.status,
    createdAt: r.created_at ?? r.createdAt,
  };
}

function rowToTeam(r: any): Team {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    name: r.name,
    description: r.description ?? undefined,
    createdAt: r.created_at ?? r.createdAt,
  };
}

function rowToTeamMember(r: any): TeamMember {
  return {
    id: r.id,
    teamId: r.team_id ?? r.teamId,
    userId: r.user_id ?? r.userId,
    addedBy: r.added_by ?? r.addedBy ?? undefined,
    createdAt: r.created_at ?? r.createdAt,
  };
}

function rowToShare(r: any): ResourceShare {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    resourceType: r.resource_type ?? r.resourceType,
    resourceId: r.resource_id ?? r.resourceId,
    granteeType: r.grantee_type ?? r.granteeType,
    granteeId: r.grantee_id ?? r.granteeId,
    permission: r.permission,
    linkToken: r.link_token ?? r.linkToken ?? undefined,
    sharedBy: r.shared_by ?? r.sharedBy,
    expiresAt: r.expires_at ?? r.expiresAt ?? undefined,
    createdAt: r.created_at ?? r.createdAt,
  };
}

function rowToSsoFlow(r: any): SsoFlow {
  return {
    state: r.state,
    tenantId: r.tenant_id ?? r.tenantId,
    codeVerifier: r.code_verifier ?? r.codeVerifier,
    redirectUri: r.redirect_uri ?? r.redirectUri,
    expiresAt: r.expires_at ?? r.expiresAt,
    createdAt: r.created_at ?? r.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* Memberships                                                        */
/* ------------------------------------------------------------------ */

export async function upsertMembership(m: Membership): Promise<void> {
  if (!usePostgres()) {
    memory.memberships = memory.memberships.filter((x) => !(x.userId === m.userId && x.tenantId === m.tenantId));
    memory.memberships.push(m);
    return;
  }
  const p = getPostgresPool()!;
  await p.query(
    `INSERT INTO memberships (id, user_id, tenant_id, role, status, invited_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, tenant_id) DO UPDATE
     SET role = EXCLUDED.role, status = EXCLUDED.status, invited_by = EXCLUDED.invited_by`,
    [m.id, m.userId, m.tenantId, m.role, m.status, m.invitedBy || null, m.createdAt],
  );
}

export async function getMembership(tenantId: string, userId: string): Promise<Membership | null> {
  if (!usePostgres()) {
    const found = memory.memberships.find((x) => x.tenantId === tenantId && x.userId === userId);
    return found || null;
  }
  const p = getPostgresPool()!;
  const res = await p.query('SELECT * FROM memberships WHERE tenant_id = $1 AND user_id = $2 LIMIT 1', [
    tenantId,
    userId,
  ]);
  return res.rows[0] ? rowToMembership(res.rows[0]) : null;
}

export async function listTenantMemberships(tenantId: string): Promise<Membership[]> {
  if (!usePostgres()) {
    return memory.memberships.filter((x) => x.tenantId === tenantId);
  }
  const p = getPostgresPool()!;
  const res = await p.query('SELECT * FROM memberships WHERE tenant_id = $1 ORDER BY created_at ASC', [tenantId]);
  return res.rows.map(rowToMembership);
}

export async function listUserMemberships(userId: string): Promise<Membership[]> {
  if (!usePostgres()) {
    return memory.memberships.filter((x) => x.userId === userId && x.status === 'active');
  }
  const p = getPostgresPool()!;
  const res = await p.query(
    "SELECT * FROM memberships WHERE user_id = $1 AND status = 'active' ORDER BY created_at ASC",
    [userId],
  );
  return res.rows.map(rowToMembership);
}

export async function deleteMembership(tenantId: string, userId: string): Promise<void> {
  if (!usePostgres()) {
    memory.memberships = memory.memberships.filter((x) => !(x.tenantId === tenantId && x.userId === userId));
    return;
  }
  const p = getPostgresPool()!;
  await p.query('DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId]);
}

export async function countTenantOwners(tenantId: string): Promise<number> {
  if (!usePostgres()) {
    return memory.memberships.filter((x) => x.tenantId === tenantId && x.role === 'owner').length;
  }
  const p = getPostgresPool()!;
  const res = await p.query("SELECT COUNT(*)::int AS n FROM memberships WHERE tenant_id = $1 AND role = 'owner'", [
    tenantId,
  ]);
  return Number(res.rows[0]?.n || 0);
}

/* ------------------------------------------------------------------ */
/* Role resolution (the Phase 5 activation point)                     */
/* ------------------------------------------------------------------ */

/**
 * Resolves the caller's role within a tenant:
 *  1. Active membership row → its role.
 *  2. Legacy creator fallback (users.tenant_id === tenantId) → owner, with a
 *     lazy backfill of the membership row so future reads hit path 1.
 *  3. Otherwise → null (not a member; callers must deny).
 */
export async function resolveMembershipRole(tenantId: string, userId: string): Promise<Role | null> {
  try {
    const membership = await getMembership(tenantId, userId);
    if (membership) {
      return membership.status === 'active' ? membership.role : null;
    }

    const user = await db.getUserById(userId);
    if (user && user.tenantId === tenantId) {
      // Backfill the owner row for pre-Phase-5 creators (best-effort).
      upsertMembership({
        id: `mem-${randomUUID()}`,
        userId,
        tenantId,
        role: 'owner',
        status: 'active',
        createdAt: new Date().toISOString(),
      }).catch(() => {});
      return 'owner';
    }
    return null;
  } catch (err) {
    log.warn('[membershipService] resolveMembershipRole failed:', (err as Error)?.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Invitations                                                        */
/* ------------------------------------------------------------------ */

export function newInvitationToken(): string {
  return randomBytes(24).toString('hex');
}

export async function createInvitation(inv: Invitation): Promise<void> {
  if (!usePostgres()) {
    memory.invitations = memory.invitations.filter((x) => x.id !== inv.id);
    memory.invitations.push(inv);
    return;
  }
  const p = getPostgresPool()!;
  await p.query(
    `INSERT INTO invitations (id, tenant_id, email, role, token, invited_by, expires_at, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, expires_at = EXCLUDED.expires_at, status = EXCLUDED.status`,
    [inv.id, inv.tenantId, inv.email, inv.role, inv.token, inv.invitedBy, inv.expiresAt, inv.status, inv.createdAt],
  );
}

export async function getInvitationByToken(token: string): Promise<Invitation | null> {
  if (!usePostgres()) {
    return memory.invitations.find((x) => x.token === token) || null;
  }
  const p = getPostgresPool()!;
  const res = await p.query('SELECT * FROM invitations WHERE token = $1 LIMIT 1', [token]);
  return res.rows[0] ? rowToInvitation(res.rows[0]) : null;
}

export async function findPendingInvitationByEmail(tenantId: string, email: string): Promise<Invitation | null> {
  const normalized = email.trim().toLowerCase();
  if (!usePostgres()) {
    return (
      memory.invitations.find((x) => x.tenantId === tenantId && x.email === normalized && x.status === 'pending') ||
      null
    );
  }
  const p = getPostgresPool()!;
  const res = await p.query(
    "SELECT * FROM invitations WHERE tenant_id = $1 AND email = $2 AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    [tenantId, normalized],
  );
  return res.rows[0] ? rowToInvitation(res.rows[0]) : null;
}

/**
 * Lists pending invitations addressed to an email address across ALL tenants.
 * Used by the invitee's own inbox view (accept/decline). Expired rows are
 * filtered out; tokens are included so the accept call can reference them.
 */
export async function listPendingInvitationsByEmail(email: string): Promise<Invitation[]> {
  const normalized = email.trim().toLowerCase();
  const now = Date.now();
  if (!usePostgres()) {
    return memory.invitations.filter((x) => x.email === normalized && isInvitationUsable(x, now));
  }
  const p = getPostgresPool()!;
  const res = await p.query(
    "SELECT * FROM invitations WHERE email = $1 AND status = 'pending' AND expires_at > $2 ORDER BY created_at DESC",
    [normalized, new Date(now).toISOString()],
  );
  return res.rows.map(rowToInvitation);
}

export async function listTenantInvitations(tenantId: string): Promise<Invitation[]> {
  if (!usePostgres()) {
    return memory.invitations.filter((x) => x.tenantId === tenantId);
  }
  const p = getPostgresPool()!;
  const res = await p.query('SELECT * FROM invitations WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId]);
  return res.rows.map(rowToInvitation);
}

export async function updateInvitationStatus(id: string, status: Invitation['status']): Promise<void> {
  if (!usePostgres()) {
    const inv = memory.invitations.find((x) => x.id === id);
    if (inv) inv.status = status;
    return;
  }
  const p = getPostgresPool()!;
  await p.query('UPDATE invitations SET status = $1 WHERE id = $2', [status, id]);
}

export async function deleteInvitation(id: string, tenantId: string): Promise<void> {
  if (!usePostgres()) {
    memory.invitations = memory.invitations.filter((x) => !(x.id === id && x.tenantId === tenantId));
    return;
  }
  const p = getPostgresPool()!;
  await p.query('DELETE FROM invitations WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
}

export function isInvitationUsable(inv: Invitation, now = Date.now()): boolean {
  if (inv.status !== 'pending') return false;
  const expires = new Date(inv.expiresAt).getTime();
  return Number.isFinite(expires) && expires > now;
}

/**
 * Accepts an invitation for an authenticated user: validates the token,
 * checks the account email matches the invited address, and converts it into
 * an active membership. Returns the created membership or throws a readable
 * error (surfaced verbatim by the API layer).
 */
export async function acceptInvitation(token: string, userId: string, userEmail: string): Promise<Membership> {
  const inv = await getInvitationByToken(token);
  if (!inv) throw new Error('الدعوة غير موجودة أو تم حذفها (Invitation not found).');
  if (!isInvitationUsable(inv)) {
    if (inv.status === 'pending') await updateInvitationStatus(inv.id, 'expired').catch(() => {});
    throw new Error('الدعوة منتهية الصلاحية أو مستخدمة سابقا (Invitation expired or already used).');
  }
  if (inv.email !== userEmail.trim().toLowerCase()) {
    throw new Error('هذه الدعوة موجهة لبريد إلكتروني آخر (Invitation was issued to a different email).');
  }

  const existing = await getMembership(inv.tenantId, userId);
  if (existing) {
    await updateInvitationStatus(inv.id, 'accepted');
    return existing;
  }

  const membership: Membership = {
    id: `mem-${randomUUID()}`,
    userId,
    tenantId: inv.tenantId,
    role: inv.role,
    status: 'active',
    invitedBy: inv.invitedBy,
    createdAt: new Date().toISOString(),
  };
  await upsertMembership(membership);
  await updateInvitationStatus(inv.id, 'accepted');
  return membership;
}

/* ------------------------------------------------------------------ */
/* Teams                                                              */
/* ------------------------------------------------------------------ */

export async function createTeam(team: Team): Promise<void> {
  if (!usePostgres()) {
    memory.teams = memory.teams.filter((x) => x.id !== team.id);
    memory.teams.push(team);
    return;
  }
  const p = getPostgresPool()!;
  await p.query(
    `INSERT INTO teams (id, tenant_id, name, description, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
    [team.id, team.tenantId, team.name, team.description || null, team.createdAt],
  );
}

export async function listTenantTeams(tenantId: string): Promise<Team[]> {
  if (!usePostgres()) {
    return memory.teams.filter((x) => x.tenantId === tenantId);
  }
  const p = getPostgresPool()!;
  const res = await p.query('SELECT * FROM teams WHERE tenant_id = $1 ORDER BY created_at ASC', [tenantId]);
  return res.rows.map(rowToTeam);
}

export async function getTeam(teamId: string, tenantId: string): Promise<Team | null> {
  if (!usePostgres()) {
    return memory.teams.find((x) => x.id === teamId && x.tenantId === tenantId) || null;
  }
  const p = getPostgresPool()!;
  const res = await p.query('SELECT * FROM teams WHERE id = $1 AND tenant_id = $2 LIMIT 1', [teamId, tenantId]);
  return res.rows[0] ? rowToTeam(res.rows[0]) : null;
}

export async function deleteTeam(teamId: string, tenantId: string): Promise<void> {
  if (!usePostgres()) {
    memory.teams = memory.teams.filter((x) => !(x.id === teamId && x.tenantId === tenantId));
    memory.teamMembers = memory.teamMembers.filter((x) => x.teamId !== teamId);
    return;
  }
  const p = getPostgresPool()!;
  await p.query('DELETE FROM team_members WHERE team_id = $1', [teamId]);
  await p.query('DELETE FROM teams WHERE id = $1 AND tenant_id = $2', [teamId, tenantId]);
}

export async function addTeamMember(tm: TeamMember): Promise<void> {
  if (!usePostgres()) {
    memory.teamMembers = memory.teamMembers.filter((x) => !(x.teamId === tm.teamId && x.userId === tm.userId));
    memory.teamMembers.push(tm);
    return;
  }
  const p = getPostgresPool()!;
  await p.query(
    `INSERT INTO team_members (id, team_id, user_id, added_by, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (team_id, user_id) DO NOTHING`,
    [tm.id, tm.teamId, tm.userId, tm.addedBy || null, tm.createdAt],
  );
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  if (!usePostgres()) {
    memory.teamMembers = memory.teamMembers.filter((x) => !(x.teamId === teamId && x.userId === userId));
    return;
  }
  const p = getPostgresPool()!;
  await p.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
}

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  if (!usePostgres()) {
    return memory.teamMembers.filter((x) => x.teamId === teamId);
  }
  const p = getPostgresPool()!;
  const res = await p.query('SELECT * FROM team_members WHERE team_id = $1 ORDER BY created_at ASC', [teamId]);
  return res.rows.map(rowToTeamMember);
}

/** Ids of the tenant teams a user belongs to (for share-grant resolution). */
export async function listUserTeamIds(userId: string, tenantId: string): Promise<string[]> {
  const tenantTeams = await listTenantTeams(tenantId);
  if (tenantTeams.length === 0) return [];
  if (!usePostgres()) {
    const teamIds = new Set(tenantTeams.map((t) => t.id));
    return memory.teamMembers.filter((x) => x.userId === userId && teamIds.has(x.teamId)).map((x) => x.teamId);
  }
  const p = getPostgresPool()!;
  const res = await p.query(
    `SELECT tm.team_id FROM team_members tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.user_id = $1 AND t.tenant_id = $2`,
    [userId, tenantId],
  );
  return res.rows.map((r: any) => r.team_id);
}

/* ------------------------------------------------------------------ */
/* Resource shares                                                    */
/* ------------------------------------------------------------------ */

export async function upsertResourceShare(share: ResourceShare): Promise<void> {
  if (!usePostgres()) {
    memory.resourceShares = memory.resourceShares.filter(
      (x) =>
        !(
          x.resourceType === share.resourceType &&
          x.resourceId === share.resourceId &&
          x.granteeType === share.granteeType &&
          x.granteeId === share.granteeId
        ),
    );
    memory.resourceShares.push(share);
    return;
  }
  const p = getPostgresPool()!;
  await p.query(
    `INSERT INTO resource_shares
       (id, tenant_id, resource_type, resource_id, grantee_type, grantee_id, permission, link_token, shared_by, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (resource_type, resource_id, grantee_type, grantee_id) DO UPDATE
     SET permission = EXCLUDED.permission, link_token = EXCLUDED.link_token,
         shared_by = EXCLUDED.shared_by, expires_at = EXCLUDED.expires_at`,
    [
      share.id,
      share.tenantId,
      share.resourceType,
      share.resourceId,
      share.granteeType,
      share.granteeId,
      share.permission,
      share.linkToken || null,
      share.sharedBy,
      share.expiresAt || null,
      share.createdAt,
    ],
  );
}

export async function listSharesForResource(
  tenantId: string,
  resourceType: string,
  resourceId: string,
): Promise<ResourceShare[]> {
  if (!usePostgres()) {
    return memory.resourceShares.filter(
      (x) => x.tenantId === tenantId && x.resourceType === resourceType && x.resourceId === resourceId,
    );
  }
  const p = getPostgresPool()!;
  const res = await p.query(
    'SELECT * FROM resource_shares WHERE tenant_id = $1 AND resource_type = $2 AND resource_id = $3 ORDER BY created_at ASC',
    [tenantId, resourceType, resourceId],
  );
  return res.rows.map(rowToShare);
}

export async function listTenantShares(tenantId: string): Promise<ResourceShare[]> {
  if (!usePostgres()) {
    return memory.resourceShares.filter((x) => x.tenantId === tenantId);
  }
  const p = getPostgresPool()!;
  const res = await p.query('SELECT * FROM resource_shares WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId]);
  return res.rows.map(rowToShare);
}

export async function deleteResourceShare(id: string, tenantId: string): Promise<void> {
  if (!usePostgres()) {
    memory.resourceShares = memory.resourceShares.filter((x) => !(x.id === id && x.tenantId === tenantId));
    return;
  }
  const p = getPostgresPool()!;
  await p.query('DELETE FROM resource_shares WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
}

export async function getShareByLinkToken(token: string): Promise<ResourceShare | null> {
  if (!usePostgres()) {
    const found = memory.resourceShares.find((x) => x.linkToken === token);
    if (!found) return null;
    if (found.expiresAt && new Date(found.expiresAt).getTime() <= Date.now()) return null;
    return found;
  }
  const p = getPostgresPool()!;
  const res = await p.query('SELECT * FROM resource_shares WHERE link_token = $1 LIMIT 1', [token]);
  if (!res.rows[0]) return null;
  const share = rowToShare(res.rows[0]);
  if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) return null;
  return share;
}

function isShareActive(share: ResourceShare, now = Date.now()): boolean {
  if (!share.expiresAt) return true;
  const expires = new Date(share.expiresAt).getTime();
  return Number.isFinite(expires) && expires > now;
}

/**
 * Resource-level access decision combining tenant role and explicit grants.
 * `needed` = 'read' is satisfied by 'read' or 'edit' grants; 'edit' requires
 * an 'edit' grant (or a role that already allows writes tenant-wide, checked
 * by the caller through requirePermission before falling back here).
 */
export async function canAccessResource(
  userId: string,
  tenantId: string,
  resourceType: ShareResourceType,
  resourceId: string,
  needed: SharePermission,
): Promise<boolean> {
  try {
    const shares = await listSharesForResource(tenantId, resourceType, resourceId);
    const active = shares.filter((s) => isShareActive(s));
    if (active.length === 0) return false;

    const direct = active.filter((s) => s.granteeType === 'user' && s.granteeId === userId);
    const satisfies = (s: ResourceShare) => (needed === 'read' ? true : s.permission === 'edit');
    if (direct.some(satisfies)) return true;

    const teamIds = new Set(await listUserTeamIds(userId, tenantId));
    return active.some((s) => s.granteeType === 'team' && teamIds.has(s.granteeId) && satisfies(s));
  } catch (err) {
    log.warn('[membershipService] canAccessResource failed:', (err as Error)?.message);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* SSO OIDC flows                                                     */
/* ------------------------------------------------------------------ */

export async function createSsoFlow(flow: SsoFlow): Promise<void> {
  if (!usePostgres()) {
    memory.ssoFlows = memory.ssoFlows.filter((x) => x.state !== flow.state);
    memory.ssoFlows.push(flow);
    return;
  }
  const p = getPostgresPool()!;
  await p.query(
    `INSERT INTO sso_flows (state, tenant_id, code_verifier, redirect_uri, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (state) DO UPDATE SET code_verifier = EXCLUDED.code_verifier, expires_at = EXCLUDED.expires_at`,
    [flow.state, flow.tenantId, flow.codeVerifier, flow.redirectUri, flow.expiresAt, flow.createdAt],
  );
}

/** Reads and deletes the flow (single-use). Returns null when absent/expired. */
export async function consumeSsoFlow(state: string): Promise<SsoFlow | null> {
  let flow: SsoFlow | null = null;
  if (!usePostgres()) {
    flow = memory.ssoFlows.find((x) => x.state === state) || null;
    memory.ssoFlows = memory.ssoFlows.filter((x) => x.state !== state);
  } else {
    const p = getPostgresPool()!;
    const res = await p.query('SELECT * FROM sso_flows WHERE state = $1 LIMIT 1', [state]);
    if (res.rows[0]) {
      flow = rowToSsoFlow(res.rows[0]);
      await p.query('DELETE FROM sso_flows WHERE state = $1', [state]);
    }
  }
  if (!flow) return null;
  const expires = new Date(flow.expiresAt).getTime();
  if (!Number.isFinite(expires) || expires <= Date.now()) return null;
  return flow;
}

export async function purgeExpiredSsoFlows(): Promise<void> {
  const nowIso = new Date().toISOString();
  if (!usePostgres()) {
    memory.ssoFlows = memory.ssoFlows.filter((x) => x.expiresAt > nowIso);
    return;
  }
  const p = getPostgresPool()!;
  await p.query('DELETE FROM sso_flows WHERE expires_at <= $1', [nowIso]).catch(() => {});
}
