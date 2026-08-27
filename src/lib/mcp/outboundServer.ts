import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { db } from '../storage/db';
import { getToolDefinition } from './registry/tools';
import { executeMcpToolCall, McpToolNotExecutableError } from './dispatcher';

/**
 * Outbound MCP server (Phase 6) — exposes the tenant's tool surface to
 * standard MCP clients (Claude Desktop, Cursor, …) over the Streamable HTTP
 * transport from `@modelcontextprotocol/sdk`.
 *
 * Design:
 * - STATELESS: a fresh Server + transport is built per request
 *   (`sessionIdGenerator: undefined`), so it scales across serverless
 *   instances with no shared session store, and `enableJsonResponse` avoids
 *   holding SSE sockets open (Vercel-friendly).
 * - Auth is enforced by the route layer (Bearer API key or session cookie)
 *   BEFORE reaching this module; the resolved tenant scopes every lookup.
 * - Per-key tool restriction: API keys may carry an `mcpTools` whitelist.
 *   When present, both tools/list and tools/call are limited to it — a key
 *   can never invoke a tool it isn't allowed to see.
 * - Execution reuses the unified dispatcher (`executeMcpToolCall`), so audit
 *   records, timeouts, and the simulated-honesty stamping match the chat path.
 */

export interface OutboundMcpContext {
  tenantId: string;
  userId?: string;
  /** API-key tool whitelist; null/undefined = all tenant-enabled tools. */
  allowedTools?: string[] | null;
}

interface McpToolListEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/**
 * Aggregates the tenant's enabled tools across its registered MCP servers
 * (same aggregation the in-app gateway uses), applies the optional per-key
 * whitelist, and shapes them for `tools/list`.
 */
export async function buildOutboundToolList(ctx: OutboundMcpContext): Promise<McpToolListEntry[]> {
  const servers = await db.getMcpServers(ctx.tenantId);

  let targetTools: string[] = [];
  const customSchemas: Record<string, any> = {};
  servers.forEach((s) => {
    targetTools.push(...(s.enabledTools || []));
    if ((s as any).customToolSchemas) Object.assign(customSchemas, (s as any).customToolSchemas);
  });
  targetTools = Array.from(new Set(targetTools));

  // Per-key whitelist — intersect, never expand.
  if (Array.isArray(ctx.allowedTools) && ctx.allowedTools.length > 0) {
    const allowed = new Set(ctx.allowedTools);
    targetTools = targetTools.filter((t) => allowed.has(t));
  }

  return targetTools.map((toolName) => {
    const def = getToolDefinition(toolName);
    if (def) {
      return {
        name: def.name,
        description: def.description,
        inputSchema: def.parameters as Record<string, unknown>,
        // Standard MCP tool annotations derived from our honesty/side-effect
        // flags so clients can present confirmation UX appropriately.
        annotations: {
          readOnlyHint: !def.hasSideEffect,
          destructiveHint: def.hasSideEffect,
          openWorldHint: true,
          ...(def.simulated ? { title: `${def.name} (simulated)` } : {}),
        },
      };
    }

    const cs = customSchemas[toolName];
    if (cs) {
      return {
        name: cs.toolName || toolName,
        description: cs.description || `أداة مخصصة بالذكاء الاصطناعي (${toolName})`,
        inputSchema: {
          type: 'object',
          properties: cs.properties || {},
          required: cs.required || [],
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      };
    }

    return {
      name: toolName,
      description: `أداة MCP مخصصة برمجية: ${toolName}`,
      inputSchema: {
        type: 'object',
        properties: { input: { type: 'string', description: 'مدخل الأداة' } },
        required: [],
      },
    };
  });
}

/** Builds the per-request stateless MCP server bound to one tenant context. */
export function createOutboundMcpServer(ctx: OutboundMcpContext): Server {
  const server = new Server(
    { name: 'OmniRAG-MCP-Gateway', version: '3.0.0' },
    { capabilities: { tools: { listChanged: false } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await buildOutboundToolList(ctx);
    return { tools } as any;
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const toolArgs = (request.params.arguments || {}) as Record<string, unknown>;

    // Defense in depth: enforce the whitelist on call as well as list, so a
    // hand-crafted tools/call cannot reach a hidden tool.
    if (Array.isArray(ctx.allowedTools) && ctx.allowedTools.length > 0 && !ctx.allowedTools.includes(toolName)) {
      return {
        content: [
          { type: 'text', text: `الأداة (${toolName}) غير مصرح بها لهذا المفتاح (Tool not allowed for this key).` },
        ],
        isError: true,
      } as any;
    }

    try {
      const outcome = await executeMcpToolCall(toolName, toolArgs, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
      });

      if (outcome.isError) {
        return {
          content: [{ type: 'text', text: outcome.errorMessage || `فشل تنفيذ الأداة (${toolName})` }],
          isError: true,
        } as any;
      }

      return {
        content: [
          {
            type: 'text',
            text: typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result, null, 2),
          },
        ],
        isError: false,
      } as any;
    } catch (err: any) {
      const message =
        err instanceof McpToolNotExecutableError
          ? err.message
          : `فشل تنفيذ أداة الـ MCP (${toolName}): ${err?.message || err}`;
      return { content: [{ type: 'text', text: message }], isError: true } as any;
    }
  });

  return server;
}

/**
 * Handles one Streamable HTTP request end-to-end: builds a stateless server,
 * connects a Web-standard transport, and returns the transport's Response.
 * Never throws for protocol-level problems — the transport produces proper
 * JSON-RPC error responses itself.
 */
export async function handleOutboundMcpRequest(req: Request, ctx: OutboundMcpContext): Promise<Response> {
  const server = createOutboundMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless mode — no session id, safe behind any load balancer.
    sessionIdGenerator: undefined,
    // JSON responses instead of SSE: serverless-friendly and fully supported
    // by Streamable HTTP clients.
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } finally {
    // Best-effort teardown — the per-request server holds no persistent state.
    server.close().catch(() => {});
  }
}
