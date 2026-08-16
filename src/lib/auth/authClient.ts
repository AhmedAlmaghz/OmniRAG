/**
 * Client-side auth (Postgres-only — replaces Firebase Auth).
 *
 * Thin client over the server auth API routes. The opaque session token lives
 * in an httpOnly cookie set by the server, so this module carries no secrets:
 * it just calls the routes with `credentials: 'same-origin'` and surfaces the
 * returned identity. There is no SDK, no token refresh, no client-stored
 * credential — revocation is server-side (delete the session row).
 */

export interface AuthResult {
  tenantId: string;
  userEmail: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };

async function postAuth(route: 'register' | 'login', body: object): Promise<AuthResult> {
  const res = await fetch(`/api/v1/auth/${route}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.tenantId) {
    const msg = data.error || (res.status === 401 ? 'بيانات غير صحيحة' : 'فشل المصادقة');
    const err = new Error(msg) as Error & { code?: string; status?: number };
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return { tenantId: data.tenantId, userEmail: data.userEmail };
}

/** Register a new account; the server provisions a tenant, seeds defaults, and sets a session cookie. */
export async function signUpUser(email: string, password: string, workspaceName: string): Promise<AuthResult> {
  return postAuth('register', { email, password, workspaceName });
}

/** Sign in an existing user; the server sets a session cookie. */
export async function signInUser(email: string, password: string): Promise<AuthResult> {
  return postAuth('login', { email, password });
}

/** Sign out: the server revokes the session row and clears the cookie. */
export async function logOutUser(): Promise<void> {
  await fetch('/api/v1/auth/logout', {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'same-origin',
  }).catch(() => {});
}

/** Rehydrate auth state at boot by reading the (opaque) session cookie via the server. */
export async function getSession(): Promise<AuthResult & { authenticated: boolean }> {
  const res = await fetch('/api/v1/auth/session', { credentials: 'same-origin' });
  if (res.status === 401) return { authenticated: false, tenantId: '', userEmail: '' };
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.authenticated) return { authenticated: false, tenantId: '', userEmail: '' };
  return { authenticated: true, tenantId: data.tenantId, userEmail: data.userEmail || '' };
}
