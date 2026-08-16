import { NextRequest, NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { db } from '@/lib/storage/db';
import { mcpClientPool } from '@/lib/mcp/client-pool';

export const dynamic = 'force-dynamic';

export const GET = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  try {
    const tenantId = authCtx.tenantId;

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
      }),
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
    console.error('[api/v1/mcp/health] GET error:', err);
    return NextResponse.json({ success: false, error: 'فشل فحص الحالة المجمعة لخوادم MCP' }, { status: 500 });
  }
});
