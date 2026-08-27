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

/** A workspace the signed-in user belongs to (Phase 5 multi-tenancy). */
export interface WorkspaceRef {
  tenantId: string;
  name: string;
  role: string;
  isCurrent: boolean;
}

export interface SessionInfo extends AuthResult {
  authenticated: boolean;
  role: string | null;
  workspaces: WorkspaceRef[];
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

/**
 * Register a new account. Two modes:
 *  - Without `inviteToken`: the server provisions a new tenant + owner membership.
 *  - With `inviteToken`: the account joins the inviting workspace (no new
 *    tenant) — creating an account is not synonymous with creating a workspace.
 */
export async function signUpUser(
  email: string,
  password: string,
  workspaceName: string,
  inviteToken?: string,
): Promise<AuthResult> {
  return postAuth('register', { email, password, workspaceName, inviteToken: inviteToken || undefined });
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
export async function getSession(): Promise<SessionInfo> {
  const empty: SessionInfo = { authenticated: false, tenantId: '', userEmail: '', role: null, workspaces: [] };
  const res = await fetch('/api/v1/auth/session', { credentials: 'same-origin' });
  if (res.status === 401) return empty;
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.authenticated) return empty;
  return {
    authenticated: true,
    tenantId: data.tenantId,
    userEmail: data.userEmail || '',
    role: data.role || null,
    workspaces: Array.isArray(data.workspaces) ? data.workspaces : [],
  };
}

/**
 * Switch the active session to another workspace the user belongs to. The
 * server issues a new session cookie bound to the target tenant. Returns the
 * new tenantId + role so the caller can update local state without a reload.
 */
export async function switchWorkspace(tenantId: string): Promise<{ tenantId: string; role: string }> {
  const res = await fetch('/api/v1/auth/workspaces', {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ tenantId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'فشل تبديل مساحة العمل (Workspace switch failed)');
  }
  return { tenantId: data.tenantId, role: data.role };
}

/** Kick off an OIDC SSO login; returns the provider URL to navigate to. */
export async function startSsoLogin(input: { tenantId?: string; email?: string }): Promise<string> {
  const res = await fetch('/api/v1/auth/sso/initiate', {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.authorizationUrl) {
    throw new Error(data.error || 'تعذر بدء تسجيل الدخول الأحادي (Could not start SSO)');
  }
  return data.authorizationUrl;
}
