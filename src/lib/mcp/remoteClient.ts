import { createLogger } from '@/lib/logging/logger';

const log = createLogger('LibMcpRemoteClient');

import { createMCPClient, type CallToolResult, type MCPClient } from '@ai-sdk/mcp';
import { assertPublicHttpUrl } from './net';
import { mcpOAuthManager } from './auth/oauth-manager';
import { decryptToken } from './auth/encryption';

/**
 * Unified remote-MCP client layer on top of the official AI SDK MCP package
 * (`@ai-sdk/mcp`).
 *
 * Replaces the previous hand-rolled one-shot `tools/call` fetch, which skipped
 * the MCP initialize handshake entirely — many real servers reject such
 * calls. Sessions now negotiate protocol version and capabilities properly,
 * support Streamable HTTP / SSE transports, attach tenant OAuth bearer tokens,
 * and are always closed again (even on failure).
 *
 * The SSRF guard still runs BEFORE any http(s) connection attempt: only public
 * http(s) endpoints are reachable. Local stdio servers (self-hosted only)
 * spawn a child process instead and therefore bypass the URL guard by design —
 * they are gated behind the self-hosted flag and operator-provided commands.
 */

export interface RemoteMcpServerRef {
  id: string;
  name: string;
  endpointUrl: string;
  headers?: Record<string, string>;
  transportType?: 'http' | 'sse' | 'stdio' | 'websocket';
  config?: Record<string, any>;
}

/** Default budgets for the whole session lifecycle (handshake + call). */
const SESSION_TIMEOUT_MS = 30_000;

/**
 * stdio servers spawn local child processes, which only exists on
 * self-hosted deployments — Vercel's serverless runtime has no durable
 * process spawning. This is the single gate both the API layer (add/edit)
 * and the transport layer (session creation) enforce.
 */
export function isStdioTransportAllowed(): boolean {
  return !process.env.VERCEL;
}

export interface RemoteSessionOptions {
  /** Hard budget for a tool call inside the session (ms). */
  timeoutMs?: number;
}

/**
 * Builds the stdio transport for a local MCP server from its stored config.
 * Env values are stored encrypted (AES-256-GCM via encryptToken) and are only
 * decrypted here, at the edge of the child process spawn.
 */
async function createStdioTransport(server: RemoteMcpServerRef) {
  if (!isStdioTransportAllowed()) {
    throw new Error('نقل stdio متاح فقط في النشر الذاتي (self-hosted) وليس على بيئات الخوادم المدارة.');
  }
  const command = String(server.config?.command || '').trim();
  if (!command) {
    throw new Error(`خادم الـ MCP المحلي (${server.name}) لا يحدد أمر تشغيل (command) في إعداده.`);
  }
  const rawArgs = server.config?.args;
  const args = Array.isArray(rawArgs) ? rawArgs.map((a) => String(a)) : undefined;
  const rawEnv = server.config?.env;
  let env: Record<string, string> | undefined;
  if (rawEnv && typeof rawEnv === 'object') {
    env = {};
    for (const [key, value] of Object.entries(rawEnv as Record<string, unknown>)) {
      const strValue = String(value ?? '');
      try {
        env[key] = decryptToken(strValue);
      } catch {
        env[key] = strValue; // stored unencrypted — pass through as-is
      }
    }
  }
  // Lazy import: pulls node:child_process, must never enter client bundles.
  const { Experimental_StdioMCPTransport } = await import('@ai-sdk/mcp/mcp-stdio');
  return new Experimental_StdioMCPTransport({ command, args, env });
}

/**
 * Runs `fn` with a live, fully-initialized MCP client session against the
 * given tenant server. The client is closed in all cases; failures inside
 * `fn` propagate after cleanup.
 */
export async function withRemoteMcpSession<T>(
  tenantId: string,
  server: RemoteMcpServerRef,
  fn: (client: MCPClient) => Promise<T>,
  options: RemoteSessionOptions = {},
): Promise<T> {
  const callBudget = options.timeoutMs ?? SESSION_TIMEOUT_MS;
  let client: MCPClient | null = null;
  try {
    if (server.transportType === 'stdio') {
      // Local process transport — no URL, no SSRF surface, no OAuth headers.
      const transport = await createStdioTransport(server);
      client = await createMCPClient({
        transport,
        initializationOptions: { timeout: callBudget },
        maxRetries: 1,
        onUncaughtError: (err: any) =>
          log.warn(`[Remote MCP] Uncaught stdio transport error (${server.name}):`, err?.message || err),
      });
      return await fn(client);
    }

    const url = await assertPublicHttpUrl(server.endpointUrl);

    // Attach the tenant's decrypted OAuth bearer token when one is provisioned
    // for this server (fixes the old gap where tokens were stored but never sent).
    const oauthToken = await mcpOAuthManager.getDecryptedToken(server.id, tenantId).catch(() => null);
    const headers: Record<string, string> = { ...(server.headers || {}) };
    if (oauthToken) headers.Authorization = `Bearer ${oauthToken}`;

    client = await createMCPClient({
      transport: { type: 'http', url: url.href, headers },
      initializationOptions: { timeout: callBudget },
      maxRetries: 1,
      onUncaughtError: (err: any) =>
        log.warn(`[Remote MCP] Uncaught transport error (${server.name}):`, err?.message || err),
    });
    return await fn(client);
  } finally {
    await client?.close().catch((err: any) => {
      log.warn(`[Remote MCP] Session close failed (${server.name}):`, err?.message || err);
    });
  }
}

/**
 * Extracts a usable payload from a standard MCP CallToolResult: first text
 * part parsed as JSON when possible, otherwise the raw result object.
 */
function extractToolPayload(result: CallToolResult): any {
  const content = (result as any).content;
  if (Array.isArray(content) && content.length > 0 && content[0]?.type === 'text') {
    const text = String(content[0].text ?? '');
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }
  if ((result as any).structuredContent != null) return (result as any).structuredContent;
  return result ?? {};
}

/**
 * Calls a tool on a remote MCP server through a real client session and
 * returns its payload. Protocol-level tool errors (`isError: true`) surface
 * as thrown errors carrying the server's message.
 */
export async function callRemoteTool(
  tenantId: string,
  server: RemoteMcpServerRef,
  toolName: string,
  args: Record<string, any>,
  timeoutMs?: number,
): Promise<any> {
  return withRemoteMcpSession(
    tenantId,
    server,
    async (client) => {
      const result = await client.callTool({
        name: toolName,
        arguments: args,
        options: { timeout: timeoutMs },
      });

      if ((result as any).isError) {
        const content = (result as any).content;
        const firstText =
          Array.isArray(content) && content[0]?.type === 'text' ? String(content[0].text ?? '') : undefined;
        throw new Error(firstText || `فشل تنفيذ الأداة (${toolName}) على الخادم البعيد (${server.name})`);
      }

      return extractToolPayload(result);
    },
    { timeoutMs },
  );
}

/**
 * Lists a remote server's tools through a real protocol session — used by
 * health/test flows as a TRUE capability check instead of a bare HTTP ping.
 */
export async function listRemoteTools(
  tenantId: string,
  server: RemoteMcpServerRef,
): Promise<Array<{ name: string; description?: string }>> {
  return withRemoteMcpSession(tenantId, server, async (client) => {
    const listed = await client.listTools();
    return (listed.tools || []).map((t: any) => ({ name: t.name, description: t.description }));
  });
}
