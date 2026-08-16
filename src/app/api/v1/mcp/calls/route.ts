import { NextRequest, NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { db } from '@/lib/storage/db';

export const dynamic = 'force-dynamic';

export const GET = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  try {
    const tenantId = authCtx.tenantId;

    const calls = await db.getToolCalls(tenantId);

    return NextResponse.json({
      success: true,
      tenantId,
      totalCalls: calls.length,
      calls,
    });
  } catch (err: any) {
    console.error('[api/v1/mcp/calls] GET error:', err);
    return NextResponse.json({ success: false, error: 'فشل جلب سجل استدعاءات الأدوات' }, { status: 500 });
  }
});
