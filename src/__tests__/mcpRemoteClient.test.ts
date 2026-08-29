import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Remote MCP client layer contract (@ai-sdk/mcp):
 * 1. The SSRF guard runs BEFORE any session is created — private/dummy
 *    endpoints are unreachable no matter what the tenant configured.
 * 2. Sessions perform a real initialize handshake via @ai-sdk/mcp, attach
 *    provisioned OAuth bearer tokens, and are ALWAYS closed afterwards.
 * 3. Tool results are extracted from standard CallToolResult content;
 *    protocol-level isError surfaces as a thrown error with the server's
 *    message.
 *
 * DNS note: the SSRF guard resolves hostnames before connecting. The
 * fictional public hosts used here (mcp.corp-gateway.org, …) do not exist,
 * so DNS is mocked to a public address — real DNS rejection (nip.io,
 * localtest.me, unresolvable) is covered in mcpNetSsrf.test.ts.
 */
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

async function loadRemoteClient(opts: { oauthToken?: string | null } = {}) {
  vi.resetModules();
  const createMCPClient = vi.fn();
  const getDecryptedToken = vi.fn(async () => opts.oauthToken ?? null);

  vi.doMock('@ai-sdk/mcp', () => ({ createMCPClient }));
  vi.doMock('@/lib/mcp/auth/oauth-manager', () => ({
    mcpOAuthManager: { getDecryptedToken },
  }));

  const mod = await import('../lib/mcp/remoteClient');
  return { mod, createMCPClient, getDecryptedToken };
}

function makeFakeClient(overrides: Partial<Record<'callTool' | 'listTools' | 'close', any>> = {}) {
  return {
    callTool: overrides.callTool ?? vi.fn(async () => ({ content: [] })),
    listTools: overrides.listTools ?? vi.fn(async () => ({ tools: [] })),
    close: overrides.close ?? vi.fn(async () => {}),
  };
}

describe('withRemoteMcpSession / callRemoteTool', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@ai-sdk/mcp');
    vi.doUnmock('@/lib/mcp/auth/oauth-manager');
    vi.resetModules();
  });

  it('rejects private-network endpoints before creating any session', async () => {
    const { mod, createMCPClient } = await loadRemoteClient();

    await expect(
      mod.callRemoteTool('tenant-1', { id: 's1', name: 'X', endpointUrl: 'http://169.254.169.254/meta' }, 'tool', {}),
    ).rejects.toThrow(/SSRF|أمنية/);

    expect(createMCPClient).not.toHaveBeenCalled();
  });

  it('performs a real session call, parses JSON text content, and closes the session', async () => {
    const fake = makeFakeClient({
      callTool: vi.fn(async () => ({ content: [{ type: 'text', text: '{"ok":true,"items":[1,2]}' }] })),
    });
    const { mod, createMCPClient } = await loadRemoteClient({ oauthToken: null });

    createMCPClient.mockImplementation(async () => fake);

    const payload = await mod.callRemoteTool(
      'tenant-1',
      { id: 's1', name: 'Corp Server', endpointUrl: 'https://mcp.corp-gateway.org/rpc' },
      'get_orders',
      { limit: 5 },
    );

    expect(payload).toEqual({ ok: true, items: [1, 2] });

    const config = createMCPClient.mock.calls[0][0];
    expect(config.transport.type).toBe('http');
    expect(config.transport.url).toBe('https://mcp.corp-gateway.org/rpc');

    const callArgs = fake.callTool.mock.calls[0][0];
    expect(callArgs.name).toBe('get_orders');
    expect(callArgs.arguments).toEqual({ limit: 5 });

    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it('attaches provisioned OAuth bearer tokens to the transport headers', async () => {
    const fake = makeFakeClient();
    const { mod, createMCPClient, getDecryptedToken } = await loadRemoteClient({ oauthToken: 'oauth-secret-1' });
    createMCPClient.mockImplementation(async () => fake);

    await mod.listRemoteTools('tenant-1', {
      id: 'srv-oauth',
      name: 'OAuth Server',
      endpointUrl: 'https://api.vendor-services.org/mcp',
      headers: { 'X-Custom': 'yes' },
    });

    expect(getDecryptedToken).toHaveBeenCalledWith('srv-oauth', 'tenant-1');
    const config = createMCPClient.mock.calls[0][0];
    expect(config.transport.headers.Authorization).toBe('Bearer oauth-secret-1');
    expect(config.transport.headers['X-Custom']).toBe('yes');
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it('closes the session even when the tool call fails', async () => {
    const fake = makeFakeClient({
      callTool: vi.fn(async () => {
        throw new Error('connection reset');
      }),
    });
    const { mod, createMCPClient } = await loadRemoteClient();
    createMCPClient.mockImplementation(async () => fake);

    await expect(
      mod.callRemoteTool('tenant-1', { id: 's1', name: 'X', endpointUrl: 'https://mcp.public-relay.org' }, 't', {}),
    ).rejects.toThrow('connection reset');

    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it('throws with the server-provided message on protocol-level tool errors', async () => {
    const fake = makeFakeClient({
      callTool: vi.fn(async () => ({
        isError: true,
        content: [{ type: 'text', text: 'invalid arguments for tool' }],
      })),
    });
    const { mod, createMCPClient } = await loadRemoteClient();
    createMCPClient.mockImplementation(async () => fake);

    await expect(
      mod.callRemoteTool('tenant-1', { id: 's1', name: 'X', endpointUrl: 'https://mcp.public-relay.org' }, 't', {}),
    ).rejects.toThrow('invalid arguments for tool');
  });

  it('listRemoteTools returns normalized tool names from the handshake session', async () => {
    const fake = makeFakeClient({
      listTools: vi.fn(async () => ({
        tools: [{ name: 'search_docs', description: 'Search docs' }, { name: 'create_ticket' }],
      })),
    });
    const { mod, createMCPClient } = await loadRemoteClient();
    createMCPClient.mockImplementation(async () => fake);

    const tools = await mod.listRemoteTools('tenant-1', {
      id: 's1',
      name: 'X',
      endpointUrl: 'https://mcp.public-relay.org',
    });

    expect(tools.map((t) => t.name)).toEqual(['search_docs', 'create_ticket']);
  });
});
