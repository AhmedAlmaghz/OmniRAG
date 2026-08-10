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

async function ensureSeeded() {
  if (isSeeded) return;
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
    console.error('Error seeding Firestore database:', error);
  }
}

// Durable Firestore Database Singleton Store
class OmniRAGDatabase {
  // Sources
  async getSources(tenantId: string): Promise<SourceConnector[]> {
    await ensureSeeded();
    const q = query(collection(firestore, 'sources'), where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((d) => d.data() as SourceConnector)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getSourceById(id: string, tenantId: string): Promise<SourceConnector | undefined> {
    await ensureSeeded();
    const docRef = doc(firestore, 'sources', id);
    const snap = await getDoc(docRef);
    if (snap.exists() && snap.data().tenantId === tenantId) {
      return snap.data() as SourceConnector;
    }
    return undefined;
  }

  async addSource(source: SourceConnector): Promise<void> {
    await ensureSeeded();
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
  }

  async updateSource(id: string, updates: Partial<SourceConnector>, tenantId: string): Promise<SourceConnector | undefined> {
    await ensureSeeded();
    const docRef = doc(firestore, 'sources', id);
    const snap = await getDoc(docRef);
    if (!snap.exists() || snap.data().tenantId !== tenantId) return undefined;

    const updatedData = { ...snap.data(), ...updates };
    await setDoc(docRef, updatedData);
    return updatedData as SourceConnector;
  }

  async deleteSource(id: string, tenantId: string, purgeDocs: boolean = true): Promise<void> {
    await ensureSeeded();
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
  }

  async syncSource(id: string, tenantId: string): Promise<{ success: boolean; itemsProcessed: number; durationMs: number }> {
    await ensureSeeded();
    const source = await this.getSourceById(id, tenantId);
    if (!source) return { success: false, itemsProcessed: 0, durationMs: 0 };

    const duration = Math.floor(Math.random() * 3000) + 1200;
    const items = Math.floor(Math.random() * 5) + 1;

    source.status = 'healthy';
    source.lastSyncAt = new Date().toISOString();
    source.documentCount = (source.documentCount || 0) + items;
    source.lastError = undefined;

    await setDoc(doc(firestore, 'sources', id), source);

    // Create a new simulated document ingested from this sync
    const newDocId = `doc-sync-${Date.now().toString().slice(-4)}`;
    const newDocTitle = `${source.name} - تحديث ${new Date().toLocaleDateString('ar-SA')}`;
    const newDocContent = `تحديث بيانات من الموصل (${source.name}):\nتم جلب واستخراج ${items} سجل جديد وحفظها بتشفير عالي ومعالجة متجهات Qdrant بضمان عزْل المستأجر ${tenantId}.`;

    const newDoc: Document = {
      id: newDocId,
      tenantId,
      title: newDocTitle,
      content: newDocContent,
      sourceType: source.type === 'file' ? 'file' : 'integration',
      language: 'ar',
      status: 'indexed',
      chunkCount: 2,
      createdAt: new Date().toISOString(),
      metadata: { sourceId: source.id, connectorType: source.type },
      collectionIds: source.collectionIds,
    };

    await this.addDocument(newDoc);
    await this.addChunk({
      id: `chunk-${newDocId}-1`,
      tenantId,
      documentId: newDocId,
      documentTitle: newDocTitle,
      content: newDocContent,
      chunkIndex: 0,
      pageNumber: 1,
      language: 'ar',
      metadata: { sourceId: source.id },
    });

    await this.addSyncLog({
      id: `log-${Date.now()}`,
      tenantId,
      sourceId: source.id,
      sourceName: source.name,
      status: 'success',
      itemsProcessed: items,
      durationMs: duration,
      message: `تمت المزمنة بنجاح: جلب ${items} مستند جديد وتقسيمه إلى متجهات.`,
      timestamp: new Date().toISOString(),
    });

    return { success: true, itemsProcessed: items, durationMs: duration };
  }

  // Sync Logs
  async getSyncLogs(tenantId: string, sourceId?: string): Promise<SyncLogEntry[]> {
    await ensureSeeded();
    const q = query(collection(firestore, 'syncLogs'), where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);
    let logs = snapshot.docs.map((d) => d.data() as SyncLogEntry);
    if (sourceId) {
      logs = logs.filter((l) => l.sourceId === sourceId);
    }
    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async addSyncLog(log: SyncLogEntry): Promise<void> {
    await ensureSeeded();
    await setDoc(doc(firestore, 'syncLogs', log.id), log);
  }

  // MCP Resources
  async getMcpResources(tenantId: string): Promise<McpResourceItem[]> {
    await ensureSeeded();
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
  }

  // Documents
  async getDocuments(tenantId: string): Promise<Document[]> {
    await ensureSeeded();
    const q = query(collection(firestore, 'documents'), where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((d) => d.data() as Document)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getDocumentById(id: string, tenantId: string): Promise<Document | undefined> {
    await ensureSeeded();
    const docRef = doc(firestore, 'documents', id);
    const snap = await getDoc(docRef);
    if (snap.exists() && snap.data().tenantId === tenantId) {
      return snap.data() as Document;
    }
    return undefined;
  }

  async addDocument(docObj: Document): Promise<void> {
    await ensureSeeded();
    await setDoc(doc(firestore, 'documents', docObj.id), docObj);

    // Save to PostgreSQL for lexical search as described in SDLC
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
  }

  async deleteDocument(id: string, tenantId: string): Promise<void> {
    await ensureSeeded();
    const docRef = doc(firestore, 'documents', id);
    const snap = await getDoc(docRef);
    if (!snap.exists() || snap.data().tenantId !== tenantId) return;

    await deleteDoc(docRef);

    // Clean up chunks from Firestore
    const chunksRef = collection(firestore, 'chunks');
    const q = query(chunksRef, where('documentId', '==', id), where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);
    for (const chunkDoc of snapshot.docs) {
      await deleteDoc(chunkDoc.ref);
    }

    // Clean up from PostgreSQL and Qdrant
    await deletePostgresDocument(id, tenantId);
    await deleteQdrantDocument(id, tenantId);
  }

  // Chunks
  async getChunks(tenantId: string): Promise<DocumentChunk[]> {
    await ensureSeeded();
    const q = query(collection(firestore, 'chunks'), where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as DocumentChunk);
  }

  async addChunk(chunk: DocumentChunk): Promise<void> {
    await ensureSeeded();
    await setDoc(doc(firestore, 'chunks', chunk.id), chunk);

    // Generate real vector embedding using Gemini API
    const vector = await generateEmbedding(chunk.content);

    // Save to PostgreSQL for lexical search FTS
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

    // Get parent document collections if exists, so we can filter by collections in Qdrant
    let collectionIds: string[] = [];
    try {
      const parentDoc = await this.getDocumentById(chunk.documentId, chunk.tenantId);
      if (parentDoc && parentDoc.collectionIds) {
        collectionIds = parentDoc.collectionIds;
      }
    } catch (e) {
      console.warn('Failed to fetch parent collections for chunk, defaulting to empty:', e);
    }

    // Save to Qdrant Cloud for semantic search with tenant-isolation filters
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
  }

  // Collections
  async getCollections(tenantId: string): Promise<Collection[]> {
    await ensureSeeded();
    const q = query(collection(firestore, 'collections'), where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((d) => d.data() as Collection)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async addCollection(col: Collection): Promise<void> {
    await ensureSeeded();
    await setDoc(doc(firestore, 'collections', col.id), col);
  }

  // MCP Servers
  async getMcpServers(tenantId: string): Promise<MCPServerConfig[]> {
    await ensureSeeded();
    const q = query(collection(firestore, 'mcpServers'), where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as MCPServerConfig);
  }

  async addMcpServer(server: MCPServerConfig): Promise<void> {
    await ensureSeeded();
    await setDoc(doc(firestore, 'mcpServers', server.id), server);
  }

  async toggleMcpTool(serverId: string, toolName: string, tenantId: string): Promise<void> {
    await ensureSeeded();
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
  }

  async deleteMcpServer(serverId: string, tenantId: string): Promise<void> {
    await ensureSeeded();
    const docRef = doc(firestore, 'mcpServers', serverId);
    const snap = await getDoc(docRef);
    if (snap.exists() && snap.data().tenantId === tenantId) {
      await deleteDoc(docRef);
    }
  }

  // Audit Logs
  async getAuditLogs(tenantId: string): Promise<AuditLogEntry[]> {
    await ensureSeeded();
    const q = query(collection(firestore, 'auditLogs'), where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((d) => d.data() as AuditLogEntry)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async addAuditLog(entry: AuditLogEntry): Promise<void> {
    await ensureSeeded();
    await setDoc(doc(firestore, 'auditLogs', entry.id), entry);
  }

  // Tool Calls
  async getToolCalls(tenantId: string): Promise<MCPToolCall[]> {
    await ensureSeeded();
    const q = query(collection(firestore, 'toolCalls'), where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((d) => d.data() as MCPToolCall)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async addToolCall(tc: MCPToolCall): Promise<void> {
    await ensureSeeded();
    await setDoc(doc(firestore, 'toolCalls', tc.id), tc);
  }
}

export const db = new OmniRAGDatabase();
