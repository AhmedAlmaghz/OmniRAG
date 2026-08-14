'use server';

import { db } from '../lib/storage/db';
import { Tenant, Collection, MCPServerConfig, SourceConnector, Document, DocumentChunk } from '../lib/types/omnirag';

export async function seedNewTenant(tenantId: string, tenantName: string): Promise<void> {
  // Check if tenant has documents already to make this call fully idempotent and safe
  try {
    const existingDocs = await db.getDocuments(tenantId);
    if (existingDocs.length > 0) {
      console.log(`[Seeding] Tenant ${tenantId} is already seeded. Skipping.`);
      return;
    }
  } catch (err) {
    console.error(`[Seeding] Error checking existing tenant documents:`, err);
  }

  const colId = `col-general-${tenantId.slice(-6)}`;
  const mcpServerId = `mcp-core-${tenantId.slice(-6)}`;
  const sourceId = `src-guide-${tenantId.slice(-6)}`;
  const docId = `doc-welcome-${tenantId.slice(-6)}`;
  const chunkId = `chunk-welcome-${tenantId.slice(-6)}`;

  const initialCollection: Collection = {
    id: colId,
    tenantId,
    name: 'الوثائق الأساسية والسياسات',
    description: 'المستودع المركزي للأنظمة واللوائح والقرارات الإدارية للمؤسسة',
    documentCount: 1,
    createdAt: new Date().toISOString(),
  };
  await db.addCollection(initialCollection);

  const initialMcpServer: MCPServerConfig = {
    id: mcpServerId,
    tenantId,
    name: 'خادم الأدوات الرئيسي للمؤسسة',
    description: 'بوابة خادم أدوات MCP الأساسية للبحث المباشر ودمج قواعد البيانات',
    endpointUrl: 'https://mcp.omnirag.internal/core',
    protocolVersion: '2026-07-28',
    sandboxTier: 'T1_LIMITED',
    status: 'healthy',
    latencyMs: 120,
    lastChecked: new Date().toISOString(),
    enabledTools: ['web_live_search', 'fetch_url_content', 'knowledge_ingest_document', 'external_postgres_query'],
    requireConfirmationTools: ['external_postgres_query'],
  };
  await db.addMcpServer(initialMcpServer);

  const unstructuredMcpServer: MCPServerConfig = {
    id: `mcp-unstructured-transform-${tenantId.slice(-6)}`,
    tenantId,
    name: 'Unstructured Transform',
    description: 'Connect to the official Unstructured Transform MCP server for advanced document transform, clean and chunk pipelines.',
    endpointUrl: 'https://mcp.transform.unstructured.io',
    protocolVersion: '2026-07-28',
    sandboxTier: 'T2_ELEVATED',
    enabledTools: ['unstructured_transform_document', 'unstructured_chunk_document'],
    requireConfirmationTools: [],
    status: 'healthy',
    latencyMs: 45,
    lastChecked: new Date().toISOString(),
  };
  await db.addMcpServer(unstructuredMcpServer);

  const initialSource: SourceConnector = {
    id: sourceId,
    tenantId,
    name: 'دليل التشغيل الأمني والسياسات',
    type: 'file',
    status: 'healthy',
    config: {},
    syncSchedule: 'manual',
    documentCount: 1,
    collectionIds: [colId],
    createdAt: new Date().toISOString(),
  };
  await db.addSource(initialSource);

  const welcomeTitle = `دليل التشغيل لمنصة OmniRAG في ${tenantName}`;
  const welcomeContent = `مرحباً بك في منصة OmniRAG المؤسسية المتقدمة لـ (${tenantName})!\n\nهذه المساحة مخصصة ومعزولة بالكامل رقمياً باستخدام نظام Row-Level Security (RLS) ومؤمنة حتمياً بواسطة خطافات HookHarness الأمنية لمنع تسريب البيانات وعزل المستأجرين.\n\nخطوات تشغيلية موصى بها:\n1. استكشف استوديو المحادثة المعززة الذكي للتفاعل مع ملفاتك.\n2. ارفع وثائق أو ملفات PDF جديدة في مستودع المعرفة للتقسيم والفهرسة التلقائية.\n3. أدر واختبر موصلات البيانات وخوادم MCP في بوابة الأدوات الخارجية.\n4. تابع سجلات التدقيق والتحليلات الأمنية الفورية في مركز الحوكمة والأمن.`;
  
  const welcomeDoc: Document = {
    id: docId,
    tenantId,
    title: welcomeTitle,
    content: welcomeContent,
    sourceType: 'file',
    language: 'ar',
    status: 'indexed',
    chunkCount: 1,    createdAt: new Date().toISOString(),
    metadata: { sourceId, author: 'منصة OmniRAG' },
    collectionIds: [colId],
  };
  await db.addDocument(welcomeDoc);

  const welcomeChunk: DocumentChunk = {
    id: chunkId,
    tenantId,
    documentId: docId,
    documentTitle: welcomeTitle,
    content: welcomeContent,
    chunkIndex: 0,
    pageNumber: 1,
    language: 'ar',
    metadata: { sourceId },
  };
  await db.addChunk(welcomeChunk);
}
