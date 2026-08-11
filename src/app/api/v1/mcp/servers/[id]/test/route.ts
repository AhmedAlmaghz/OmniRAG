import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { mcpClientPool } from '@/lib/mcp/client-pool';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const tenantId = body.tenantId || req.headers.get('x-tenant-id') || 'tenant-alpha-001';

    const servers = await db.getMcpServers(tenantId);
    const server = servers.find((s) => s.id === id);

    if (!server) {
      return NextResponse.json(
        { success: false, error: `خادم الـ MCP غير موجود` },
        { status: 404 }
      );
    }

    const probe = await mcpClientPool.probeServer(server, tenantId);

    // If an explicit tool call test was requested in body
    let testCallResult: any = null;
    if (body.toolName) {
      testCallResult = await mcpClientPool.executeToolCall(
        server.id,
        body.toolName,
        body.arguments || {},
        { tenantId, userId: body.userId }
      );
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
    return NextResponse.json(
      { success: false, error: err.message || 'فشل فحص لاختبار اتصال خادم الـ MCP' },
      { status: 500 }
    );
  }
}
