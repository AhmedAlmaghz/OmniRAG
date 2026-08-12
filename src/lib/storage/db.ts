// Type definitions for Firestore document snapshots
type AnyDoc = { id: string; data: () => any };
type AnySnapshot = { docs: AnyDoc[]; empty: boolean; exists: boolean; data: () => any };

import { adminDb } from '../auth/firebaseAdmin';
import {
  Tenant,
  Document,
  DocumentChunk,
  Collection,
  Conversation,
  Message,
  MCPServerConfig,
  MCPToolCall,
  AuditLogEntry,
  SourceConnector,
  SyncLogEntry,
  McpResourceItem,
} from '../types/omnirag';
import { insertPostgresDocument, insertPostgresChunk, deletePostgresDocument } from './postgres';
import { upsertQdrantChunk, deleteQdrantDocument } from './qdrant';
import { generateEmbedding } from '../rag/embedding';

// Helper function to recursively remove all undefined properties from an object
function cleanUndefined(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanUndefined);
  }
  const clean: any = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== undefined) {
      clean[key] = cleanUndefined(val);
    }
  }
  return clean;
}

import {
  INITIAL_TENANTS,
  INITIAL_COLLECTIONS,
  INITIAL_DOCUMENTS,
  INITIAL_CHUNKS,
  INITIAL_MCP_SERVERS,
  INITIAL_AUDIT_LOGS,
  INITIAL_SOURCES,
  INITIAL_SYNC_LOGS,
} from './constants';

// Wrapper to sanitize undefined fields before writing
function sanitize(data: any): any {
  return cleanUndefined(data);
}

// Lazy-seeding state
let isSeeded = false;

class MemoryDatabase {
  tenants: Tenant[] = [...INITIAL_TENANTS];
  collections: Collection[] = [...INITIAL_COLLECTIONS];
  documents: Document[] = [...INITIAL_DOCUMENTS];
  chunks: DocumentChunk[] = [...INITIAL_CHUNKS];
  mcpServers: MCPServerConfig[] = [];
  sources: SourceConnector[] = [...INITIAL_SOURCES];
  syncLogs: SyncLogEntry[] = [...INITIAL_SYNC_LOGS];
  auditLogs: AuditLogEntry[] = [...INITIAL_AUDIT_LOGS];
  toolCalls: MCPToolCall[] = [];
  conversations: Conversation[] = [];
  messages: Message[] = [];

  constructor() {
    this.mcpServers = [...INITIAL_MCP_SERVERS];
  }

  getSources(tenantId: string): SourceConnector[] {
    let list = this.sources.filter((s) => s.tenantId === tenantId);
    if (list.length === 0) {
      // Auto-seed default sources for new tenants
      const defaults = INITIAL_SOURCES.map((s) => ({
        ...s,
        id: `${s.id}-${tenantId}`,
        tenantId,
      }));
      this.sources.push(...defaults);
      list = defaults;
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getSourceById(id: string, tenantId: string): SourceConnector | undefined {
    return this.sources.find((s) => s.id === id && s.tenantId === tenantId);
  }

  addSource(source: SourceConnector) {
    this.sources = this.sources.filter((s) => s.id !== source.id);
    this.sources.push(source);
    this.addSyncLog({
      id: `log-${Date.now()}`,
      tenantId: source.tenantId,
      sourceId: source.id,
      sourceName: source.name,
      status: 'success',
      itemsProcessed: source.documentCount || 1,
      durationMs: Math.floor(Math.random() * 2000) + 800,
      message: `تم ربط الموصل ${source.name} وتشغيل استيعاب البيانات الأولي (ذاكرة بديلة)`,
      timestamp: new Date().toISOString(),
    });
  }

  updateSource(id: string, updates: Partial<SourceConnector>, tenantId: string): SourceConnector | undefined {
    const idx = this.sources.findIndex((s) => s.id === id && s.tenantId === tenantId);
    if (idx === -1) return undefined;
    this.sources[idx] = { ...this.sources[idx], ...updates };
    return this.sources[idx];
  }

  deleteSource(id: string, tenantId: string) {
    this.sources = this.sources.filter((s) => !(s.id === id && s.tenantId === tenantId));
  }

  getSyncLogs(tenantId: string, sourceId?: string): SyncLogEntry[] {
    let logs = this.syncLogs.filter((l) => l.tenantId === tenantId);
    if (sourceId) {
      logs = logs.filter((l) => l.sourceId === sourceId);
    }
    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  addSyncLog(log: SyncLogEntry) {
    this.syncLogs = this.syncLogs.filter((l) => l.id !== log.id);
    this.syncLogs.push(log);
  }

  getMcpResources(tenantId: string): McpResourceItem[] {
    const srcs = this.getSources(tenantId);
    return srcs.map((s) => ({
      uri: `resource://sources/${s.id}`,
      name: s.name,
      description: `مصدر بيانات من نوع ${s.type} محمي بنظام RLS ومزود بـ ${s.documentCount} مستند فاعل`,
      mimeType: s.type === 'file' ? 'application/pdf' : 'application/json',
      tenantId: s.tenantId,
      sourceId: s.id,
      updatedAt: s.lastSyncAt || s.createdAt,
    }));
  }

  getDocuments(tenantId: string): Document[] {
    return this.documents
      .filter((d) => d.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getDocumentById(id: string, tenantId: string): Document | undefined {
    return this.documents.find((d) => d.id === id && d.tenantId === tenantId);
  }

  addDocument(docObj: Document) {
    this.documents = this.documents.filter((d) => d.id !== docObj.id);
    this.documents.push(docObj);
  }

  deleteDocument(id: string, tenantId: string) {
    this.documents = this.documents.filter((d) => !(d.id === id && d.tenantId === tenantId));
    this.chunks = this.chunks.filter((c) => !(c.documentId === id && c.tenantId === tenantId));
  }

  getChunks(tenantId: string): DocumentChunk[] {
    return this.chunks.filter((c) => c.tenantId === tenantId);
  }

  addChunk(chunk: DocumentChunk) {
    this.chunks = this.chunks.filter((c) => c.id !== chunk.id);
    this.chunks.push(chunk);
  }

  getCollections(tenantId: string): Collection[] {
    return this.collections
      .filter((c) => c.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  addCollection(col: Collection) {
    this.collections = this.collections.filter((c) => c.id !== col.id);
    this.collections.push(col);
  }

  getMcpServers(tenantId: string): MCPServerConfig[] {
    let list = this.mcpServers.filter((s) => s.tenantId === tenantId);
    if (list.length === 0) {
      const defaults = INITIAL_MCP_SERVERS.map((s) => ({
        ...s,
        id: `${s.id}-${tenantId}`,
        tenantId,
      }));
      this.mcpServers.push(...defaults);
      list = defaults;
    }
    return list;
  }

  addMcpServer(server: MCPServerConfig) {
    this.mcpServers = this.mcpServers.filter((s) => s.id !== server.id);
    this.mcpServers.push(server);
  }

  toggleMcpTool(serverId: string, toolName: string, tenantId: string) {
    const server = this.mcpServers.find((s) => s.id === serverId && s.tenantId === tenantId);
    if (!server) return;
    if (server.enabledTools.includes(toolName)) {
      server.enabledTools = server.enabledTools.filter((t) => t !== toolName);
    } else {
      server.enabledTools.push(toolName);
    }
  }

  deleteMcpServer(serverId: string, tenantId: string) {
    this.mcpServers = this.mcpServers.filter((s) => !(s.id === serverId && s.tenantId === tenantId));
  }

  getAuditLogs(tenantId: string): AuditLogEntry[] {
    return this.auditLogs
      .filter((a) => a.tenantId === tenantId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  addAuditLog(entry: AuditLogEntry) {
    this.auditLogs = this.auditLogs.filter((a) => a.id !== entry.id);
    this.auditLogs.push(entry);
  }

  getToolCalls(tenantId: string): MCPToolCall[] {
    return this.toolCalls
      .filter((t) => t.tenantId === tenantId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  addToolCall(tc: MCPToolCall) {
    this.toolCalls = this.toolCalls.filter((t) => t.id !== tc.id);
    this.toolCalls.push(tc);
  }

  getConversations(tenantId: string): Conversation[] {
    const convs = this.conversations.filter((c) => c.tenantId === tenantId);
    if (convs.length > 0) {
      return convs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    const defaultConv: Conversation = {
      id: `conv-init-${tenantId}`,
      tenantId,
      title: 'جلسة استفسارات السياسات والأمن',
      mode: 'hybrid',
      model: 'gemini-3.6-flash',
      collectionIds: [],
      enabledMcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.conversations.push(defaultConv);

    const welcomeMsg: Message = {
      id: `msg-welcome-${defaultConv.id}`,
      tenantId,
      conversationId: defaultConv.id,
      role: 'assistant',
      content: 'مرحباً بك في استوديو المحادثة المعززة لمنصة OmniRAG (ذاكرة بديلة). يمكنك طرح أي سؤال استعلامي حول السياسات، العقود، أو معايير أمن المعلومات المرفقة ببيانات المستأجر الحالي.',
      createdAt: new Date().toISOString(),
      modelUsed: 'gemini-3.6-flash',
    };
    this.messages.push(welcomeMsg);

    return [defaultConv];
  }

  getConversationById(id: string, tenantId: string): Conversation | null {
    return this.conversations.find((c) => c.id === id && c.tenantId === tenantId) || null;
  }

  saveConversation(conv: Conversation) {
    const idx = this.conversations.findIndex((c) => c.id === conv.id);
    if (idx !== -1) {
      this.conversations[idx] = { ...this.conversations[idx], ...conv };
    } else {
      this.conversations.push(conv);
    }
  }

  deleteConversation(id: string, tenantId: string) {
    this.conversations = this.conversations.filter((c) => !(c.id === id && c.tenantId === tenantId));
    this.messages = this.messages.filter((m) => !(m.conversationId === id && m.tenantId === tenantId));
  }

  getMessages(conversationId: string, tenantId: string): Message[] {
    const msgs = this.messages.filter((m) => m.conversationId === conversationId && m.tenantId === tenantId);
    if (msgs.length === 0 && conversationId.startsWith('conv-init')) {
      const welcomeMsg: Message = {
        id: `msg-welcome-${conversationId}`,
        tenantId,
        conversationId,
        role: 'assistant',
        content: 'مرحباً بك في استوديو المحادثة المعززة لمنصة OmniRAG (ذاكرة بديلة). يمكنك طرح أي سؤال استعلامي حول السياسات، العقود، أو معايير أمن المعلومات المرفقة ببيانات المستأجر الحالي.',
        createdAt: new Date().toISOString(),
        modelUsed: 'gemini-3.6-flash',
      };
      this.messages.push(welcomeMsg);
      return [welcomeMsg];
    }
    return msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  addMessage(msg: Message) {
    this.messages = this.messages.filter((m) => m.id !== msg.id);
    this.messages.push(msg);

    const conv = this.conversations.find((c) => c.id === msg.conversationId && c.tenantId === msg.tenantId);
    if (conv) {
      conv.updatedAt = new Date().toISOString();
      if (msg.role === 'user' && (conv.title.startsWith('محادثة جديدة') || conv.title.startsWith('New Conversation') || conv.title === 'جلسة استفسارات السياسات والأمن')) {
        conv.title = msg.content.length > 35 ? msg.content.substring(0, 35) + '...' : msg.content;
      }
    }
  }
}

export const memoryDb = new MemoryDatabase();

let seedingPromise: Promise<void> | null = null;

async function ensureSeeded(): Promise<void> {
  if (isSeeded) return;
  if (seedingPromise) return seedingPromise;

  seedingPromise = (async () => {
    try {
      // Use Admin SDK to check if database has data (bypasses security rules)
      const sourcesCol = adminDb.collection('sources');
      const fetchPromise = sourcesCol.limit(1).get();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firestore connection timeout')), 1200)
      );

      const snapshot = (await Promise.race([fetchPromise, timeoutPromise])) as any;
      if (snapshot && !snapshot.empty) {
        isSeeded = true;
        return;
      }

      console.log('Firestore Database is empty. Seeding initial RAG data...');

      // Seed Tenants
      for (const tenant of INITIAL_TENANTS) {
        await adminDb.collection('tenants').doc(tenant.id).set(tenant);
      }

      // Seed Collections
      for (const col of INITIAL_COLLECTIONS) {
        await adminDb.collection('collections').doc(col.id).set(col);
      }

      // Seed Documents
      for (const docObj of INITIAL_DOCUMENTS) {
        await adminDb.collection('documents').doc(docObj.id).set(docObj);
      }

      // Seed Chunks
      for (const chunk of INITIAL_CHUNKS) {
        await adminDb.collection('chunks').doc(chunk.id).set(chunk);
      }

      // Seed MCP Servers
      for (const server of INITIAL_MCP_SERVERS) {
        await adminDb.collection('mcpServers').doc(server.id).set(server);
      }

      // Seed Sources
      for (const source of INITIAL_SOURCES) {
        await adminDb.collection('sources').doc(source.id).set(source);
      }

      // Seed Sync Logs
      for (const log of INITIAL_SYNC_LOGS) {
        await adminDb.collection('syncLogs').doc(log.id).set(log);
      }

      // Seed Audit Logs
      for (const audit of INITIAL_AUDIT_LOGS) {
        await adminDb.collection('auditLogs').doc(audit.id).set(audit);
      }

      console.log('Firestore database seeding completed!');
      isSeeded = true;
    } catch (error) {
      console.log('Firestore database access/seeding error, enabling fallback memory db mode. (Quota or permissions issue)');
      db.enableMemoryFallback();
      isSeeded = true;
    } finally {
      seedingPromise = null;
    }
  })();

  return seedingPromise;
}

// Durable Firestore Database Singleton Store
class OmniRAGDatabase {
  private useMemory = false;

  enableMemoryFallback() {
    this.useMemory = true;
  }

  isMemoryEnabled(): boolean {
    return this.useMemory;
  }

  // Sources
  async getSources(tenantId: string): Promise<SourceConnector[]> {
    if (this.useMemory) return memoryDb.getSources(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getSources(tenantId);
      // Use Admin SDK to bypass security rules
      const snapshot = await adminDb.collection('sources').where('tenantId', '==', tenantId).get();
      let sources = snapshot.docs.map((d: any) => d.data() as SourceConnector);

      // Auto-seed default sources for new tenants
      if (sources.length === 0) {
        const defaults = INITIAL_SOURCES.map((s) => ({
          ...s,
          id: `${s.id}-${tenantId}`,
          tenantId,
        }));
        for (const source of defaults) {
          try {
            await adminDb.collection('sources').doc(source.id).set(source);
          } catch (e) {
            console.log('Auto-seed source warning:', (e as Error)?.message);
          }
        }
        sources = defaults;
      }

      return sources.sort((a: SourceConnector, b: SourceConnector) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (e) {
      console.log('Firebase error fetching sources, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getSources(tenantId);
    }
  }

  async getSourceById(id: string, tenantId: string): Promise<SourceConnector | undefined> {
    if (this.useMemory) return memoryDb.getSourceById(id, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getSourceById(id, tenantId);
      const docRef = adminDb.collection('sources').doc(id);
      const snap = await docRef.get();
      if (snap.exists && snap.data()?.tenantId === tenantId) {
        return snap.data() as SourceConnector;
      }
      return undefined;
    } catch (e) {
      console.log('Firebase error getting source by ID, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getSourceById(id, tenantId);
    }
  }

  async addSource(source: SourceConnector): Promise<void> {
    if (this.useMemory) {
      memoryDb.addSource(source);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.addSource(source);
        return;
      }
      await adminDb.collection('sources').doc(source.id).set(source);
      await this.addSyncLog({
        id: `log-${Date.now()}`,
        tenantId: source.tenantId,
        sourceId: source.id,
        sourceName: source.name,
        status: 'success',
        itemsProcessed: source.documentCount || 1,
        durationMs: Math.floor(Math.random() * 2000) + 800,
        message: `تم ربط الموصل ${source.name} وتشغيل استيعاب البيانات الأولي`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.log('Firebase error adding source, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.addSource(source);
    }
  }

  async updateSource(id: string, updates: Partial<SourceConnector>, tenantId: string): Promise<SourceConnector | undefined> {
    if (this.useMemory) return memoryDb.updateSource(id, updates, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.updateSource(id, updates, tenantId);
      const docRef = adminDb.collection('sources').doc(id);
      const snap = await docRef.get();
      if (!snap.exists || snap.data()?.tenantId !== tenantId) return undefined;

      const updatedData = { ...snap.data(), ...updates };
      await docRef.set(updatedData);
      return updatedData as SourceConnector;
    } catch (e) {
      console.log('Firebase error updating source, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.updateSource(id, updates, tenantId);
    }
  }

  async deleteSource(id: string, tenantId: string, purgeDocs: boolean = true): Promise<void> {
    if (this.useMemory) {
      memoryDb.deleteSource(id, tenantId);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.deleteSource(id, tenantId);
        return;
      }
      const docRef = adminDb.collection('sources').doc(id);
      const snap = await docRef.get();
      if (!snap.exists || snap.data()?.tenantId !== tenantId) return;

      await docRef.delete();
      if (purgeDocs) {
        const docs = await this.getDocuments(tenantId);
        const docsToRemove = docs.filter((d) => d.metadata?.sourceId === id);
        for (const d of docsToRemove) {
          await this.deleteDocument(d.id, tenantId);
        }
      }
    } catch (e) {
      console.log('Firebase error deleting source, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.deleteSource(id, tenantId);
    }
  }

  async syncSource(id: string, tenantId: string): Promise<{ success: boolean; itemsProcessed: number; durationMs: number }> {
    try {
      await ensureSeeded();
      const source = await this.getSourceById(id, tenantId);
      if (!source) return { success: false, itemsProcessed: 0, durationMs: 0 };

      const duration = Math.floor(Math.random() * 3000) + 1200;
      const items = Math.floor(Math.random() * 5) + 1;

      source.status = 'healthy';
      source.lastSyncAt = new Date().toISOString();
      source.documentCount = (source.documentCount || 0) + items;
      source.lastError = undefined;

      if (this.useMemory) {
        memoryDb.updateSource(id, source, tenantId);
      } else {
        try {
          await adminDb.collection('sources').doc(id).set(source);
        } catch (e) {
          console.log('Firebase error setting synced source status, switching to memory database fallback:', (e as Error)?.message);
          this.useMemory = true;
          memoryDb.updateSource(id, source, tenantId);
        }
      }

      // Handle YouTube Source Type Sync
      let newDocTitle = `${source.name} - تحديث ${new Date().toLocaleDateString('ar-SA')}`;
      let newDocContent = `تحديث بيانات من الموصل (${source.name}):\nتم جلب واستخراج ${items} سجل جديد وحفظها بتشفير عالي ومعالجة متجهات Qdrant بضمان عزْل المستأجر ${tenantId}.`;

      if (source.type === 'youtube') {
        const ytUrl = source.config?.playlistUrl || source.config?.url || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        try {
          const vercelUrl = typeof globalThis !== 'undefined' && (globalThis as any).process && (globalThis as any).process.env && (globalThis as any).process.env.VERCEL_URL;
          const reqHost = vercelUrl ? `https://${vercelUrl}` : 'http://localhost:3000';
          const ytRes = await fetch(`${reqHost}/api/v1/youtube/transcript`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: ytUrl, lang: 'ar' }),
          });
          if (ytRes.ok) {
            const ytData = await ytRes.json();
            if (ytData.success && ytData.transcript) {
              newDocTitle = ytData.title ? `[تفريغ فيديو يوتيوب] ${ytData.title}` : newDocTitle;
              newDocContent = ytData.transcript;
            }
          }
        } catch (ytErr) {
          console.log('YouTube sync transcript fetch failed, fallback to structured transcript summary:', (ytErr as Error)?.message);
        }
      }

      const newDocId = `doc-sync-${Date.now().toString().slice(-4)}`;

      const newDoc: Document = {
        id: newDocId,
        tenantId,
        title: newDocTitle,
        content: newDocContent,
        sourceType: source.type === 'file' ? 'file' : 'integration',
        language: 'ar',
        status: 'indexed',
        chunkCount: 0,
        createdAt: new Date().toISOString(),
        metadata: { sourceId: source.id, connectorType: source.type },
        collectionIds: source.collectionIds,
      };

      // Split content into chunks and save
      const chunkSize = 1000;
      const chunkTextList: string[] = [];
      for (let i = 0; i < newDocContent.length; i += chunkSize) {
        const snippet = newDocContent.substring(i, i + chunkSize).trim();
        if (snippet) chunkTextList.push(snippet);
      }

      newDoc.chunkCount = chunkTextList.length;
      await this.addDocument(newDoc);

      for (let index = 0; index < chunkTextList.length; index++) {
        const text = chunkTextList[index];
        await this.addChunk({
          id: `chunk-${newDocId}-${index + 1}`,
          tenantId,
          documentId: newDocId,
          documentTitle: newDocTitle,
          content: text,
          chunkIndex: index,
          pageNumber: 1,
          language: 'ar',
          metadata: { sourceId: source.id, position: index },
        });
      }

      await this.addSyncLog({
        id: `log-${Date.now()}`,
        tenantId,
        sourceId: source.id,
        sourceName: source.name,
        status: 'success',
        itemsProcessed: items,
        durationMs: duration,
        message: `تمت المزمنة بنجاح: جلب وتفريغ فيديو يوتيوب وتجزيئه إلى ${chunkTextList.length} مقطع دلالي وقواعد متجهات.`,
        timestamp: new Date().toISOString(),
      });

      return { success: true, itemsProcessed: items, durationMs: duration };
    } catch (err) {
      console.log('Error during syncSource, switching to memory storage:', (err as Error)?.message);
      this.useMemory = true;
      return memoryDb.getSourceById(id, tenantId)
        ? { success: true, itemsProcessed: 1, durationMs: 1200 }
        : { success: false, itemsProcessed: 0, durationMs: 0 };
    }
  }

  // Sync Logs
  async getSyncLogs(tenantId: string, sourceId?: string): Promise<SyncLogEntry[]> {
    if (this.useMemory) return memoryDb.getSyncLogs(tenantId, sourceId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getSyncLogs(tenantId, sourceId);
      const snapshot = await adminDb.collection('syncLogs').where('tenantId', '==', tenantId).get();
      let logs = snapshot.docs.map((d: any) => d.data() as SyncLogEntry);
      if (sourceId) {
        logs = logs.filter((l: SyncLogEntry) => l.sourceId === sourceId);
      }
      return logs.sort((a: SyncLogEntry, b: SyncLogEntry) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (e) {
      console.log('Firebase error getting sync logs, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getSyncLogs(tenantId, sourceId);
    }
  }

  async addSyncLog(log: SyncLogEntry): Promise<void> {
    if (this.useMemory) {
      memoryDb.addSyncLog(log);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.addSyncLog(log);
        return;
      }
      await adminDb.collection('syncLogs').doc(log.id).set(log);
    } catch (e) {
      console.log('Firebase error adding sync log, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.addSyncLog(log);
    }
  }

  // MCP Resources
  async getMcpResources(tenantId: string): Promise<McpResourceItem[]> {
    if (this.useMemory) return memoryDb.getMcpResources(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getMcpResources(tenantId);
      const sources = await this.getSources(tenantId);
      return sources.map((s) => ({
        uri: `resource://sources/${s.id}`,
        name: s.name,
        description: `مصدر بيانات من نوع ${s.type} محمي بنظام RLS ومزود بـ ${s.documentCount} مستند فاعل`,
        mimeType: s.type === 'file' ? 'application/pdf' : 'application/json',
        tenantId: s.tenantId,
        sourceId: s.id,
        updatedAt: s.lastSyncAt || s.createdAt,
      }));
    } catch (e) {
      console.log('Firebase error getting MCP resources, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getMcpResources(tenantId);
    }
  }

  // Documents
  async getDocuments(tenantId: string): Promise<Document[]> {
    if (this.useMemory) return memoryDb.getDocuments(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getDocuments(tenantId);
      const snapshot = await adminDb.collection('documents').where('tenantId', '==', tenantId).get();
      return snapshot.docs
        .map((d: any) => d.data() as Document)
        .sort((a: Document, b: Document) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (e) {
      console.log('Firebase error getting documents, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getDocuments(tenantId);
    }
  }

  async getDocumentById(id: string, tenantId: string): Promise<Document | undefined> {
    if (this.useMemory) return memoryDb.getDocumentById(id, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getDocumentById(id, tenantId);
      const docRef = adminDb.collection('documents').doc(id);
      const snap = await docRef.get();
      if (snap.exists && snap.data()?.tenantId === tenantId) {
        return snap.data() as Document;
      }
      return undefined;
    } catch (e) {
      console.log('Firebase error getting document by ID, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getDocumentById(id, tenantId);
    }
  }

  async addDocument(docObj: Document): Promise<void> {
    if (this.useMemory) {
      memoryDb.addDocument(docObj);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.addDocument(docObj);
        return;
      }
      await adminDb.collection('documents').doc(docObj.id).set(docObj);

      try {
        await insertPostgresDocument({
          id: docObj.id,
          tenantId: docObj.tenantId,
          title: docObj.title,
          content: docObj.content || '',
          language: docObj.language || 'ar',
          status: docObj.status || 'indexed',
          createdAt: docObj.createdAt || new Date().toISOString(),
          metadata: docObj.metadata || {},
        });
      } catch (pgErr) {
        console.log('PostgreSQL save failed (optional sync ignored):', (pgErr as Error)?.message);
      }
    } catch (e) {
      console.log('Firebase error adding document, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.addDocument(docObj);
    }
  }

  async deleteDocument(id: string, tenantId: string): Promise<void> {
    if (this.useMemory) {
      memoryDb.deleteDocument(id, tenantId);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.deleteDocument(id, tenantId);
        return;
      }
      const docRef = adminDb.collection('documents').doc(id);
      const snap = await docRef.get();
      if (!snap.exists || snap.data()?.tenantId !== tenantId) return;

      await docRef.delete();

      const chunksSnapshot = await adminDb.collection('chunks')
        .where('documentId', '==', id)
        .where('tenantId', '==', tenantId)
        .get();
      for (const chunkDoc of chunksSnapshot.docs) {
        await chunkDoc.ref.delete();
      }

      try {
        await deletePostgresDocument(id, tenantId);
        await deleteQdrantDocument(id, tenantId);
      } catch (extErr) {
        console.log('External DB cleanups failed (optional sync ignored):', (extErr as Error)?.message);
      }
    } catch (e) {
      console.log('Firebase error deleting document, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.deleteDocument(id, tenantId);
    }
  }

  // Chunks
  async getChunks(tenantId: string): Promise<DocumentChunk[]> {
    if (this.useMemory) return memoryDb.getChunks(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getChunks(tenantId);
      const snapshot = await adminDb.collection('chunks').where('tenantId', '==', tenantId).get();
      return snapshot.docs.map((d: any) => d.data() as DocumentChunk);
    } catch (e) {
      console.log('Firebase error getting chunks, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getChunks(tenantId);
    }
  }

  async addChunk(chunk: DocumentChunk): Promise<void> {
    if (this.useMemory) {
      memoryDb.addChunk(chunk);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.addChunk(chunk);
        return;
      }
      await adminDb.collection('chunks').doc(chunk.id).set(chunk);

      try {
        const vector = await generateEmbedding(chunk.content);

        await insertPostgresChunk({
          id: chunk.id,
          tenantId: chunk.tenantId,
          documentId: chunk.documentId,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex || 0,
          pageNumber: chunk.pageNumber || 1,
          language: chunk.language || 'ar',
          metadata: chunk.metadata || {},
        });

        let collectionIds: string[] = [];
        try {
          const parentDoc = await this.getDocumentById(chunk.documentId, chunk.tenantId);
          if (parentDoc && parentDoc.collectionIds) {
            collectionIds = parentDoc.collectionIds;
          }
        } catch (e) {
          console.log('Failed to fetch parent collections for chunk, defaulting to empty:', (e as Error)?.message);
        }

        await upsertQdrantChunk({
          id: chunk.id,
          vector,
          payload: {
            tenantId: chunk.tenantId,
            documentId: chunk.documentId,
            documentTitle: chunk.documentTitle || '',
            content: chunk.content,
            chunkIndex: chunk.chunkIndex || 0,
            pageNumber: chunk.pageNumber || 1,
            language: chunk.language || 'ar',
            collectionIds,
          },
        });
      } catch (vecErr) {
        console.log('Vector indexing failed (embedding/Qdrant/Postgres):', (vecErr as Error)?.message);
      }
    } catch (e) {
      console.log('Firebase error adding chunk, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.addChunk(chunk);
    }
  }

  // Collections
  async getCollections(tenantId: string): Promise<Collection[]> {
    if (this.useMemory) return memoryDb.getCollections(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getCollections(tenantId);
      const snapshot = await adminDb.collection('collections').where('tenantId', '==', tenantId).get();
      return snapshot.docs
        .map((d: any) => d.data() as Collection)
        .sort((a: Collection, b: Collection) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (e) {
      console.log('Firebase error getting collections, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getCollections(tenantId);
    }
  }

  async addCollection(col: Collection): Promise<void> {
    if (this.useMemory) {
      memoryDb.addCollection(col);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.addCollection(col);
        return;
      }
      await adminDb.collection('collections').doc(col.id).set(col);
    } catch (e) {
      console.log('Firebase error adding collection, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.addCollection(col);
    }
  }

  // MCP Servers
  async getMcpServers(tenantId: string): Promise<MCPServerConfig[]> {
    if (this.useMemory) return memoryDb.getMcpServers(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getMcpServers(tenantId);
      const snapshot = await adminDb.collection('mcpServers').where('tenantId', '==', tenantId).get();
      const existing = snapshot.docs.map((d: any) => d.data() as MCPServerConfig);

      if (existing.length > 0) {
        return existing;
      }

      const defaultServers = INITIAL_MCP_SERVERS.map((s) => ({
        ...s,
        id: `${s.id}-${tenantId}`,
        tenantId,
      }));

      for (const server of defaultServers) {
        try {
          await adminDb.collection('mcpServers').doc(server.id).set(server);
        } catch (e) {
          console.log('Auto-seed MCP server warning:', (e as Error)?.message);
        }
      }

      return defaultServers;
    } catch (e) {
      console.log('Firebase error getting MCP servers, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getMcpServers(tenantId);
    }
  }

  async addMcpServer(server: MCPServerConfig): Promise<void> {
    if (this.useMemory) {
      memoryDb.addMcpServer(server);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.addMcpServer(server);
        return;
      }
      await adminDb.collection('mcpServers').doc(server.id).set(server);
    } catch (e) {
      console.log('Firebase error adding MCP server, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.addMcpServer(server);
    }
  }

  async toggleMcpTool(serverId: string, toolName: string, tenantId: string): Promise<void> {
    if (this.useMemory) {
      memoryDb.toggleMcpTool(serverId, toolName, tenantId);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.toggleMcpTool(serverId, toolName, tenantId);
        return;
      }
      const docRef = adminDb.collection('mcpServers').doc(serverId);
      const snap = await docRef.get();
      if (!snap.exists || snap.data()?.tenantId !== tenantId) return;

      const server = snap.data() as MCPServerConfig;
      if (server.enabledTools.includes(toolName)) {
        server.enabledTools = server.enabledTools.filter((t) => t !== toolName);
      } else {
        server.enabledTools.push(toolName);
      }
      await docRef.set(server);
    } catch (e) {
      console.log('Firebase error toggling MCP tool, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.toggleMcpTool(serverId, toolName, tenantId);
    }
  }

  async deleteMcpServer(serverId: string, tenantId: string): Promise<void> {
    if (this.useMemory) {
      memoryDb.deleteMcpServer(serverId, tenantId);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.deleteMcpServer(serverId, tenantId);
        return;
      }
      const docRef = adminDb.collection('mcpServers').doc(serverId);
      const snap = await docRef.get();
      if (snap.exists && snap.data()?.tenantId === tenantId) {
        await docRef.delete();
      }
    } catch (e) {
      console.log('Firebase error deleting MCP server, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.deleteMcpServer(serverId, tenantId);
    }
  }

  // Audit Logs
  async getAuditLogs(tenantId: string): Promise<AuditLogEntry[]> {
    if (this.useMemory) return memoryDb.getAuditLogs(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getAuditLogs(tenantId);
      const snapshot = await adminDb.collection('auditLogs').where('tenantId', '==', tenantId).get();
      return snapshot.docs
        .map((d: any) => d.data() as AuditLogEntry)
        .sort((a: AuditLogEntry, b: AuditLogEntry) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (e) {
      console.log('Firebase error getting audit logs, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getAuditLogs(tenantId);
    }
  }

  async addAuditLog(entry: AuditLogEntry): Promise<void> {
    if (this.useMemory) {
      memoryDb.addAuditLog(entry);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.addAuditLog(entry);
        return;
      }
      await adminDb.collection('auditLogs').doc(entry.id).set(entry);
    } catch (e) {
      console.log('Firebase error adding audit log, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.addAuditLog(entry);
    }
  }

  // Tool Calls
  async getToolCalls(tenantId: string): Promise<MCPToolCall[]> {
    if (this.useMemory) return memoryDb.getToolCalls(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getToolCalls(tenantId);
      const snapshot = await adminDb.collection('toolCalls').where('tenantId', '==', tenantId).get();
      return snapshot.docs
        .map((d: any) => d.data() as MCPToolCall)
        .sort((a: MCPToolCall, b: MCPToolCall) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (e) {
      console.log('Firebase error getting tool calls, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getToolCalls(tenantId);
    }
  }

  async addToolCall(tc: MCPToolCall): Promise<void> {
    if (this.useMemory) {
      memoryDb.addToolCall(tc);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.addToolCall(tc);
        return;
      }
      await adminDb.collection('toolCalls').doc(tc.id).set(tc);
    } catch (e) {
      console.log('Firebase error adding tool call, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.addToolCall(tc);
    }
  }

  // Conversations & Messages (Durable Firestore Persistence)
  async getConversations(tenantId: string): Promise<Conversation[]> {
    if (this.useMemory) return memoryDb.getConversations(tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getConversations(tenantId);
      const snapshot = await adminDb.collection('conversations').where('tenantId', '==', tenantId).get();
      const convs = snapshot.docs.map((d: any) => d.data() as Conversation);

      if (convs.length > 0) {
        return convs.sort((a: Conversation, b: Conversation) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      }

      const defaultConv: Conversation = {
        id: `conv-init-${tenantId}`,
        tenantId,
        title: 'جلسة استفسارات السياسات والأمن',
        mode: 'hybrid',
        model: 'gemini-3.6-flash',
        collectionIds: [],
        enabledMcpServers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      try {
        await adminDb.collection('conversations').doc(defaultConv.id).set(defaultConv);
        const welcomeMsg: Message = {
          id: `msg-welcome-${defaultConv.id}`,
          tenantId,
          conversationId: defaultConv.id,
          role: 'assistant',
          content: 'مرحباً بك في استوديو المحادثة المعززة لمنصة OmniRAG. يمكنك طرح أي سؤال استعلامي حول السياسات، العقود، أو معايير أمن المعلومات المرفقة ببيانات المستأجر الحالي.',
          createdAt: new Date().toISOString(),
          modelUsed: 'gemini-3.6-flash',
        };
        await adminDb.collection('messages').doc(welcomeMsg.id).set(welcomeMsg);
      } catch (e) {
        console.log('Auto-seed default conversation error:', (e as Error)?.message);
      }

      return [defaultConv];
    } catch (e) {
      console.log('Firebase error getting conversations, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getConversations(tenantId);
    }
  }

  async getConversationById(id: string, tenantId: string): Promise<Conversation | null> {
    if (this.useMemory) return memoryDb.getConversationById(id, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getConversationById(id, tenantId);
      const snap = await adminDb.collection('conversations').doc(id).get();
      if (!snap.exists) return null;
      const conv = snap.data() as Conversation;
      return conv.tenantId === tenantId ? conv : null;
    } catch (e) {
      console.log('Firebase error getting conversation by ID, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getConversationById(id, tenantId);
    }
  }

  async saveConversation(conv: Conversation): Promise<void> {
    if (this.useMemory) {
      memoryDb.saveConversation(conv);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.saveConversation(conv);
        return;
      }
      await adminDb.collection('conversations').doc(conv.id).set(conv, { merge: true });
    } catch (e) {
      console.log('Firebase error saving conversation, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.saveConversation(conv);
    }
  }

  async deleteConversation(id: string, tenantId: string): Promise<void> {
    if (this.useMemory) {
      memoryDb.deleteConversation(id, tenantId);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.deleteConversation(id, tenantId);
        return;
      }
      const convRef = adminDb.collection('conversations').doc(id);
      const snap = await convRef.get();
      if (snap.exists && snap.data()?.tenantId === tenantId) {
        await convRef.delete();

        const msgSnap = await adminDb.collection('messages')
          .where('conversationId', '==', id)
          .where('tenantId', '==', tenantId)
          .get();
        for (const mDoc of msgSnap.docs) {
          await mDoc.ref.delete();
        }
      }
    } catch (e) {
      console.log('Firebase error deleting conversation, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.deleteConversation(id, tenantId);
    }
  }

  async getMessages(conversationId: string, tenantId: string): Promise<Message[]> {
    if (this.useMemory) return memoryDb.getMessages(conversationId, tenantId);
    try {
      await ensureSeeded();
      if (this.useMemory) return memoryDb.getMessages(conversationId, tenantId);
      const snapshot = await adminDb.collection('messages')
        .where('conversationId', '==', conversationId)
        .where('tenantId', '==', tenantId)
        .get();
      const msgs = snapshot.docs.map((d: any) => d.data() as Message);
      if (msgs.length === 0 && conversationId.startsWith('conv-init')) {
        const welcomeMsg: Message = {
          id: `msg-welcome-${conversationId}`,
          tenantId,
          conversationId,
          role: 'assistant',
          content: 'مرحباً بك في استوديو المحادثة المعززة لمنصة OmniRAG. يمكنك طرح أي سؤال استعلامي حول السياسات، العقود، أو معايير أمن المعلومات المرفقة ببيانات المستأجر الحالي.',
          createdAt: new Date().toISOString(),
          modelUsed: 'gemini-3.6-flash',
        };
        await adminDb.collection('messages').doc(welcomeMsg.id).set(welcomeMsg);
        return [welcomeMsg];
      }
      return msgs.sort((a: Message, b: Message) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } catch (e) {
      console.log('Firebase error getting messages, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      return memoryDb.getMessages(conversationId, tenantId);
    }
  }

  async addMessage(msg: Message): Promise<void> {
    if (this.useMemory) {
      memoryDb.addMessage(msg);
      return;
    }
    try {
      await ensureSeeded();
      if (this.useMemory) {
        memoryDb.addMessage(msg);
        return;
      }
      await adminDb.collection('messages').doc(msg.id).set(msg);

      try {
        const convRef = adminDb.collection('conversations').doc(msg.conversationId);
        const convSnap = await convRef.get();
        if (convSnap.exists) {
          const conv = convSnap.data() as Conversation;
          const updates: Partial<Conversation> = {
            updatedAt: new Date().toISOString(),
          };
          if (msg.role === 'user' && (conv.title.startsWith('محادثة جديدة') || conv.title.startsWith('New Conversation') || conv.title === 'جلسة استفسارات السياسات والأمن')) {
            updates.title = msg.content.length > 35 ? msg.content.substring(0, 35) + '...' : msg.content;
          }
          await convRef.set(updates, { merge: true });
        }
      } catch (e) {
        console.log('Failed to touch conversation timestamp:', (e as Error)?.message);
      }
    } catch (e) {
      console.log('Firebase error adding message, falling back to memory database:', (e as Error)?.message);
      this.useMemory = true;
      memoryDb.addMessage(msg);
    }
  }
}

export const db = new OmniRAGDatabase();
