import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId') || 'tenant-acme-01';
  const servers = db.getMcpServers(tenantId);
  return NextResponse.json({ servers });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { serverId, toolName, tenantId = 'tenant-acme-01' } = body;

    db.toggleMcpTool(serverId, toolName, tenantId);
    return NextResponse.json({ success: true, servers: db.getMcpServers(tenantId) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
