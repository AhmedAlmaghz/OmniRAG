import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * v0.12.12 (audit 2026-08-29 item 6): the four PRE-AUTH mutation routes —
 * which cannot sit behind withAuthAndRateLimit because it authenticates
 * first — now apply the SAME strong Origin gate as the 50 wrapped routes
 * (originGuardDenied). The legacy `x-requested-with` header check remains as
 * layer two; these tests send a VALID legacy header with an EVIL origin so a
 * 403 can only come from the new gate.
 */

const ROUTES = [
  { path: '/api/v1/auth/login', mod: '../app/api/v1/auth/login/route' },
  { path: '/api/v1/auth/register', mod: '../app/api/v1/auth/register/route' },
  { path: '/api/v1/auth/logout', mod: '../app/api/v1/auth/logout/route' },
  { path: '/api/v1/auth/sso/initiate', mod: '../app/api/v1/auth/sso/initiate/route' },
];

const BASE = 'http://localhost:3000';

describe('pre-auth mutation routes — strong origin gate (audit item 6)', () => {
  it.each(ROUTES)('$path rejects a cross-origin POST with 403 before any work', async ({ path, mod }) => {
    const { POST } = await import(mod);
    const req = new NextRequest(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // valid legacy-header check + evil origin → only the new gate can 403
        'x-requested-with': 'XMLHttpRequest',
        origin: 'https://evil.example',
      },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it.each(ROUTES)('$path lets a same-origin request past the gate', async ({ path, mod }) => {
    const { POST } = await import(mod);
    const req = new NextRequest(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).not.toBe(403);
  });
});
