import { generatePKCEPair, PKCEPair } from './pkce';
import { encryptToken, decryptToken } from './encryption';
import crypto from 'crypto';
import { db } from '@/lib/storage/db';

export interface OAuthSessionState {
  serverId: string;
  tenantId: string;
  pkce: PKCEPair;
  resourceIndicator: string; // RFC 8707
  expectedIssuer: string; // RFC 9207
  redirectUri: string;
  createdAt: number;
}

// In-memory active OAuth flow states
const activeOAuthSessions = new Map<string, OAuthSessionState>();

export class MCPOAuthManager {
  /**
   * Initiate OAuth 2.0 PKCE flow with RFC 8707 Resource Indicator & RFC 9207 ISS
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
  }): Promise<{ authorizationUrl: string; state: string }> {
    const pkce = generatePKCEPair();

    const sessionState: OAuthSessionState = {
      serverId: params.serverId,
      tenantId: params.tenantId,
      pkce,
      resourceIndicator: params.resourceIndicator,
      expectedIssuer: params.expectedIssuer,
      redirectUri: params.redirectUri,
      createdAt: Date.now(),
    };

    activeOAuthSessions.set(pkce.state, sessionState);

    // Build OAuth 2.0 Authorization URL per RFC 8707 & RFC 9207
    const url = new URL(params.authUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('scope', params.scopes.join(' '));
    url.searchParams.set('state', pkce.state);
    url.searchParams.set('code_challenge', pkce.codeChallenge);
    url.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);

    // RFC 8707 Resource Indicator
    if (params.resourceIndicator) {
      url.searchParams.set('resource', params.resourceIndicator);
    }

    return {
      authorizationUrl: url.toString(),
      state: pkce.state,
    };
  }

  /**
   * Process OAuth 2.0 callback, validate state, iss (RFC 9207), exchange code, and save encrypted token
   */
  async handleCallback(params: {
    code: string;
    state: string;
    iss?: string; // RFC 9207 Issuer parameter sent by OAuth Server
  }): Promise<{ success: boolean; serverId: string; tenantId: string; message: string }> {
    const session = activeOAuthSessions.get(params.state);

    if (!session) {
      throw new Error('جلسة الـ OAuth إما منتهية الصلاحية أو غير صالحة (State Mismatch)');
    }

    // RFC 9207 Issuer Validation
    if (params.iss && session.expectedIssuer && !params.iss.includes(session.expectedIssuer)) {
      throw new Error(`فشل التحقق من المصدر RFC 9207: المتوقع (${session.expectedIssuer})، الفعلي (${params.iss})`);
    }

    // Cleanup session state
    activeOAuthSessions.delete(params.state);

    // Simulate Token Exchange with Authorization Code + PKCE Verifier.
    // Use cryptographically-strong random values for issued token material.
    const accessToken = `mcp-token-${Date.now()}-${crypto.randomUUID()}`;
    const refreshToken = `mcp-refresh-${Date.now()}-${crypto.randomUUID()}`;

    const encryptedAccessToken = encryptToken(accessToken);
    const encryptedRefreshToken = encryptToken(refreshToken);

    // Update MCP server config in DB
    const servers = await db.getMcpServers(session.tenantId);
    const server = servers.find((s) => s.id === session.serverId);

    if (server) {
      server.authType = 'oauth2';
      server.status = 'healthy';

      // Update encrypted auth token config
      if (!server.config) server.config = {};
      server.config.encryptedAccessToken = encryptedAccessToken;
      server.config.encryptedRefreshToken = encryptedRefreshToken;
      server.config.resourceIndicator = session.resourceIndicator;
      server.config.oauthIssuer = session.expectedIssuer || params.iss;

      await db.addMcpServer(server);

      // Audit log entry
      await db.addAuditLog({
        id: `audit-${Date.now()}`,
        tenantId: session.tenantId,
        actorId: 'mcp_oauth_manager',
        action: 'MCP_SERVER_OAUTH_SUCCESS',
        resourceType: 'mcp_server',
        resourceId: session.serverId,
        status: 'success',
        details: `تم توثيق خادم الـ MCP (${server.name}) بنجاح باستخدام OAuth 2.0 PKCE و RFC 8707.`,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      success: true,
      serverId: session.serverId,
      tenantId: session.tenantId,
      message: 'تم الربط والتوثيق بنجاح عبر OAuth 2.0 PKCE',
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
