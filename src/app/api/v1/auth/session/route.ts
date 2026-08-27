import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { getSessionTokenFromRequest } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Read-only endpoint the client hits at boot to rehydrate auth state across
 * reloads (the httpOnly cookie is opaque; only the server can map it to
 * identity). Returns 200 with identity when a valid session exists, else 401.
 */
export async function GET(req: NextRequest) {
  const token = getSessionTokenFromRequest(req);
  if (!token) {
    return NextResponse.json(
      { authenticated: false, error: 'No active session', code: '401_NO_SESSION' },
      { status: 401 },
    );
  }

  let session;
  try {
    session = await db.getSession(token);
  } catch {
    return NextResponse.json(
      { authenticated: false, error: 'Could not verify session', code: '401_SESSION_LOOKUP_FAILED' },
      { status: 401 },
    );
  }

  if (!session) {
    return NextResponse.json(
      { authenticated: false, error: 'Invalid or expired session', code: '401_INVALID_SESSION' },
      { status: 401 },
    );
  }

  const expiresAt = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    db.deleteSession(token).catch(() => {});
    return NextResponse.json(
      { authenticated: false, error: 'Session expired', code: '401_EXPIRED_SESSION' },
      { status: 401 },
    );
  }

  // Resolve email best-effort; not strictly required by the client at boot,
  // but the AuthScreen/LandingPage show it when available.
  let userEmail: string | undefined;
  try {
    const user = await db.getUserById(session.userId);
    userEmail = user?.email;
  } catch {
    /* ignore: email is optional in the boot handshake */
  }

  // Phase 5: multi-workspace. Resolve the caller's role in the CURRENT tenant
  // and the list of workspaces they belong to, so the tenant switcher can
  // render at boot without a second round-trip. Both are best-effort — a
  // failure here must not break the auth handshake.
  let role: string | null = null;
  let workspaces: { tenantId: string; name: string; role: string; isCurrent: boolean }[] = [];
  try {
    const { resolveMembershipRole, listUserMemberships } = await import('@/lib/services/membershipService');
    role = await resolveMembershipRole(session.tenantId, session.userId);
    const memberships = await listUserMemberships(session.userId);
    workspaces = await Promise.all(
      memberships
        .filter((m) => m.status === 'active')
        .map(async (m) => {
          const tenant = await db.getTenant(m.tenantId).catch(() => undefined);
          return {
            tenantId: m.tenantId,
            name: tenant?.name || m.tenantId,
            role: m.role,
            isCurrent: m.tenantId === session.tenantId,
          };
        }),
    );
  } catch {
    /* ignore: workspace enrichment is optional at boot */
  }

  return NextResponse.json({
    authenticated: true,
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail,
    role,
    workspaces,
  });
}
