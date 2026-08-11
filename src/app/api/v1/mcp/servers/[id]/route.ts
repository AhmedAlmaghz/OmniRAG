import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') || req.headers.get('x-tenant-id') || 'tenant-alpha-001';

    const servers = await db.getMcpServers(tenantId);
    const server = servers.find((s) => s.id === id);

    if (!server) {
      return NextResponse.json(
        { success: false, error: `خادم ה-MCP المعرف بـ (${id}) غير موجود` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      tenantId,
      server,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'فشل جلب تفاصيل خادم الـ MCP' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const tenantId = body.tenantId || req.headers.get('x-tenant-id') || 'tenant-alpha-001';

    const servers = await db.getMcpServers(tenantId);
    const server = servers.find((s) => s.id === id);

    if (!server) {
      return NextResponse.json(
        { success: false, error: `خادم الـ MCP غير موجود` },
        { status: 404 }
      );
    }

    // Update server properties
    if (body.status) server.status = body.status;
    if (body.enabledTools) server.enabledTools = body.enabledTools;
    if (body.name) server.name = body.name;
    if (body.url) server.url = body.url;
    if (body.config) server.config = { ...server.config, ...body.config };

    await db.addMcpServer(server);

    return NextResponse.json({
      success: true,
      message: 'تم تحديث خادم الـ MCP بنجاح',
      server,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'فشل تحديث بيانات خادم الـ MCP' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') || req.headers.get('x-tenant-id') || 'tenant-alpha-001';

    await db.deleteMcpServer(id, tenantId);

    await db.addAuditLog({
      id: `audit-${Date.now()}`,
      tenantId,
      actorId: 'mcp_gateway',
      action: 'MCP_SERVER_DELETE',
      resourceType: 'mcp_server',
      resourceId: id,
      status: 'success',
      details: `تم حذف خادم الـ MCP المعرف بـ (${id}) نهائياً من المستأجر`,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: `تم حذف خادم الـ MCP (${id}) بنجاح`,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'فشل حذف خادم الـ MCP' },
      { status: 500 }
    );
  }
}
