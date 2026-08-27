import { NextRequest, NextResponse } from 'next/server';
import type { SessionRecord } from '../types/omnirag';
import { db } from '../storage/db';
import { getSessionTokenFromRequest } from './session';
import { extractBearerApiKey, hashApiKey, isApiKeyActive } from './apiKeys';
import { checkKeyedRateLimit } from '../security/rateLimiter';

export interface AuthenticatedContext {
  authenticated: boolean;
  tenantId: string;
  userId: string;
  userEmail?: string;
  /**
   * 'session' = verified opaque session row (browser cookie).
   * 'apiKey'  = verified tenant API key (Authorization: Bearer …) for
   *             headless/external clients. Both yield a tenant identity.
   */
  authMethod: 'session' | 'apiKey';
  /** Present when authMethod === 'apiKey'; scopes granted to the key. */
  apiKeyScopes?: string[];
  /** Present when authMethod === 'apiKey'; the key row id for auditing. */
  apiKeyId?: string;
  /**
   * Present when authMethod === 'apiKey'; outbound MCP tool whitelist.
   * null/undefined = all tenant-enabled tools; array = only listed tools.
   */
  apiKeyMcpTools?: string[] | null;
  response?: NextResponse;
}

function deny(status: 401 | 403, code: string, reason: string): AuthenticatedContext {
  return {
    authenticated: false,
    tenantId: '',
    userId: '',
    authMethod: 'session',
    response: NextResponse.json({ error: reason, code }, { status }),
  };
}

/**
 * Attempts to authenticate via a tenant API key carried as
 * `Authorization: Bearer omnirag_live_…`. Returns null when the request does
 * not present an OmniRAG-shaped Bearer key (so the cookie path can run), or a
 * context (authenticated or denied) when it does.
 *
 * Verification hashes the presented key and looks up the hash — the plaintext
 * key is never stored. Revoked/expired keys are rejected; a successful match
 * best-effort stamps last_used_at without blocking the request.
 */
async function verifyApiKeyAuth(req: NextRequest): Promise<AuthenticatedContext | null> {
  const plainKey = extractBearerApiKey(req);
  if (!plainKey) return null; // Not an API-key request — fall through to session.

  let keyHash: string;
  try {
    keyHash = hashApiKey(plainKey);
  } catch {
    return deny(401, '401_BAD_API_KEY', 'مفتاح API غير صالح (Invalid API key).');
  }

  let record;
  try {
    record = await db.getApiKeyByHash(keyHash);
  } catch (error) {
    console.warn('[apiAuth] API key lookup failed — rejecting request:', (error as Error)?.message);
    return deny(401, '401_API_KEY_LOOKUP_FAILED', 'تعذّر التحقق من مفتاح API (Could not verify API key).');
  }

  if (!record) {
    return deny(401, '401_INVALID_API_KEY', 'مفتاح API غير معروف أو ملغى (Unknown or revoked API key).');
  }

  if (!isApiKeyActive(record)) {
    return deny(401, '401_API_KEY_INACTIVE', 'مفتاح API منتهي أو ملغى (Expired or revoked API key).');
  }

  // Per-key ceiling (requests/minute) — bucketed by key id so the limit is
  // independent of client IP and applies uniformly across all routes.
  if (typeof record.rateLimitPerMinute === 'number' && record.rateLimitPerMinute > 0) {
    const rl = checkKeyedRateLimit(`apikey:${record.id}`, record.rateLimitPerMinute, 60000);
    if (!rl.success) {
      return {
        authenticated: false,
        tenantId: '',
        userId: '',
        authMethod: 'apiKey',
        response: NextResponse.json(
          {
            error: 'تم تجاوز حد الطلبات المسموح لهذا المفتاح (API key rate limit exceeded).',
            code: '429_API_KEY_RATE_LIMITED',
            retryAfterMs: rl.retryAfterMs,
          },
          {
            status: 429,
            headers: { 'Retry-After': Math.ceil((rl.retryAfterMs || 60000) / 1000).toString() },
          },
        ),
      };
    }
  }

  // Telemetry only — never fail auth over a last-used stamp.
  db.touchApiKeyLastUsed(record.id, new Date().toISOString()).catch(() => {});

  return {
    authenticated: true,
    tenantId: record.tenantId,
    userId: record.userId,
    authMethod: 'apiKey',
    apiKeyScopes: record.scopes || [],
    apiKeyId: record.id,
    apiKeyMcpTools: record.mcpTools ?? null,
  };
}

/**
 * Validates API request authorization.
 *
 * Two credential paths, checked in order:
 *  1. `Authorization: Bearer omnirag_live_…` — tenant API key for headless /
 *     external systems (REST clients, MCP clients, automation). Verified by
 *     SHA-256 hash lookup against the `api_keys` table.
 *  2. httpOnly session cookie — the browser path. The opaque token is looked
 *     up verbatim in the `sessions` table; revocation is immediate (row delete).
 *
 * There is no demo/bypass path and no signed-token (JWT) fallback. Missing or
 * invalid credentials on BOTH paths are rejected with 401. The resolved
 * `tenant_id` scopes all downstream DB queries.
 */
export async function verifyApiAuth(req: NextRequest): Promise<AuthenticatedContext> {
  // 1. API key (Bearer) — headless/external access.
  const apiKeyCtx = await verifyApiKeyAuth(req);
  if (apiKeyCtx) return apiKeyCtx;

  // 2. Session cookie — browser access.
  const token = getSessionTokenFromRequest(req);
  if (!token) {
    return deny(401, '401_NO_SESSION', 'المصادقة مطلوبة: لا توجد جلسة صالحة أو مفتاح API (No active session).');
  }

  let session: SessionRecord | undefined;
  try {
    session = await db.getSession(token);
  } catch (error) {
    console.warn('[apiAuth] Session lookup failed — rejecting request:', (error as Error)?.message);
    return deny(401, '401_SESSION_LOOKUP_FAILED', 'تعذّر التحقق من الجلسة (Could not verify session).');
  }

  if (!session) {
    return deny(401, '401_INVALID_SESSION', 'الجلسة غير صالحة أو منتهية (Invalid or expired session).');
  }

  // Enforce expiry even if cleanup hasn't run.
  const expiresAt = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    // Best-effort purge; ignore errors.
    db.deleteSession(token).catch(() => {});
    return deny(401, '401_EXPIRED_SESSION', 'انتهت صلاحية الجلسة (Session expired).');
  }

  return {
    authenticated: true,
    tenantId: session.tenantId,
    userId: session.userId,
    authMethod: 'session',
  };
}
