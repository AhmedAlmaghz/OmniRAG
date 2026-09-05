import { createLogger } from '@/lib/logging/logger';

const log = createLogger('AppApiV1AuthSsoInitiate');

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/storage/db';
import { getEnv } from '@/lib/env/runtimeEnv';
import { checkRateLimit } from '@/lib/security/rateLimiter';
import { originGuardDenied } from '@/lib/api/originGuard';
import { getTenantConfig } from '@/lib/services/tenantConfigService';
import { createSsoFlow, SSO_FLOW_TTL_MS } from '@/lib/services/membershipService';
import { buildAuthorizationUrl, generatePkce, generateState } from '@/lib/auth/sso/oidc';

export const dynamic = 'force-dynamic';

/**
 * Starts an OIDC SSO login for an UNAUTHENTICATED user (Phase 5).
 *
 * The caller supplies either:
 *  - `tenantId` — the workspace to sign in to, or
 *  - `email`    — a corporate email; the workspace is resolved by matching the
 *                 email's domain against tenants with SSO enabled + a bound
 *                 `emailDomain`.
 *
 * Returns `{ authorizationUrl }`; the client navigates the browser to it. The
 * provider redirects back to /api/v1/auth/sso/callback with `code` + `state`.
 * PKCE (S256) and a single-use server-side `state` row protect the flow.
 */

function deriveRedirectUri(req: NextRequest): string {
  const appUrl = getEnv('APP_URL', req);
  if (appUrl) {
    try {
      return `${new URL(appUrl.trim()).origin}/api/v1/auth/sso/callback`;
    } catch {
      /* fall through to host fallback (dev only) */
    }
  }
  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}/api/v1/auth/sso/callback`;
}

export async function POST(req: NextRequest) {
  // Tight limit: this is unauthenticated and hits the DB + provider discovery.
  const rl = await checkRateLimit(req, 10, 60000, 'sso-initiate');
  if (!rl.success && rl.response) return rl.response;

  // v0.12.12 (audit item 6): strong Origin gate — a cross-site initiation
  // would otherwise be usable for SSO login-CSRF flow seeding.
  const originDenied = originGuardDenied(req);
  if (originDenied) return originDenied;

  try {
    const body = await req.json().catch(() => ({}));
    const requestedTenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    // Resolve the target tenant.
    let tenantId = '';
    if (requestedTenantId) {
      tenantId = requestedTenantId;
    } else if (email) {
      const domain = email.split('@')[1];
      if (!domain) {
        return NextResponse.json(
          { error: 'البريد الإلكتروني غير صالح (Invalid email)', code: '400_INVALID_EMAIL' },
          { status: 400 },
        );
      }
      const found = await db.findTenantIdBySsoEmailDomain(domain);
      if (!found) {
        return NextResponse.json(
          {
            error: 'لا توجد مساحة عمل مهيأة لتسجيل الدخول الأحادي لهذا النطاق (No SSO workspace for this domain)',
            code: '404_NO_SSO_TENANT',
          },
          { status: 404 },
        );
      }
      tenantId = found;
    } else {
      return NextResponse.json(
        { error: 'tenantId أو email مطلوب (tenantId or email required)', code: '400_MISSING_INPUT' },
        { status: 400 },
      );
    }

    const config = await getTenantConfig(tenantId);
    const sso = config.ssoOidc;
    if (!sso?.enabled || !sso.issuer || !sso.clientId) {
      return NextResponse.json(
        {
          error: 'تسجيل الدخول الأحادي غير مفعل لهذه المساحة (SSO is not enabled for this workspace)',
          code: '403_SSO_DISABLED',
        },
        { status: 403 },
      );
    }

    const redirectUri = deriveRedirectUri(req);
    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePkce();
    const now = new Date().toISOString();

    await createSsoFlow({
      state,
      tenantId,
      codeVerifier,
      redirectUri,
      expiresAt: new Date(Date.now() + SSO_FLOW_TTL_MS).toISOString(),
      createdAt: now,
    });

    const authorizationUrl = await buildAuthorizationUrl({ config: sso, redirectUri, state, codeChallenge });
    return NextResponse.json({ authorizationUrl, state });
  } catch (err) {
    log.error('[sso/initiate] error:', (err as Error)?.message);
    return NextResponse.json(
      { error: 'تعذر بدء تسجيل الدخول الأحادي (Could not start SSO)', code: '500_SERVER_ERROR' },
      { status: 500 },
    );
  }
}
