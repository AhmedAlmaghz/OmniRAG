import { NextRequest } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import type { AuthenticatedContext } from '@/lib/auth/apiAuth';
import { handleOutboundMcpRequest } from '@/lib/mcp/outboundServer';
import { getEnv } from '@/lib/env/runtimeEnv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Tool executions (OCR, search, parsing) can run long; keep the invocation
// alive for post-response work on serverless hosts.
export const maxDuration = 300;

/**
 * Outbound MCP endpoint (Phase 6) — standard Streamable HTTP transport from
 * `@modelcontextprotocol/sdk`, compatible with Claude Desktop, Cursor and any
 * MCP client.
 *
 * Auth: Bearer tenant API key (headless clients) or session cookie (in-app
 * gateway), enforced by withAuthAndRateLimit before the transport runs.
 * API keys may carry an `mcpTools` whitelist that restricts tools/list and
 * tools/call; session traffic sees all tenant-enabled tools.
 *
 * The server is stateless (no session id) and answers with JSON responses,
 * so it scales horizontally across serverless instances.
 */

// Hydrate runtime-provided keys so tool executions inside the gateway (web
// search providers, document parsers, storage backends) resolve the caller's
// configured environment.
function hydrateToolRuntimeEnv(req: NextRequest) {
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('TAVILY_API_KEY', req);
  getEnv('SERPER_API_KEY', req);
  getEnv('BRAVE_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);
}

async function handleMcp(req: NextRequest, authCtx: AuthenticatedContext) {
  hydrateToolRuntimeEnv(req);
  return handleOutboundMcpRequest(req, {
    tenantId: authCtx.tenantId,
    userId: authCtx.userId,
    // Tool whitelist applies to API-key traffic only; browser sessions keep
    // the full tenant tool surface (chat gateway parity).
    allowedTools: authCtx.authMethod === 'apiKey' ? authCtx.apiKeyMcpTools : null,
  });
}

export const POST = withAuthAndRateLimit(async (req, authCtx) => handleMcp(req, authCtx));

// Streamable HTTP clients use POST for messages; GET (SSE stream) and DELETE
// (session teardown) are answered by the transport itself — 405 in stateless
// mode, per spec.
export const GET = withAuthAndRateLimit(async (req, authCtx) => handleMcp(req, authCtx));
export const DELETE = withAuthAndRateLimit(async (req, authCtx) => handleMcp(req, authCtx));
