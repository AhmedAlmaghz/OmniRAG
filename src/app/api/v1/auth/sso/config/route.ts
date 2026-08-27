import { NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { serverErrorResponse } from '@/lib/api/safeError';
import { guardPermission } from '@/lib/auth/permissions';
import { getTenantConfig, updateTenantConfig, type SsoOidcConfig } from '@/lib/services/tenantConfigService';
import { encryptToken } from '@/lib/mcp/auth/encryption';

export const dynamic = 'force-dynamic';

/** Mask shown in place of the stored client secret on read. */
const SECRET_MASK = '••••••••';

/**
 * Per-tenant OIDC SSO configuration (Phase 5).
 * GET  — returns the current config with the client secret masked.
 * POST — saves the config. The client secret is encrypted at rest (AES-256-GCM).
 *        Sending the mask placeholder keeps the existing secret; sending an
 *        empty string clears it.
 */

function publicView(sso?: SsoOidcConfig) {
  if (!sso) {
    return { enabled: false, issuer: '', clientId: '', emailDomain: '', defaultRole: 'viewer', hasClientSecret: false };
  }
  return {
    enabled: Boolean(sso.enabled),
    issuer: sso.issuer || '',
    clientId: sso.clientId || '',
    emailDomain: sso.emailDomain || '',
    defaultRole: sso.defaultRole || 'viewer',
    hasClientSecret: Boolean(sso.clientSecret),
    clientSecret: sso.clientSecret ? SECRET_MASK : '',
  };
}

export const GET = withAuthAndRateLimit(async (_req, authCtx) => {
  try {
    const denied = await guardPermission(authCtx, 'settings:read');
    if (denied) return denied;
    const config = await getTenantConfig(authCtx.tenantId);
    return NextResponse.json({ success: true, sso: publicView(config.ssoOidc) });
  } catch (err) {
    return serverErrorResponse('sso config GET', err);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const denied = await guardPermission(authCtx, 'settings:write');
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const current = await getTenantConfig(authCtx.tenantId);
    const prev = current.ssoOidc;

    const issuer = typeof body.issuer === 'string' ? body.issuer.trim() : '';
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    const emailDomain = typeof body.emailDomain === 'string' ? body.emailDomain.trim().toLowerCase() : '';
    const enabled = Boolean(body.enabled);
    const defaultRole = body.defaultRole === 'admin' || body.defaultRole === 'editor' ? body.defaultRole : 'viewer';

    if (enabled && (!issuer || !clientId)) {
      return NextResponse.json(
        {
          error: 'تفعيل SSO يتطلب issuer و clientId (Enabling SSO requires issuer and clientId)',
          code: '400_INCOMPLETE',
        },
        { status: 400 },
      );
    }
    if (issuer && !/^https:\/\//i.test(issuer)) {
      return NextResponse.json(
        { error: 'issuer يجب أن يكون رابط HTTPS (issuer must be an HTTPS URL)', code: '400_BAD_ISSUER' },
        { status: 400 },
      );
    }

    // Resolve the client secret: mask → keep existing; empty → clear; else encrypt.
    let clientSecret = prev?.clientSecret;
    if (typeof body.clientSecret === 'string') {
      if (body.clientSecret === SECRET_MASK) {
        clientSecret = prev?.clientSecret;
      } else if (body.clientSecret.trim() === '') {
        clientSecret = undefined;
      } else {
        clientSecret = encryptToken(body.clientSecret.trim());
      }
    }

    const next: SsoOidcConfig = {
      enabled,
      issuer,
      clientId,
      clientSecret,
      emailDomain: emailDomain || undefined,
      defaultRole,
    };

    const saved = await updateTenantConfig(authCtx.tenantId, { ssoOidc: next });
    if (!saved) {
      return NextResponse.json(
        { error: 'تعذر حفظ إعدادات SSO (Could not save SSO config)', code: '500_SERVER_ERROR' },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: true, sso: publicView(saved.ssoOidc) });
  } catch (err) {
    return serverErrorResponse('sso config POST', err);
  }
});
