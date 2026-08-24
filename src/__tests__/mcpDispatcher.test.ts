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
 */

function makeDbMock(servers: any[] = []) {
  return {
    getMcpServers: vi.fn(async () => servers),
    addToolCall: vi.fn(async (_record?: any) => {}),
    addAuditLog: vi.fn(async (_entry?: any) => {}),
  };
}

async function loadDispatcher(dbMock: any) {
  vi.doMock('@/lib/storage/db', () => ({ db: dbMock }));
  return import('../lib/mcp/dispatcher');
}

const CTX = { tenantId: 'tenant-acme-01', userId: 'user-1' };

describe('MCP unified dispatcher', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-expect-error — install a fetch mock for remote-dispatch paths
    global.fetch = fetchMock;
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/storage/db');
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

  it('dispatches custom tools to a public remote MCP server over JSON-RPC', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: '{"custom":true,"value":42}' }] },
      }),
    });

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

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://remote.mcp.example.dev/rpc');
    expect(init.headers.Authorization).toBe('Bearer token-x');
    const body = JSON.parse(init.body);
    expect(body.method).toBe('tools/call');
    expect(body.params).toEqual({ name: 'my_custom_tool', arguments: { input: 'hi' } });
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
    expect(fetchMock).not.toHaveBeenCalled();
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
