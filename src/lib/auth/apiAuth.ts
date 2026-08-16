import { NextRequest, NextResponse } from 'next/server';
import type { SessionRecord } from '../types/omnirag';
import { db } from '../storage/db';
import { getSessionTokenFromRequest } from './session';

export interface AuthenticatedContext {
  authenticated: boolean;
  tenantId: string;
  userId: string;
  userEmail?: string;
  /** 'session' = verified opaque session row in Postgres. The only auth method. */
  authMethod: 'session';
  response?: NextResponse;
}

function deny(status: 401 | 403, code: string, reason: string): AuthenticatedContext {
  return {
    authenticated: false,
    tenantId: '',
    userId: '',
    authMethod: 'session',
    response: NextResponse.json({ error: reason, code }, { status }),
  };
}

/**
 * Validates API request authorization against a persisted Postgres session.
 *
 * The session token is carried in an httpOnly cookie (no client-side JS
 * access). On every request the token is looked up verbatim in the
 * `sessions` table; a row found within its expiry window yields a verified
 * identity. There is no demo/bypass path and no signed-token (JWT) fallback:
 * revocation is immediate (delete the row).
 *
 * Rules:
 *  1. A valid, unexpired session row is the only source of a tenant identity
 *     (the session's `tenant_id`, set at login/registration).
 *  2. Missing / expired / tampered tokens are always rejected with 401.
 *  3. The session's `tenant_id` is the scope for all DB queries downstream.
 */
export async function verifyApiAuth(req: NextRequest): Promise<AuthenticatedContext> {
  const token = getSessionTokenFromRequest(req);
  if (!token) {
    return deny(401, '401_NO_SESSION', 'المصادقة مطلوبة: لا توجد جلسة صالحة (No active session).');
  }

  let session: SessionRecord | undefined;
  try {
    session = await db.getSession(token);
  } catch (error) {
    console.warn('[apiAuth] Session lookup failed — rejecting request:', (error as Error)?.message);
    return deny(401, '401_SESSION_LOOKUP_FAILED', 'تعذّر التحقق من الجلسة (Could not verify session).');
  }

  if (!session) {
    return deny(401, '401_INVALID_SESSION', 'الجلسة غير صالحة أو منتهية (Invalid or expired session).');
  }

  // Enforce expiry even if cleanup hasn't run.
  const expiresAt = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    // Best-effort purge; ignore errors.
    db.deleteSession(token).catch(() => {});
    return deny(401, '401_EXPIRED_SESSION', 'انتهت صلاحية الجلسة (Session expired).');
  }

  return {
    authenticated: true,
    tenantId: session.tenantId,
    userId: session.userId,
    authMethod: 'session',
  };
}
