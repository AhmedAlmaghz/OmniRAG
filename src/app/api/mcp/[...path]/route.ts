import { NextRequest, NextResponse } from 'next/server';
import { processMcpProtocolRequest } from '@/lib/mcp/server-factory';

export const runtime = 'nodejs';

/**
 * MCP Gateway Stateless Protocol Endpoint per SPEC 2026-07-28
 * Supports GET, POST, DELETE with X-Tenant-ID header isolation
 */

export async function POST(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id') || 'tenant-alpha-001';
    const userId = req.headers.get('x-user-id') || undefined;

    const body = await req.json();

    const response = await processMcpProtocolRequest(body, {
      tenantId,
      userId,
    });

    return NextResponse.json(response, {
      headers: {
        'Content-Type': 'application/json',
        'X-MCP-Protocol-Version': '2026-07-28',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32603,
          message: err.message || 'خطأ غير متوقع في خادم MCP Gateway',
        },
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') || 'tenant-alpha-001';

  // Return protocol capabilities and active gateway information
  const initInfo = await processMcpProtocolRequest(
    { jsonrpc: '2.0', id: 'get-init', method: 'initialize' },
    { tenantId }
  );

  return NextResponse.json(initInfo.result, {
    headers: {
      'Content-Type': 'application/json',
      'X-MCP-Protocol-Version': '2026-07-28',
    },
  });
}

export async function DELETE(req: NextRequest) {
  return NextResponse.json({
    jsonrpc: '2.0',
    id: 'del-1',
    result: { message: 'تم إغلاق وتفريغ جلسة MCP عديمة الحالة بنجاح' },
  });
}
