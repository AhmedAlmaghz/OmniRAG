import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai';
import { SearchQuery, SearchResult, DocumentChunk, Citation, MCPToolCall } from '../types/omnirag';
import { db } from '../storage/db';
import { searchPostgresLexical, normalizeArabicForSearch } from '../storage/postgres';
import { getVectorStoreSelection } from '../storage/vectors/registry';
import { generateEmbedding } from './embedding';
import { rerankChunks } from './reranker';
import { getAiModel } from '../config/aiModels';
import { getEnv } from '../env/runtimeEnv';
import { resolveLanguageModel, isModelRefConfigured } from '../ai/registry/resolve';
import { generateTextResilient } from '../ai/resilientGenerate';
import { SYSTEM_CONFIG } from '../config/systemConfig';
import { isTenantEmbeddingStale, selfHealStaleCorpus } from '../services/reembedService';
import { buildTenantMcpTools, type CustomToolSchema } from '../mcp/aiSdkTools';
import { ToolExecutionOutcome, executeMcpToolCall } from '../mcp/dispatcher';
import { createLogger } from '../logging/logger';

const log = createLogger('RagEngine');

/**
 * Dispatcher wrapper that converts hard failures (e.g. a model-hallucinated
 * unknown tool name) into a failed outcome instead of throwing, so the chat
 * loop can explain the failure to the user rather than collapsing into the
 * deterministic fallback response.
 */
export async function runToolSafely(
  tenantId: string,
  toolName: string,
  args: Record<string, any>,
  conversationId?: string,
): Promise<ToolExecutionOutcome> {
  try {
    return await executeMcpToolCall(toolName, args, { tenantId, conversationId });
  } catch (err: any) {
    const message = err?.message || 'الأداة غير قابلة للتنفيذ';
    return {
      toolName,
      result: { success: false, error: message },
      latencyMs: 0,
      isError: true,
      errorMessage: message,
      source: 'registry',
      simulated: false,
    };
  }
}

/**
 * Build the numbered citation list from retrieved context chunks.
 *
 * This exact mapping was previously copy-pasted in THREE places (tool-call
 * response, normal response, and the deterministic fallback), so any change to
 * citation shape had to be made three times. Single source of truth now.
 */
export function buildCitations(contextChunks: DocumentChunk[]): Citation[] {
  return contextChunks.map((chunk, idx) => ({
    index: idx + 1,
    chunkId: chunk.id,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    pageNumber: chunk.pageNumber,
    // Report the ACTUAL retrieval score; fabricating 0.85 for chunks without
    // one made citation confidence meaningless to the user.
    score: Number((chunk.score ?? 0).toFixed(4)),
    snippet: buildCitationSnippet(chunk.content),
    sourceUrl: getCitationSourceUrl(chunk),
  }));
}

/** Truncated snippet with an ellipsis ONLY when content was actually cut. */
function buildCitationSnippet(content: string): string {
  const clean = (content || '').trim();
  if (clean.length <= 120) return clean;
  return `${clean.substring(0, 120).trimEnd()}...`;
}

/**
 * Collects the tenant's enabled MCP tools + custom schemas from healthy
 * servers, applying the private-mode external-tool containment filter.
 * Shared by the completions path (generateRagCompletion) and the streaming
 * path (chat/stream) so both offer the identical tool surface.
 */
export async function collectTenantMcpTools(
  tenantId: string,
  mode: string,
): Promise<{
  toolsToOffer: string[];
  requireApprovalTools: string[];
  customSchemas: Record<string, CustomToolSchema>;
}> {
  const servers = await db.getMcpServers(tenantId);
  const enabledTools: string[] = [];
  const requireApprovalTools: string[] = [];
  const customSchemas: Record<string, CustomToolSchema> = {};

  for (const server of servers) {
    Object.assign(customSchemas, ((server as any).customToolSchemas || {}) as Record<string, CustomToolSchema>);
    if (server.status === 'healthy') {
      for (const tool of server.enabledTools) {
        enabledTools.push(tool);
        if (server.requireConfirmationTools?.includes(tool)) {
          requireApprovalTools.push(tool);
        }
      }
    }
  }

  let toolsToOffer = Array.from(new Set(enabledTools));
  if (mode === 'private') {
    const externalPrefixes = ['slack_', 'github_', 'web_', 'fetch_'];
    toolsToOffer = toolsToOffer.filter((t) => !externalPrefixes.some((pref) => t.startsWith(pref)));
  }

  return { toolsToOffer, requireApprovalTools, customSchemas };
}

/**
 * The agentic system instruction shared by the completions and streaming
 * paths. Kept in one place so tool guidance (including the Phase-4 production
 * skills) cannot drift between the two chat surfaces.
 */
export function buildAgenticSystemInstruction(modelToUse: string, mode: string, toolsToOffer: string[]): string {
  // Per-mode answer-depth policy. Every mode is COMPREHENSIVE by default — the
  // answer must cover ALL retrieved context, not a curated top-2 — but the
  // register adapts to the conversation mode the user picked.
  const modeDepthPolicy: Record<string, string> = {
    analysis:
      'وضع التحليل العميق: قدم إجابة تحليلية شاملة وموسعة — استخرج كل الأنماط والعلاقات والاستنتاجات والتفاصيل الرقمية من كل المصادر، مع مقارنة دقيقة بينها وتقييم نقاط الاتفاق والاختلاف، وتوثيق كل معلومة برقم استشهادها.',
    hybrid:
      'وضع الاسترجاع الهجين: قدم إجابة شاملة ومفصلة تغطي كل جانب ورد في المستندات المسترجعة، مع تنظيم واضح بعناوين وفقرات حسب محاور السؤال.',
    general:
      'الوضع العام: قدم إجابة شاملة ومفصلة بأسلوب سلس ومنظم، تغطي كل المعلومات المتاحة في المستندات المسترجعة دون اختصار مخل.',
    private: 'وضع الخصوصية المغلق: قدم إجابة شاملة ومفصلة اعتماداً على مستندات المستأجر الداخلية فقط.',
  };
  const depthPolicy = modeDepthPolicy[mode] || modeDepthPolicy.hybrid;

  return `أنت مساعد ذكي ومحرك وكلاء متمكن (Agentic RAG Engine) ضمن منصة OmniRAG للمؤسسات.
أنت متصل مباشرة ببروتوكول سياق النموذج MCP (Model Context Protocol) لربط الأنظمة والخوادم الحية.
النموذج النشط: ${modelToUse} | الوضع الحالي: ${mode}.
الأدوات والخوادم المربوطة والمتاحة لك فوراَ: ${toolsToOffer.length > 0 ? toolsToOffer.join(', ') : 'لا توجد أدوات خارجية مفعلة حالياَ'}.

ذاكرة المحادثة والسياق:
1. تم تزويدك بسجل المحادثة السابقة بينك وبين المستخدم. استخدم هذا السياق لفهم السياق الكامل للمحادثة.
2. إذا أشار المستخدم بكلمات مثل "هذا"، "ذلك"، "المذكور"، "الموضوع"، "مرة أخرى" وغيرها من الإشارات، فاستخدم سياق المحادثة السابقة لفهم المراد.
3. لا تعيد ذكر معلومات سبق إخبار المستخدم بها إلا إذا طلب ذلك صراحة.
4. رد بشكل طبيعي ومتصل كأنك تعرف تاريخ المحادثة.

سياسة شمولية الإجابة والإسناد (إلزامية بلا استثناء):
1. المستندات المسترجعة المرفقة أدناه هي مصدرك الوحيد، وقد جرى استرجاعها لأنها تحقق شرط البحث والاسترجاع حسب المصادر والصلاحيات المحددة من المستخدم — لذلك استخدمها كلها ولا تهمل أياً منها.
2. لا تحدد عدد المصادر التي تعتمد عليها: غطِّ المعلومات الواردة في كل المقاطع المسترجعة التي تتصل بالسؤال، واعمل على أن يظهر أثر كل مصدر ذي صلة في الإجابة.
3. لا يوجد أي حد لطول الإجابة أو عدد الفقرات: أجب بإسهاب كامل وبشكل مفصل وواضح حتى تغطي كل شيء عن السؤال — ملخصات الأسطر القليلة المختصرة غير مقبولة إلا إذا طلب المستخدم صراحةً الإيجاز أو كان السؤال بسيطاً بطبيعته.
4. نظم الإجابة بعناوين وفقرات ونقاط بحسب محاور السؤال، واشرح كل نقطة بعمق مدعومة بالمعلومات المسترجعة (تعريفات، خطوات، أرقام، تواريخ، أمثلة، استثناءات).
5. إذا كانت المعلومات المتاحة لا تغطي السؤال بالكامل، اذكر صراحةً ما هو مغطى وما لم تتوفر له معلومات ضمن المصادر، دون اختلاق.
6. إذا كان السؤال تجميعياً/شاملاً عن محتوى مستند كامل أو هيكله (مثل: ما هي الدروس/الفصول/الوحدات/المحتويات في الكتاب؟ أو عدّد كل الأقسام)، فهذا يتطلب استعراض كامل المستند: اجمع المعلومات من جميع المقاطع المسترجعة عبر كامل نطاق المستند من أوله إلى آخره (استعن بخريطة ترتيب المستند المرفقة إن وجدت)، ورتّبها حسب تسلسلها الطبيعي، ولا تجب أبداً من مقطع واحد أو فصل واحد مهما بدا أقرب للسؤال.
7. إذا ذكر المستخدم في سؤاله مصدراً/مرجعاً/كتاباً معيناً بالاسم، فقد جرى تجهيز المقاطع المسترجعة لتغطية ذلك المصدر تحديداً عبر كامله — فاجب من كامل مقاطعه المرفقة بترتيبها في المصدر، من المقدمة والفصل الأول حتى الفصل الأخير والخاتمة، واستشهد بكل مقطع ذي صلة. لا يجوز الاكتفاء بجزء من المصدر مهما بدا أكثر صلة بالسؤال.
${depthPolicy}

قواعد الإسناد والاستشهاد المضمن:
1. عند استخدام معلومة من المستندات المرفقة، ضع رقم الاستشهاد مباشرة في النص كرقم بين أقواس مربعة مثل [1] أو [2] المطابق لرقم المصدر، ووزع الاستشهادات على كامل متن الإجابة كلما وردت معلومة من مصدر.
2. لا تبتكر مراجع وهمية غير موجودة في النص.
3. لا تضع قائمة منفصلة للمصادر في نهاية الرد — فقط الأرقام المضمنة في النص.

توجيهات واستخدام أدوات الـ MCP:
1. إذا طلب المستخدم إجراء أو استعلام يتطلب إرسال تنبيه أو رسالة (مثل slack_send_message أو slack_post_alert)، أو قراءة قناة (slack_read_channel)، أو البحث في كود GitHub أو إنشاء تذكرة (github_search_code / github_create_issue)، أو البحث المباشر في الويب (web_live_search / fetch_url_content)، أو الاستعلام عن قواعد البيانات (external_postgres_query)، أو البحث في قاعدة المعرفة (search_knowledge_base) أو فهرسة محتوى جديد فيها (knowledge_ingest_document)، فيجب عليك فوراَ استدعاء الأداة المناسبة عبر Function Call.
2. مهارات الإنتاج: إذا طلب المستخدم رسما بيانيا أو مخططا فاستدع create_chart ومرر البيانات الرقمية كاملة؛ وإذا طلب صورة فاستدع generate_image مع وصف دقيق؛ وإذا طلب ملف Word/Excel/PowerPoint/PDF فاستدع create_office_document مع المحتوى بصيغة Markdown؛ وإذا طلب تقريرا منظما فاستدع build_report؛ وإذا طلب دليلا تعليميا أو شرحا خطوة-بخطوة فاستدع create_tutorial_guide؛ وإذا طلب إرسال بريد إلكتروني فاستدع send_email (سيتطلب موافقة المستخدم قبل الإرسال). عند استلام نتيجة أي من هذه المهارات، ضمّن في ردك عنصر العرض المرفق في النتيجة (markdownFence للمخططات، markdownImage للصور، markdownLink للملفات) كما هو حرفيا.
3. اختر دائماَ الأداة الأنسب لنية المستخدم، ومرّر المدخلات المطلوبة كاملة وصحيحة حسب مخطط كل أداة. إذا لم تكن أي أداة مناسبة، أجب من المستندات المتاحة مباشرة دون استدعاء.
4. ملاحظة صدق البيانات: بعض النتائج تأتي موسومة بـ "simulated: true" وهي بيانات تجريبية توضيحية وليست تكاملا حيا — وضّح للمستخدم بلطف أن هذه البيانات تجريبية. أما النتائج الموسومة بـ "simulated: false" فهي من تكامل حقيقي.
5. إذا فشلت الأداة وأعادت خطأ، لا تختلق نتائج: اعتذر باختصار، اشرح سبب الفشل، واقترح خطوة بديلة.
6. بالنسبة للأدوات ذات الأثر الجانبي، سيتولى نظام الأمان طلب الموافقة البشرية قبل التنفيذ تلقائيا.
${mode === 'private' ? 'تنبيه الأمان الحرج: الوضع الحالي مغلق وخاص بالكامل (Private Mode). تم إيقاف وتصفية جميع أدوات الـ MCP الخارجية لشبكة الويب أو الخدمات الخارجية للطرف الثالث حماية لسرية بيانات المستأجر.' : ''}`;
}

/**
 * Smart Router: selects the optimal model based on query complexity and mode from central settings
 */
export function selectSmartModel(query: string, mode: string): string {
  if (mode === 'analysis' || query.length > 250 || query.includes('حلل') || query.includes('مقارنة')) {
    return getAiModel('analysisModel');
  }
  return getAiModel('chatModel');
}

/**
 * Detects AGGREGATIVE queries — questions that ask for a comprehensive
 * enumeration over a document/collection ("ما هي الدروس/الفصول/الوحدات…",
 * "list all chapters", "أعطني ملخص كل جزء"). These are fundamentally
 * different from point queries: the answer is spread across the WHOLE
 * corpus, not concentrated in the top-k nearest neighbors.
 *
 * For such queries plain semantic top-k retrieval systematically fails —
 * the query embedding resembles a table-of-contents fragment, so retrieval
 * gravitates to one section (typically the tail) and the model answers from
 * it. The engine routes these through multi-query + full-coverage retrieval
 * instead (see performHybridSearch).
 *
 * LEXICAL detection (not regex phrases): the earlier phrase-based detector
 * required exact collocations like "الدروس/الفصول..." with the definite
 * article — real users write "ماهي وحدات ودروس كتاب الفيزياء ثالث ثانوي
 * اليمن بالتفصيل الممل" (no ال, واو عطف, ماهي fused) and the detector
 * missed it entirely, so none of the coverage machinery ever ran. Word-level
 * matching over the ARABIC-NORMALIZED query is robust to every such variant.
 */
/** Content-enumeration nouns — any mention signals an aggregative intent. */
const AGGREGATIVE_NOUNS_AR = [
  // lesson / unit / chapter / section / topic family (definite, indefinite,
  // dual, plural — the normalizer already folds hamza/alef/taa-marbuta)
  'دروس',
  'درس',
  'وحدات',
  'وحده',
  'فصول',
  'فصل',
  'موضوعات',
  'موضوع',
  'محاور',
  'محور',
  'اقسام',
  'قسم',
  'عناوين',
  'عنوان',
  'اجزاء',
  'جزء',
  'محتويات',
  'محتوى',
  'فهرس',
  'منهج',
  'فهرسات',
  'توبيك',
];
/** Verbs/asks that signal enumeration intent even without an aggregative noun. */
const AGGREGATIVE_LEXICON_EN = [
  'lessons',
  'chapters',
  'units',
  'sections',
  'topics',
  'contents',
  'curriculum',
  'outline',
  'syllabus',
  'table of contents',
];
/** Verbs that amplify the enumerative signal when combined with a noun. */
const ENUMERATION_VERBS_AR = ['اذكر', 'اسرد', 'عدد', 'استعرض', 'اعرض', 'لخص', 'اجمع', 'احصر', 'استقصي', 'حصر'];
/** Exhaustiveness modifiers that alone can trigger aggregative mode. */
const EXHAUSTIVE_MARKERS_AR = [
  'بالتفصيل الممل',
  'بشكل شامل',
  'بشكل كامل',
  'كل شيء',
  'تغطية كاملة',
  'بجميع تفاصيله',
  'من اوله الى اخرة',
  'بالكامل',
];

export function isAggregativeQuery(query: string): boolean {
  const q = normalizeArabicForSearch(query.toLowerCase());
  const tokens = new Set(q.split(/[\s،,؛;؟?!.\u060C]+/).filter(Boolean));

  // 1) Any aggregative noun (word-level, works with/without ال and واو العطف)
  const hasNoun = AGGREGATIVE_NOUNS_AR.some(
    (w) => tokens.has(w) || tokens.has(`ال${w}`) || tokens.has(`و${w}`) || tokens.has(`بال${w}`),
  );
  // 2) Exhaustiveness markers alone are a strong enough signal
  const hasExhaustiveMarker = EXHAUSTIVE_MARKERS_AR.some((m) => q.includes(m));
  // 3) English enumeration lexicon
  const hasEnglish = AGGREGATIVE_LEXICON_EN.some((w) => q.includes(w));
  // 4) TOC-style "محتويات/فهرس" anywhere
  const hasToc = /فهرس|محتويات|جدول المحتويات/.test(q) || /table of contents/.test(q);

  return hasNoun || hasExhaustiveMarker || hasEnglish || hasToc;
}

/**
 * Detects whether the query names a specific source/document ("كتاب
 * الفيزياء ثالث ثانوي اليمن") — a strong signal that the user wants the
 * answer built from THAT document, comprehensively. Used to anchor retrieval
 * on the named document's chunks instead of leaving the pool to drift toward
 * whatever nearest neighbors dominate.
 *
 * Word overlap is computed over ARABIC-NORMALIZED text (same folding as
 * search) with Arabic stopwords excluded, so "الفيزياء" matches a document
 * titled "كتاب الفيزياء" regardless of hamza/diacritic/definite-article
 * differences.
 */
const AR_STOPWORDS = new Set([
  'في',
  'من',
  'على',
  'عن',
  'الى',
  'إلى',
  'ما',
  'ماهي',
  'ماهى',
  'هي',
  'هو',
  'ماذا',
  'و',
  'أو',
  'او',
  'ثم',
  'التي',
  'الذي',
  'هذا',
  'هذه',
  'ذلك',
  'تلك',
  'مع',
  'كل',
  'بالتفصيل',
  'الممل',
  'الرئيسية',
  'الموجودة',
  'الموجود',
  'اذكر',
  'اسرد',
  'عدد',
  'استعرض',
  'اعرض',
  'لخص',
  'بين',
  'وضح',
  'اشرح',
  'قلي',
  'اخبرني',
  'اريد',
  // Generic container words — "كتاب/مرجع/مصدر" appear in nearly every
  // knowledge-base title, so keeping them would match EVERYTHING.
  'كتاب',
  'كتب',
  'مرجع',
  'مراجع',
  'مصدر',
  'مصادر',
  'المنهج',
  'منهج',
  // DELIBERATELY NOT stopwords (the v0.12.4 mistake): ثالث/ثانوي/اليمن/
  // الصف/ابتدائي… — grade/level/region words are PRIMARY discriminators in
  // textbook titles ("الفيزياء ثالث ثانوي" vs "الفيزياء أول ثانوي");
  // dropping them collapsed every same-subject book into a 4-way tie.
]);

/** Tokenizes an Arabic/English string into normalized search tokens. */
function toNormalizedTokens(input: string, extraStop: Set<string> = new Set()): string[] {
  return normalizeArabicForSearch(input.toLowerCase())
    .split(/[\s،,؛;؟?!.:\-()\[\]«»"']+/)
    .map((t) => t.replace(/^(?:بال|وال|فال|كال|لل)/, '').replace(/^ال/, ''))
    .filter((t) => t.length > 2 && !AR_STOPWORDS.has(t) && !extraStop.has(t));
}

export interface NamedDocumentMatch {
  documentId: string;
  title: string;
  /** 0..1 — share of QUERY content-words found in the document title. */
  overlap: number;
}

/**
 * Finds the document whose title best matches the query's content words.
 * Returns undefined when no document's title shares at least MIN_TITLE_OVERLAP
 * of the query's content vocabulary (i.e. the query names no known source).
 */
export async function findNamedDocumentInQuery(
  query: string,
  tenantId: string,
): Promise<NamedDocumentMatch | undefined> {
  const queryTokens = toNormalizedTokens(query);
  if (queryTokens.length === 0) return undefined;

  const docs = await db.getDocuments(tenantId);
  let best: NamedDocumentMatch | undefined;

  for (const doc of docs) {
    const titleTokens = new Set(toNormalizedTokens(doc.title || ''));
    if (titleTokens.size === 0) continue;
    const hits = queryTokens.filter((t) => titleTokens.has(t)).length;
    const overlap = hits / queryTokens.length;
    if (overlap < 0.2) continue;
    if (!best || overlap > best.overlap) {
      best = { documentId: doc.id, title: doc.title, overlap };
    } else if (best && overlap === best.overlap && hits > queryTokens.length * 0.2) {
      // TIE-BREAKERS (same overlap): prefer the title that covers MORE query
      // content words absolutely (a longer, more specific match), then the
      // more recent document — textbooks commonly share subject+grade words
      // and the newest upload is what the user is most likely asking about.
      const bestTitleTokens = new Set(toNormalizedTokens(best.title));
      const bestHits = queryTokens.filter((t) => bestTitleTokens.has(t)).length;
      const bestCreated = docs.find((d) => d.id === best!.documentId)?.createdAt || '';
      if (hits > bestHits || (hits === bestHits && (doc.createdAt || '') > bestCreated)) {
        best = { documentId: doc.id, title: doc.title, overlap };
      }
    }
  }
  return best;
}

/**
 * Multi-query expansion for aggregative searches (Multi-Query Retrieval, as
 * pioneered by LangChain/LlamaIndex RAG pipelines): transform the user's
 * question into 2-3 diverse retrieval views so no single embedding can
 * dominate the neighbor pool:
 *   - the original question (user intent preserved),
 *   - a structure view ("الفهرس/الفصول/العناوين…"),
 *   - a content view ("عناوين الدروس + أسماء الوحدات + المحاور").
 * When the query names a specific document, the title words are injected into
 * the views so embeddings anchor on the RIGHT book.
 * Each view is embedded and searched, then the per-view results are fused
 * with RRF — a query that mentions "الدروس والوحدات" now ALSO matches the
 * chapter-title fragments that never resembled the full question embedding.
 */
function buildAggregativeQueryViews(query: string, namedDocTitle?: string): string[] {
  const views = new Set<string>([query]);
  const coreSubject = query.replace(/[?؟!.]/g, '').trim();
  const titleHint = namedDocTitle ? ` في ${namedDocTitle}` : '';
  views.add(`فهرس ومحتويات وعناوين${titleHint}: ${coreSubject}`);
  views.add(`الفصول والوحدات والدروس وعناوين الأقسام الرئيسية${titleHint}: ${coreSubject}`);
  return Array.from(views).slice(0, 3);
}

/**
 * HyDE (Hypothetical Document Embeddings) Generator using Vercel AI SDK
 */
export async function generateHydeDocument(query: string): Promise<string> {
  const hydeModelName = getAiModel('hydeModel');
  if (!(await isModelRefConfigured(hydeModelName))) return query;

  try {
    const { text } = await generateText({
      model: await resolveLanguageModel(hydeModelName),
      prompt: `اكتب مستندا افتراضيا مثاليا يبين الإجابة الشاملة على السؤال التالي بغرض استخدامه في محرك الاسترجاع المتجهي (HyDE):\n\nالسؤال: ${query}`,
    });
    return text || query;
  } catch (e) {
    log.warn('HyDE generation fallback to raw query:', e);
    return query;
  }
}

/**
 * Reciprocal Rank Fusion (RRF) algorithm:
 * RRF_Score(d) = (1 / (k + rank_semantic)) * semanticWeight + (1 / (k + rank_lexical)) * lexicalWeight
 * where k = 60
 */
export function computeRrfScore(
  semanticRank: number | null,
  lexicalRank: number | null,
  semanticWeight: number = 0.7,
  lexicalWeight: number = 0.3,
  k: number = 60,
): number {
  let score = 0;
  if (semanticRank !== null && semanticRank > 0) {
    score += (1 / (k + semanticRank)) * semanticWeight;
  }
  if (lexicalRank !== null && lexicalRank > 0) {
    score += (1 / (k + lexicalRank)) * lexicalWeight;
  }
  return score;
}

/**
 * Hybrid Search Engine: Dense Vector + Sparse Lexical + Reciprocal Rank Fusion (RRF)
 */
export async function performHybridSearch(searchQuery: SearchQuery): Promise<SearchResult> {
  const startTime = Date.now();

  // Retrieval merges ALL chunks above the semantic floor — there is no fixed
  // topK that silently truncates the answer pool. `topK`, when a caller still
  // passes it, only nudges how many candidates each backend returns before
  // fusion/reranking (an over-fetch hint, never a final cap). The single
  // downward bound is `CONTEXT_CHUNK_CAP` applied as a defensive soft cap
  // after reranking, sized to fit a reasonable model context window.
  const {
    tenantId,
    query,
    collectionIds,
    topK,
    // Pull the semantic similarity floor from the centralized RAG config so we
    // don't keep a second dead copy here. Callers CAN still override per-call
    // (e.g. a strict-debate search with scoreThreshold: 0.3), but the default
    // matching/recall policy now comes from SYSTEM_CONFIG.RAG instead of being
    // unavailable at runtime.
    scoreThreshold = SYSTEM_CONFIG.RAG.MIN_SIMILARITY_SCORE,
    semanticWeight = SYSTEM_CONFIG.RAG.HYBRID_WEIGHTS.SEMANTIC,
    lexicalWeight = SYSTEM_CONFIG.RAG.HYBRID_WEIGHTS.LEXICAL,
    useHyde,
  } = searchQuery;

  // `topK` is now purely an over-fetch hint per backend. We clamp it from
  // below so a caller passing `topK: 0` doesn't nuke recall, and from above
  // so a runaway value (e.g. 50000 in a fuzz test) can't balloon Qdrant/PG
  // traffic — the ceiling is tied to the final context cap so the backends can
  // always deliver every chunk the model context could hold. The merged result
  // pool is sliced only by the similarity floor and the final
  // CONTEXT_CHUNK_CAP — never by this hint.
  const overfetchHint = Math.max(8, Math.min(topK ?? 40, SYSTEM_CONFIG.RAG.CONTEXT_CHUNK_CAP));
  const overfetchLimit = Math.max(
    overfetchHint * SYSTEM_CONFIG.RAG.ENGINE_OVERFETCH_FACTOR,
    SYSTEM_CONFIG.RAG.CONTEXT_CHUNK_CAP,
  );

  // Aggregative questions ("ما هي الدروس في الكتاب؟") enumerate content
  // spread over the WHOLE corpus. Plain nearest-neighbor retrieval anchors
  // to one section for them, so we expand the query into multiple retrieval
  // views and fuse them — full-coverage retrieval instead of top-k locality.
  const aggregative = isAggregativeQuery(query);

  // NAMED-DOCUMENT anchoring: when the query names a specific source
  // ("كتاب الفيزياء ثالث ثانوي اليمن"), the user's intent is comprehensive
  // coverage of THAT book. Detect the best title match and (for aggregative
  // queries) ensure the pool is anchored on the named document's chunks.
  const namedDoc = aggregative ? await findNamedDocumentInQuery(query, tenantId) : undefined;
  const searchViews = aggregative ? buildAggregativeQueryViews(query, namedDoc?.title) : [query];

  // Step 1: Optional HyDE Expansion (Applied ONLY to Semantic Search)
  let semanticSearchContent = searchViews[0];
  let hydePrompt: string | undefined;
  if (useHyde) {
    hydePrompt = await generateHydeDocument(query);
    semanticSearchContent = `${semanticSearchContent} ${hydePrompt}`;
  }

  // Lexical search uses the clean original query
  const lexicalSearchContent = query;

  // Check if we can use real database connections
  const isPostgresActive = !!(getEnv('DATABASE_URL') || getEnv('POSTGRES_URL'));
  // Resolve the tenant's vector backend through the storage registry. The
  // in-memory backend only participates in semantic search when a tenant
  // explicitly selected it — otherwise a nothing-configured deployment keeps
  // the historical keyword-only behavior.
  const { store: vectorStore, explicit: vectorStoreExplicit } = await getVectorStoreSelection(tenantId);
  const isVectorActive = vectorStore.isConfigured() && (vectorStore.id !== 'memory' || vectorStoreExplicit);

  // ── VECTOR PROVENANCE GUARD ─────────────────────────────────────────────
  // Vectors produced by a different embedding model (or a different
  // embedding pipeline version) live in an incomparable space — comparing
  // them against the ACTIVE model's query vectors yields pure noise that
  // LOOKS like results. This is the exact mechanism that made dev-pro appear
  // "broken" right after the v0.12.3 default-model switch: the corpus was
  // still text-embedding-004 while queries became gemini-embedding-2.
  // On staleness: (a) trigger the background self-heal re-embed once, and
  // (b) downgrade the semantic arm to a RANK-ONLY signal (no similarity
  // claims, weight shifted to lexical) so this search still returns useful
  // lexical results instead of cross-space garbage.
  let vectorsStale = false;
  try {
    vectorsStale = await isTenantEmbeddingStale(tenantId);
    if (vectorsStale) {
      log.warn(
        `[Hybrid Search] Stored vectors use a different embedding model/pipeline than the active one — semantic arm downgraded to rank-only; a background re-embed has been scheduled.`,
      );
      void selfHealStaleCorpus(tenantId);
    }
  } catch {
    // Provenance check is best-effort — never block search on it.
  }
  const effectiveSemanticWeight = vectorsStale ? 0 : semanticWeight;
  const effectiveLexicalWeight = vectorsStale ? Math.max(lexicalWeight, 0.7) : lexicalWeight;

  let resultChunks: any[] = [];
  let totalCount = 0;
  let semanticMatches = 0;
  let lexicalMatches = 0;

  if (isPostgresActive || isVectorActive) {
    try {
      // Run semantic and lexical search in parallel. The semantic backend is
      // asked for ALL chunks meeting the similarity floor (score_threshold),
      // capped only by an over-fetch hint that protects the round-trip cost
      // — vector stores pre-filter below the floor server-side, so fused RRF
      // ranks over genuinely-relevant chunks instead of arbitrary rank
      // truncation.
      //
      // AGGREGATIVE queries additionally run EVERY retrieval view and fuse
      // the views with RRF (multi-query retrieval): each view contributes
      // its own neighbor ranks, so chapter-title fragments that never
      // resemble the full question embedding still surface.
      const semanticArm = async (): Promise<any[]> => {
        if (!isVectorActive) return [];
        if (aggregative && searchViews.length > 1) {
          // Multi-view semantic search: embed each view, search, then RRF-
          // fuse across views. Rank r in ANY view contributes 1/(k+r)/views.
          const perViewResults = await Promise.all(
            searchViews.map(async (view) => {
              const vector = await generateEmbedding(view);
              return vectorStore.search({
                vector,
                tenantId,
                collectionIds,
                limit: overfetchLimit,
                scoreThreshold,
              });
            }),
          );
          const fused = new Map<string, any>();
          for (const viewResults of perViewResults) {
            viewResults.forEach((item, idx) => {
              const existing = fused.get(item.id);
              const viewRankScore = 1 / (SYSTEM_CONFIG.RAG.RRF_CONSTANT_K + idx + 1);
              if (existing) {
                existing.__viewScore = (existing.__viewScore || 0) + viewRankScore;
                if ((item.semanticScore || 0) > (existing.semanticScore || 0)) {
                  existing.semanticScore = item.semanticScore;
                }
              } else {
                fused.set(item.id, { ...item, __viewScore: viewRankScore });
              }
            });
          }
          return Array.from(fused.values()).sort((a, b) => (b.__viewScore || 0) - (a.__viewScore || 0));
        }
        const vector = await generateEmbedding(semanticSearchContent);
        return vectorStore.search({
          vector,
          tenantId,
          collectionIds,
          limit: overfetchLimit,
          scoreThreshold,
        });
      };

      const [semanticResults, lexicalResults] = await Promise.all([
        semanticArm(),
        isPostgresActive
          ? searchPostgresLexical(lexicalSearchContent, tenantId, overfetchLimit, collectionIds)
          : Promise.resolve([]),
      ]);

      const itemMap = new Map<string, any>();

      // Index semantic ranks
      semanticResults.forEach((item, idx) => {
        itemMap.set(item.id, {
          ...item,
          semanticRank: idx + 1,
          lexicalRank: null,
          semanticScore: item.semanticScore || 0,
          lexicalScore: 0,
        });
      });

      // Index lexical ranks
      lexicalResults.forEach((item, idx) => {
        const existing = itemMap.get(item.id);
        if (existing) {
          existing.lexicalRank = idx + 1;
          existing.lexicalScore = item.lexicalScore || 0;
        } else {
          itemMap.set(item.id, {
            ...item,
            semanticRank: null,
            lexicalRank: idx + 1,
            semanticScore: 0,
            lexicalScore: item.lexicalScore || 0,
          });
        }
      });

      // Batch load document titles — only when some merged items actually
      // lack one. The Qdrant payload carries `documentTitle`, so the previous
      // unconditional "load every tenant document per search" round-trip was
      // an N+1-style tax on the common path.
      const docIds = Array.from(
        new Set(
          Array.from(itemMap.values())
            .map((i) => i.documentId)
            .filter(Boolean),
        ),
      );
      const docMap = new Map<string, string>();
      const missingTitles = docIds.filter(
        (id) => !Array.from(itemMap.values()).some((i) => i.documentId === id && i.documentTitle),
      );
      if (missingTitles.length > 0) {
        const tenantDocs = await db.getDocuments(tenantId);
        tenantDocs.forEach((d) => docMap.set(d.id, d.title));
      }

      const mergedList = Array.from(itemMap.values());

      // Apply the semantic similarity floor post-fusion: keep a chunk if it
      // either passed Qdrant's cosine floor (semanticScore >= scoreThreshold)
      // OR was independently matched by lexical search (exact keyword hit,
      // high precision even when its embedding score is low). Pure noise that
      // neither matched semantically nor lexically is dropped here.
      const semanticFloor = scoreThreshold;
      const filteredList = mergedList.filter((item) => {
        const passedSemantic = (item.semanticScore || 0) >= semanticFloor;
        const passedLexical = item.lexicalRank !== null && item.lexicalRank > 0;
        return passedSemantic || passedLexical;
      });

      for (const item of filteredList) {
        if (!item.documentTitle) {
          item.documentTitle = docMap.get(item.documentId) || 'مستند مسترجع';
        }

        // Apply Reciprocal Rank Fusion (RRF). k comes from the central config —
        // previously the SYSTEM_CONFIG value was dead because this call relied
        // on the function default, so tuning the config changed nothing. The
        // EFFECTIVE weights are the staleness-adjusted ones: with stale
        // vectors the semantic rank carries no real similarity information
        // (cross-space noise), so its weight drops to 0.
        const rrf = computeRrfScore(
          item.semanticRank,
          item.lexicalRank,
          effectiveSemanticWeight,
          effectiveLexicalWeight,
          SYSTEM_CONFIG.RAG.RRF_CONSTANT_K,
        );
        item.score = Number(rrf.toFixed(4));
        item.tenantId = tenantId;
      }

      filteredList.sort((a, b) => b.score - a.score);
      // No topK slice here — every above-floor chunk is carried forward.
      // The defensive soft cap is applied AFTER reranking, once, below.
      resultChunks = filteredList;
      totalCount = filteredList.length;

      semanticMatches = resultChunks.filter((c) => c.semanticScore >= semanticFloor).length;
      lexicalMatches = resultChunks.filter((c) => c.lexicalRank !== null && c.lexicalRank > 0).length;
    } catch (realSearchError) {
      log.error('Real hybrid search failed, falling back to local storage:', realSearchError);
      resultChunks = [];
    }
  }

  // Fallback to local db chunks if we got zero results
  if (resultChunks.length === 0) {
    let chunks = await db.getChunks(tenantId);

    if (collectionIds && collectionIds.length > 0) {
      const docsInCollections = (await db.getDocuments(tenantId)).filter((d) =>
        d.collectionIds?.some((c) => collectionIds.includes(c)),
      );
      const validDocIds = new Set(docsInCollections.map((d) => d.id));
      chunks = chunks.filter((c) => validDocIds.has(c.documentId));
    }

    // Defensive bound on the keyword-fallback candidate pool. This degraded
    // path scores chunks in-process, so an unbounded tenant corpus would load
    // every chunk into memory and burn CPU on keyword matching. Beyond this
    // pool size a naive keyword fallback is not meaningful anyway — the proper
    // fix is restoring the Qdrant/Postgres backends.
    const FALLBACK_SCAN_CAP = 2000;
    if (chunks.length > FALLBACK_SCAN_CAP) {
      log.warn(
        `[Search fallback] Tenant corpus has ${chunks.length} chunks; capping keyword fallback scan at ${FALLBACK_SCAN_CAP}.`,
      );
      chunks = chunks.slice(0, FALLBACK_SCAN_CAP);
    }

    // Arabic-normalized keyword matching: both the query terms AND the chunk
    // text are folded through normalizeArabicForSearch so diacritic/hamza
    // variants match instead of silently missing.
    const norm = (s: string) => normalizeArabicForSearch(s.toLowerCase());
    const queryTerms = norm(lexicalSearchContent)
      .split(/\s+/)
      .filter((t) => t.length > 2);

    const scoredChunks = chunks.map((chunk) => {
      const textLower = norm(chunk.content);
      const titleLower = norm(chunk.documentTitle || '');

      let lexicalScore = 0;
      queryTerms.forEach((term) => {
        if (textLower.includes(term)) lexicalScore += 0.25;
        if (titleLower.includes(term)) lexicalScore += 0.4;
      });
      lexicalScore = Math.min(1.0, lexicalScore);

      // Heuristic semantic score starts at ZERO (not 0.2): the baseline was
      // above MIN_SIMILARITY_SCORE (0.15), which made the below-floor filter a
      // no-op and let completely unmatched chunks flood the (now much larger)
      // model context. Only real term hits/language matches accrue score now.
      let semanticScore = 0;
      queryTerms.forEach((term) => {
        if (textLower.includes(term)) semanticScore += 0.35;
      });
      if (searchQuery.language && searchQuery.language !== 'auto' && chunk.language === searchQuery.language) {
        semanticScore += 0.1;
      }
      semanticScore = Math.min(0.98, semanticScore);

      // Deterministic RRF score for fallback local search (staleness-adjusted
      // weights: with cross-space vectors the lexical term carries the signal).
      const fusedScore = semanticScore * effectiveSemanticWeight + lexicalScore * effectiveLexicalWeight;

      return {
        ...chunk,
        score: Number(fusedScore.toFixed(3)),
        semanticScore: Number(semanticScore.toFixed(3)),
        lexicalScore: Number(lexicalScore.toFixed(3)),
      };
    });

    scoredChunks.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Apply the same semantic floor as the live path so the local fallback
    // can't carry a pile of zero-relevance chunks into the model context.
    // A chunk is retained if its heuristic semantic score meets the floor OR
    // its lexical score is non-zero (exact term hit). No topK truncation here
    // — the defensive CONTEXT_CHUNK_CAP after reranking is the only soft bound.
    const localSemanticFloor = scoreThreshold;
    const localFiltered = scoredChunks.filter(
      (c) => (c.semanticScore || 0) >= localSemanticFloor || (c.lexicalScore || 0) > 0,
    );
    resultChunks = localFiltered;
    totalCount = localFiltered.length;

    semanticMatches = resultChunks.filter((c) => (c.semanticScore || 0) >= localSemanticFloor).length;
    lexicalMatches = resultChunks.filter((c) => (c.lexicalScore || 0) > 0).length;
  }

  // Optional Cross-Encoder LLM Reranking (SPEC-C04). We now pass the FULL
  // above-floor pool — the reranker no longer internally caps at 15 — so its
  // cross-encoder scores are computed against every viable candidate rather
  // than an arbitrary top-N. The defensive CONTEXT_CHUNK_CAP is applied
  // AFTER reranking, once, as the single downward bound on assembled context.
  //
  // AGGREGATIVE queries skip the cross-encoder: its criterion ("which chunk
  // directly answers the query") actively penalizes structural fragments
  // (chapter titles/TOC) that an enumeration question needs — precisely the
  // bias that previously collapsed the answer onto one chapter. Multi-view
  // fusion already orders the pool for them.
  if (searchQuery.rerank && !aggregative && resultChunks.length > 1) {
    const preRerankTime = Date.now();
    resultChunks = await rerankChunks(query, resultChunks as DocumentChunk[]);
    log.info(`[Reranker] LLM Reranking applied, took ${Date.now() - preRerankTime}ms`);
  }

  // NAMED-DOCUMENT SPAN COVERAGE (the core fix for "answer from the WHOLE
  // named book"). For an aggregative query that names a specific document,
  // retrieval-similarity alone still gravitates toward the sections that
  // resemble the question — the user's book may have 300 chunks while only
  // 40 surface above the similarity floor. Since the user explicitly asked
  // about THAT book comprehensively, load the named document's FULL chunk
  // grid and merge it into the pool:
  //   - chunks already retrieved keep their fused scores,
  //   - named-document chunks missing from the pool enter with a floor-level
  //     score so they participate but never outrank genuinely-matched chunks,
  //   - the whole-book grid is capped at the context budget (the named book
  //     legitimately may consume it — that is what the user asked for).
  if (namedDoc) {
    try {
      // Page through the whole grid up to the context budget: the DB layer
      // caps each page at 500 rows, so books longer than that need multiple
      // fetches. `chunk_index ASC` ordering keeps pages monotonic.
      const budget = SYSTEM_CONFIG.RAG.CONTEXT_CHUNK_CAP;
      const collected: DocumentChunk[] = [];
      let offset = 0;
      while (collected.length < budget) {
        const page = await db.getChunksByDocument(tenantId, namedDoc.documentId, {
          limit: Math.min(500, budget - collected.length),
          offset,
        });
        collected.push(...page.chunks);
        if (page.chunks.length === 0 || collected.length >= page.total) break;
        offset += page.chunks.length;
      }

      const existingIds = new Set(resultChunks.map((c) => c.id));
      const missingChunks = collected
        .filter((c) => !existingIds.has(c.id))
        .map((c) => ({
          ...c,
          score: Number((scoreThreshold * 0.9).toFixed(4)),
          semanticScore: scoreThreshold,
          lexicalScore: 0,
          semanticRank: null,
          lexicalRank: null,
          fromNamedDocumentCoverage: true,
        }));
      resultChunks = [...resultChunks, ...missingChunks];
      log.info(
        `[Hybrid Search] Named-document coverage: "${namedDoc.title}" (match ${Math.round(namedDoc.overlap * 100)}%) — pool ${existingIds.size} retrieved + ${missingChunks.length} span-coverage chunks`,
      );
    } catch (coverageErr) {
      log.warn('[Hybrid Search] Named-document span coverage failed:', (coverageErr as Error)?.message);
    }
  }

  // Document-coverage balancing (relevant when the pool must be capped).
  // Nearest-neighbor retrieval over a large corpus is notoriously clustered:
  // one long document can fill the entire pool while other equally-relevant
  // documents (or distant sections of the SAME document) never make the cut.
  // When capping, distribute slots round-robin across documents first, then
  // fill remaining slots globally by score — every document in the pool gets
  // represented, and within one document the chunks keep their score order.
  // EXCEPTION: with a named-document aggregative query the user explicitly
  // asked for THAT book — the named document legitimately dominates the cap,
  // so plain score order is used and other documents fill only the slack.
  const contextChunkCap = SYSTEM_CONFIG.RAG.CONTEXT_CHUNK_CAP;
  const preCapCount = resultChunks.length;
  if (resultChunks.length > contextChunkCap) {
    if (namedDoc) {
      // Named-document mode: the named book's chunks fill the budget first
      // (in book order), other documents' chunks append by score into the
      // remaining slack.
      const namedSet = resultChunks.filter((c) => c.documentId === namedDoc.documentId);
      const others = resultChunks
        .filter((c) => c.documentId !== namedDoc.documentId)
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      const namedBudget = Math.min(namedSet.length, contextChunkCap);
      const slack = Math.max(0, contextChunkCap - namedBudget);
      resultChunks = [...namedSet.slice(0, namedBudget), ...others.slice(0, slack)];
      log.info(
        `[Hybrid Search] Defensive context cap applied: ${preCapCount} → ${resultChunks.length} (named "${namedDoc.title}" ${namedBudget} chunks + ${Math.min(others.length, slack)} from other documents)`,
      );
    } else {
      const byDoc = new Map<string, any[]>();
      for (const chunk of resultChunks) {
        const key = chunk.documentId || '_none_';
        const list = byDoc.get(key);
        if (list) list.push(chunk);
        else byDoc.set(key, [chunk]);
      }
      const docOrder = Array.from(byDoc.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .map(([id]) => id);
      const balanced: any[] = [];
      const perDocCursors = new Map<string, number>(docOrder.map((id) => [id, 0]));
      let exhausted = false;
      while (balanced.length < contextChunkCap && !exhausted) {
        exhausted = true;
        for (const docId of docOrder) {
          if (balanced.length >= contextChunkCap) break;
          const docChunks = byDoc.get(docId)!;
          const cursor = perDocCursors.get(docId)!;
          if (cursor < docChunks.length) {
            balanced.push(docChunks[cursor]);
            perDocCursors.set(docId, cursor + 1);
            exhausted = false;
          }
        }
      }
      resultChunks = balanced;
      log.info(
        `[Hybrid Search] Defensive context cap applied: ${preCapCount} above-floor chunks → ${resultChunks.length} (cap=${contextChunkCap}), balanced across ${docOrder.length} document(s)`,
      );
    }
  }

  // FINAL BOOK-ORDER ARRANGEMENT for named-document pools: the model reads
  // the context in the order presented, and for an "enumerate the book"
  // question the fragments must arrive in the book's natural sequence
  // (page/chunkIndex), not in similarity order — this alone prevents the
  // model from latching onto the highest-ranked fragment (previously the
  // last chapter's exercises) and answering only from it. Multi-document
  // pools keep score order.
  if (namedDoc && resultChunks.length > 1) {
    resultChunks.sort((a: any, b: any) => {
      const aNamed = a.documentId === namedDoc.documentId ? 0 : 1;
      const bNamed = b.documentId === namedDoc.documentId ? 0 : 1;
      if (aNamed !== bNamed) return aNamed - bNamed;
      if (aNamed === 0) {
        // Both from the named book → book order.
        return (a.pageNumber || 1) - (b.pageNumber || 1) || (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0);
      }
      return (b.score || 0) - (a.score || 0);
    });
  }

  // Strip the multi-view fusion helper field — internal only, never leaks
  // into citations or model context payloads.
  for (const chunk of resultChunks) {
    if (chunk && typeof chunk === 'object' && '__viewScore' in chunk) delete chunk.__viewScore;
  }

  return {
    chunks: resultChunks as DocumentChunk[],
    totalCount,
    latencyMs: Date.now() - startTime,
    hydePrompt,
    distribution: {
      semanticMatches,
      lexicalMatches,
      fusionCount: resultChunks.length,
    },
  };
}

/**
 * Derives a clickable source URL for a citation:
 * - An external URL when the chunk metadata carries one (web/RSS/YouTube/GitHub sources).
 * - Otherwise an in-app deep link to the document in the Knowledge Base tab.
 */
function getCitationSourceUrl(chunk: DocumentChunk): string {
  const metaUrl =
    chunk.metadata?.sourceUrl || chunk.metadata?.url || chunk.metadata?.originalUrl || chunk.metadata?.source?.url;
  if (typeof metaUrl === 'string' && /^https?:\/\//i.test(metaUrl)) {
    return metaUrl;
  }
  return `/?tab=knowledge&doc=${encodeURIComponent(chunk.documentId)}`;
}

/**
 * Builds the retrieval context block. When ALL chunks come from ONE document
 * (the "uploaded a book, asked about the book" case), the chunks are ALSO
 * listed in their natural book order (chunkIndex/pageNumber) under a header
 * showing the document's coverage span — the model then reads the context as
 * a coherent sequential document instead of a wall of unordered fragments,
 * which is what previously made it answer only from the tail of the book.
 * The numbered citation order (used for [n] citations) stays the retrieval
 * order in both cases.
 */
export function buildContextBlock(contextChunks: DocumentChunk[]): string {
  if (contextChunks.length === 0) return '';

  const uniqueDocs = new Set(contextChunks.map((c) => c.documentId));
  const numbered = contextChunks
    .map((c, i) => `[المصدر ${i + 1} - ${c.documentTitle} (صفحة ${c.pageNumber || 1})]:\n${c.content}`)
    .join('\n\n');

  if (uniqueDocs.size <= 1) {
    // Single-document pool: append a reading-order map so the model can
    // walk the whole book rather than gravitating to one fragment.
    const sortedByPosition = [...contextChunks].sort(
      (a, b) => (a.pageNumber || 1) - (b.pageNumber || 1) || (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0),
    );
    const firstPage = sortedByPosition[0]?.pageNumber || 1;
    const lastPage = sortedByPosition[sortedByPosition.length - 1]?.pageNumber || 1;
    const coverageMap = sortedByPosition
      .map((c) => {
        const idx = contextChunks.indexOf(c) + 1;
        return `- المصدر [${idx}]: صفحة ${c.pageNumber || 1}${c.chunkIndex != null ? `، الموضع ${c.chunkIndex + 1}` : ''}`;
      })
      .join('\n');
    const title = contextChunks[0]?.documentTitle || 'المستند';
    return `${numbered}\n\n[خريطة ترتيب مستند "${title}" — تغطية المقاطع المسترجعة من صفحة ${firstPage} إلى صفحة ${lastPage}، مرتبة حسب موضعها الطبيعي في المستند]:
${coverageMap}
[ملاحظة: هذه مقاطع من مستند واحد مرتبة أعلاه بترتيبها في الكتاب — عند السؤال عن محتويات أو هيكل المستند كاملاً، استعرض المعلومات عبر كامل النطاق من أوله إلى آخره ولا تقتصر على مقطع واحد منه]`;
  }
  return numbered;
}

/**
 * Generates an Agentic RAG Completion with Citations & MCP context using Gemini
 * Supports conversation memory (short-term context) and AI-powered follow-up suggestions.
 */
export async function generateRagCompletion(params: {
  tenantId: string;
  query: string;
  mode: string;
  modelOverride?: string;
  contextChunks: DocumentChunk[];
  approvedToolCall?: MCPToolCall;
  conversationHistory?: Array<{ role: string; content: string }>;
  generateSuggestions?: boolean;
}): Promise<{
  text: string;
  citations: Citation[];
  modelUsed: string;
  tokensUsed: { input: number; output: number };
  pendingToolCall?: MCPToolCall;
  toolCalls?: MCPToolCall[];
  suggestions?: string[];
}> {
  const {
    tenantId,
    query,
    mode,
    modelOverride,
    contextChunks,
    approvedToolCall,
    conversationHistory = [],
    generateSuggestions = false,
  } = params;
  const modelToUse = modelOverride || selectSmartModel(query, mode);

  // Format context block with citations (+ single-document reading-order map)
  const contextText = buildContextBlock(contextChunks);

  // Conversation memory becomes REAL multi-turn messages (last 10), letting
  // the model resolve references like "هذا/ذلك" natively instead of through a
  // flattened text transcript pasted into one giant prompt.
  const MAX_HISTORY_MESSAGES = 10;
  const recentHistory = conversationHistory.slice(-MAX_HISTORY_MESSAGES);
  const messages: ModelMessage[] = recentHistory.map((msg) => ({
    role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: msg.content,
  }));

  const alreadyExecutedToolCalls: MCPToolCall[] = [];

  const docsBlock = `المستندات المسترجعة (${contextChunks.length} مقطعاً — كلها اجتازت البحث والاسترجاع حسب المصادر والصلاحيات المحددة):
${contextText || 'لا توجد مستندات مسترجعة.'}
[تعليمات إلزامية: استخدم كل المقاطع المسترجعة أعلاه في بناء الإجابة بحيث تغطي إجابتك كل ما يرتبط بالسؤال منها بشكل مفصل وواضح، مع استشهاد مضمّن [رقم] لكل معلومة، ولا تختصر الإجابة. وإذا ذُكر في السؤال مصدر/كتاب محدد بالاسم فهذه المقاطع تغطي ذلك المصدر عبر كامله وقد رُتّبت بترتيبها الطبيعي فيه — استعرضها من أولها إلى آخرها عند السؤال عن محتواه أو هيكله]`;
  let userContent = `${docsBlock}\n\nسؤال المستخدم: ${query}`;

  if (approvedToolCall) {
    // Human-approved side-effect call — executed through the SAME unified MCP
    // dispatcher used by the protocol gateway, so audit persistence, timeouts
    // and simulation stamping behave identically in both paths.
    const outcome = await runToolSafely(
      tenantId,
      approvedToolCall.scopedToolName,
      approvedToolCall.inputParams,
      approvedToolCall.conversationId,
    );
    alreadyExecutedToolCalls.push({
      ...approvedToolCall,
      status: outcome.isError ? 'failed' : 'completed',
      outputResult: outcome.result,
      latencyMs: outcome.latencyMs,
      timestamp: new Date().toISOString(),
    });

    userContent += `\n\n[تأكيد تنفيذ أداة الـ MCP]: تمت الموافقة البشرية بنجاح وتم إرجاع نتيجة الأداة (${approvedToolCall.scopedToolName}):\n${JSON.stringify(outcome.result, null, 2)}\n\nيرجى دمج هذه البيانات وصياغة الرد النهائي للمستخدم.${
      outcome.isError ? '\nملاحظة: فشل تنفيذ الأداة — وضّح ذلك للمستخدم بلطف واقترح بديلاً.' : ''
    }`;
  }

  const modelAlias = modelToUse || (mode === 'analysis' ? getAiModel('analysisModel') : getAiModel('chatModel'));
  const providerConfigured = await isModelRefConfigured(modelAlias);

  if (providerConfigured) {
    try {
      // Tenant tool surface + system instruction are shared with the
      // streaming path (chat/stream) via collectTenantMcpTools /
      // buildAgenticSystemInstruction so the two surfaces cannot drift.
      const { toolsToOffer, requireApprovalTools, customSchemas } = await collectTenantMcpTools(tenantId, mode);
      const systemInstruction = buildAgenticSystemInstruction(modelToUse, mode, toolsToOffer);

      // Native AI SDK tool loop: registry-derived zod schemas + custom JSON
      // Schema tools, executed through the unified MCP dispatcher.
      let aiTools: ToolSet | undefined;
      const pendingApprovalRef: { value: MCPToolCall | null } = { value: null };

      if (!approvedToolCall && toolsToOffer.length > 0) {
        aiTools = buildTenantMcpTools(toolsToOffer, customSchemas, {
          tenantId,
          requireApprovalTools,
          runSafely: (toolName, args) => runToolSafely(tenantId, toolName, args),
          onAutoExecuted: (info) => {
            alreadyExecutedToolCalls.push({
              id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              tenantId,
              scopedToolName: info.toolName,
              inputParams: info.args,
              outputResult: info.outputResult,
              latencyMs: info.latencyMs,
              status: info.isError ? 'failed' : 'completed',
              hasSideEffect: info.hasSideEffect,
              timestamp: new Date().toISOString(),
            });
          },
          onPendingApproval: (toolName, args) => {
            pendingApprovalRef.value = {
              id: `tc-${Date.now()}`,
              tenantId,
              scopedToolName: toolName,
              inputParams: args,
              latencyMs: 0,
              status: 'pending',
              hasSideEffect: true,
              timestamp: new Date().toISOString(),
            };
          },
        });
      }

      log.info(
        `[Agentic RAG] generateText via ${modelAlias} with ${aiTools ? Object.keys(aiTools).length : 0} MCP tools...`,
      );
      const response = await generateText({
        model: await resolveLanguageModel(modelAlias),
        system: systemInstruction,
        messages: [...messages, { role: 'user', content: userContent }],
        ...(aiTools && Object.keys(aiTools).length > 0 ? { tools: aiTools, toolChoice: 'auto' as const } : {}),
        stopWhen: stepCountIs(5),
        temperature: 0.2,
      });

      const citations: Citation[] = buildCitations(contextChunks);

      // Approval gate hit mid-loop → surface the pending call with the exact
      // same contract as before; the marker transcript is never exposed.
      const pendingCall = pendingApprovalRef.value;
      if (pendingCall) {
        return {
          text: `⚠️ [بوابة موافقة الأدوات MCP]: يقترح المساعد تشغيل الأداة (${pendingCall.scopedToolName}) بمدخلات: ${JSON.stringify(pendingCall.inputParams)}. تتطلب هذه الأداة موافقة بشرية قبل التنفيذ. يرجى تأكيد العملية في القائمة الجانبية للمتابعة.`,
          citations: [],
          modelUsed: modelToUse,
          tokensUsed: { input: 200, output: 80 },
          pendingToolCall: pendingCall,
        };
      }

      const usageAny: any = (response as any).usage || {};
      const tokensUsed = {
        input:
          usageAny.inputTokens ??
          usageAny.promptTokens ??
          Math.floor((messages.reduce((n, m) => n + String(m.content).length, 0) + userContent.length) / 4),
        output: usageAny.outputTokens ?? usageAny.completionTokens ?? Math.floor((response.text || '').length / 4),
      };

      // AI-powered contextual follow-up suggestions (central resilient helper)
      let suggestions: string[] | undefined;
      if (generateSuggestions && response.text) {
        try {
          const suggestionsResult = await generateTextResilient({
            model: modelAlias,
            system:
              'أنت مساعد يولد أسئلة متابعة سياقية ذكية. أجب بـ 3 أسئلة فقط، كل سؤال في سطر منفصل، بدون أي نص إضافي أو ترقيم أو رموز.',
            prompt: `بناءً على الإجابة التالية والمحادثة، اقترح 3 أسئلة متابعة سياقية قصيرة ومفيدة يمكن للمستخدم أن يسألها. أعد الأسئلة فقط، كل سؤال في سطر منفصل، بدون ترقيم أو نقاط:\n\nالإجابة: ${response.text.substring(0, 500)}\n\nسؤال المستخدم: ${query}`,
            temperature: 0.7,
            maxRetries: 1,
          });
          suggestions = (suggestionsResult?.text || '')
            .split('\n')
            .map((s) => s.replace(/^[\d\.\-\*\s]+/, '').trim())
            .filter((s) => s.length > 10 && s.length < 150)
            .slice(0, 4);
        } catch {
          // Silently fail — suggestions are optional enhancement
        }
      }

      return {
        text: response.text || 'لم يتم استخراج نص من النموذج.',
        citations,
        modelUsed: modelToUse,
        tokensUsed,
        toolCalls: alreadyExecutedToolCalls.length > 0 ? alreadyExecutedToolCalls : undefined,
        suggestions,
      };
    } catch (err: any) {
      log.error('AI SDK execution error, using deterministic fallback:', err);
    }
  }

  const fallbackCitations: Citation[] = buildCitations(contextChunks);

  return {
    text: `بناءً على المستندات المسترجعة من النظام (${contextChunks.length} قطعة):\n\n${
      contextChunks[0]?.content || 'تم استرجاع السجلات المطلوبة بنجاح.'
    }\n\n[إشعار المحرك: تم توليد الاستجابة المباشرة وفق سياسة الالتزام ببيانات المستأجر].`,
    citations: fallbackCitations,
    modelUsed: modelToUse,
    tokensUsed: { input: 120, output: 85 },
    toolCalls: alreadyExecutedToolCalls.length > 0 ? alreadyExecutedToolCalls : undefined,
    suggestions: [],
  };
}
