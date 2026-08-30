import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { guardPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

/**
 * Lightweight connector-status probe for the KB sync poller.
 *
 * The knowledge base used to poll the full data query (4 parallel requests)
 * every 4s while a connector synced — 60 req/min against a 30/min
 * per-endpoint ceiling, which guaranteed 429s and the "تعذر الاتصال بالخادم"
 * banner. This endpoint answers exactly what the poller needs (are any
 * connectors still syncing?) in ONE cheap request per tick (15/min), without
 * loading sync logs, MCP resources, documents, or collections.
 */
export const GET = withAuthAndRateLimit(
  async (_req, authCtx) => {
    const denied = await guardPermission(authCtx, 'sources:read');
    if (denied) return denied;

    try {
      const sources = await db.getSources(authCtx.tenantId);
      const statuses = sources.map((s) => ({
        id: s.id,
        status: s.status,
        lastSyncAt: s.lastSyncAt,
        documentCount: s.documentCount,
        lastError: s.lastError || null,
      }));
      return NextResponse.json({
        tenantId: authCtx.tenantId,
        syncing: statuses.filter((s) => s.status === 'syncing').length,
        statuses,
      });
    } catch (error: any) {
      return NextResponse.json(
        { error: 'تعذر جلب حالة الموصلات (Could not fetch connector statuses)', code: 'INTERNAL_ERROR' },
        { status: 500 },
      );
    }
  },
  { limit: 60, windowMs: 60000 },
);
