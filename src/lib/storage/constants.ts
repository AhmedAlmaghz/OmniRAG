import {
  Tenant,
  Document,
  DocumentChunk,
  Collection,
  MCPServerConfig,
  AuditLogEntry,
  SourceConnector,
  SyncLogEntry,
} from '../types/omnirag';
import { DEFAULT_AI_MODELS } from '../config/aiModels';

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
      defaultModel: DEFAULT_AI_MODELS.chatModel,
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
      defaultModel: DEFAULT_AI_MODELS.analysisModel,
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
    version: 3,
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    metadata: { author: 'Legal Team', classification: 'Confidential' },
    collectionIds: ['col-legal-01'],
    versions: [
      {
        id: 'ver-doc-001-v1',
        documentId: 'doc-001',
        versionNumber: 1,
        title: 'مسودة اتفاقية السرية NDA (2026)',
        content: `اتفاقية عدم الإفصاح والسرية (NDA) - مسودة أولية
المادة 1: التعريفات والالتزامات
يتعهد الطرفان بالحفاظ على سرية المعلومات العامة والتقنية المتبادلة.
المادة 2: مدة الاتفاقية
تستمر هذه الاتفاقية لمدة سنتين من تاريخ التوقيع.`,
        chunkCount: 1,
        createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
        createdBy: 'Sara Ahmed (Legal Associate)',
        changeSummary: 'المسودة التأسيسية الأولى لبنود السرية التعاقدية',
      },
      {
        id: 'ver-doc-001-v2',
        documentId: 'doc-001',
        versionNumber: 2,
        title: 'اتفاقية عدم الإفصاح والسرية NDA (مراجعة المستشار القانوني)',
        content: `اتفاقية عدم الإفصاح والسرية (NDA) - شركة أكمي العالمية
المادة 1: التعريفات والالتزامات
يتعهد الطرفان بالحفاظ على سرية جميع البيانات التقنية والمالية والتجارية المتبادلة. يمنع منعاً باتاً نقل أي بيانات خارج نطاق المستأجر المعين (Tenant Isolation).
المادة 2: مدة الاتفاقية والنطاق
تستمر هذه الاتفاقية لمدة 5 سنوات من تاريخ التوقيع. في حال حدوث أي تسريب غير مصرح به، يحق للطرف المتضرر المطالبة بتعويضات فورية.`,
        chunkCount: 2,
        createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        createdBy: 'Omar Al-Hassan (Senior Counsel)',
        changeSummary: 'تمديد فترة السريان إلى 5 سنوات وإضافة إلزامية عزل بيانات المستأجرين',
      },
      {
        id: 'ver-doc-001-v3',
        documentId: 'doc-001',
        versionNumber: 3,
        title: 'اتفاقية عدم الإفصاح والسرية NDA (2026)',
        content: `اتفاقية عدم الإفصاح والسرية (NDA) - شركة أكمي العالمية
المادة 1: التعريفات والالتزامات
يتعهد الطرفان بالحفاظ على سرية جميع البيانات التقنية والمالية والتجارية المتبادلة. يمنع منعاً باتاً نقل أي بيانات خارج نطاق المستأجر المعين (Tenant Isolation).
المادة 2: مدة الاتفاقية والنطاق
تستمر هذه الاتفاقية لمدة 5 سنوات من تاريخ التوقيع. في حال حدوث أي تسريب غير مصرح به، يحق للطرف المتضرر المطالبة بتعويضات فورية وتقديم بلاغ للجهات المختصة.
المادة 3: حماية البيانات في بيئة Cloud
تلتزم جميع الأنظمة المستضافة بالتشفير الكامل بأسلوب AES-256 أثناء التخزين وببروتوكول TLS 1.3 أثناء النقل، مع تفعيل سياسات التحكم بالوصول على مستوى الصفوف (Row Level Security).`,
        chunkCount: 3,
        createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
        createdBy: 'Security & Compliance Board',
        changeSummary: 'إضافة المادة 3 لمعايير التشفير السحابي AES-256 و TLS 1.3 و RLS',
      },
    ],
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
    version: 2,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    metadata: { department: 'CyberSecurity', isoVersion: '2026.1' },
    collectionIds: ['col-tech-02'],
    versions: [
      {
        id: 'ver-doc-002-v1',
        documentId: 'doc-002',
        versionNumber: 1,
        title: 'سياسة أمن المعلومات الأولية ISO27001',
        content: `سياسة أمن واستجابة الحوادث - قسم تكنولوجيا المعلومات
1. كشف الاختراقات وهجمات الحقن:
يتم فحص جميع المدخلات للذكاء الاصطناعي لمنع محاولات تجاوز التعليمات.
2. التشفير وإسقاط الهويات:
يُحظر بث أي معلومات تعريف شخصية في استجابات النموذج.`,
        chunkCount: 2,
        createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        createdBy: 'DevSecOps Team',
        changeSummary: 'الإصدار الأساسي لسياسات ISO27001',
      },
      {
        id: 'ver-doc-002-v2',
        documentId: 'doc-002',
        versionNumber: 2,
        title: 'سياسة أمن واستجابة الحوادث السيبرانية ISO27001',
        content: `سياسة أمن واستجابة الحوادث - قسم تكنولوجيا المعلومات
1. كشف الاختراقات وهجمات الحقن (Prompt Injection Defense):
يتم فحص جميع المدخلات الموجهة لوكلاء الذكاء الاصطناعي عبر محرك حتمي (HookHarness) لمنع محاولات تجاوز تعليمات النظام أو استخراج المفاتيح والرموز الحساسة.
2. إدارة أدوات MCP بروتوكول سياق النموذج:
جميع أدوات MCP المصنفة تحت مستوى Sandbox T2 و T3 (التي تحدث آثاراً جانبية مثل إرسال بريد أو تعديل قواعد البيانات) تتطلب موافقة بشرية صريحة من المستخدم قبل التنفيذ.
3. التشفير وإسقاط الهويات PII Redaction:
يُحظر بث أي معلومات تعريف شخصية (بريد إلكتروني، رقم هاتف، بطاقة ائتمان) في استجابات النموذج، ويتم استبدالها حتمياً بوسوم [REDACTED].`,
        chunkCount: 3,
        createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
        createdBy: 'CISO Office',
        changeSummary: 'إضافة ضوابط أمان بروتوكول سياق النموذج (MCP Sandbox T2/T3) والموافقة البشرية',
      },
    ],
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
    content:
      'المادة 1: يتعهد الطرفان بالحفاظ على سرية جميع البيانات التقنية والمالية والتجارية المتبادلة. يمنع منعاً باتاً نقل أي بيانات خارج نطاق المستأجر المعين (Tenant Isolation).',
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
    content:
      'المادة 2: تستمر هذه الاتفاقية لمدة 5 سنوات من تاريخ التوقيع. في حال حدوث أي تسريب غير مصرح به، يحق للطرف المتضرر المطالبة بتعويضات فورية وتقديم بلاغ للجهات المختصة.',
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
    content:
      'المادة 3: تلتزم جميع الأنظمة المستضافة بالتشفير الكامل بأسلوب AES-256 أثناء التخزين وببروتوكول TLS 1.3 أثناء النقل، مع تفعيل سياسات التحكم بالوصول على مستوى الصفوف (Row Level Security).',
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
    content:
      '1. كشف الاختراقات وهجمات الحقن (Prompt Injection Defense): يتم فحص جميع المدخلات الموجهة لوكلاء الذكاء الاصطناعي عبر محرك حتمي (HookHarness) لمنع محاولات تجاوز تعليمات النظام أو استخراج المفاتيح.',
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
    content:
      '2. إدارة أدوات MCP: جميع أدوات MCP المصنفة تحت Sandbox T2 و T3 (التي تحدث آثاراً جانبية مثل إرسال بريد أو تعديل قواعد البيانات) تتطلب موافقة بشرية صريحة من المستخدم قبل التنفيذ.',
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
    content:
      '3. التشفير وإسقاط الهويات PII Redaction: يُحظر بث أي معلومات تعريف شخصية (بريد إلكتروني، رقم هاتف، بطاقة ائتمان) في استجابات النموذج، ويتم استبدالها حتمياً بوسوم [REDACTED].',
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
    content:
      'Multi-Tenant Hybrid Search Engine: Combines dense vector retrieval via Qdrant (cosine similarity) and sparse BM25 text matching over Neon Postgres. Fused using Reciprocal Rank Fusion (RRF).',
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
    content:
      'Smart Agentic Routing: Simple requests are handled by fast models (Gemini Flash-Lite), while complex reasoning, cross-encoder reranking, and multi-step tool calls route to Gemini 3.6 Flash or 3.1 Pro Preview.',
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
    content:
      'Citation Verification: Every generated claim with a citation index is cross-checked against retrieved chunk UUIDs to eliminate hallucinated references.',
    chunkIndex: 2,
    pageNumber: 2,
    language: 'en',
    metadata: { module: 'Citation Verification' },
  },
];

// Initial MCP Servers
export const INITIAL_MCP_SERVERS: MCPServerConfig[] = [
  {
    id: 'mcp-unstructured-transform',
    tenantId: 'tenant-acme-01',
    name: 'Unstructured Transform',
    description:
      'Connect to the official Unstructured Transform MCP server for advanced document transform, clean and chunk pipelines.',
    endpointUrl: 'https://mcp.transform.unstructured.io',
    protocolVersion: '2026-07-28',
    sandboxTier: 'T2_ELEVATED',
    enabledTools: ['unstructured_parse_document', 'mistral_document_ai_parse'],
    requireConfirmationTools: [],
    status: 'healthy',
    latencyMs: 45,
    lastChecked: '2026-08-14T12:00:00.000Z',
  },
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
