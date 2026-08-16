import { NextRequest, NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { db } from '@/lib/storage/db';
import { mcpClientPool } from '@/lib/mcp/client-pool';

export const dynamic = 'force-dynamic';

export const POST = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  try {
    const { id } = await (props as { params: Promise<{ id: string }> }).params;
    const body = await req.json().catch(() => ({}));
    const tenantId = authCtx.tenantId;

    const servers = await db.getMcpServers(tenantId);
    const server = servers.find((s) => s.id === id);

    if (!server) {
      return NextResponse.json({ success: false, error: `خادم الـ MCP غير موجود` }, { status: 404 });
    }

    const probe = await mcpClientPool.probeServer(server, tenantId);

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
      testCallResult,
      testedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[api/v1/mcp/servers/[id]/test] POST error:', err);
    return NextResponse.json({ success: false, error: 'فشل اختبار اتصال خادم الـ MCP' }, { status: 500 });
  }
});
