const fs = require('fs');
let file = fs.readFileSync('src/lib/db/migrateAndSeedDrizzle.ts', 'utf8');

const replacement = `
  // 2. Drizzle ORM Seeding Implementation
  try {
    const db = getDrizzle();
    
    console.log('[Drizzle] Seeding initial collections...');
    if (INITIAL_COLLECTIONS.length > 0) {
      await db.insert(collections).values(INITIAL_COLLECTIONS.map(col => ({
        id: col.id,
        tenantId: col.tenantId,
        name: col.name,
        description: col.description || '',
        documentCount: col.documentCount || 0,
        createdAt: col.createdAt,
      }))).onConflictDoNothing();
    }

    console.log('[Drizzle] Seeding initial documents...');
    if (INITIAL_DOCUMENTS.length > 0) {
      await db.insert(documents).values(INITIAL_DOCUMENTS.map(docObj => ({
        id: docObj.id,
        tenantId: docObj.tenantId,
        title: docObj.title,
        content: docObj.content,
        sourceType: docObj.sourceType || 'file',
        language: docObj.language,
        status: docObj.status,
        chunkCount: docObj.chunkCount || 0,
        createdAt: docObj.createdAt,
        metadata: docObj.metadata || {},
        collectionIds: docObj.collectionIds || [],
      }))).onConflictDoNothing();
    }

    console.log('[Drizzle] Seeding initial chunks...');
    if (INITIAL_CHUNKS.length > 0) {
      await db.insert(chunks).values(INITIAL_CHUNKS.map(chunk => ({
        id: chunk.id,
        tenantId: chunk.tenantId,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle || '',
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber || 1,
        language: chunk.language,
        metadata: chunk.metadata || {},
      }))).onConflictDoNothing();
    }

    console.log('[Drizzle] Seeding initial MCP servers...');
    if (INITIAL_MCP_SERVERS.length > 0) {
      await db.insert(mcpServers).values(INITIAL_MCP_SERVERS.map(s => ({
        id: s.id,
        tenantId: s.tenantId,
        name: s.name,
        description: s.description || '',
        endpointUrl: s.endpointUrl,
        protocolVersion: s.protocolVersion,
        sandboxTier: s.sandboxTier,
        enabledTools: s.enabledTools || [],
        requireConfirmationTools: s.requireConfirmationTools || [],
        status: s.status,
        latencyMs: s.latencyMs || 0,
        lastChecked: s.lastChecked,
        headers: s.headers || {},
        category: s.category || '',
        url: s.url || '',
        authType: s.authType || 'none',
        transportType: s.transportType || 'http',
        config: s.config || {},
        customToolSchemas: s.customToolSchemas || {},
        createdAt: '',
      }))).onConflictDoNothing();
    }

    console.log('[Drizzle] Seeding initial sources...');
    if (INITIAL_SOURCES.length > 0) {
      await db.insert(sources).values(INITIAL_SOURCES.map(s => ({
        id: s.id,
        tenantId: s.tenantId,
        name: s.name,
        type: s.type,
        status: s.status,
        config: s.config || {},
        syncSchedule: s.syncSchedule || '',
        lastSyncAt: s.lastSyncAt || '',
        documentCount: s.documentCount || 0,
        lastError: s.lastError || '',
        createdAt: s.createdAt,
        collectionIds: s.collectionIds || [],
      }))).onConflictDoNothing();
    }

    console.log('[Drizzle] Seeding initial audit logs...');
    if (INITIAL_AUDIT_LOGS.length > 0) {
      await db.insert(auditLogs).values(INITIAL_AUDIT_LOGS.map(log => ({
        id: log.id,
        tenantId: log.tenantId,
        actorId: log.actorId,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        status: log.status,
        details: log.details || '',
        timestamp: log.timestamp,
      }))).onConflictDoNothing();
    }

    console.log('[Drizzle] Database seeding and schema migrations complete.');
  } catch (seedErr) {
    console.error('[Drizzle] Seeding failed:', seedErr);
    throw seedErr;
  }
}
`;

const startIndex = file.indexOf('  // 2. Drizzle ORM Seeding Implementation');
if (startIndex !== -1) {
  file = file.substring(0, startIndex) + replacement;
  fs.writeFileSync('src/lib/db/migrateAndSeedDrizzle.ts', file);
  console.log('Patched');
} else {
  console.error('Not found');
}
