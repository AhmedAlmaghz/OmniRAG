import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from './firebaseAdmin';

export interface AuthenticatedContext {
  authenticated: boolean;
  tenantId: string;
  userId: string;
  userEmail?: string;
  /** 'firebase' = verified Firebase ID token. The only supported auth method. */
  authMethod: 'firebase';
  response?: NextResponse;
}

function deny(status: 401 | 403, code: string, reason: string): AuthenticatedContext {
  return {
    authenticated: false,
    tenantId: '',
    userId: '',
    authMethod: 'firebase',
    response: NextResponse.json({ error: reason, code }, { status }),
  };
}

/**
 * Validates API request authorization and derives tenant identity exclusively
 * from verified Firebase credentials. There is no demo/bypass path: every
 * authenticated request must carry a valid Firebase ID token.
 *
 * Rules:
 *  1. A valid Firebase ID token is the only source of a tenant identity
 *     (`tenant-<uid>`, overridable via the `tenantId` custom claim).
 *  2. Invalid / expired / forged tokens (including any `tenant-*` Bearer) are
 *     ALWAYS rejected with 401 — they cannot be verified as Firebase tokens.
 *  3. Missing Authorization header is always rejected.
 */
export async function verifyApiAuth(req: NextRequest): Promise<AuthenticatedContext> {
  const authHeader = req.headers.get('authorization') || '';

  if (!authHeader.startsWith('Bearer ')) {
    return deny(401, '401_MISSING_TOKEN', 'المصادقة مطلوبة: يجب إرسال توكن هوية صالح في ترويسة Authorization.');
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return deny(401, '401_EMPTY_TOKEN', 'توكن الهوية فارغ أو غير صالح.');
  }

  // Verify the Firebase ID token. Any failure (including forged `tenant-*`
  // strings that are not real Firebase tokens) is rejected — never falls back.
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);

    const claimTenant = (decodedToken.firebase?.claims as Record<string, unknown> | undefined)?.tenantId;
    const tenantId =
      typeof claimTenant === 'string' && claimTenant.startsWith('tenant-') ? claimTenant : `tenant-${decodedToken.uid}`;

    return {
      authenticated: true,
      tenantId,
      userId: decodedToken.uid,
      userEmail: decodedToken.email,
      authMethod: 'firebase',
    };
  } catch (error) {
    console.warn('[apiAuth] ID token verification failed — rejecting request:', (error as Error)?.message);
    return deny(401, '401_INVALID_TOKEN', 'توكن الهوية غير صالح أو منتهي الصلاحية.');
  }
}
