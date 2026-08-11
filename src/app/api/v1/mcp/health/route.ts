import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { mcpClientPool } from '@/lib/mcp/client-pool';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') || req.headers.get('x-tenant-id') || 'tenant-alpha-001';

    const servers = await db.getMcpServers(tenantId);

    const probes = await Promise.all(
      servers.map(async (server) => {
        const probeResult = await mcpClientPool.probeServer(server, tenantId);
        return {
          serverId: server.id,
          name: server.name,
          category: server.category,
          status: probeResult.status,
          latencyMs: probeResult.latencyMs,
          enabledToolsCount: server.enabledTools.length,
          lastPingAt: probeResult.lastPingAt,
        };
      })
    );

    const healthyCount = probes.filter((p) => p.status === 'healthy' || p.status === 'connected').length;
    const totalCount = probes.length;

    return NextResponse.json({
      success: true,
      tenantId,
      aggregatedHealth: healthyCount === totalCount ? 'healthy' : healthyCount > 0 ? 'degraded' : 'unhealthy',
      healthyServersRatio: `${healthyCount}/${totalCount}`,
      servers: probes,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'فشل فحص الحالة المجمعة لخوادم MCP' },
      { status: 500 }
    );
  }
}
