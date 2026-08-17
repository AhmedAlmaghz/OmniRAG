import { generatePKCEPair, PKCEPair } from './pkce';
import { encryptToken, decryptToken } from './encryption';
import { db } from '@/lib/storage/db';
import crypto from 'crypto';

export interface OAuthSessionState {
  serverId: string;
  tenantId: string;
  pkce: PKCEPair;
  resourceIndicator: string; // RFC 8707
  expectedIssuer: string; // RFC 9207
  redirectUri: string;
  // Optional provider metadata for the real token exchange. When present,
  // handleCallback performs a genuine HTTP POST to the token endpoint using
  // the stored code_verifier (RFC 7636). When absent, the flow falls back to
  // a clearly-labelled simulated token (kept for seeded/demo servers that
  // have no real provider wiring).
  tokenEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
  createdAt: number;
}

/**
 * Strictly compare two OAuth issuer URLs (RFC 9207). Substring matching is a
 * known phish — `https://slack.com` would falsely equal `https://slack.com.evil`.
 * We normalise by trimming a trailing slash and compare the full origins.
 */
function issuersMatch(expected: string, actual: string): boolean {
  try {
    const a = new URL(expected.trim().replace(/\/$/, ''));
    const b = new URL(actual.trim().replace(/\/$/, ''));
    // Compare origin (protocol + host + port) only. Path is intentionally
    // ignored because RFC 9207 issuers are origin-scoped.
    return a.origin.toLowerCase() === b.origin.toLowerCase();
  } catch {
    // If either side isn't a parseable URL, fall back to trimmed equality.
    return expected.trim().toLowerCase() === actual.trim().toLowerCase();
  }
}

/**
 * Perform the real OAuth 2.0 Authorization Code + PKCE token exchange (RFC 6749
 * §4.1.3 + RFC 7636). Returns the access/refresh tokens issued by the provider.
 */
async function exchangeCodeForToken(params: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  resourceIndicator?: string;
}): Promise<{ accessToken: string; refreshToken?: string; simulated: false }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
  });
  if (params.clientSecret) body.set('client_secret', params.clientSecret);
  if (params.resourceIndicator) body.set('resource', params.resourceIndicator);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(params.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`token endpoint returned ${res.status}: ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!json.access_token) {
      throw new Error('token endpoint response missing access_token');
    }
    return { accessToken: json.access_token, refreshToken: json.refresh_token, simulated: false };
  } finally {
    clearTimeout(timeout);
  }
}

export class MCPOAuthManager {
  /**
   * Initiate OAuth 2.0 PKCE flow with RFC 8707 Resource Indicator & RFC 9207 ISS.
   *
   * Flow state is persisted to the tenant's MCP server config (encrypted at
   * rest via the existing source-config crypto path is out of scope here; the
   * PKCE verifier is short-lived and rotated per flow, and is removed on
   * callback). This makes the flow survive serverless instance restarts,
   * which the previous in-memory Map did not.
   */
  async initiateFlow(params: {
    serverId: string;
    tenantId: string;
    authUrl: string;
    clientId: string;
    scopes: string[];
    resourceIndicator: string; // RFC 8707 (e.g., https://api.slack.com)
    expectedIssuer: string; // RFC 9207 (e.g., https://slack.com)
    redirectUri: string;
    tokenEndpoint?: string; // real provider token URL; omit for demo/simulated
    clientSecret?: string; // confidential-client secret; omit for public PKCE clients
  }): Promise<{ authorizationUrl: string; state: string }> {
    const pkce = generatePKCEPair();

    const sessionState: OAuthSessionState = {
      serverId: params.serverId,
      tenantId: params.tenantId,
      pkce,
      resourceIndicator: params.resourceIndicator,
      expectedIssuer: params.expectedIssuer,
      redirectUri: params.redirectUri,
      tokenEndpoint: params.tokenEndpoint,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      createdAt: Date.now(),
    };

    await this.persistPendingFlow(sessionState);

    // Build OAuth 2.0 Authorization URL per RFC 8707 & RFC 9207.
    // The EXTERNAL state encodes the tenantId so the unauthenticated callback
    // can recover the owning tenant without enumerating all tenants. Format:
    //   <tenantId>:<pkceState>
    // tenantId is not a secret (it appears in cookies/URLs/audit logs); the
    // random half remains the 128-bit CSRF/flow-binding secret.
    const externalState = `${params.tenantId}:${pkce.state}`;
    const url = new URL(params.authUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('scope', params.scopes.join(' '));
    url.searchParams.set('state', externalState);
    url.searchParams.set('code_challenge', pkce.codeChallenge);
    url.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);

    // RFC 8707 Resource Indicator
    if (params.resourceIndicator) {
      url.searchParams.set('resource', params.resourceIndicator);
    }

    return {
      authorizationUrl: url.toString(),
      state: externalState,
    };
  }

  /**
   * Split an external state back into (tenantId, pkceState). Returns undefined
   * if the format is unexpected.
   */
  private static parseExternalState(externalState: string): { tenantId: string; pkceState: string } | undefined {
    const sep = externalState.lastIndexOf(':');
    if (sep <= 0 || sep >= externalState.length - 1) return undefined;
    const tenantId = externalState.slice(0, sep);
    const pkceState = externalState.slice(sep + 1);
    if (!tenantId || !pkceState) return undefined;
    return { tenantId, pkceState };
  }

  /**
   * Persist a pending OAuth flow onto the tenant's MCP server config so it
   * survives instance restarts. The PKCE verifier is stored with a short TTL
   * (15 min) and removed on a successful callback or expiry sweep.
   */
  private async persistPendingFlow(state: OAuthSessionState): Promise<void> {
    const servers = await db.getMcpServers(state.tenantId).catch(() => []);
    const server = servers.find((s) => s.id === state.serverId);
    if (!server) return;
    if (!server.config) server.config = {};
    const pendingFlows: Record<string, OAuthSessionState> =
      (server.config.oauthPendingFlows as Record<string, OAuthSessionState>) || {};
    // Drop any expired flows (>15 min) before adding the new one.
    const now = Date.now();
    for (const [k, v] of Object.entries(pendingFlows)) {
      if (now - v.createdAt > 15 * 60 * 1000) delete pendingFlows[k];
    }
    pendingFlows[state.pkce.state] = state;
    server.config.oauthPendingFlows = pendingFlows;
    await db.addMcpServer(server).catch(() => {});
  }

  /**
   * Resolve a pending OAuth flow by `state` across a given tenant's servers,
   * then atomically remove it. Returns undefined if not found / expired.
   */
  async resolveAndConsumeFlow(tenantId: string, state: string): Promise<OAuthSessionState | undefined> {
    const servers = await db.getMcpServers(tenantId).catch(() => []);
    for (const server of servers) {
      const pendingFlows = (server.config?.oauthPendingFlows as Record<string, OAuthSessionState>) || {};
      const flow = pendingFlows[state];
      if (flow) {
        if (Date.now() - flow.createdAt > 15 * 60 * 1000) {
          delete pendingFlows[state];
          server.config = { ...server.config, oauthPendingFlows: pendingFlows };
          await db.addMcpServer(server).catch(() => {});
          return undefined; // expired
        }
        delete pendingFlows[state];
        server.config = { ...server.config, oauthPendingFlows: pendingFlows };
        await db.addMcpServer(server).catch(() => {});
        return flow;
      }
    }
    return undefined;
  }

  /**
   * Process OAuth 2.0 callback: validate state, iss (RFC 9207, STRICT), perform
   * the real token exchange when provider metadata is available (else a clearly
   * labelled simulated token for demo servers), and persist encrypted tokens.
   */
  async handleCallback(params: {
    code: string;
    state: string; // EXTERNAL state: "<tenantId>:<pkceState>"
    iss?: string; // RFC 9207 Issuer parameter sent by OAuth Server
  }): Promise<{ success: boolean; serverId: string; tenantId: string; message: string }> {
    const parsed = MCPOAuthManager.parseExternalState(params.state);
    if (!parsed) {
      throw new Error('صيغة قيمة الحالة (State) غير صالحة');
    }
    const session = await this.resolveAndConsumeFlow(parsed.tenantId, parsed.pkceState);

    if (!session) {
      throw new Error('جلسة الـ OAuth إما منتهية الصلاحية أو غير صالحة (State Mismatch / Expired)');
    }

    // RFC 9207 Issuer Validation — STRICT (no substring phish).
    if (params.iss && session.expectedIssuer && !issuersMatch(session.expectedIssuer, params.iss)) {
      await db.addAuditLog({
        id: `audit-${crypto.randomUUID()}`,
        tenantId: session.tenantId,
        actorId: 'mcp_oauth_manager',
        action: 'MCP_SERVER_OAUTH_ISS_MISMATCH',
        resourceType: 'mcp_server',
        resourceId: session.serverId,
        status: 'error',
        details: `فشل التحقق من المصدر RFC 9207: المتوقع (${session.expectedIssuer})، الفعلي (${params.iss})`,
        timestamp: new Date().toISOString(),
      });
      throw new Error(`فشل التحقق من المصدر RFC 9207: المتوقع (${session.expectedIssuer})، الفعلي (${params.iss})`);
    }

    // Token exchange: real HTTP POST when provider metadata is present,
    // otherwise a clearly-labelled simulated token (demo/seeded servers only).
    let accessToken: string;
    let refreshToken: string | undefined;
    let simulated = false;
    if (session.tokenEndpoint && session.clientId) {
      const real = await exchangeCodeForToken({
        tokenEndpoint: session.tokenEndpoint,
        clientId: session.clientId,
        clientSecret: session.clientSecret,
        redirectUri: session.redirectUri,
        code: params.code,
        codeVerifier: session.pkce.codeVerifier,
        resourceIndicator: session.resourceIndicator,
      });
      accessToken = real.accessToken;
      refreshToken = real.refreshToken;
    } else {
      // Simulated path — kept for servers that have no real provider wiring.
      // The token is crypto-random, never a real provider token, and flagged.
      accessToken = `mcp-sim-token-${crypto.randomUUID()}`;
      refreshToken = `mcp-sim-refresh-${crypto.randomUUID()}`;
      simulated = true;
    }

    const encryptedAccessToken = encryptToken(accessToken);
    const encryptedRefreshToken = refreshToken ? encryptToken(refreshToken) : undefined;

    // Update MCP server config in DB
    const servers = await db.getMcpServers(session.tenantId);
    const server = servers.find((s) => s.id === session.serverId);

    if (server) {
      server.authType = 'oauth2';
      server.status = 'healthy';

      if (!server.config) server.config = {};
      server.config.encryptedAccessToken = encryptedAccessToken;
      if (encryptedRefreshToken) server.config.encryptedRefreshToken = encryptedRefreshToken;
      server.config.resourceIndicator = session.resourceIndicator;
      server.config.oauthIssuer = session.expectedIssuer || params.iss;
      server.config.oauthTokenSimulated = simulated;

      await db.addMcpServer(server);

      await db.addAuditLog({
        id: `audit-${crypto.randomUUID()}`,
        tenantId: session.tenantId,
        actorId: 'mcp_oauth_manager',
        action: 'MCP_SERVER_OAUTH_SUCCESS',
        resourceType: 'mcp_server',
        resourceId: session.serverId,
        status: 'success',
        details: simulated
          ? `تم توثيق خادم الـ MCP (${server.name}) بنجاح باستخدام OAuth 2.0 PKCE و RFC 8707 [رمز محاكى — لا يوجد مزوّد حقيقي مربوط].`
          : `تم توثيق خادم الـ MCP (${server.name}) بنجاح باستخدام OAuth 2.0 PKCE و RFC 8707.`,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      success: true,
      serverId: session.serverId,
      tenantId: session.tenantId,
      message: simulated
        ? 'تم الربط عبر OAuth 2.0 PKCE (رمز محاكى — حدّد tokenEndpoint لتبديل حقيقي)'
        : 'تم الربط والتوثيق بنجاح عبر OAuth 2.0 PKCE',
    };
  }

  /**
   * Get decrypted token for active MCP server API calls
   */
  async getDecryptedToken(serverId: string, tenantId: string): Promise<string | null> {
    const servers = await db.getMcpServers(tenantId);
    const server = servers.find((s) => s.id === serverId);

    if (!server || !server.config?.encryptedAccessToken) {
      return null;
    }

    return decryptToken(server.config.encryptedAccessToken);
  }
}

export const mcpOAuthManager = new MCPOAuthManager();
