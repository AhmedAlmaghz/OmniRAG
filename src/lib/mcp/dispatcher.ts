import { db } from '@/lib/storage/db';
import { MCPToolCall } from '@/lib/types/omnirag';
import { randomUUID } from 'crypto';
import { getToolDefinition } from './registry/tools';
import { assertPublicHttpUrl } from './net';

/**
 * Unified MCP tool dispatcher — the SINGLE execution path for every tool call
 * in the platform (chat agentic loop, protocol gateway, client-pool tests).
 *
 * Responsibilities:
 * 1. Resolve the tool against the central registry (with legacy aliases).
 * 2. Fall back to a real remote JSON-RPC dispatch when a non-registry tool is
 *    enabled on a tenant server with a public endpoint (custom/AI-generated
 *    tools registered through McpGateway).
 * 3. Enforce per-tool hard timeouts.
 * 4. Stamp simulation honesty (`simulated` / `__simulated`) onto results that
 *    don't declare it themselves.
 * 5. Persist every attempt as an MCPToolCall audit record (success OR failure)
 *    so /api/v1/mcp/calls reflects chat-driven calls, not only gateway calls.
 */

export interface ToolExecutionContext {
  tenantId: string;
  userId?: string;
  conversationId?: string;
}

export interface ToolExecutionOutcome {
  toolName: string;
  result: any;
  latencyMs: number;
  isError: boolean;
  errorMessage?: string;
  /** Where the execution actually happened. */
  source: 'registry' | 'remote-server';
  simulated: boolean;
}

export class McpToolNotExecutableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolNotExecutableError';
  }
}

const DEFAULT_TOOL_TIMEOUT_MS = 30000;

function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`تجاوز تنفيذ الأداة المهلة المحددة (${timeoutMs}ms)`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Ensures a tool result carries an explicit honesty stamp.
 * - Registry demo tools: anything that does not declare `simulated: false`
 *   itself is treated as simulated — the default must be conservative so demo
 *   data can never masquerade as live data.
 * - Remote-server dispatches (`defaultSimulated=false`): the round-trip to an
 *   external MCP server genuinely happened, so results are real unless the
 *   remote payload itself declares otherwise.
 */
function applySimulationStamp(result: any, defaultSimulated = true): any {
  if (result === null || result === undefined) return result;
  if (Array.isArray(result)) {
    return { __simulated: defaultSimulated, simulated: defaultSimulated, items: result };
  }
  if (typeof result === 'object') {
    const simulated = 'simulated' in result ? result.simulated !== false : defaultSimulated;
    return { ...result, simulated, __simulated: simulated };
  }
  return { __simulated: true, simulated: true, value: result };
}

/**
 * Real remote dispatch of a custom tool to its owning tenant server via the
 * stateless MCP JSON-RPC protocol. Only public http(s) endpoints are allowed;
 * seeded/dummy or private-network endpoints are rejected by the SSRF guard.
 */
async function dispatchToRemoteServer(
  server: { id: string; name: string; endpointUrl: string; headers?: Record<string, string> },
  toolName: string,
  args: Record<string, any>,
  timeoutMs: number,
): Promise<any> {
  const url = assertPublicHttpUrl(server.endpointUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.href, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(server.headers || {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `remote-${Date.now()}`,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });

    if (!res.ok) {
      throw new Error(`خادم MCP البعيد (${server.name}) أعاد HTTP ${res.status}`);
    }

    const payload = await res.json().catch(() => null);
    if (!payload || payload.error) {
      throw new Error(payload?.error?.message || `استجابة غير صالحة من خادم MCP البعيد (${server.name})`);
    }

    const content = payload.result?.content;
    if (Array.isArray(content) && content.length > 0 && content[0]?.type === 'text') {
      const text = content[0].text;
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    }
    return payload.result ?? payload;
  } finally {
    clearTimeout(timer);
  }
}

async function findOwningRemoteServer(tenantId: string, toolName: string) {
  const servers = await db.getMcpServers(tenantId);
  return servers.find(
    (s) =>
      s.enabledTools.includes(toolName) &&
      s.endpointUrl &&
      !s.endpointUrl.includes('.internal') &&
      !s.endpointUrl.includes('example.com') &&
      /^https?:\/\//i.test(s.endpointUrl),
  );
}

/**
 * Execute a tool call end-to-end and persist the audit record.
 * Throws McpToolNotExecutableError when no execution path exists (unknown tool
 * without a dispatchable server) — callers must surface this honestly instead
 * of fabricating success.
 */
export async function executeMcpToolCall(
  toolName: string,
  args: Record<string, any>,
  ctx: ToolExecutionContext,
): Promise<ToolExecutionOutcome> {
  if (!toolName || typeof toolName !== 'string') {
    throw new McpToolNotExecutableError('اسم أداة MCP مفقود أو غير صالح');
  }

  const def = getToolDefinition(toolName);
  const startTime = Date.now();

  let outcome: ToolExecutionOutcome;

  if (def) {
    try {
      const rawResult = await runWithTimeout(def.execute(args, ctx), def.timeoutMs || DEFAULT_TOOL_TIMEOUT_MS);
      const stamped = applySimulationStamp(rawResult);
      outcome = {
        toolName,
        result: stamped,
        latencyMs: Date.now() - startTime,
        isError: false,
        source: 'registry',
        simulated: stamped?.simulated !== false,
      };
    } catch (err: any) {
      outcome = {
        toolName,
        result: { success: false, error: err?.message || 'فشل تشغيل الأداة' },
        latencyMs: Date.now() - startTime,
        isError: true,
        errorMessage: err?.message || 'فشل تشغيل الأداة',
        source: 'registry',
        simulated: false,
      };
    }
  } else {
    // Not in the registry — try a real dispatch to the owning tenant server.
    let remoteResult: any;
    let remoteError: string | undefined;

    try {
      const server = await findOwningRemoteServer(ctx.tenantId, toolName);
      if (!server) {
        throw new McpToolNotExecutableError(
          `الأداة (${toolName}) غير معروفة في سجل أدوات OmniRAG ولا مرتبطة بخادم MCP خارجي قابل للتنفيذ`,
        );
      }
      remoteResult = await dispatchToRemoteServer(server, toolName, args, DEFAULT_TOOL_TIMEOUT_MS);
      const stamped = applySimulationStamp(remoteResult, false);
      outcome = {
        toolName,
        result: stamped,
        latencyMs: Date.now() - startTime,
        isError: false,
        source: 'remote-server',
        simulated: stamped?.simulated !== false,
      };
    } catch (err: any) {
      if (err instanceof McpToolNotExecutableError) throw err;
      remoteError = err?.message || 'فشل الاستدعاء على الخادم البعيد';
      outcome = {
        toolName,
        result: { success: false, error: remoteError },
        latencyMs: Date.now() - startTime,
        isError: true,
        errorMessage: remoteError,
        source: 'remote-server',
        simulated: false,
      };
    }
  }

  // Persist the attempt for the tenant's tool-call audit trail. Persistence
  // failures must never mask the actual execution outcome.
  try {
    const record: MCPToolCall = {
      id: `tc-${Date.now()}-${randomUUID().slice(0, 8)}`,
      tenantId: ctx.tenantId,
      conversationId: ctx.conversationId,
      scopedToolName: toolName,
      inputParams: args || {},
      outputResult: outcome.result,
      latencyMs: outcome.latencyMs,
      status: outcome.isError ? 'failed' : 'completed',
      hasSideEffect: def?.hasSideEffect || false,
      timestamp: new Date().toISOString(),
    };
    await db.addToolCall(record);

    if (outcome.isError) {
      await db.addAuditLog({
        id: `audit-${randomUUID()}`,
        tenantId: ctx.tenantId,
        actorId: ctx.userId || 'mcp_dispatcher',
        action: 'MCP_TOOL_FAILED',
        resourceType: 'mcp_tool',
        resourceId: toolName,
        status: 'error',
        details: `فشل تنفيذ أداة الـ MCP (${toolName}): ${outcome.errorMessage}`,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (persistErr) {
    console.warn('[MCP Dispatcher] failed to persist tool-call record:', persistErr);
  }

  return outcome;
}
