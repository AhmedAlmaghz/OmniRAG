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
} from '../types/omnirag';

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

// In-Memory Database Store Singleton
class OmniRAGDatabase {
  private documents: Document[] = [...INITIAL_DOCUMENTS];
  private chunks: DocumentChunk[] = [...INITIAL_CHUNKS];
  private collections: Collection[] = [...INITIAL_COLLECTIONS];
  private mcpServers: MCPServerConfig[] = [...INITIAL_MCP_SERVERS];
  private conversations: Conversation[] = [];
  private messages: Message[] = [];
  private toolCalls: MCPToolCall[] = [];
  private auditLogs: AuditLogEntry[] = [...INITIAL_AUDIT_LOGS];

  // Documents
  getDocuments(tenantId: string): Document[] {
    return this.documents.filter((d) => d.tenantId === tenantId);
  }

  getDocumentById(id: string, tenantId: string): Document | undefined {
    return this.documents.find((d) => d.id === id && d.tenantId === tenantId);
  }

  addDocument(doc: Document) {
    this.documents.unshift(doc);
  }

  deleteDocument(id: string, tenantId: string) {
    this.documents = this.documents.filter((d) => !(d.id === id && d.tenantId === tenantId));
    this.chunks = this.chunks.filter((c) => !(c.documentId === id && c.tenantId === tenantId));
  }

  // Chunks
  getChunks(tenantId: string): DocumentChunk[] {
    return this.chunks.filter((c) => c.tenantId === tenantId);
  }

  addChunk(chunk: DocumentChunk) {
    this.chunks.push(chunk);
  }

  // Collections
  getCollections(tenantId: string): Collection[] {
    return this.collections.filter((c) => c.tenantId === tenantId);
  }

  addCollection(col: Collection) {
    this.collections.push(col);
  }

  // MCP Servers
  getMcpServers(tenantId: string): MCPServerConfig[] {
    return this.mcpServers.filter((s) => s.tenantId === tenantId);
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

  // Audit Logs
  getAuditLogs(tenantId: string): AuditLogEntry[] {
    return this.auditLogs.filter((a) => a.tenantId === tenantId);
  }

  addAuditLog(entry: AuditLogEntry) {
    this.auditLogs.unshift(entry);
  }

  // Tool Calls
  getToolCalls(tenantId: string): MCPToolCall[] {
    return this.toolCalls.filter((tc) => tc.tenantId === tenantId);
  }

  addToolCall(tc: MCPToolCall) {
    this.toolCalls.unshift(tc);
  }
}

export const db = new OmniRAGDatabase();
