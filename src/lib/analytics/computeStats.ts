import { AuditLogEntry, Collection, Document, MCPToolCall } from '@/lib/types/omnirag';

/**
 * Pure analytics computations for the governance dashboard.
 *
 * Honesty policy (enforced here, not in the UI):
 * - A metric that CANNOT be measured is returned as `null`, never as a
 *   fabricated placeholder. MRR / Recall@K require a labelled relevance set
 *   (query -> known-relevant chunks) which OmniRAG does not record yet.
 * - Chunk counts are derived from each document's authoritative `chunkCount`
 *   (set by the ingestion pipeline) instead of loading every chunk body —
 *   counting should be O(documents), not O(corpus).
 */

export interface CollectionDistribution {
  name: string;
  count: number;
}

export interface ActionCount {
  action: string;
  count: number;
}

export interface AnalyticsStats {
  // Knowledge corpus
  totalDocuments: number;
  indexedDocuments: number;
  totalChunks: number;
  /** Indexed / total documents ratio; null when there are no documents. */
  retrievalHealth: number | null;

  // Security & governance
  totalAuditLogs: number;
  blockedAttacks: number;
  auditByStatus: { success: number; error: number; blocked: number };
  /** Blocked / inference-checks ratio; null when no checks were recorded. */
  attackRatio: number | null;
  topActions: ActionCount[];

  // MCP tool calls
  toolCallCount: number;
  toolCompletedCount: number;
  toolFailedCount: number;
  /** Completed / executed ratio; null when no calls were recorded. */
  toolSuccessRate: number | null;
  p95LatencyMs: number | null;
  avgToolLatencyMs: number | null;
  /** Chronological latency samples (oldest -> newest) for sparklines. */
  toolLatencySamples: number[];

  // Distribution
  chunksPerCollection: CollectionDistribution[];

  // Explicit honesty markers surfaced to operators
  unmeasured: { mrrScore: null; recallAtK: null };
}

const P95_PERCENTILE = 0.95;
export const LATENCY_SAMPLE_SIZE = 20;
export const TOP_ACTIONS_LIMIT = 5;

function percentile95(sortedLatencies: number[]): number | null {
  if (sortedLatencies.length === 0) return null;
  const idx = Math.min(sortedLatencies.length - 1, Math.floor(sortedLatencies.length * P95_PERCENTILE));
  return sortedLatencies[idx] ?? sortedLatencies[sortedLatencies.length - 1];
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function computeAnalyticsStats(input: {
  auditLogs: AuditLogEntry[];
  toolCalls: MCPToolCall[];
  documents: Document[];
  collections: Collection[];
}): AnalyticsStats {
  const { auditLogs, toolCalls, documents, collections } = input;

  // --- Corpus ---
  const totalDocuments = documents.length;
  const indexedDocuments = documents.filter((d) => d.status === 'indexed').length;
  const totalChunks = documents.reduce((sum, d) => sum + (d.chunkCount || 0), 0);
  const retrievalHealth = totalDocuments > 0 ? round2(indexedDocuments / totalDocuments) : null;

  // --- Security ---
  const auditByStatus = {
    success: auditLogs.filter((a) => a.status === 'success').length,
    error: auditLogs.filter((a) => a.status === 'error').length,
    blocked: auditLogs.filter((a) => a.status === 'blocked').length,
  };
  const blockedAttacks = auditByStatus.blocked;
  const inferenceChecks = auditLogs.filter((a) => a.action?.includes('PRE_INFERENCE')).length;
  const attackRatio = inferenceChecks > 0 ? round2(blockedAttacks / inferenceChecks) : null;

  const actionCounts = new Map<string, number>();
  for (const log of auditLogs) {
    actionCounts.set(log.action, (actionCounts.get(log.action) || 0) + 1);
  }
  const topActions = Array.from(actionCounts.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_ACTIONS_LIMIT);

  // --- MCP tool calls ---
  const toolCompletedCount = toolCalls.filter((tc) => tc.status === 'completed').length;
  const toolFailedCount = toolCalls.filter((tc) => tc.status === 'failed').length;
  const latencies = toolCalls
    .map((tc) => tc.latencyMs)
    .filter((ms) => typeof ms === 'number' && ms > 0)
    .sort((a, b) => a - b);

  const toolSuccessRate =
    toolCalls.length > 0 ? round2(toolCompletedCount / Math.max(toolCompletedCount + toolFailedCount, 1)) : null;
  const p95LatencyMs = percentile95(latencies);
  const avgToolLatencyMs =
    latencies.length > 0 ? Math.round(latencies.reduce((s, ms) => s + ms, 0) / latencies.length) : null;

  // Chronological samples for trend display (NOT sorted — time order).
  const toolLatencySamples = toolCalls
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-LATENCY_SAMPLE_SIZE)
    .map((tc) => tc.latencyMs)
    .filter((ms) => typeof ms === 'number' && ms >= 0);

  // --- Distribution per collection (from document chunkCounts) ---
  const chunksPerCollection: CollectionDistribution[] = collections.map((collection) => ({
    name: collection.name,
    count: documents
      .filter((d) => d.collectionIds?.includes(collection.id))
      .reduce((sum, d) => sum + (d.chunkCount || 0), 0),
  }));

  const uncategorizedChunks = documents
    .filter((d) => !d.collectionIds || d.collectionIds.length === 0)
    .reduce((sum, d) => sum + (d.chunkCount || 0), 0);
  if (uncategorizedChunks > 0) {
    chunksPerCollection.push({ name: 'غير مصنّف', count: uncategorizedChunks });
  }

  return {
    totalDocuments,
    indexedDocuments,
    totalChunks,
    retrievalHealth,

    totalAuditLogs: auditLogs.length,
    blockedAttacks,
    auditByStatus,
    attackRatio,
    topActions,

    toolCallCount: toolCalls.length,
    toolCompletedCount,
    toolFailedCount,
    toolSuccessRate,
    p95LatencyMs,
    avgToolLatencyMs,
    toolLatencySamples,

    chunksPerCollection,

    unmeasured: { mrrScore: null, recallAtK: null },
  };
}
