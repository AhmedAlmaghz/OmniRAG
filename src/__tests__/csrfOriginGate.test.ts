import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CSRF gate integration inside withAuthAndRateLimit.
 *
 * Every cookie-authenticated POST/PUT/DELETE across the 50 wrapped routes now
 * requires a same-origin (or CORS-allowlisted) Origin/Referer. Previously only
 * the 4 auth routes checked a spoofable custom header.
 */

const statusByOrigin = async (method: string, headers: Record<string, string>) => {
  // Dynamic import so the module graph picks up the edited wrapper.
  const mod = await import('../lib/api/withAuthAndRateLimit');
  const wrapped = mod.withAuthAndRateLimit(async () => new Response('{}', { status: 200 }));
  const url = 'https://omnirag.example/api/v1/collections';
  const res = await wrapped({
    method,
    url,
    nextUrl: { pathname: '/api/v1/collections' },
    headers: { get: (n: string) => headers[n] ?? null },
  } as never);
  return res.status;
};

describe('withAuthAndRateLimit — CSRF origin gate', () => {
  beforeEach(() => {
    // The wrapper pre-loads runtime env keys via getEnv and touches the DB
    // singleton on URL change; none of that runs for our requests (no env
    // headers supplied), so no storage mock is needed before the 403 short-
    // circuit. The 200-path test supplies a full auth context via the mocked
    // verifyApiAuth below.
  });

  it('rejects cross-origin mutation with 403 before touching auth', async () => {
    const apiAuth = await import('../lib/auth/apiAuth');
    const spy = vi.spyOn(apiAuth, 'verifyApiAuth').mockResolvedValue({
      authenticated: true,
      tenantId: 't1',
      userId: 'u1',
    } as never);
    const status = await statusByOrigin('POST', { origin: 'https://evil.example' });
    expect(status).toBe(403);
    // Auth must not even run for a CSRF-rejected request.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('lets same-origin mutations proceed to auth', async () => {
    const apiAuth = await import('../lib/auth/apiAuth');
    const spy = vi.spyOn(apiAuth, 'verifyApiAuth').mockResolvedValue({
      authenticated: true,
      tenantId: 't1',
      userId: 'u1',
    } as never);
    const status = await statusByOrigin('POST', { origin: 'https://omnirag.example' });
    expect(status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not gate safe methods (GET/HEAD)', async () => {
    const apiAuth = await import('../lib/auth/apiAuth');
    const spy = vi.spyOn(apiAuth, 'verifyApiAuth').mockResolvedValue({
      authenticated: true,
      tenantId: 't1',
      userId: 'u1',
    } as never);
    const get = await statusByOrigin('GET', { origin: 'https://evil.example' });
    expect(get).toBe(200); // safe methods are never CSRF carriers
    spy.mockRestore();
  });
});
