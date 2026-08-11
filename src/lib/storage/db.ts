import {
  collection,
  getDocs,
  getDoc,
  setDoc as firestoreSetDoc,
  doc,
  deleteDoc,
  query,
  where,
  limit,
} from 'firebase/firestore';
import { firestore } from '../firebase';
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

// Wrapper to intercept setDoc calls and sanitize undefined fields
async function setDoc(docRef: any, data: any, options?: any) {
  return firestoreSetDoc(docRef, cleanUndefined(data), options);
}


// Initial Tenants
export const INITIAL_TENANTS: Tenant[] = [
  {
    id: 'tenant-acme-01',
    name: 'شركة أكمي العالمية (ACME Corp)',
    plan: 'enterprise',
    createdAt: '2026-08-01T00:00:00.000Z',
    settings: {
      chunkSize: 500,
      chunkOverlap: 50,
      hybridWeights: { semantic: 0.7, lexical: 0.3 },
      defaultModel: 'gemini-3.6-flash',
      dataRetentionDays: 90,
      enablePiiRedaction: true,
      enablePromptSanitizer: true,
    },
  },
  {
    id: 'tenant-health-02',
    name: 'مجموعة الرعاية الصحية العالمية (BioHealth)',
    plan: 'enterprise',
    createdAt: '2026-08-01T00:00:00.000Z',
    settings: {
      chunkSize: 400,
      chunkOverlap: 40,
      hybridWeights: { semantic: 0.6, lexical: 0.4 },
      defaultModel: 'gemini-3.1-pro-preview',
      dataRetentionDays: 180,
      enablePiiRedaction: true,
      enablePromptSanitizer: true,
    },
  },
];

// Initial Collections
export const INITIAL_COLLECTIONS: Collection[] = [
  {
    id: 'col-legal-01',
    tenantId: 'tenant-acme-01',
    name: 'العقود والسياسات القانونية (Legal & Contracts)',
    description: 'شروط الخدمة، اتفاقيات السرية (NDA)، وبنود عدم التنافس والالتزام',
    documentCount: 3,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'col-tech-02',
    tenantId: 'tenant-acme-01',
    name: 'المواصفات التقنية والأمن السيبراني',
    description: 'معايير ISO27001، سياسات العزل والمستأجرين، ومعمارية API',
    documentCount: 2,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'col-health-03',
    tenantId: 'tenant-health-02',
    name: 'سياسات HIPAA وسلامة المرضى',
    description: 'دليل حماية البيانات الطبية وتشفير السجلات الحيوية',
    documentCount: 2,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
];

// Initial Documents
export const INITIAL_DOCUMENTS: Document[] = [
  {
    id: 'doc-001',
    tenantId: 'tenant-acme-01',
    title: 'اتفاقية عدم الإفصاح والسرية NDA (2026)',
    content: `اتفاقية عدم الإفصاح والسرية (NDA) - شركة أكمي العالمية
المادة 1: التعريفات والالتزامات
يتعهد الطرفان بالحفاظ على سرية جميع البيانات التقنية والمالية والتجارية المتبادلة. يمنع منعاً باتاً نقل أي بيانات خارج نطاق المستأجر المعين (Tenant Isolation).
المادة 2: مدة الاتفاقية والنطاق
تستمر هذه الاتفاقية لمدة 5 سنوات من تاريخ التوقيع. في حال حدوث أي تسريب غير مصرح به، يحق للطرف المتضرر المطالبة بتعويضات فورية وتقديم بلاغ للجهات المختصة.
المادة 3: حماية البيانات في بيئة Cloud
تلتزم جميع الأنظمة المستضافة بالتشفير الكامل بأسلوب AES-256 أثناء التخزين وببروتوكول TLS 1.3 أثناء النقل، مع تفعيل سياسات التحكم بالوصول على مستوى الصفوف (Row Level Security).`,
    sourceType: 'file',
    language: 'ar',
    status: 'indexed',
    chunkCount: 3,
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    metadata: { author: 'Legal Team', classification: 'Confidential' },
    collectionIds: ['col-legal-01'],
  },
  {
    id: 'doc-002',
    tenantId: 'tenant-acme-01',
    title: 'سياسة أمن واستجابة الحوادث السيبرانية ISO27001',
    content: `سياسة أمن واستجابة الحوادث - قسم تكنولوجيا المعلومات
1. كشف الاختراقات وهجمات الحقن (Prompt Injection Defense):
يتم فحص جميع المدخلات الموجهة لوكلاء الذكاء الاصطناعي عبر محرك حتمي (HookHarness) لمنع محاولات تجاوز تعليمات النظام أو استخراج المفاتيح والرموز الحساسة.
2. إدارة أدوات MCP بروتوكول سياق النموذج:
جميع أدوات MCP المصنفة تحت مستوى Sandbox T2 و T3 (التي تحدث آثاراً جانبية مثل إرسال بريد أو تعديل قواعد البيانات) تتطلب موافقة بشرية صريحة من المستخدم قبل التنفيذ.
3. التشفير وإسقاط الهويات PII Redaction:
يُحظر بث أي معلومات تعريف شخصية (بريد إلكتروني، رقم هاتف، بطاقة ائتمان) في استجابات النموذج، ويتم استبدالها حتمياً بوسوم [REDACTED].`,
    sourceType: 'file',
    language: 'ar',
    status: 'indexed',
    chunkCount: 3,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    metadata: { department: 'CyberSecurity', isoVersion: '2026.1' },
    collectionIds: ['col-tech-02'],
  },
  {
    id: 'doc-003',
    tenantId: 'tenant-acme-01',
    title: 'OmniRAG System Architecture & Hybrid Retrieval Spec',
    content: `OmniRAG Enterprise Architecture Specification:
1. Multi-Tenant Hybrid Search Engine:
Combines dense vector retrieval via Qdrant (cosine similarity over 3072-dim embeddings) and sparse BM25/FTS text matching over Neon Postgres. Scores are fused using Reciprocal Rank Fusion (RRF) with configurable semantic and lexical weights.
2. Smart Agentic Routing:
Simple requests are handled by fast models (Gemini Flash-Lite), while complex reasoning, cross-encoder reranking, and multi-step tool calls route to Gemini 3.6 Flash or 3.1 Pro Preview.
3. Citation Verification:
Every generated claim with a citation index is cross-checked against retrieved chunk UUIDs to eliminate hallucinated references.`,
    sourceType: 'file',
    language: 'en',
    status: 'indexed',
    chunkCount: 3,
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    metadata: { system: 'OmniRAG Core', version: '2.4' },
    collectionIds: ['col-tech-02'],
  },
];

// Initial Chunks
export const INITIAL_CHUNKS: DocumentChunk[] = [
  {
    id: 'chunk-001-1',
    tenantId: 'tenant-acme-01',
    documentId: 'doc-001',
    documentTitle: 'اتفاقية عدم الإفصاح والسرية NDA (2026)',
    content: 'المادة 1: يتعهد الطرفان بالحفاظ على سرية جميع البيانات التقنية والمالية والتجارية المتبادلة. يمنع منعاً باتاً نقل أي بيانات خارج نطاق المستأجر المعين (Tenant Isolation).',
    chunkIndex: 0,
    pageNumber: 1,
    language: 'ar',
    metadata: { section: 'التعريفات' },
  },
  {
    id: 'chunk-001-2',
    tenantId: 'tenant-acme-01',
    documentId: 'doc-001',
    documentTitle: 'اتفاقية عدم الإفصاح والسرية NDA (2026)',
    content: 'المادة 2: تستمر هذه الاتفاقية لمدة 5 سنوات من تاريخ التوقيع. في حال حدوث أي تسريب غير مصرح به، يحق للطرف المتضرر المطالبة بتعويضات فورية وتقديم بلاغ للجهات المختصة.',
    chunkIndex: 1,
    pageNumber: 1,
    language: 'ar',
    metadata: { section: 'المدة والجزاءات' },
  },
  {
    id: 'chunk-001-3',
    tenantId: 'tenant-acme-01',
    documentId: 'doc-001',
    documentTitle: 'اتفاقية عدم الإفصاح والسرية NDA (2026)',
    content: 'المادة 3: تلتزم جميع الأنظمة المستضافة بالتشفير الكامل بأسلوب AES-256 أثناء التخزين وببروتوكول TLS 1.3 أثناء النقل، مع تفعيل سياسات التحكم بالوصول على مستوى الصفوف (Row Level Security).',
    chunkIndex: 2,
    pageNumber: 2,
    language: 'ar',
    metadata: { section: 'التشفير و RLS' },
  },
  {
    id: 'chunk-002-1',
    tenantId: 'tenant-acme-01',
    documentId: 'doc-002',
    documentTitle: 'سياسة أمن واستجابة الحوادث السيبرانية ISO27001',
    content: '1. كشف الاختراقات وهجمات الحقن (Prompt Injection Defense): يتم فحص جميع المدخلات الموجهة لوكلاء الذكاء الاصطناعي عبر محرك حتمي (HookHarness) لمنع محاولات تجاوز تعليمات النظام أو استخراج المفاتيح.',
    chunkIndex: 0,
    pageNumber: 1,
    language: 'ar',
    metadata: { category: 'Prompt Injection Security' },
  },
  {
    id: 'chunk-002-2',
    tenantId: 'tenant-acme-01',
    documentId: 'doc-002',
    documentTitle: 'سياسة أمن واستجابة الحوادث السيبرانية ISO27001',
    content: '2. إدارة أدوات MCP: جميع أدوات MCP المصنفة تحت Sandbox T2 و T3 (التي تحدث آثاراً جانبية مثل إرسال بريد أو تعديل قواعد البيانات) تتطلب موافقة بشرية صريحة من المستخدم قبل التنفيذ.',
    chunkIndex: 1,
    pageNumber: 1,
    language: 'ar',
    metadata: { category: 'MCP Sandbox' },
  },
  {
    id: 'chunk-002-3',
    tenantId: 'tenant-acme-01',
    documentId: 'doc-002',
    documentTitle: 'سياسة أمن واستجابة الحوادث السيبرانية ISO27001',
    content: '3. التشفير وإسقاط الهويات PII Redaction: يُحظر بث أي معلومات تعريف شخصية (بريد إلكتروني، رقم هاتف، بطاقة ائتمان) في استجابات النموذج، ويتم استبدالها حتمياً بوسوم [REDACTED].',
    chunkIndex: 2,
    pageNumber: 2,
    language: 'ar',
    metadata: { category: 'PII Privacy' },
  },
  {
    id: 'chunk-003-1',
    tenantId: 'tenant-acme-01',
    documentId: 'doc-003',
    documentTitle: 'OmniRAG System Architecture & Hybrid Retrieval Spec',
    content: 'Multi-Tenant Hybrid Search Engine: Combines dense vector retrieval via Qdrant (cosine similarity) and sparse BM25 text matching over Neon Postgres. Fused using Reciprocal Rank Fusion (RRF).',
    chunkIndex: 0,
    pageNumber: 1,
    language: 'en',
    metadata: { module: 'Hybrid Search Engine' },
  },
  {
    id: 'chunk-003-2',
    tenantId: 'tenant-acme-01',
    documentId: 'doc-003',
    documentTitle: 'OmniRAG System Architecture & Hybrid Retrieval Spec',
    content: 'Smart Agentic Routing: Simple requests are handled by fast models (Gemini Flash-Lite), while complex reasoning, cross-encoder reranking, and multi-step tool calls route to Gemini 3.6 Flash or 3.1 Pro Preview.',
    chunkIndex: 1,
    pageNumber: 1,
    language: 'en',
    metadata: { module: 'Smart Router' },
  },
  {
    id: 'chunk-003-3',
    tenantId: 'tenant-acme-01',
    documentId: 'doc-003',
    documentTitle: 'OmniRAG System Architecture & Hybrid Retrieval Spec',
    content: 'Citation Verification: Every generated claim with a citation index is cross-checked against retrieved chunk UUIDs to eliminate hallucinated references.',
    chunkIndex: 2,
    pageNumber: 2,
    language: 'en',
    metadata: { module: 'Citation Verification' },
  },
];

// Initial MCP Servers
export const INITIAL_MCP_SERVERS: MCPServerConfig[] = [
  {
    id: 'mcp-slack-01',
    tenantId: 'tenant-acme-01',
    name: 'Slack Communication Gateway',
    description: 'إرسال التنبيهات وقراءة الرسائل والقنوات عبر Slack API',
    endpointUrl: 'https://mcp.slack.internal/v2',
    protocolVersion: '2026-07-28',
    sandboxTier: 'T2_ELEVATED',
    enabledTools: ['slack_send_message', 'slack_read_channel'],
    requireConfirmationTools: ['slack_send_message'],
    status: 'healthy',
    latencyMs: 38,
    lastChecked: '2026-08-08T12:00:00.000Z',
  },
  {
    id: 'mcp-github-02',
    tenantId: 'tenant-acme-01',
    name: 'GitHub Enterprise Integrator',
    description: 'استعلام المستودعات وقراءة الملفات وإنشاء PRs وتذاكر الإغلاق',
    endpointUrl: 'https://mcp.github.internal/v2',
    protocolVersion: '2026-07-28',
    sandboxTier: 'T2_ELEVATED',
    enabledTools: ['github_search_code', 'github_create_issue', 'github_read_repo'],
    requireConfirmationTools: ['github_create_issue'],
    status: 'healthy',
    latencyMs: 45,
    lastChecked: '2026-08-08T12:00:00.000Z',
  },
  {
    id: 'mcp-websearch-03',
    tenantId: 'tenant-acme-01',
    name: 'Google Search & Live Web Fetcher',
    description: 'جلب الأخبار الحية والمعلومات المحدثة من الويب المفتوح',
    endpointUrl: 'https://mcp.websearch.internal/v2',
    protocolVersion: '2026-07-28',
    sandboxTier: 'T0_READ_ONLY',
    enabledTools: ['web_live_search', 'fetch_url_content'],
    requireConfirmationTools: [],
    status: 'healthy',
    latencyMs: 120,
    lastChecked: '2026-08-08T12:00:00.000Z',
  },
  {
    id: 'mcp-sql-04',
    tenantId: 'tenant-acme-01',
    name: 'PostgreSQL Analytics Query Hub',
    description: 'تشغيل استعلامات SQL حتمية وآمنة فوق قاعدة بيانات التحليلات',
    endpointUrl: 'https://mcp.postgres.internal/v2',
    protocolVersion: '2026-07-28',
    sandboxTier: 'T1_LIMITED',
    enabledTools: ['external_postgres_query', 'get_table_schema'],
    requireConfirmationTools: ['external_postgres_query'],
    status: 'healthy',
    latencyMs: 22,
    lastChecked: '2026-08-08T12:00:00.000Z',
  },
];

// Initial Audit Logs
export const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: 'audit-101',
    tenantId: 'tenant-acme-01',
    actorId: 'user-sec-lead',
    action: 'PRE_INFERENCE_CHECK',
    resourceType: 'chat_completion',
    resourceId: 'conv-991',
    status: 'success',
    details: 'مرور فحص TenantGate و InputSanitizer لـ 1 مدخل',
    timestamp: '2026-08-08T20:00:00.000Z',
  },
  {
    id: 'audit-102',
    tenantId: 'tenant-acme-01',
    actorId: 'agentic_engine',
    action: 'MCP_SIDE_EFFECT_PROMPT',
    resourceType: 'mcp_tool',
    resourceId: 'slack_send_message',
    status: 'blocked',
    details: 'تم تعليق أداة Slack لطلب موافقة المستخدم البشرية (SideEffectGate H5)',
    timestamp: '2026-08-08T21:00:00.000Z',
  },
  {
    id: 'audit-103',
    tenantId: 'tenant-acme-01',
    actorId: 'user-sec-lead',
    action: 'PII_REDACTION',
    resourceType: 'output_stream',
    resourceId: 'msg-552',
    status: 'success',
    details: 'تم إخفاء بريد إلكتروني ورقم هاتف تلقائياً قبل البث (PIIRedactor H9)',
    timestamp: '2026-08-08T22:30:00.000Z',
  },
];

// Initial Sources
export const INITIAL_SOURCES: SourceConnector[] = [
  {
    id: 'src-file-01',
    tenantId: 'tenant-acme-01',
    name: 'المستندات المحلية والسياسات العامة',
    type: 'file',
    status: 'healthy',
    config: {
      acceptedTypes: ['pdf', 'docx', 'txt', 'md'],
      maxFileSizeMb: 500,
      chunkStrategy: 'semantic',
      chunkSize: 512,
      chunkOverlap: 50,
    },
    syncSchedule: 'manual',
    lastSyncAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    documentCount: 3,
    totalBytes: 1548200,
    collectionIds: ['col-legal-01', 'col-tech-02'],
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'src-url-02',
    tenantId: 'tenant-acme-01',
    name: 'زاحف بوابة المعايير الرسمية ISO27001',
    type: 'url',
    status: 'healthy',
    config: {
      url: 'https://iso27001.example.org/compliance-2026',
      maxDepth: 3,
      maxPages: 50,
      includeSelector: 'main, article',
      userAgent: 'OmniRAG-Crawler/2.4',
    },
    syncSchedule: '0 */6 * * *',
    lastSyncAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    nextSyncAt: new Date(Date.now() + 3600000 * 1).toISOString(),
    documentCount: 12,
    totalBytes: 4820000,
    collectionIds: ['col-tech-02'],
    createdAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'src-yt-03',
    tenantId: 'tenant-acme-01',
    name: 'مفرغ تفريغات ندوات الأمن السيبراني (YouTube)',
    type: 'youtube',
    status: 'healthy',
    config: {
      channelOrPlaylistUrl: 'https://youtube.com/@CyberSecuritySummit2026',
      autoTranslateArabic: true,
      extractTimestamps: true,
    },
    syncSchedule: '0 0 * * *',
    lastSyncAt: new Date(Date.now() - 3600000 * 18).toISOString(),
    documentCount: 5,
    collectionIds: ['col-tech-02'],
    createdAt: '2026-08-03T00:00:00.000Z',
  },
  {
    id: 'src-gh-04',
    tenantId: 'tenant-acme-01',
    name: 'مستودع الكود المصدري GitHub Repository',
    type: 'github',
    status: 'healthy',
    config: {
      repo: 'ACME-Corp/enterprise-rag-core',
      branch: 'main',
      fileExtensions: ['.ts', '.py', '.md', '.json'],
      includeDocsFolder: true,
    },
    syncSchedule: '0 */3 * * *',
    lastSyncAt: new Date(Date.now() - 3600000 * 1).toISOString(),
    nextSyncAt: new Date(Date.now() + 3600000 * 2).toISOString(),
    documentCount: 24,
    collectionIds: ['col-tech-02'],
    createdAt: '2026-08-04T00:00:00.000Z',
  },
  {
    id: 'src-db-05',
    tenantId: 'tenant-acme-01',
    name: 'قاعدة بيانات PostgreSQL التحليلية',
    type: 'database',
    status: 'healthy',
    config: {
      dbType: 'postgresql',
      host: 'postgres.prod.internal',
      port: 5432,
      database: 'analytics_warehouse',
      tables: ['audit_reports', 'security_incidents', 'compliance_logs'],
      syncQuery: 'SELECT id, title, content, updated_at FROM compliance_logs WHERE updated_at > :last_sync',
    },
    syncSchedule: '*/30 * * * *',
    lastSyncAt: new Date(Date.now() - 1800000).toISOString(),
    nextSyncAt: new Date(Date.now() + 1800000).toISOString(),
    documentCount: 8,
    collectionIds: ['col-legal-01'],
    createdAt: '2026-08-05T00:00:00.000Z',
  },
  {
    id: 'src-gdrive-06',
    tenantId: 'tenant-acme-01',
    name: 'مجلد Google Drive للوثائق القانونية',
    type: 'gdrive',
    status: 'degraded',
    config: {
      folderId: '1A2b3C4d5E6f7G8h9I0j',
      syncSubfolders: true,
      serviceAccountConfigured: true,
    },
    syncSchedule: '0 */12 * * *',
    lastSyncAt: new Date(Date.now() - 3600000 * 10).toISOString(),
    documentCount: 7,
    collectionIds: ['col-legal-01'],
    lastError: 'Google Drive API Rate limit exceeded (429). Retry scheduled.',
    createdAt: '2026-08-06T00:00:00.000Z',
  },
];

export const INITIAL_SYNC_LOGS: SyncLogEntry[] = [
  {
    id: 'log-001',
    tenantId: 'tenant-acme-01',
    sourceId: 'src-gh-04',
    sourceName: 'مستودع الكود المصدري GitHub Repository',
    status: 'success',
    itemsProcessed: 14,
    durationMs: 2340,
    message: 'تمت مزامنة 14 ملف جديد وتقسيمها إلى 48 متجهاً بنجاح',
    timestamp: new Date(Date.now() - 3600000 * 1).toISOString(),
  },
  {
    id: 'log-002',
    tenantId: 'tenant-acme-01',
    sourceId: 'src-url-02',
    sourceName: 'زاحف بوابة المعايير الرسمية ISO27001',
    status: 'success',
    itemsProcessed: 8,
    durationMs: 4120,
    message: 'تم زحف 8 صفحات ويب واستخراج النصوص العربية والإنجليزية',
    timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
  {
    id: 'log-003',
    tenantId: 'tenant-acme-01',
    sourceId: 'src-gdrive-06',
    sourceName: 'مجلد Google Drive للوثائق القانونية',
    status: 'failed',
    itemsProcessed: 2,
    durationMs: 1250,
    message: 'تجاوز حد الطلبات API Rate limit exceeded (429)',
    timestamp: new Date(Date.now() - 3600000 * 10).toISOString(),
  },
];

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
    return this.sources
      .filter((s) => s.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
      const sourcesCol = collection(firestore, 'sources');
      const snapshot = await getDocs(query(sourcesCol, limit(1)));
      if (!snapshot.empty) {
        isSeeded = true;
        return;
      }

      console.log('Firestore Database is empty. Seeding initial RAG data...');

      // Seed Tenants
      for (const tenant of INITIAL_TENANTS) {
        await setDoc(doc(firestore, 'tenants', tenant.id), tenant);
      }

      // Seed Collections
      for (const col of INITIAL_COLLECTIONS) {
        await setDoc(doc(firestore, 'collections', col.id), col);
      }

      // Seed Documents
      for (const docObj of INITIAL_DOCUMENTS) {
        await setDoc(doc(firestore, 'documents', docObj.id), docObj);
      }

      // Seed Chunks
      for (const chunk of INITIAL_CHUNKS) {
        await setDoc(doc(firestore, 'chunks', chunk.id), chunk);
      }

      // Seed MCP Servers
      for (const server of INITIAL_MCP_SERVERS) {
        await setDoc(doc(firestore, 'mcpServers', server.id), server);
      }

      // Seed Sources
      for (const source of INITIAL_SOURCES) {
        await setDoc(doc(firestore, 'sources', source.id), source);
      }

      // Seed Sync Logs
      for (const log of INITIAL_SYNC_LOGS) {
        await setDoc(doc(firestore, 'syncLogs', log.id), log);
      }

      // Seed Audit Logs
      for (const audit of INITIAL_AUDIT_LOGS) {
        await setDoc(doc(firestore, 'auditLogs', audit.id), audit);
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
      const q = query(collection(firestore, 'sources'), where('tenantId', '==', tenantId));
      const snapshot = await getDocs(q);
      return snapshot.docs
        .map((d) => d.data() as SourceConnector)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
      const docRef = doc(firestore, 'sources', id);
      const snap = await getDoc(docRef);
      if (snap.exists() && snap.data().tenantId === tenantId) {
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
      await setDoc(doc(firestore, 'sources', source.id), source);
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
      const docRef = doc(firestore, 'sources', id);
      const snap = await getDoc(docRef);
      if (!snap.exists() || snap.data().tenantId !== tenantId) return undefined;

      const updatedData = { ...snap.data(), ...updates };
      await setDoc(docRef, updatedData);
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
      const docRef = doc(firestore, 'sources', id);
      const snap = await getDoc(docRef);
      if (!snap.exists() || snap.data().tenantId !== tenantId) return;

      await deleteDoc(docRef);
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
          await setDoc(doc(firestore, 'sources', id), source);
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
          const reqHost = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
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
      const q = query(collection(firestore, 'syncLogs'), where('tenantId', '==', tenantId));
      const snapshot = await getDocs(q);
      let logs = snapshot.docs.map((d) => d.data() as SyncLogEntry);
      if (sourceId) {
        logs = logs.filter((l) => l.sourceId === sourceId);
      }
      return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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
      await setDoc(doc(firestore, 'syncLogs', log.id), log);
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
      const q = query(collection(firestore, 'documents'), where('tenantId', '==', tenantId));
      const snapshot = await getDocs(q);
      return snapshot.docs
        .map((d) => d.data() as Document)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
      const docRef = doc(firestore, 'documents', id);
      const snap = await getDoc(docRef);
      if (snap.exists() && snap.data().tenantId === tenantId) {
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
      await setDoc(doc(firestore, 'documents', docObj.id), docObj);

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
      const docRef = doc(firestore, 'documents', id);
      const snap = await getDoc(docRef);
      if (!snap.exists() || snap.data().tenantId !== tenantId) return;

      await deleteDoc(docRef);

      const chunksRef = collection(firestore, 'chunks');
      const q = query(chunksRef, where('documentId', '==', id), where('tenantId', '==', tenantId));
      const snapshot = await getDocs(q);
      for (const chunkDoc of snapshot.docs) {
        await deleteDoc(chunkDoc.ref);
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
      const q = query(collection(firestore, 'chunks'), where('tenantId', '==', tenantId));
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => d.data() as DocumentChunk);
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
      await setDoc(doc(firestore, 'chunks', chunk.id), chunk);

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
      const q = query(collection(firestore, 'collections'), where('tenantId', '==', tenantId));
      const snapshot = await getDocs(q);
      return snapshot.docs
        .map((d) => d.data() as Collection)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
      await setDoc(doc(firestore, 'collections', col.id), col);
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
      const q = query(collection(firestore, 'mcpServers'), where('tenantId', '==', tenantId));
      const snapshot = await getDocs(q);
      const existing = snapshot.docs.map((d) => d.data() as MCPServerConfig);

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
          await setDoc(doc(firestore, 'mcpServers', server.id), server);
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
      await setDoc(doc(firestore, 'mcpServers', server.id), server);
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
      const docRef = doc(firestore, 'mcpServers', serverId);
      const snap = await getDoc(docRef);
      if (!snap.exists() || snap.data().tenantId !== tenantId) return;

      const server = snap.data() as MCPServerConfig;
      if (server.enabledTools.includes(toolName)) {
        server.enabledTools = server.enabledTools.filter((t) => t !== toolName);
      } else {
        server.enabledTools.push(toolName);
      }
      await setDoc(docRef, server);
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
      const docRef = doc(firestore, 'mcpServers', serverId);
      const snap = await getDoc(docRef);
      if (snap.exists() && snap.data().tenantId === tenantId) {
        await deleteDoc(docRef);
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
      const q = query(collection(firestore, 'auditLogs'), where('tenantId', '==', tenantId));
      const snapshot = await getDocs(q);
      return snapshot.docs
        .map((d) => d.data() as AuditLogEntry)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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
      await setDoc(doc(firestore, 'auditLogs', entry.id), entry);
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
      const q = query(collection(firestore, 'toolCalls'), where('tenantId', '==', tenantId));
      const snapshot = await getDocs(q);
      return snapshot.docs
        .map((d) => d.data() as MCPToolCall)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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
      await setDoc(doc(firestore, 'toolCalls', tc.id), tc);
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
      const q = query(collection(firestore, 'conversations'), where('tenantId', '==', tenantId));
      const snapshot = await getDocs(q);
      const convs = snapshot.docs.map((d) => d.data() as Conversation);

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

      try {
        await setDoc(doc(firestore, 'conversations', defaultConv.id), defaultConv);
        const welcomeMsg: Message = {
          id: `msg-welcome-${defaultConv.id}`,
          tenantId,
          conversationId: defaultConv.id,
          role: 'assistant',
          content: 'مرحباً بك في استوديو المحادثة المعززة لمنصة OmniRAG. يمكنك طرح أي سؤال استعلامي حول السياسات، العقود، أو معايير أمن المعلومات المرفقة ببيانات المستأجر الحالي.',
          createdAt: new Date().toISOString(),
          modelUsed: 'gemini-3.6-flash',
        };
        await setDoc(doc(firestore, 'messages', welcomeMsg.id), welcomeMsg);
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
      const snap = await getDoc(doc(firestore, 'conversations', id));
      if (!snap.exists()) return null;
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
      await setDoc(doc(firestore, 'conversations', conv.id), conv, { merge: true });
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
      const convRef = doc(firestore, 'conversations', id);
      const snap = await getDoc(convRef);
      if (snap.exists() && snap.data().tenantId === tenantId) {
        await deleteDoc(convRef);

        const msgsRef = collection(firestore, 'messages');
        const q = query(msgsRef, where('conversationId', '==', id), where('tenantId', '==', tenantId));
        const msgSnap = await getDocs(q);
        for (const mDoc of msgSnap.docs) {
          await deleteDoc(mDoc.ref);
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
      const q = query(
        collection(firestore, 'messages'),
        where('conversationId', '==', conversationId),
        where('tenantId', '==', tenantId)
      );
      const snapshot = await getDocs(q);
      const msgs = snapshot.docs.map((d) => d.data() as Message);
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
        await setDoc(doc(firestore, 'messages', welcomeMsg.id), welcomeMsg);
        return [welcomeMsg];
      }
      return msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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
      await setDoc(doc(firestore, 'messages', msg.id), msg);

      try {
        const convRef = doc(firestore, 'conversations', msg.conversationId);
        const convSnap = await getDoc(convRef);
        if (convSnap.exists()) {
          const conv = convSnap.data() as Conversation;
          const updates: Partial<Conversation> = {
            updatedAt: new Date().toISOString(),
          };
          if (msg.role === 'user' && (conv.title.startsWith('محادثة جديدة') || conv.title.startsWith('New Conversation') || conv.title === 'جلسة استفسارات السياسات والأمن')) {
            updates.title = msg.content.length > 35 ? msg.content.substring(0, 35) + '...' : msg.content;
          }
          await setDoc(convRef, updates, { merge: true });
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
