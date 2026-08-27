/**
 * Role & permission matrix for OmniRAG workspaces.
 *
 * Phase 5 activated: roles come from the `memberships` table (a user can
 * belong to many tenants with a different role in each). Tenants created
 * before Phase 5 have no membership rows — their creator resolves to `owner`
 * through the legacy fallback inside resolveMembershipRole, which also
 * backfills the membership row lazily.
 *
 * Permission strings follow `resource:action` and are checked positively:
 * anything not explicitly granted to a role is denied.
 */

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

export const ROLES: Role[] = ['owner', 'admin', 'editor', 'viewer'];

/** Resource:action grants. Keep the list flat — the matrix below is the only
 * place permission decisions are encoded. */
export const PERMISSIONS = [
  // Knowledge & documents
  'documents:read',
  'documents:write',
  'documents:delete',
  'collections:read',
  'collections:write',
  'sources:read',
  'sources:write',
  'sources:delete',
  // Chat
  'chat:use',
  'conversations:read',
  'conversations:write',
  'conversations:delete',
  // Platform configuration
  'settings:read',
  'settings:write',
  'providers:manage',
  'mcp:manage',
  'apiKeys:manage',
  // Workspace administration
  'members:read',
  'members:manage',
  'billing:manage',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL_PERMISSIONS: ReadonlySet<Permission> = new Set(PERMISSIONS);

/**
 * Role → granted permissions. Owner gets everything; admin everything except
 * billing; editor can use and mutate knowledge/chat but not platform config;
 * viewer is read + chat only.
 */
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: ALL_PERMISSIONS,
  admin: new Set(PERMISSIONS.filter((p) => p !== 'billing:manage')),
  editor: new Set([
    'documents:read',
    'documents:write',
    'collections:read',
    'collections:write',
    'sources:read',
    'sources:write',
    'chat:use',
    'conversations:read',
    'conversations:write',
    'settings:read',
  ]),
  viewer: new Set([
    'documents:read',
    'collections:read',
    'sources:read',
    'chat:use',
    'conversations:read',
    'settings:read',
  ]),
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/**
 * Resolves the caller's role within a tenant from the memberships layer
 * (Phase 5). Returns null when the user is not a member — callers MUST deny.
 * Legacy single-user tenants keep working: the tenant creator resolves to
 * owner via the fallback inside resolveMembershipRole.
 */
export async function resolveRole(tenantId: string, userId: string): Promise<Role | null> {
  const { resolveMembershipRole } = await import('../services/membershipService');
  return resolveMembershipRole(tenantId, userId);
}

export interface PermissionCheckResult {
  allowed: boolean;
  role: Role | null;
  permission: Permission;
}

/**
 * Authorization gate for route handlers. Usage:
 *
 *   const check = await requirePermission(authCtx, 'documents:write');
 *   if (!check.allowed) return NextResponse.json({ error: '...' }, { status: 403 });
 *
 * Returns (not throws) so routes keep full control of the response shape.
 */
export async function requirePermission(
  ctx: { tenantId: string; userId: string },
  permission: Permission,
): Promise<PermissionCheckResult> {
  const role = await resolveRole(ctx.tenantId, ctx.userId);
  if (!role) return { allowed: false, role: null, permission };
  return { allowed: roleHasPermission(role, permission), role, permission };
}

/**
 * Route-guard shorthand: returns a 403 response when the caller lacks the
 * permission (or is not a member of the tenant at all), and null when the
 * request may proceed. Usage:
 *
 *   const denied = await guardPermission(authCtx, 'sources:write');
 *   if (denied) return denied;
 */
export async function guardPermission(
  ctx: { tenantId: string; userId: string },
  permission: Permission,
): Promise<import('next/server').NextResponse | null> {
  const { NextResponse } = await import('next/server');
  const check = await requirePermission(ctx, permission);
  if (check.allowed) return null;
  const reason =
    check.role === null
      ? 'أنت غير عضو في مساحة العمل هذه (Not a member of this workspace).'
      : `الدور (${check.role}) لا يملك الصلاحية ${permission} (Role lacks permission).`;
  return NextResponse.json({ error: reason, code: '403_FORBIDDEN', permission }, { status: 403 });
}
