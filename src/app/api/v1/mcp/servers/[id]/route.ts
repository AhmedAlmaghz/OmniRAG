import { NextRequest, NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { db } from '@/lib/storage/db';
import { guardPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

export const GET = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  try {
    const denied = await guardPermission(authCtx, 'mcp:manage');
    if (denied) return denied;

    const { id } = await (props as { params: Promise<{ id: string }> }).params;
    const tenantId = authCtx.tenantId;

    const servers = await db.getMcpServers(tenantId);
    const server = servers.find((s) => s.id === id);

    if (!server) {
      return NextResponse.json({ success: false, error: `خادم MCP المعرف بـ (${id}) غير موجود` }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      tenantId,
      server,
    });
  } catch (err: any) {
    console.error('[api/v1/mcp/servers/[id]] GET error:', err);
    return NextResponse.json({ success: false, error: 'فشل جلب تفاصيل خادم الـ MCP' }, { status: 500 });
  }
});

export const PATCH = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  try {
    const denied = await guardPermission(authCtx, 'mcp:manage');
    if (denied) return denied;

    const { id } = await (props as { params: Promise<{ id: string }> }).params;
    const body = await req.json();
    const tenantId = authCtx.tenantId;

    const servers = await db.getMcpServers(tenantId);
    const server = servers.find((s) => s.id === id);

    if (!server) {
      return NextResponse.json({ success: false, error: `خادم الـ MCP غير موجود` }, { status: 404 });
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
    console.error('[api/v1/mcp/servers/[id]] PATCH error:', err);
    return NextResponse.json({ success: false, error: 'فشل تحديث بيانات خادم الـ MCP' }, { status: 500 });
  }
});

export const DELETE = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  try {
    const denied = await guardPermission(authCtx, 'mcp:manage');
    if (denied) return denied;

    const { id } = await (props as { params: Promise<{ id: string }> }).params;
    const tenantId = authCtx.tenantId;

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
    console.error('[api/v1/mcp/servers/[id]] DELETE error:', err);
    return NextResponse.json({ success: false, error: 'فشل حذف خادم الـ MCP' }, { status: 500 });
  }
});
