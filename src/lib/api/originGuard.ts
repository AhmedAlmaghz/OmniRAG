import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest, getAllowedOrigins } from '../security/securityHeaders';

/**
 * Origin gate for the PRE-AUTH mutation routes (login / register / logout /
 * SSO initiate) — the exact check `withAuthAndRateLimit` applies to every
 * wrapped route (v0.12.12, audit item 6). These four could not use the
 * gateway (it authenticates first), so historically they relied on the
 * spoofable `x-requested-with` header alone.
 *
 * The legacy `isCsrfOk` header check stays as a second layer; this gate is
 * the primary defense: a browser cannot forge `Origin` on a cross-site POST,
 * and cross-site fetches carrying the header would fail CORS preflight.
 */
export function originGuardDenied(req: NextRequest): NextResponse | null {
  if (isSameOriginRequest(req, getAllowedOrigins())) return null;
  return NextResponse.json({ error: 'Forbidden (cross-origin request rejected)' }, { status: 403 });
}
