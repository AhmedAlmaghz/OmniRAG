import { generateTextResilient } from '@/lib/ai/resilientGenerate';
import { buildOfficeDocument, OFFICE_EXTENSIONS, OFFICE_MIME_TYPES, type OfficeFormat } from './officeDocuments';
import { storeSkillArtifact, type StoredArtifact } from './artifactStore';

/**
 * Long-form structured generation engine behind build_report and
 * create_tutorial_guide. The model produces organized markdown from a topic +
 * outline, then the result is optionally materialized as a downloadable
 * document (md / docx / pdf) through the shared Office builders.
 *
 * Honesty: when every model in the resilient chain fails, the engine returns a
 * structured failure — it never fabricates report content.
 */

export type ReportKind = 'report' | 'tutorial';

export interface ReportGenerationParams {
  tenantId: string;
  kind: ReportKind;
  topic: string;
  /** Optional section headings (comma or newline separated). */
  outline?: string;
  /** Extra context the model must rely on (e.g. retrieved knowledge notes). */
  context?: string;
  /** Output document format. `md` returns markdown only (no file). */
  format?: OfficeFormat;
  language?: 'ar' | 'en';
}

export interface ReportGenerationResult {
  success: boolean;
  simulated: false;
  markdown?: string;
  artifact?: StoredArtifact;
  modelUsed?: string;
  sectionsCount?: number;
  wordCount?: number;
  error?: string;
}

function parseOutline(raw?: string): string[] {
  return (raw || '')
    .split(/[,\n،]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function buildPrompt(params: ReportGenerationParams, sections: string[]): string {
  const langNote =
    params.language === 'en' ? 'Write the document in English.' : 'اكتب الوثيقة باللغة العربية الفصحى الحديثة.';
  const outlineNote =
    sections.length > 0
      ? `التزم بالعناوين التالية بالترتيب:\n${sections.map((s) => `- ${s}`).join('\n')}`
      : 'اختر بنفسك هيكلا منطقيا من 4 إلى 7 أقسام رئيسية.';
  const contextNote = params.context?.trim()
    ? `استند حصرا إلى السياق التالي عند ذكر الحقائق، وأشر إليه بوضوح:\n\n${params.context.slice(0, 6000)}`
    : 'اعتمد على معرفتك العامة، وكن دقيقا وتجنب اختلاق أرقام أو مراجع غير موجودة.';

  if (params.kind === 'tutorial') {
    return `أنشئ دليلا تعليميا عمليا خطوة-بخطوة حول: "${params.topic}".

${langNote}
${outlineNote}

متطلبات الدليل:
1. ابدأ بعنوان رئيسي (#) ثم مقدمة قصيرة تشرح الهدف والفئة المستهدفة.
2. كل قسم بعنوان (##) مع خطوات مرقمة واضحة وأمثلة عملية.
3. أختم بملخص لأهم النقاط وأخطاء شائعة يجب تجنبها.
4. استخدم Markdown صالحا (عناوين، قوائم، جداول عند الحاجة).

${contextNote}`;
  }

  return `أنشئ تقريرا مهنيا منظما حول: "${params.topic}".

${langNote}
${outlineNote}

متطلبات التقرير:
1. ابدأ بعنوان رئيسي (#) ثم ملخص تنفيذي قصير.
2. كل قسم بعنوان (##) مع تحليل واضح ونقاط تعدادية عند الحاجة.
3. استخدم جداول Markdown لعرض المقارنات أو الأرقام.
4. أختم بخاتمة وتوصيات عملية مرقمة.
5. لا تختلق بيانات أو إحصاءات غير موجودة في السياق.

${contextNote}`;
}

/**
 * Generates the structured document and (unless format is `md`) stores it as a
 * downloadable artifact in the tenant's object store.
 */
export async function generateStructuredReport(params: ReportGenerationParams): Promise<ReportGenerationResult> {
  const topic = (params.topic || '').trim();
  if (!topic) {
    return { success: false, simulated: false, error: 'الموضوع (topic) مطلوب' };
  }
  const format: OfficeFormat = params.format || 'md';
  const sections = parseOutline(params.outline);

  const generated = await generateTextResilient({
    system:
      params.kind === 'tutorial'
        ? 'أنت كاتب تقني محترف متخصص في إعداد أدلة تعليمية واضحة ومنظمة بصيغة Markdown.'
        : 'أنت محلل ومحترف كتابة تقارير مؤسسية دقيقة ومنظمة بصيغة Markdown.',
    prompt: buildPrompt({ ...params, topic }, sections),
    temperature: 0.4,
  });

  if (!generated || !generated.text?.trim()) {
    return {
      success: false,
      simulated: false,
      error: 'تعذر توليد المحتوى: لم ينجح أي نموذج في السلسلة. تحقق من مفاتيح المزودين أو حاول مرة أخرى.',
    };
  }

  const markdown = generated.text.trim();
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;
  const sectionsCount = (markdown.match(/^#{1,2}\s+/gm) || []).length;

  if (format === 'md') {
    return { success: true, simulated: false, markdown, modelUsed: generated.modelUsed, sectionsCount, wordCount };
  }

  try {
    const safeTitle = topic.slice(0, 80).replace(/[\\/:*?"<>|]/g, '-');
    const bytes = await buildOfficeDocument({ format, title: topic, content: markdown, author: 'OmniRAG' });
    const artifact = await storeSkillArtifact(
      params.tenantId,
      `${safeTitle}${OFFICE_EXTENSIONS[format]}`,
      OFFICE_MIME_TYPES[format],
      bytes,
    );
    return {
      success: true,
      simulated: false,
      markdown,
      artifact,
      modelUsed: generated.modelUsed,
      sectionsCount,
      wordCount,
    };
  } catch (err: any) {
    // Content was generated successfully; only materialization failed.
    // Return the markdown so nothing is lost, with an honest error attached.
    return {
      success: true,
      simulated: false,
      markdown,
      modelUsed: generated.modelUsed,
      sectionsCount,
      wordCount,
      error: `تم توليد المحتوى لكن تعذر إنشاء الملف (${format}): ${err?.message || err}`,
    };
  }
}
