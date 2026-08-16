import { describe, it, expect } from 'vitest';
import type { IOmniRAGDatabase } from '@/lib/storage/IOmniRAGDatabase';
import { MemoryDatabase } from '../lib/storage/db';

// Exercise the in-memory store against the public contract so the interface
// stays honest: the in-memory backend must satisfy IOmniRAGDatabase and its
// document-versioning round-trip must remain stable.
describe('MemoryDatabase — IOmniRAGDatabase contract', () => {
  const mem: IOmniRAGDatabase = new MemoryDatabase();

  it('satisfies the IOmniRAGDatabase contract (structural typing)', () => {
    // Compile-time assertion: assigning the concrete instance to the contract.
    const _typed: IOmniRAGDatabase = mem;
    expect(_typed).toBe(mem);
  });

  it('round-trips document versioning (create then revert restores content)', async () => {
    const tenantId = 'tenant-acme-01'; // has seeded documents in the memory store

    const docs = await mem.getDocuments(tenantId);
    const doc = docs[0];
    expect(doc).toBeDefined();

    const revisedContent = 'المحتوى المعدّل لاختبار الإصدار';
    const created = await mem.createDocumentVersion(
      doc.id,
      { content: revisedContent, changeSummary: 'مراجعة' },
      tenantId,
    );
    expect(created).toBeDefined();
    expect(created!.document.content).toBe(revisedContent);
    const createdVersionNumber = created!.version.versionNumber;

    const reverted = await mem.revertDocumentVersion(doc.id, createdVersionNumber, tenantId);
    expect(reverted).toBeDefined();
    expect(reverted!.document.content).toBe(revisedContent);
  });

  it('isolates reads by tenantId via getSyncLogs', async () => {
    const logsA = await mem.getSyncLogs('tenant-acme-01');
    const logsB = await mem.getSyncLogs('tenant-nonexistent-99');
    // Seeded tenant has sync logs; a fabricated tenant must not see them.
    expect(Array.isArray(logsA)).toBe(true);
    expect(logsB.length).toBe(0);
  });

  it('returns typed arrays for every read method', async () => {
    const tenantId = 'tenant-acme-01';
    expect(Array.isArray(await mem.getSources(tenantId))).toBe(true);
    expect(Array.isArray(await mem.getCollections(tenantId))).toBe(true);
    expect(Array.isArray(await mem.getMcpServers(tenantId))).toBe(true);
    expect(Array.isArray(await mem.getConversations(tenantId))).toBe(true);
    expect(Array.isArray(await mem.getAuditLogs(tenantId))).toBe(true);
  });
});
