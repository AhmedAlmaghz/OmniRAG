import { createLogger } from '@/lib/logging/logger';

const log = createLogger('AppApiV1AuthSsoCallback');

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/storage/db';
import { getEnv } from '@/lib/env/runtimeEnv';
import { checkRateLimit } from '@/lib/security/rateLimiter';
import { setSessionCookie } from '@/lib/auth/session';
import { createSessionToken, sessionExpiryIso } from '@/lib/auth/sessionInfo';
import { SSO_NO_PASSWORD_HASH } from '@/lib/auth/password';
import { getTenantConfig } from '@/lib/services/tenantConfigService';
import { consumeSsoFlow, upsertMembership, getMembership } from '@/lib/services/membershipService';
import { exchangeCodeForTokens, verifyIdToken, emailFromClaims } from '@/lib/auth/sso/oidc';

export const dynamic = 'force-dynamic';

/**
 * OIDC callback (Phase 5). The provider redirects the browser here with
 * `code` + `state`. The flow row (single-use) binds the callback to the
 * initiating tenant and carries the PKCE verifier + exact redirect URI.
 *
 * On success a session cookie is set and the browser lands on `/`. On any
 * failure the browser is redirected home with `?sso=error&reason=…` so the
 * AuthScreen can surface a message — internal details never leak.
 */

function failRedirect(req: NextRequest, reason: string): NextResponse {
  const url = new URL('/', req.url);
  url.searchParams.set('sso', 'error');
  url.searchParams.set('reason', reason);
  return NextResponse.redirect(url, 302);
}

export async function GET(req: NextRequest) {
  // Preload runtime env so DB access works under the runtime-env pattern.
  for (const key of ['DATABASE_URL', 'POSTGRES_URL']) {
    getEnv(key, req);
  }

  const rl = await checkRateLimit(req, 10, 60000, 'sso-callback');
  if (!rl.success && rl.response) return rl.response;

  const { searchParams } = new URL(req.url);

  // Provider-side refusal (user cancelled, access_denied, …).
  if (searchParams.get('error')) {
    return failRedirect(req, 'provider_denied');
  }

  const code = searchParams.get('code') || '';
  const state = searchParams.get('state') || '';
  if (!code || !state) return failRedirect(req, 'missing_params');

  try {
    // Single-use: consumes the flow; replayed/unknown/expired states fail here.
    const flow = await consumeSsoFlow(state);
    if (!flow) return failRedirect(req, 'invalid_state');

    const config = await getTenantConfig(flow.tenantId);
    const sso = config.ssoOidc;
    if (!sso?.enabled || !sso.issuer || !sso.clientId) return failRedirect(req, 'sso_disabled');

    const tokens = await exchangeCodeForTokens({
      config: sso,
      code,
      redirectUri: flow.redirectUri,
      codeVerifier: flow.codeVerifier,
    });
    if (!tokens.id_token) return failRedirect(req, 'no_id_token');

    const claims = await verifyIdToken({ idToken: tokens.id_token, config: sso });
    const email = emailFromClaims(claims);
    if (!email) return failRedirect(req, 'no_email');

    // Email-domain binding: when configured, only matching corporate emails
    // may JIT-provision into this workspace.
    if (sso.emailDomain) {
      const domain = email.split('@')[1];
      if (domain !== sso.emailDomain.toLowerCase()) return failRedirect(req, 'domain_mismatch');
    }

    // JIT provisioning: reuse an existing account by email, else create one.
    // SSO accounts carry a non-loginable password sentinel.
    const now = new Date().toISOString();
    let user = await db.getUserByEmail(email);
    if (!user) {
      user = {
        id: `user-${randomUUID()}`,
        email,
        passwordHash: SSO_NO_PASSWORD_HASH,
        tenantId: flow.tenantId,
        createdAt: now,
      };
      await db.createUser(user);
    }

    // Grant membership without downgrading an existing (higher) role.
    const existing = await getMembership(flow.tenantId, user.id);
    if (!existing) {
      await upsertMembership({
        id: `mem-${randomUUID()}`,
        userId: user.id,
        tenantId: flow.tenantId,
        role: sso.defaultRole || 'viewer',
        status: 'active',
        createdAt: now,
      });
    }

    const token = createSessionToken();
    await db.createSession({
      token,
      userId: user.id,
      tenantId: flow.tenantId,
      expiresAt: sessionExpiryIso(),
      createdAt: now,
    });

    await db.addAuditLog({
      id: `audit-${randomUUID()}`,
      tenantId: flow.tenantId,
      actorId: user.id,
      action: 'SSO_LOGIN',
      resourceType: 'session',
      resourceId: flow.tenantId,
      status: 'success',
      details: `تسجيل دخول عبر SSO/OIDC للبريد (${email}).`,
      timestamp: now,
    });

    const home = new URL('/', req.url);
    home.searchParams.set('sso', 'success');
    const res = NextResponse.redirect(home, 302);
    return setSessionCookie(res, { token });
  } catch (err) {
    log.error('[sso/callback] error:', (err as Error)?.message);
    return failRedirect(req, 'callback_failed');
  }
}
