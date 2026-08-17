import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regression guard for the Phase 4 MCP OAuth hardening:
 * 1. Strict origin equality for the RFC 9207 issuer (no substring phish —
 *    `https://slack.com` must NOT match `https://slack.com.evil`).
 * 2. External state encodes `tenantId:pkceState` so the unauthenticated callback
 *    can recover the owning tenant without enumerating tenants.
 * 3. When `tokenEndpoint`/`clientId` are configured, the callback performs a
 *    REAL HTTP POST to the provider's token endpoint using the stored PKCE
 *    verifier (RFC 7636), and persists the provider-issued token.
 * 4. When no token endpoint is configured, the flow falls back to a clearly
 *    labelled simulated token.
 *
 * The manager is exercised with a mocked db + global fetch.
 */

function makeServer(id: string, tenantId: string, config: Record<string, any> = {}) {
  return {
    id,
    tenantId,
    name: 'Slack Gateway',
    description: '',
    endpointUrl: 'https://slack.com/api',
    protocolVersion: '2026-07-28' as const,
    sandboxTier: 'T1_LIMITED' as const,
    enabledTools: [],
    requireConfirmationTools: [],
    status: 'degraded' as const,
    latencyMs: 0,
    lastChecked: '',
    authType: 'none' as const,
    config,
  };
}

describe('MCP OAuth manager — Phase 4 hardening', () => {
  let serversByTenant: Record<string, any[]>;
  let addedServers: any[];
  let auditLogs: any[];
  let fetchMock: ReturnType<typeof vi.fn>;

  function loadManager() {
    vi.doMock('@/lib/storage/db', () => ({
      db: {
        getMcpServers: vi.fn(async (tenantId: string) => serversByTenant[tenantId] ?? []),
        addMcpServer: vi.fn(async (s: any) => {
          addedServers.push(s);
          // Reflect the write back into serversByTenant so subsequent reads see it.
          const arr = serversByTenant[s.tenantId] ?? (serversByTenant[s.tenantId] = []);
          const idx = arr.findIndex((x) => x.id === s.id);
          if (idx >= 0) arr[idx] = s;
          else arr.push(s);
        }),
        addAuditLog: vi.fn(async (e: any) => {
          auditLogs.push(e);
        }),
      },
    }));
    return import('../lib/mcp/auth/oauth-manager').then((m) => m.mcpOAuthManager);
  }

  beforeEach(() => {
    serversByTenant = {};
    addedServers = [];
    auditLogs = [];
    fetchMock = vi.fn();
    // @ts-expect-error — install a fetch mock for the token exchange path
    global.fetch = fetchMock;

    vi.resetModules();
    // The encryption module reads MCP_OAUTH_ENCRYPTION_KEY / NODE_ENV at import;
    // ensure a dev key is available so encryptToken doesn't throw in tests.
    if (!process.env.MCP_OAUTH_ENCRYPTION_KEY)
      process.env.MCP_OAUTH_ENCRYPTION_KEY = 'test-encryption-key-32-bytes-aaaaaa';
  });

  afterEach(() => {
    vi.doUnmock('@/lib/storage/db');
    vi.resetModules();
  });

  it('encodes tenantId into the external state and round-trips it', async () => {
    serversByTenant['tenant-acme-01'] = [makeServer('srv-1', 'tenant-acme-01')];
    const mgr = await loadManager();

    const flow = await mgr.initiateFlow({
      serverId: 'srv-1',
      tenantId: 'tenant-acme-01',
      authUrl: 'https://slack.com/oauth/v2/authorize',
      clientId: 'cid',
      scopes: ['chat:write'],
      resourceIndicator: 'https://api.slack.com',
      expectedIssuer: 'https://slack.com',
      redirectUri: 'https://app.example.com/api/v1/mcp/oauth/callback',
    });
    expect(flow.state).toBe(
      `tenant-acme-01:${expect.any(String)}`.replace(expect.any(String), flow.state.split(':')[1]),
    );
    expect(flow.state.startsWith('tenant-acme-01:')).toBe(true);
    expect(flow.authorizationUrl).toContain(`state=tenant-acme-01%3A`);
  });

  it('rejects a substring issuer phish with strict origin equality', async () => {
    const server = makeServer('srv-2', 'tenant-acme-01');
    serversByTenant['tenant-acme-01'] = [server];
    const mgr = await loadManager();

    const flow = await mgr.initiateFlow({
      serverId: 'srv-2',
      tenantId: 'tenant-acme-01',
      authUrl: 'https://slack.com/oauth/v2/authorize',
      clientId: 'cid',
      scopes: ['chat:write'],
      resourceIndicator: 'https://api.slack.com',
      expectedIssuer: 'https://slack.com',
      redirectUri: 'https://app.example.com/api/v1/mcp/oauth/callback',
    });

    // Attacker issuer shares the expected issuer as a substring but is a
    // different origin. Must be rejected.
    await expect(
      mgr.handleCallback({
        code: 'authcode123',
        state: flow.state,
        iss: 'https://slack.com.evil.tld',
      }),
    ).rejects.toThrow(/RFC 9207/);

    // And an audit log entry must have been written for the mismatch.
    expect(auditLogs.some((a) => a.action === 'MCP_SERVER_OAUTH_ISS_MISMATCH')).toBe(true);
  });

  it('performs a REAL token exchange when tokenEndpoint is configured', async () => {
    const server = makeServer('srv-3', 'tenant-acme-01');
    serversByTenant['tenant-acme-01'] = [server];
    const mgr = await loadManager();

    const providerAccessToken = 'real-provider-access-token-xyz';
    const providerRefreshToken = 'real-provider-refresh-token-abc';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: providerAccessToken, refresh_token: providerRefreshToken }),
      text: async () => '',
    });

    const flow = await mgr.initiateFlow({
      serverId: 'srv-3',
      tenantId: 'tenant-acme-01',
      authUrl: 'https://slack.com/oauth/v2/authorize',
      clientId: 'cid-3',
      clientSecret: 'secret-3',
      scopes: ['chat:write'],
      resourceIndicator: 'https://api.slack.com',
      expectedIssuer: 'https://slack.com',
      redirectUri: 'https://app.example.com/api/v1/mcp/oauth/callback',
      tokenEndpoint: 'https://slack.com/api/oauth.token',
    });

    const result = await mgr.handleCallback({
      code: 'authcode-real',
      state: flow.state,
      iss: 'https://slack.com',
    });

    expect(result.success).toBe(true);
    // The fetch must have POSTed to the real token endpoint with the PKCE verifier.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://slack.com/api/oauth.token');
    expect(init.method).toBe('POST');
    const body = String(init.body);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=authcode-real');
    expect(body).toContain('client_id=cid-3');
    expect(body).toContain('code_verifier=');
    expect(body).toContain('client_secret=secret-3');
    expect(body).toContain('resource=https%3A%2F%2Fapi.slack.com');

    // The persisted server config must hold the ENCRYPTED real token (not the
    // simulated prefix) and flag the token as non-simulated.
    const persisted = addedServers.find((s) => s.id === 'srv-3');
    expect(persisted).toBeDefined();
    expect(persisted.config.encryptedAccessToken).not.toContain('mcp-sim-');
    expect(persisted.config.oauthTokenSimulated).toBe(false);
    // And a success audit log was written (not the mismatch one).
    expect(auditLogs.some((a) => a.action === 'MCP_SERVER_OAUTH_SUCCESS')).toBe(true);
  });

  it('falls back to a clearly-labelled simulated token when no tokenEndpoint is set', async () => {
    const server = makeServer('srv-4', 'tenant-acme-01');
    serversByTenant['tenant-acme-01'] = [server];
    const mgr = await loadManager();

    const flow = await mgr.initiateFlow({
      serverId: 'srv-4',
      tenantId: 'tenant-acme-01',
      authUrl: 'https://slack.com/oauth/v2/authorize',
      clientId: 'cid-4',
      scopes: ['chat:write'],
      resourceIndicator: 'https://api.slack.com',
      expectedIssuer: 'https://slack.com',
      redirectUri: 'https://app.example.com/api/v1/mcp/oauth/callback',
    });

    const result = await mgr.handleCallback({
      code: 'authcode',
      state: flow.state,
      iss: 'https://slack.com',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('محاكى');
    expect(fetchMock).not.toHaveBeenCalled();
    const persisted = addedServers.find((s) => s.id === 'srv-4');
    expect(persisted.config.oauthTokenSimulated).toBe(true);
  });

  it('rejects a callback with an unknown / expired state', async () => {
    serversByTenant['tenant-acme-01'] = [makeServer('srv-5', 'tenant-acme-01')];
    const mgr = await loadManager();

    await expect(
      mgr.handleCallback({
        code: 'c',
        state: 'tenant-acme-01:nonexistent-state',
        iss: 'https://slack.com',
      }),
    ).rejects.toThrow(/State Mismatch|Expired|جلسة/);
  });
});
