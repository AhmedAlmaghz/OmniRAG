import { SandboxTier } from '@/lib/types/omnirag';

/**
 * Curated catalog of well-known, useful MCP server presets.
 *
 * Each preset is a one-click registration template for the McpGateway: the
 * listed tools are backed by the central registry (lib/mcp/registry/tools.ts)
 * or by real remote dispatch when the tenant configures a public endpoint.
 * `anyOfEnv` keys are alternatives — having ANY one of them makes the preset
 * fully live; without them the tools degrade to honest not-configured results.
 */
export interface McpServerPreset {
  id: string;
  name: string;
  description: string;
  category: 'documents' | 'search' | 'knowledge' | 'communication' | 'development' | 'database';
  /** Official endpoint where the vendor hosts a real MCP server; otherwise the platform gateway. */
  endpointUrl: string;
  transportType: 'http' | 'sse' | 'stdio' | 'websocket';
  sandboxTier: SandboxTier;
  enabledTools: string[];
  requireConfirmationTools: string[];
  /** Alternative env keys — ANY one unlocks full liveness. */
  anyOfEnv?: string[];
  docsUrl?: string;
}

export const MCP_SERVER_PRESETS: McpServerPreset[] = [
  {
    id: 'unstructured-transform',
    name: 'Unstructured Transform',
    description:
      'خادم Unstructured Transform الرسمي لمعالجة الملفات المرفوعة (PDF, DOCX, PPTX, Excel, صور، صوت وفيديو) واستخراج محتواها إلى Markdown منظّم جاهزاً للتخزين في المصادر والمعرفة.',
    category: 'documents',
    endpointUrl: 'https://mcp.transform.unstructured.io',
    transportType: 'http',
    sandboxTier: 'T2_ELEVATED',
    enabledTools: ['unstructured_parse_document', 'mistral_document_ai_parse', 'knowledge_ingest_document'],
    requireConfirmationTools: ['knowledge_ingest_document'],
    anyOfEnv: ['UNSTRUCTURED_API_KEY', 'MISTRAL_API_KEY', 'GEMINI_API_KEY'],
    docsUrl: 'https://docs.unstructured.io',
  },
  {
    id: 'knowledge-core',
    name: 'نواة المعرفة OmniRAG',
    description:
      'الخادم المركزي لقاعدة معرفة المؤسسة: بحث دلالي هجين، استعلام المجموعات، وفهرسة محتوى جديد من ملفات وروابط ونصوص مباشرة داخل المعرفة.',
    category: 'knowledge',
    endpointUrl: 'https://mcp.omnirag.internal/core',
    transportType: 'http',
    sandboxTier: 'T1_LIMITED',
    enabledTools: [
      'search_knowledge_base',
      'query_collection',
      'knowledge_ingest_document',
      'youtube_fetch_transcript',
    ],
    requireConfirmationTools: ['knowledge_ingest_document'],
  },
  {
    id: 'web-search',
    name: 'البحث الحي في الويب',
    description:
      'بحث حي فوري عبر مزودي البحث العالميين (Tavily / Serper / Brave) مع جلب محتوى الصفحات ووثائق الويب مباشرة وتنظيفه من HTML.',
    category: 'search',
    endpointUrl: 'https://api.search.brave.com/res/v1/web/search',
    transportType: 'http',
    sandboxTier: 'T0_READ_ONLY',
    enabledTools: ['web_live_search', 'fetch_url_content'],
    requireConfirmationTools: [],
    anyOfEnv: ['TAVILY_API_KEY', 'SERPER_API_KEY', 'BRAVE_API_KEY'],
  },
  {
    id: 'youtube-intelligence',
    name: 'ذكاء يوتيوب',
    description:
      'جلب التفريغ النصي الكامل (Transcript) لفيديوهات يوتيوب مع البيانات الوصفية، وتحويلها إلى Markdown قابل للتلخيص أو الفهرسة الفورية في المعرفة.',
    category: 'knowledge',
    endpointUrl: 'https://mcp.omnirag.internal/youtube',
    transportType: 'http',
    sandboxTier: 'T0_READ_ONLY',
    enabledTools: ['youtube_fetch_transcript'],
    requireConfirmationTools: [],
  },
  {
    id: 'slack',
    name: 'Slack Communications',
    description:
      'بوابة تواصل Slack المؤسسية: إرسال رسائل وتنبيهات أمنية للقنوات وقراءة آخر المحادثات. تعمل حالياً في وضع المحاكاة الآمنة حتى ربط OAuth.',
    category: 'communication',
    endpointUrl: 'https://mcp.slack.internal/v2',
    transportType: 'http',
    sandboxTier: 'T2_ELEVATED',
    enabledTools: ['slack_send_message', 'slack_post_alert', 'slack_read_channel'],
    requireConfirmationTools: ['slack_send_message', 'slack_post_alert'],
    docsUrl: 'https://api.slack.com/docs',
  },
  {
    id: 'github',
    name: 'GitHub Enterprise',
    description:
      'تكامل GitHub للمؤسسات: البحث في الشيفرة والمستودعات، قراءة الهيكلية، وإنشاء تذاكر المتابعة (Issues). تعمل حالياً في وضع المحاكاة الآمنة.',
    category: 'development',
    endpointUrl: 'https://mcp.github.internal/v2',
    transportType: 'http',
    sandboxTier: 'T2_ELEVATED',
    enabledTools: ['github_search_code', 'github_read_repo', 'github_create_issue'],
    requireConfirmationTools: ['github_create_issue'],
    docsUrl: 'https://docs.github.com/rest',
  },
  {
    id: 'postgres-analytics',
    name: 'PostgreSQL Analytics',
    description:
      'استعلامات SQL تحليلية للقراءة فقط (SELECT) على قواعد بيانات PostgreSQL الخارجية مع استكشاف المخططات والأعمدة بأمان.',
    category: 'database',
    endpointUrl: 'https://mcp.postgres.internal/v2',
    transportType: 'http',
    sandboxTier: 'T1_LIMITED',
    enabledTools: ['external_postgres_query', 'get_table_schema'],
    requireConfirmationTools: ['external_postgres_query'],
  },
];

export function getPresetById(presetId: string): McpServerPreset | undefined {
  return MCP_SERVER_PRESETS.find((p) => p.id === presetId);
}
