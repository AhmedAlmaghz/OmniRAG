import { NextRequest, NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { processMcpProtocolRequest } from '@/lib/mcp/server-factory';
import { getEnv } from '@/lib/env/runtimeEnv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MCP Gateway Stateless Protocol Endpoint per SPEC 2026-07-28
 * Supports GET, POST, DELETE with authenticated tenant isolation.
 * Tenant identity is derived exclusively from the verified auth context.
 */

// Hydrate runtime-provided keys so tool executions inside the gateway (web
// search providers, document parsers, storage backends) resolve the caller's
// configured environment.
function hydrateToolRuntimeEnv(req: NextRequest) {
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
}

export const POST = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  try {
    const tenantId = authCtx.tenantId;
    const userId = authCtx.userId;

    hydrateToolRuntimeEnv(req);

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
    console.error('[api/mcp/[...path]] POST error:', err);
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32603,
          message: 'خطأ غير متوقع في خادم MCP Gateway',
        },
      },
      { status: 500 },
    );
  }
});

export const GET = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  const tenantId = authCtx.tenantId;

  hydrateToolRuntimeEnv(req);

  // Return protocol capabilities and active gateway information
  const initInfo = await processMcpProtocolRequest(
    { jsonrpc: '2.0', id: 'get-init', method: 'initialize' },
    { tenantId },
  );

  return NextResponse.json(initInfo.result, {
    headers: {
      'Content-Type': 'application/json',
      'X-MCP-Protocol-Version': '2026-07-28',
    },
  });
});

export const DELETE = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  return NextResponse.json({
    jsonrpc: '2.0',
    id: 'del-1',
    result: { message: 'تم إغلاق وتفريغ جلسة MCP عديمة الحالة بنجاح' },
  });
});
