import { NextRequest, NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { db } from '@/lib/storage/db';
import { mcpClientPool } from '@/lib/mcp/client-pool';
import { listRemoteTools } from '@/lib/mcp/remoteClient';
import { getEnv } from '@/lib/env/runtimeEnv';

export const dynamic = 'force-dynamic';

export const POST = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  try {
    // Hydrate runtime-provided keys so a real tool-call test resolves the
    // caller's configured environment (search providers, parsers, storage).
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

    const { id } = await (props as { params: Promise<{ id: string }> }).params;
    const body = await req.json().catch(() => ({}));
    const tenantId = authCtx.tenantId;

    const servers = await db.getMcpServers(tenantId);
    const server = servers.find((s) => s.id === id);

    if (!server) {
      return NextResponse.json({ success: false, error: `خادم الـ MCP غير موجود` }, { status: 404 });
    }

    const probe = await mcpClientPool.probeServer(server, tenantId);

    // TRUE protocol-level capability check: a real MCP session (initialize
    // handshake + tools/list) against public http(s) endpoints. Goes beyond
    // the reachability ping and reports honestly on failure without failing
    // the whole route.
    let protocolCheck: { ok: boolean; toolCount?: number; tools?: string[]; error?: string } | null = null;
    if (/^https?:\/\//i.test(server.endpointUrl || '') && !server.endpointUrl.includes('.internal')) {
      try {
        const remoteTools = await listRemoteTools(tenantId, server);
        protocolCheck = {
          ok: true,
          toolCount: remoteTools.length,
          tools: remoteTools.slice(0, 20).map((t) => t.name),
        };
      } catch (err: any) {
        protocolCheck = { ok: false, error: err?.message || 'MCP handshake/listTools failed' };
      }
    }

    // If an explicit tool call test was requested in body
    let testCallResult: any = null;
    if (body.toolName) {
      testCallResult = await mcpClientPool.executeToolCall(server.id, body.toolName, body.arguments || {}, {
        tenantId,
        userId: authCtx.userId,
      });
    }

    return NextResponse.json({
      success: true,
      serverId: server.id,
      serverName: server.name,
      probe,
      protocolCheck,
      testCallResult,
      testedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[api/v1/mcp/servers/[id]/test] POST error:', err);
    return NextResponse.json({ success: false, error: 'فشل اختبار اتصال خادم الـ MCP' }, { status: 500 });
  }
});
