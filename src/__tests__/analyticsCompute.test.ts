import { describe, it, expect } from 'vitest';

/**
 * Analytics computation contract — honesty-first:
 * - Metrics that cannot be measured are null, never fabricated placeholders
 *   (the old API returned a hardcoded 180ms P95 and the UI faked 96.4%
 *   Recall@K).
 * - Chunk counting derives from document.chunkCount (O(docs)), and the
 *   uncategorized bucket appears only when it is non-empty.
 */
import { computeAnalyticsStats } from '../lib/analytics/computeStats';
import { AuditLogEntry, Collection, Document, MCPToolCall } from '../lib/types/omnirag';

const TENANT = 'tenant-acme-01';

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    tenantId: TENANT,
    title: 'Doc',
    content: '',
    sourceType: 'file',
    language: 'ar',
    status: 'indexed',
    chunkCount: 4,
    createdAt: new Date().toISOString(),
    collectionIds: [],
    ...overrides,
  } as Document;
}

function makeLog(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: `audit-${Math.random()}`,
    tenantId: TENANT,
    actorId: 'tester',
    action: 'SOME_ACTION',
    resourceType: 'system',
    resourceId: 'res',
    status: 'success',
    details: '',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeCall(latencyMs: number, status: 'completed' | 'failed' = 'completed', i = 0): MCPToolCall {
  return {
    id: `tc-${i}`,
    tenantId: TENANT,
    scopedToolName: 'search_knowledge_base',
    inputParams: {},
    latencyMs,
    status,
    hasSideEffect: false,
    timestamp: new Date(Date.now() + i).toISOString(),
  };
}

const EMPTY_COLLECTIONS: Collection[] = [];

describe('computeAnalyticsStats — empty/honest baseline', () => {
  const stats = computeAnalyticsStats({ auditLogs: [], toolCalls: [], documents: [], collections: EMPTY_COLLECTIONS });

  it('returns zeros for counts and NULL for unmeasurable metrics', () => {
    expect(stats.totalDocuments).toBe(0);
    expect(stats.totalChunks).toBe(0);
    expect(stats.blockedAttacks).toBe(0);
    // No data => null, never a fabricated default like the old 180ms.
    expect(stats.retrievalHealth).toBeNull();
    expect(stats.p95LatencyMs).toBeNull();
    expect(stats.avgToolLatencyMs).toBeNull();
    expect(stats.attackRatio).toBeNull();
    expect(stats.toolSuccessRate).toBeNull();
    expect(stats.unmeasured.mrrScore).toBeNull();
    expect(stats.unmeasured.recallAtK).toBeNull();
  });

  it('omits the uncategorized distribution bucket when empty', () => {
    expect(stats.chunksPerCollection).toEqual([]);
  });
});

describe('computeAnalyticsStats — corpus metrics', () => {
  const documents = [
    makeDoc({ id: 'd1', chunkCount: 10, status: 'indexed', collectionIds: ['c1'] }),
    makeDoc({ id: 'd2', chunkCount: 6, status: 'indexed', collectionIds: ['c1'] }),
    makeDoc({ id: 'd3', chunkCount: 4, status: 'processing', collectionIds: [] }),
  ];
  const collections = [{ id: 'c1', name: 'السياسات', tenantId: TENANT, documentCount: 2, createdAt: '' } as Collection];

  const stats = computeAnalyticsStats({ auditLogs: [], toolCalls: [], documents, collections });

  it('sums chunks from document.chunkCount without loading the corpus', () => {
    expect(stats.totalChunks).toBe(20);
    expect(stats.totalDocuments).toBe(3);
    expect(stats.indexedDocuments).toBe(2);
    expect(stats.retrievalHealth).toBeCloseTo(0.67);
  });

  it('builds per-collection distribution plus an uncategorized bucket', () => {
    expect(stats.chunksPerCollection).toEqual([
      { name: 'السياسات', count: 16 },
      { name: 'غير مصنّف', count: 4 },
    ]);
  });
});

describe('computeAnalyticsStats — MCP tool call metrics', () => {
  // 20 calls with latencies 1..20 ms => p95 index = floor(20*0.95)=19 -> 20ms
  const toolCalls = Array.from({ length: 20 }, (_, i) => makeCall(i + 1, i < 17 ? 'completed' : 'failed', i));

  const stats = computeAnalyticsStats({
    auditLogs: [],
    toolCalls,
    documents: [],
    collections: EMPTY_COLLECTIONS,
  });

  it('counts outcomes and derives an honest success rate', () => {
    expect(stats.toolCallCount).toBe(20);
    expect(stats.toolCompletedCount).toBe(17);
    expect(stats.toolFailedCount).toBe(3);
    expect(stats.toolSuccessRate).toBeCloseTo(0.85);
  });

  it('computes real P95/avg latency and keeps chronological samples', () => {
    expect(stats.p95LatencyMs).toBe(20);
    expect(stats.avgToolLatencyMs).toBe(Math.round(10.5));
    expect(stats.toolLatencySamples[0]).toBeLessThanOrEqual(
      stats.toolLatencySamples[stats.toolLatencySamples.length - 1],
    );
    expect(stats.toolLatencySamples.length).toBe(20);
  });
});

describe('computeAnalyticsStats — security audit metrics', () => {
  const auditLogs = [
    makeLog({ action: 'PRE_INFERENCE_CHECK', status: 'blocked' }),
    makeLog({ action: 'PRE_INFERENCE_CHECK', status: 'success' }),
    makeLog({ action: 'PRE_INFERENCE_CHECK', status: 'success' }),
    makeLog({ action: 'PRE_INFERENCE_CHECK', status: 'success' }),
    makeLog({ action: 'MCP_PRESET_INSTALLED', status: 'success' }),
    makeLog({ action: 'MCP_TOOL_FAILED', status: 'error' }),
  ];

  const stats = computeAnalyticsStats({
    auditLogs,
    toolCalls: [],
    documents: [],
    collections: EMPTY_COLLECTIONS,
  });

  it('computes block ratio against inference checks only', () => {
    expect(stats.auditByStatus).toEqual({ success: 4, error: 1, blocked: 1 });
    expect(stats.attackRatio).toBeCloseTo(0.25);
  });

  it('ranks top actions by frequency', () => {
    expect(stats.topActions[0]).toEqual({ action: 'PRE_INFERENCE_CHECK', count: 4 });
    expect(stats.topActions.length).toBeLessThanOrEqual(5);
  });

  it('keeps attackRatio null when no inference checks exist (even with blocks)', () => {
    const weird = computeAnalyticsStats({
      auditLogs: [makeLog({ action: 'OTHER', status: 'blocked' })],
      toolCalls: [],
      documents: [],
      collections: EMPTY_COLLECTIONS,
    });
    expect(weird.blockedAttacks).toBe(1);
    expect(weird.attackRatio).toBeNull();
  });
});
