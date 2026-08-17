import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';

export const dynamic = 'force-dynamic';

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  // The wrapper already verified auth and rejected invalid tokens; authCtx is
  // the single source of identity. No redundant inner verifyApiAuth call.
  const tenantId = authCtx.tenantId;
  const auditLogs = await db.getAuditLogs(tenantId);
  const toolCalls = await db.getToolCalls(tenantId);
  const docs = await db.getDocuments(tenantId);
  const chunks = await db.getChunks(tenantId);
  const collections = await db.getCollections(tenantId);

  // Compute distribution of chunks per collection
  const chunksPerCollection = collections.map((collection) => {
    // Find documents belonging to this collection
    const collectionDocs = docs.filter((d) => d.collectionIds?.includes(collection.id));
    // Calculate total chunks for these documents
    // Note: A document might not have chunkCount correct, or we can use the actual chunks array
    // Since chunks have documentId, let's use the chunks array directly:
    const docIds = new Set(collectionDocs.map((d) => d.id));
    const collectionChunksCount = chunks.filter((c) => docIds.has(c.documentId)).length;

    return {
      name: collection.name,
      count: collectionChunksCount,
    };
  });

  // Add Uncategorized category if there are chunks in documents without collections
  const uncategorizedDocs = docs.filter((d) => !d.collectionIds || d.collectionIds.length === 0);
  const uncategorizedDocIds = new Set(uncategorizedDocs.map((d) => d.id));
  const uncategorizedChunksCount = chunks.filter((c) => uncategorizedDocIds.has(c.documentId)).length;

  if (uncategorizedChunksCount > 0) {
    chunksPerCollection.push({ name: 'Uncategorized', count: uncategorizedChunksCount });
  }

  // Compute real P95 latency from tool call & audit log latencies
  const latencies: number[] = [];
  toolCalls.forEach((tc) => {
    if (tc.latencyMs && tc.latencyMs > 0) latencies.push(tc.latencyMs);
  });

  latencies.sort((a, b) => a - b);
  let p95LatencyMs = 180;
  if (latencies.length > 0) {
    const p95Idx = Math.floor(latencies.length * 0.95);
    p95LatencyMs = latencies[p95Idx] || latencies[latencies.length - 1];
  }

  // Calculate real success rate & attack defense metrics
  const blockedAttacks = auditLogs.filter((a) => a.status === 'blocked').length;
  const totalInferenceChecks = auditLogs.filter(
    (a) => a.action === 'PRE_INFERENCE_CHECK' || a.action === 'PRE_INFERENCE',
  ).length;
  const attackRatio = totalInferenceChecks > 0 ? Number((blockedAttacks / totalInferenceChecks).toFixed(2)) : 0;

  // MRR / Recall@K estimation.
  //
  // The previous implementation fabricated these metrics: it returned hard-
  // coded high values (0.85–0.97 / 0.88–0.98) scaled only by the ratio of
  // indexed documents, which has no statistical relationship to retrieval
  // quality. Surfacing 0.97 "MRR" gave a false impression of retrieval health
  // to operators reading the dashboard. A proper MRR/Recall@K requires a
  // labelled relevance set (query → known-relevant chunks) that this system
  // does not record, so we report null and surface the fact honestly instead
  // of inventing the number. `retrievalHealth` reports what we DO measure.
  const totalIndexedDocs = docs.filter((d) => d.status === 'indexed').length;
  const docHealthRatio = docs.length > 0 ? totalIndexedDocs / docs.length : 1.0;

  const stats = {
    totalDocuments: docs.length,
    totalChunks: chunks.length,
    totalAuditLogs: auditLogs.length,
    blockedAttacks,
    attackRatio,
    toolCallCount: toolCalls.length,
    p95LatencyMs,
    // MRR / Recall@K require a labelled relevance set (query → known-relevant
    // chunks), which OmniRAG does not record. Report null rather than a
    // fabricated number; retrievalHealth reports the indexed-chunk coverage
    // we *can* measure.
    mrrScore: null,
    recallAtK: null,
    retrievalHealth: Number(docHealthRatio.toFixed(2)),
    chunksPerCollection,
  };

  return NextResponse.json({ stats, auditLogs });
});
