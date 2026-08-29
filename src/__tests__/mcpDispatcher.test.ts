import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unified MCP dispatcher contract:
 * 1. Registry tools execute and persist an MCPToolCall audit record.
 * 2. Failures persist as failed records + audit log instead of vanishing.
 * 3. Unknown tools throw honestly when no dispatchable server exists — no more
 *    fabricated "تم تشغيل الأداة المخصصة بنجاح" results.
 * 4. Custom tools on servers with PUBLIC endpoints are dispatched remotely via
 *    the stateless JSON-RPC protocol; private/dummy endpoints are rejected by
 *    the SSRF guard.
 *
 * DNS note: fictional public hosts (mcp.public-relay.org) get a mocked public
 * DNS answer here; real DNS rejection is covered in mcpNetSsrf.test.ts.
 */
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

function makeDbMock(servers: any[] = []) {
  return {
    getMcpServers: vi.fn(async () => servers),
    addToolCall: vi.fn(async (_record?: any) => {}),
    addAuditLog: vi.fn(async (_entry?: any) => {}),
  };
}

async function loadDispatcher(dbMock: any) {
  vi.doMock('@/lib/storage/db', () => ({ db: dbMock }));
  // Remote dispatch now goes through @ai-sdk/mcp client sessions.
  vi.doMock('@ai-sdk/mcp', () => ({ createMCPClient: createMCPClientMock }));
  return import('../lib/mcp/dispatcher');
}

const CTX = { tenantId: 'tenant-acme-01', userId: 'user-1' };

// Module-level so the vi.doMock factory can always resolve it.
const createMCPClientMock = vi.fn();

describe('MCP unified dispatcher', () => {
  beforeEach(() => {
    createMCPClientMock.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/storage/db');
    vi.doUnmock('@ai-sdk/mcp');
    vi.resetModules();
    delete process.env.TAVILY_API_KEY;
    delete process.env.SERPER_API_KEY;
    delete process.env.BRAVE_API_KEY;
  });

  it('executes a registry tool and persists a completed tool-call record', async () => {
    const dbMock = makeDbMock();
    const d = await loadDispatcher(dbMock);

    const outcome = await d.executeMcpToolCall('get_table_schema', { tableName: 'users_log' }, CTX);

    expect(outcome.isError).toBe(false);
    expect(outcome.source).toBe('registry');
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.tableName).toBe('users_log');
    // Static demo tools must be stamped as simulated.
    expect(outcome.result.simulated).toBe(true);
    expect(outcome.result.__simulated).toBe(true);

    expect(dbMock.addToolCall).toHaveBeenCalledTimes(1);
    const record = dbMock.addToolCall.mock.calls[0][0];
    expect(record.scopedToolName).toBe('get_table_schema');
    expect(record.status).toBe('completed');
    expect(record.tenantId).toBe(CTX.tenantId);
  });

  it('converts tool-internal failures into failed outcomes + audit log', async () => {
    const dbMock = makeDbMock();
    const d = await loadDispatcher(dbMock);

    const outcome = await d.executeMcpToolCall('external_postgres_query', { sqlQuery: 'DROP TABLE users' }, CTX);

    expect(outcome.isError).toBe(true);
    expect(outcome.result.error).toMatch(/SELECT/);
    expect(dbMock.addToolCall).toHaveBeenCalledTimes(1);
    expect(dbMock.addToolCall.mock.calls[0][0].status).toBe('failed');
    expect(dbMock.addAuditLog).toHaveBeenCalledTimes(1);
  });

  it('throws honestly for unknown tools with no dispatchable server', async () => {
    const dbMock = makeDbMock();
    const d = await loadDispatcher(dbMock);

    await expect(d.executeMcpToolCall('hallucinated_tool_x', {}, CTX)).rejects.toThrow(/غير معروفة/);
  });

  it('dispatches custom tools to a public remote MCP server over a real client session', async () => {
    const fakeClient = {
      callTool: vi.fn(async (_args: any) => ({
        content: [{ type: 'text', text: '{"custom":true,"value":42}' }],
      })),
      listTools: vi.fn(async () => ({ tools: [] })),
      close: vi.fn(async () => {}),
    };
    createMCPClientMock.mockResolvedValue(fakeClient);

    const server = {
      id: 'srv-remote',
      tenantId: CTX.tenantId,
      name: 'Remote Tools',
      endpointUrl: 'https://remote.mcp.example.dev/rpc',
      enabledTools: ['my_custom_tool'],
      headers: { Authorization: 'Bearer token-x' },
    };
    const dbMock = makeDbMock([server]);
    const d = await loadDispatcher(dbMock);

    const outcome = await d.executeMcpToolCall('my_custom_tool', { input: 'hi' }, CTX);

    expect(outcome.isError).toBe(false);
    expect(outcome.source).toBe('remote-server');
    // A real round-trip to a live remote server is NOT simulated by default.
    expect(outcome.result.simulated).toBe(false);
    expect(outcome.result.__simulated).toBe(false);
    expect(outcome.result.custom).toBe(true);
    expect(outcome.result.value).toBe(42);

    // Full protocol handshake against the right endpoint, carrying headers.
    const config = createMCPClientMock.mock.calls[0][0];
    expect(config.transport.type).toBe('http');
    expect(config.transport.url).toBe('https://remote.mcp.example.dev/rpc');
    expect(config.transport.headers.Authorization).toBe('Bearer token-x');

    const callArgs = fakeClient.callTool.mock.calls[0][0];
    expect(callArgs.name).toBe('my_custom_tool');
    expect(callArgs.arguments).toEqual({ input: 'hi' });

    // Session hygiene: always closed.
    expect(fakeClient.close).toHaveBeenCalledTimes(1);
  });

  it('refuses remote dispatch to private/metadata endpoints (SSRF guard)', async () => {
    const server = {
      id: 'srv-evil',
      tenantId: CTX.tenantId,
      name: 'Metadata Prober',
      endpointUrl: 'http://169.254.169.254/latest/meta-data/',
      enabledTools: ['steal_credentials'],
      headers: {},
    };
    const dbMock = makeDbMock([server]);
    const d = await loadDispatcher(dbMock);

    const outcome = await d.executeMcpToolCall('steal_credentials', {}, CTX);

    expect(outcome.isError).toBe(true);
    // Guard fires BEFORE any MCP session is opened.
    expect(createMCPClientMock).not.toHaveBeenCalled();
    expect(dbMock.addToolCall.mock.calls[0][0].status).toBe('failed');
  });

  it('reports web_live_search as honestly-not-configured when no provider key exists', async () => {
    const dbMock = makeDbMock();
    const d = await loadDispatcher(dbMock);

    const outcome = await d.executeMcpToolCall('web_live_search', { query: 'test' }, CTX);

    expect(outcome.result.simulated).toBe(true);
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.reason).toMatch(/TAVILY_API_KEY|SERPER_API_KEY|BRAVE_API_KEY/);
  });
});
