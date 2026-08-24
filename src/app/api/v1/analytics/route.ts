import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { computeAnalyticsStats } from '@/lib/analytics/computeStats';

export const dynamic = 'force-dynamic';

/** Latest audit rows returned to the dashboard table (stats use the full set). */
const AUDIT_LOG_PAGE_SIZE = 100;

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  // The wrapper already verified auth and rejected invalid tokens; authCtx is
  // the single source of identity. No redundant inner verifyApiAuth call.
  try {
    const tenantId = authCtx.tenantId;

    const [auditLogs, toolCalls, docs, collections, conversations] = await Promise.all([
      db.getAuditLogs(tenantId),
      db.getToolCalls(tenantId),
      db.getDocuments(tenantId),
      db.getCollections(tenantId),
      db.getConversations(tenantId).catch(() => []),
    ]);

    // Pure computation lives in lib/analytics/computeStats (unit-tested).
    // Chunk counts derive from document.chunkCount — no full-corpus load.
    const stats = computeAnalyticsStats({ auditLogs, toolCalls, documents: docs, collections });

    // Newest first, bounded page for the UI table.
    const recentAuditLogs = auditLogs
      .slice()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, AUDIT_LOG_PAGE_SIZE);

    return NextResponse.json(
      {
        stats,
        auditLogs: recentAuditLogs,
        auditLogsTotal: auditLogs.length,
        conversationsCount: conversations.length,
        generatedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[api/v1/analytics] GET error:', err);
    return NextResponse.json(
      { error: 'فشل تجميع مقاييس التحليلات (Failed to aggregate analytics)', code: '500_ANALYTICS_ERROR' },
      { status: 500 },
    );
  }
});
