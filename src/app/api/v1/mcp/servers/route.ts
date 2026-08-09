import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId') || 'tenant-acme-01';
  const servers = db.getMcpServers(tenantId);
  return NextResponse.json({ servers });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = body.tenantId || 'tenant-acme-01';

    if (body.action === 'add' && body.server) {
      const newServer = {
        ...body.server,
        id: `mcp-${Date.now()}`,
        tenantId,
        status: 'healthy',
        latencyMs: Math.floor(Math.random() * 30) + 15,
        lastChecked: new Date().toISOString(),
      };
      db.addMcpServer(newServer);
      return NextResponse.json({ success: true, server: newServer, servers: db.getMcpServers(tenantId) }, { status: 201 });
    }

    const { serverId, toolName } = body;
    if (serverId && toolName) {
      db.toggleMcpTool(serverId, toolName, tenantId);
    }

    return NextResponse.json({ success: true, servers: db.getMcpServers(tenantId) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
