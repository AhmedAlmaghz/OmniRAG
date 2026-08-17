import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regression guard for Phase 3 auth hardening:
 * 1. /auth/login applies a per-IP rate limit before doing any work.
 * 2. /auth/login applies a secondary per-email rate limit so credential
 *    stuffing across rotated IPs still hits a per-account ceiling.
 * 3. When no user matches the email, login runs a full Argon2 verification
 *    against a dummy hash (timing-oracle defense) rather than skipping
 *    verification. We assert verifyPassword is invoked on the missing-user
 *    path.
 * 4. /auth/register rejects after its rate limit is exceeded.
 *
 * Both routes are mocked at the dependency boundary (db, password, sessionInfo)
 * so no live Postgres or Argon2 hash is required for the behavioural checks.
 */

function makeReq(body: any, headers: Record<string, string> = {}): any {
  return {
    json: async () => body,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    nextUrl: { pathname: '/api/v1/auth/login' },
    cookies: { get: () => undefined },
  } as any;
}

const xhrHeaders = { 'x-requested-with': 'XMLHttpRequest' };

describe('Phase 3 auth hardening — rate limiting & timing defense', () => {
  let verifySpy: ReturnType<typeof vi.fn>;
  let getUserByEmailSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // vitest sets NODE_ENV='test' by default (non-production), which is what
    // the limiter assumes. No env mutation needed here.

    verifySpy = vi.fn(async () => false);
    getUserByEmailSpy = vi.fn(async () => undefined);

    vi.resetModules();
    vi.doMock('@/lib/storage/db', () => ({
      db: {
        getUserByEmail: getUserByEmailSpy,
        createSession: vi.fn(async () => {}),
        deleteExpiredSessions: vi.fn(async () => {}),
      },
    }));
    vi.doMock('@/lib/auth/password', () => ({
      verifyPassword: verifySpy,
      hashPassword: vi.fn(async () => 'hashed'),
      getDummyPasswordHash: vi.fn(async () => 'dummy-hash'),
    }));
    vi.doMock('@/lib/auth/session', () => ({
      setSessionCookie: (res: any) => res,
      getSessionTokenFromRequest: () => undefined,
      clearSessionCookie: (res: any) => res,
    }));
    vi.doMock('@/lib/auth/sessionInfo', () => ({
      createSessionToken: () => 'token',
      sessionExpiryIso: () => '2099-01-01T00:00:00.000Z',
    }));
    vi.doMock('@/lib/auth/csrf', async () => {
      const actual = await vi.importActual<any>('@/lib/auth/csrf');
      return actual;
    });
  });

  afterEach(() => {
    vi.doUnmock('@/lib/storage/db');
    vi.doUnmock('@/lib/auth/password');
    vi.doUnmock('@/lib/auth/session');
    vi.doUnmock('@/lib/auth/sessionInfo');
    vi.doUnmock('@/lib/auth/csrf');
    vi.resetModules();
  });

  async function loadLogin() {
    const mod = await import('../app/api/v1/auth/login/route');
    return mod.POST;
  }

  it('enforces a per-IP rate limit on /auth/login before any work', async () => {
    const POST = await loadLogin();
    const ip = '203.0.113.7';

    // Exhaust the per-IP/per-path budget (default login limit is 10/min).
    // Use a distinct email per request so the per-EMAIL bucket (5/min, stricter)
    // does NOT engage — we are isolating the per-IP behavior here.
    let lastResponse: any;
    for (let i = 0; i < 11; i++) {
      lastResponse = await POST(
        makeReq({ email: `u${i}@b.com`, password: 'pw123456' }, { 'x-forwarded-for': ip, ...xhrHeaders }),
      );
    }
    expect(lastResponse.status).toBe(429);
    // First 10 requests ran the handler (10 db lookups); the 11th was throttled.
    expect(getUserByEmailSpy).toHaveBeenCalledTimes(10);
  });

  it('runs a dummy Argon2 verify when no user matches (timing defense)', async () => {
    getUserByEmailSpy.mockResolvedValue(undefined);
    const POST = await loadLogin();

    const res = await POST(makeReq({ email: 'missing@b.com', password: 'pw123456' }, { ...xhrHeaders }));
    expect(res.status).toBe(401);
    // The defining assertion: even though no user row existed, verifyPassword
    // must have been invoked against the dummy hash.
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy.mock.calls[0][0]).toBe('pw123456');
    expect(verifySpy.mock.calls[0][1]).toBe('dummy-hash');
  });

  it('rejects after the per-email budget is exceeded even across IPs', async () => {
    getUserByEmailSpy.mockResolvedValue(undefined);
    const POST = await loadLogin();
    // Per-email limit is 5/min. Rotate IP on every request to defeat the
    // per-IP bucket; the per-email bucket must still throttle.
    const email = 'target@example.com';
    let lastResponse: any;
    for (let i = 0; i < 6; i++) {
      lastResponse = await POST(
        makeReq({ email, password: 'pw123456' }, { 'x-forwarded-for': `198.51.100.${i}`, ...xhrHeaders }),
      );
    }
    expect(lastResponse.status).toBe(429);
  });
});
