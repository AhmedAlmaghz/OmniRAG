import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * MCP → AI SDK v7 tool bridge contract:
 * 1. Registry definitions become native AI SDK tools with zod input schemas
 *    derived from the registry's parameter spec (single source of truth).
 * 2. Tools flagged for human confirmation NEVER execute — they surface a
 *    pending-approval callback and return a marker payload instead.
 * 3. Auto-executed tools run through the unified MCP dispatcher and report
 *    back via onAutoExecuted with the real outcome.
 * 4. Custom tenant schemas (AI-generated / remote) are exposed as dynamic
 *    tools from their stored JSON schema.
 *
 * DNS note: fictional remote hosts get a mocked public DNS answer (the SSRF
 * guard resolves before connecting); real rejection is in mcpNetSsrf.test.ts.
 */
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

async function loadBridge() {
  vi.resetModules();
  // The dispatcher import inside aiSdkTools is type-only; stub it anyway so
  // no DB/network module graph loads.
  vi.doMock('@/lib/mcp/dispatcher', () => ({ executeMcpToolCall: vi.fn() }));
  return import('../lib/mcp/aiSdkTools');
}

describe('buildTenantMcpTools', () => {
  let runSafely: any;

  beforeEach(() => {
    vi.resetModules();
    runSafely = vi.fn();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/mcp/dispatcher');
    vi.resetModules();
  });

  it('exposes a registry tool with zod schema and executes through the dispatcher', async () => {
    const { buildTenantMcpTools } = await loadBridge();

    const onAutoExecuted = vi.fn();
    runSafely.mockResolvedValue({
      toolName: 'search_knowledge_base',
      result: { results: ['hit-1'] },
      latencyMs: 12,
      isError: false,
      source: 'registry',
      simulated: false,
    });

    const toolSet = buildTenantMcpTools(
      ['search_knowledge_base'],
      {},
      {
        tenantId: 'tenant-1',
        requireApprovalTools: [],
        runSafely: runSafely,
        onAutoExecuted,
      },
    );

    const t: any = toolSet.search_knowledge_base;
    expect(t).toBeDefined();
    expect(t.description).toContain('قاعدة المعرفة');

    const output = await t.execute({ query: 'سياسة الاسترجاع' });
    expect(JSON.parse(output)).toEqual({ results: ['hit-1'] });
    expect(runSafely).toHaveBeenCalledWith('search_knowledge_base', { query: 'سياسة الاسترجاع' });
    expect(onAutoExecuted).toHaveBeenCalledTimes(1);
    expect(onAutoExecuted.mock.calls[0][0].toolName).toBe('search_knowledge_base');
  });

  it('never executes approval-required tools — surfaces pending approval instead', async () => {
    const { buildTenantMcpTools, MCP_PENDING_APPROVAL_MARKER } = await loadBridge();

    const onPendingApproval = vi.fn();
    const toolSet = buildTenantMcpTools(
      ['slack_send_message'],
      {},
      {
        tenantId: 'tenant-1',
        requireApprovalTools: [],
        runSafely: runSafely,
        onPendingApproval,
      },
    );

    const t: any = toolSet.slack_send_message;
    const output = await t.execute({ channel: 'C123', message: 'hello' });

    const parsed = JSON.parse(output);
    expect(parsed[MCP_PENDING_APPROVAL_MARKER]).toBe(true);
    expect(parsed.toolName).toBe('slack_send_message');
    expect(parsed.inputParams).toEqual({ channel: 'C123', message: 'hello' });
    expect(onPendingApproval).toHaveBeenCalledWith('slack_send_message', {
      channel: 'C123',
      message: 'hello',
    });
    expect(runSafely).not.toHaveBeenCalled();
  });

  it('respects the per-server requireApproval list over the registry default', async () => {
    const { buildTenantMcpTools } = await loadBridge();

    // search_knowledge_base is read-only in the registry, but the tenant
    // explicitly requires confirmation for it.
    const toolSet = buildTenantMcpTools(
      ['search_knowledge_base'],
      {},
      {
        tenantId: 'tenant-1',
        requireApprovalTools: ['search_knowledge_base'],
        runSafely: runSafely,
      },
    );

    const t: any = toolSet.search_knowledge_base;
    const output = await t.execute({ query: 'x' });
    expect(JSON.parse(output).__mcpPendingApproval).toBe(true);
    expect(runSafely).not.toHaveBeenCalled();
  });

  it('reports failed executions with an explicit mcpToolFailed marker', async () => {
    const { buildTenantMcpTools } = await loadBridge();

    runSafely.mockResolvedValue({
      toolName: 'search_knowledge_base',
      result: { detail: 'down' },
      latencyMs: 5,
      isError: true,
      errorMessage: 'backend unreachable',
      source: 'registry',
      simulated: false,
    });

    const toolSet = buildTenantMcpTools(
      ['search_knowledge_base'],
      {},
      {
        tenantId: 'tenant-1',
        requireApprovalTools: [],
        runSafely: runSafely,
      },
    );

    const t: any = toolSet.search_knowledge_base;
    const parsed = JSON.parse(await t.execute({ query: 'x' }));
    expect(parsed.mcpToolFailed).toBe(true);
    expect(parsed.error).toContain('unreachable');
  });

  it('exposes unknown tools as dynamic custom tools requiring approval', async () => {
    const { buildTenantMcpTools } = await loadBridge();

    const onPendingApproval = vi.fn();
    const toolSet = buildTenantMcpTools(
      ['remote_custom_action'],
      {
        remote_custom_action: {
          toolName: 'remote_custom_action',
          description: 'أداة مخصصة لمستأجر محدد',
          properties: { target: { type: 'string', description: 'الهدف' } },
          required: ['target'],
        },
      },
      { tenantId: 'tenant-1', requireApprovalTools: [], runSafely, onPendingApproval },
    );

    const t: any = toolSet.remote_custom_action;
    expect(t.description).toContain('مخصصة');
    const parsed = JSON.parse(await t.execute({ target: 'x' }));
    expect(parsed.__mcpPendingApproval).toBe(true);
    expect(runSafely).not.toHaveBeenCalled();
  });
});
