import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') || req.headers.get('x-tenant-id') || 'tenant-alpha-001';

    const calls = await db.getToolCalls(tenantId);

    return NextResponse.json({
      success: true,
      tenantId,
      totalCalls: calls.length,
      calls,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'فشل جلب سجل استدعاءات الأدوات' },
      { status: 500 }
    );
  }
}
