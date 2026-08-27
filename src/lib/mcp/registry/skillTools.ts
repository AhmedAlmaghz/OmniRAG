import type { MCPToolDefinition } from './tools';
import type { MCPServerConfig } from '@/lib/types/omnirag';
import { normalizeChartSpec, chartMarkdownFence, CHART_TYPES } from '@/lib/skills/charts';
import {
  buildOfficeDocument,
  OFFICE_EXTENSIONS,
  OFFICE_MIME_TYPES,
  type OfficeFormat,
} from '@/lib/skills/officeDocuments';
import { storeSkillArtifact } from '@/lib/skills/artifactStore';
import { generateSkillImage } from '@/lib/skills/imageGen';
import { generateStructuredReport } from '@/lib/skills/reportGen';
import { sendSkillEmail } from '@/lib/skills/emailSender';

/**
 * Production skills (Phase 4) — real productivity tools exposed through the
 * same MCPToolDefinition registry as every other tool, so the agentic chat
 * loop, the protocol gateway and the approval gate all treat them uniformly.
 *
 * Render contract: tools that produce a visual artifact return a ready-to-paste
 * markdown snippet (chart fence / image / download link). The chat UI also
 * injects these snippets deterministically from the tool output, so artifacts
 * render even if the model forgets to copy them into its reply.
 */

function parseJsonArg(raw: unknown, what: string): unknown {
  if (raw == null || raw === '') return undefined;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`قيمة ${what} ليست JSON صالحا`);
  }
}

function safeFileName(title: string, extension: string): string {
  const safe =
    (title || 'document')
      .replace(/[\\/:*?"<>|]/g, '-')
      .trim()
      .slice(0, 80) || 'document';
  return `${safe}${extension}`;
}

export const SKILL_TOOLS: Record<string, MCPToolDefinition> = {
  create_chart: {
    name: 'create_chart',
    serverName: 'OmniRAG Production Skills',
    description: 'إنشاء مخطط بياني تفاعلي (أعمدة/خطوط/دائري/مساحة/مبعثر) من بيانات رقمية — يُعرض المخطط داخل المحادثة',
    category: 'skills',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    timeoutMs: 15000,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'عنوان المخطط' },
        chartType: {
          type: 'string',
          description: 'نوع المخطط',
          enum: [...CHART_TYPES],
        },
        labels: { type: 'string', description: 'تسميات المحاور مفصولة بفواصل (مثل: يناير,فبراير,مارس)' },
        series: {
          type: 'string',
          description: 'بيانات السلاسل بصيغة JSON: [{"name":"المبيعات","data":[10,20,30]}]',
        },
        xLabel: { type: 'string', description: 'عنوان المحور الأفقي (اختياري)' },
        yLabel: { type: 'string', description: 'عنوان المحور الرأسي (اختياري)' },
      },
      required: ['title', 'chartType', 'labels', 'series'],
    },
    execute: async (args) => {
      const spec = normalizeChartSpec({
        title: args.title,
        chartType: args.chartType,
        labels: args.labels,
        series: parseJsonArg(args.series, 'series'),
        xLabel: args.xLabel,
        yLabel: args.yLabel,
      });
      const fence = chartMarkdownFence(spec);
      return {
        success: true,
        simulated: false,
        chartType: spec.chartType,
        seriesCount: spec.series.length,
        pointsCount: spec.series.reduce((n, s) => n + s.data.length, 0),
        markdownFence: fence,
        renderInstruction:
          'اعرض المخطط في ردك بنسخ كتلة الكود التالية كما هي حرفيا (ستتحول إلى مخطط تفاعلي عند المستخدم):\n' + fence,
      };
    },
  },

  generate_image: {
    name: 'generate_image',
    serverName: 'OmniRAG Production Skills',
    description:
      'توليد صورة بالذكاء الاصطناعي من وصف نصي عبر مزودي الصور المهيئين (Imagen/DALL·E) وحفظها في مخزن الكائنات مع رابط عرض',
    category: 'skills',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    timeoutMs: 120000,
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'وصف تفصيلي للصورة المراد توليدها (يفضل بالإنجليزية لدقة أعلى)' },
        model: { type: 'string', description: 'مرجع نموذج الصور اختياري بصيغة provider/modelId (مثل openai/dall-e-3)' },
        size: { type: 'string', description: 'أبعاد الصورة بصيغة WIDTHxHEIGHT (مثل 1024x1024) إن دعمها المزود' },
        aspectRatio: { type: 'string', description: 'نسبة الأبعاد بصيغة W:H (مثل 16:9) إن دعمها المزود' },
      },
      required: ['prompt'],
    },
    execute: async (args, ctx) => {
      const result = await generateSkillImage({
        tenantId: ctx.tenantId,
        prompt: String(args.prompt || ''),
        modelRef: args.model,
        size: args.size,
        aspectRatio: args.aspectRatio,
      });
      if (!result.success) return result;
      return {
        ...result,
        imageUrl: result.artifact.url,
        fileName: result.artifact.fileName,
        sizeBytes: result.artifact.sizeBytes,
        markdownImage: `![${String(args.prompt || 'صورة مولدة').slice(0, 60)}](${result.artifact.url})`,
        renderInstruction: 'ضمّن الصورة في ردك عبر سطر الماركداون markdownImage أعلاه.',
      };
    },
  },

  create_office_document: {
    name: 'create_office_document',
    serverName: 'OmniRAG Production Skills',
    description:
      'إنشاء ملف مكتبي حقيقي قابل للتنزيل: Word (docx) أو Excel (xlsx) أو PowerPoint (pptx) أو PDF أو Markdown',
    category: 'skills',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    timeoutMs: 60000,
    parameters: {
      type: 'object',
      properties: {
        format: { type: 'string', description: 'صيغة الملف المطلوبة', enum: ['docx', 'xlsx', 'pptx', 'pdf', 'md'] },
        title: { type: 'string', description: 'عنوان المستند' },
        content: {
          type: 'string',
          description:
            'محتوى المستند بصيغة Markdown (عناوين #/##، نقاط -، جداول |). ملاحظة: PDF لا يدعم النصوص العربية — استخدم docx للعربية',
        },
        table: {
          type: 'string',
          description: 'بيانات جدول Excel بصيغة JSON: {"columns":["أ","ب"],"rows":[[1,2]]} (اختياري)',
        },
        slides: {
          type: 'string',
          description: 'شرائح العرض بصيغة JSON: [{"title":"...","bullets":["..."]}] (اختياري لـ pptx)',
        },
      },
      required: ['format', 'title'],
    },
    execute: async (args, ctx) => {
      const format = String(args.format || '') as OfficeFormat;
      if (!OFFICE_EXTENSIONS[format]) {
        throw new Error(`صيغة غير مدعومة: ${args.format}. الصيغ المتاحة: ${Object.keys(OFFICE_EXTENSIONS).join(', ')}`);
      }
      const table = parseJsonArg(args.table, 'table') as any;
      const slides = parseJsonArg(args.slides, 'slides') as any;

      const bytes = await buildOfficeDocument({
        format,
        title: String(args.title || ''),
        content: args.content,
        table,
        slides,
      });
      const fileName = safeFileName(String(args.title), OFFICE_EXTENSIONS[format]);
      const artifact = await storeSkillArtifact(ctx.tenantId, fileName, OFFICE_MIME_TYPES[format], bytes);

      return {
        success: true,
        simulated: false,
        format,
        fileName,
        sizeBytes: artifact.sizeBytes,
        downloadUrl: artifact.url,
        markdownLink: `[📄 ${fileName}](${artifact.url})`,
        renderInstruction: 'أرفق رابط التنزيل في ردك عبر سطر الماركداون markdownLink أعلاه.',
      };
    },
  },

  build_report: {
    name: 'build_report',
    serverName: 'OmniRAG Production Skills',
    description:
      'بناء تقرير مؤسسي منظم وطويل (ملخص تنفيذي + أقسام تحليلية + توصيات) من موضوع وسياق، مع تنزيله بصيغة Markdown أو DOCX أو PDF',
    category: 'skills',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    timeoutMs: 180000,
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'موضوع التقرير' },
        outline: { type: 'string', description: 'عناوين الأقسام مقترحة مفصولة بفواصل (اختياري)' },
        context: {
          type: 'string',
          description: 'سياق أو بيانات من قاعدة المعرفة يجب أن يستند إليها التقرير (اختياري)',
        },
        format: { type: 'string', description: 'صيغة الملف النهائي', enum: ['md', 'docx', 'pdf'] },
        language: { type: 'string', description: 'لغة التقرير', enum: ['ar', 'en'] },
      },
      required: ['topic'],
    },
    execute: async (args, ctx) => {
      const result = await generateStructuredReport({
        tenantId: ctx.tenantId,
        kind: 'report',
        topic: String(args.topic || ''),
        outline: args.outline,
        context: args.context,
        format: (args.format as OfficeFormat) || 'md',
        language: args.language === 'en' ? 'en' : 'ar',
      });
      if (!result.success) return result;
      return {
        ...result,
        markdownPreview: (result.markdown || '').slice(0, 1500),
        downloadUrl: result.artifact?.url,
        markdownLink: result.artifact ? `[📊 تقرير: ${result.artifact.fileName}](${result.artifact.url})` : undefined,
      };
    },
  },

  create_tutorial_guide: {
    name: 'create_tutorial_guide',
    serverName: 'OmniRAG Production Skills',
    description: 'إنشاء دليل تعليمي عملي خطوة-بخطوة حول موضوع تقني أو إجرائي، مع تنزيله بصيغة Markdown أو DOCX أو PDF',
    category: 'skills',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    timeoutMs: 180000,
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'موضوع الدليل التعليمي' },
        outline: { type: 'string', description: 'عناوين الأقسام مقترحة مفصولة بفواصل (اختياري)' },
        context: { type: 'string', description: 'سياق إضافي أو سياسات داخلية يجب الالتزام بها (اختياري)' },
        format: { type: 'string', description: 'صيغة الملف النهائي', enum: ['md', 'docx', 'pdf'] },
        language: { type: 'string', description: 'لغة الدليل', enum: ['ar', 'en'] },
      },
      required: ['topic'],
    },
    execute: async (args, ctx) => {
      const result = await generateStructuredReport({
        tenantId: ctx.tenantId,
        kind: 'tutorial',
        topic: String(args.topic || ''),
        outline: args.outline,
        context: args.context,
        format: (args.format as OfficeFormat) || 'md',
        language: args.language === 'en' ? 'en' : 'ar',
      });
      if (!result.success) return result;
      return {
        ...result,
        markdownPreview: (result.markdown || '').slice(0, 1500),
        downloadUrl: result.artifact?.url,
        markdownLink: result.artifact ? `[📘 دليل: ${result.artifact.fileName}](${result.artifact.url})` : undefined,
      };
    },
  },

  send_email: {
    name: 'send_email',
    serverName: 'OmniRAG Production Skills',
    description: 'إرسال بريد إلكتروني حقيقي عبر SMTP أو Resend — يتطلب موافقة بشرية مسبقة ولا يعمل دون تهيئة مزود بريد',
    category: 'skills',
    hasSideEffect: true,
    requireConfirmation: true,
    simulated: false,
    timeoutMs: 30000,
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'عناوين المستلمين مفصولة بفواصل (بحد أقصى 10)' },
        cc: { type: 'string', description: 'عناوين النسخة الكربونية مفصولة بفواصل (اختياري)' },
        subject: { type: 'string', description: 'موضوع الرسالة' },
        body: { type: 'string', description: 'نص الرسالة' },
        html: { type: 'boolean', description: 'هل النص بصيغة HTML؟ (افتراضي: نص عادي)' },
      },
      required: ['to', 'subject', 'body'],
    },
    execute: async (args, ctx) => {
      const result = await sendSkillEmail({
        to: args.to,
        cc: args.cc,
        subject: String(args.subject || ''),
        body: String(args.body || ''),
        html: Boolean(args.html),
      });

      // Lazy import: db.ts auto-injects the skills server, so a static import
      // here would create a db -> skillTools -> db cycle at module init.
      const { db } = await import('@/lib/storage/db');
      await db.addAuditLog({
        id: `audit-${Date.now()}-email`,
        tenantId: ctx.tenantId,
        actorId: ctx.userId || 'mcp_gateway',
        action: 'MCP_TOOL_EXECUTE',
        resourceType: 'email',
        resourceId: String(args.to || ''),
        status: result.success ? 'success' : 'error',
        details: result.success
          ? `تم إرسال بريد إلى (${args.to}) عبر ${result.provider} بعنوان "${String(args.subject).slice(0, 60)}"`
          : `فشل إرسال بريد إلى (${args.to}): ${result.error}`,
        timestamp: new Date().toISOString(),
      });

      return result;
    },
  },
};

export const SKILL_TOOL_NAMES = Object.keys(SKILL_TOOLS);

/** Tools that must surface a human approval request before executing. */
export const SKILL_CONFIRMATION_TOOLS = SKILL_TOOL_NAMES.filter((n) => SKILL_TOOLS[n].requireConfirmation);

/**
 * The built-in server entry that exposes the skills to a tenant. Auto-injected
 * by db.getMcpServers the same way the Unstructured Transform server is, so
 * existing tenants pick it up without re-seeding.
 */
export function buildSkillsServer(tenantId: string): MCPServerConfig {
  return {
    id: `mcp-omnirag-skills-${tenantId}`,
    tenantId,
    name: 'OmniRAG Production Skills',
    description: 'مهارات إنتاج حقيقية: مخططات تفاعلية، توليد صور، مستندات Office، تقارير وأدلة، وإرسال بريد إلكتروني',
    endpointUrl: 'https://skills.omnirag.internal',
    protocolVersion: '2026-07-28',
    sandboxTier: 'T1_LIMITED',
    enabledTools: [...SKILL_TOOL_NAMES],
    requireConfirmationTools: [...SKILL_CONFIRMATION_TOOLS],
    status: 'healthy',
    latencyMs: 0,
    lastChecked: new Date().toISOString(),
    category: 'skills',
  };
}
