import { google } from './googleProvider';
import { generateText } from 'ai';
import { SearchQuery, SearchResult, DocumentChunk, Citation, MCPToolCall } from '../types/omnirag';
import { db } from '../storage/db';
import { searchPostgresLexical } from '../storage/postgres';
import { searchQdrantSemantic } from '../storage/qdrant';
import { generateEmbedding } from './embedding';
import { rerankChunks } from './reranker';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import { getAiModel } from '../config/aiModels';
import { getEnv } from '../env/runtimeEnv';
import { SYSTEM_CONFIG } from '../config/systemConfig';
import { MCPToolDefinition, getToolDefinition } from '../mcp/registry/tools';
import { ToolExecutionOutcome, executeMcpToolCall } from '../mcp/dispatcher';

/**
 * Dispatcher wrapper that converts hard failures (e.g. a model-hallucinated
 * unknown tool name) into a failed outcome instead of throwing, so the chat
 * loop can explain the failure to the user rather than collapsing into the
 * deterministic fallback response.
 */
async function runToolSafely(
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

// Singleton AI Client instance for agentic MCP calls
let globalAiClient: GoogleGenAI | null = null;
let currentKey: string | null = null;

function getMcpAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
  if (!globalAiClient || currentKey !== apiKey) {
    globalAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    currentKey = apiKey;
  }
  return globalAiClient;
}

/**
 * Maps a central-registry JSON-schema parameter type onto the Gemini SDK Type
 * enum. The registry (src/lib/mcp/registry/tools.ts) is the single source of
 * truth for tool schemas — the model-facing declarations are DERIVED from it
 * here, so adding a tool never requires touching the chat engine again.
 */
const REGISTRY_TYPE_TO_GEMINI: Record<string, any> = {
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.NUMBER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
  object: Type.OBJECT,
};

function toGeminiFunctionDeclaration(def: MCPToolDefinition): FunctionDeclaration {
  const properties: Record<string, any> = {};
  for (const [propName, prop] of Object.entries(def.parameters.properties || {})) {
    properties[propName] = {
      type: REGISTRY_TYPE_TO_GEMINI[prop.type] || Type.STRING,
      description: prop.description,
      ...(prop.enum && prop.enum.length > 0 ? { enum: prop.enum } : {}),
    };
  }
  return {
    name: def.name,
    description: def.description,
    parameters: {
      type: Type.OBJECT,
      properties,
      required: def.parameters.required,
    },
  };
}

/**
 * Build the numbered citation list from retrieved context chunks.
 *
 * This exact mapping was previously copy-pasted in THREE places (tool-call
 * response, normal response, and the deterministic fallback), so any change to
 * citation shape had to be made three times. Single source of truth now.
 */
function buildCitations(contextChunks: DocumentChunk[]): Citation[] {
  return contextChunks.map((chunk, idx) => ({
    index: idx + 1,
    chunkId: chunk.id,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    pageNumber: chunk.pageNumber,
    score: chunk.score || 0.85,
    snippet: chunk.content.substring(0, 120) + '...',
    sourceUrl: getCitationSourceUrl(chunk),
  }));
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
 * HyDE (Hypothetical Document Embeddings) Generator using Vercel AI SDK
 */
export async function generateHydeDocument(query: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return query;

  try {
    const hydeModelName = getAiModel('hydeModel');
    const { text } = await generateText({
      model: google(hydeModelName),
      prompt: `اكتب مستنداً افتراضياً مثالياً يبين الإجابة الشاملة على السؤال التالي بغرض استخدامه في محرك الاسترجاع المتجهي (HyDE):\n\nالسؤال: ${query}`,
    });
    return text || query;
  } catch (e) {
    console.warn('HyDE generation fallback to raw query:', e);
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
  // traffic. The merged result pool is sliced only by the similarity floor and
  // the final CONTEXT_CHUNK_CAP — never by this hint.
  const overfetchHint = Math.max(8, Math.min(topK ?? 10, 100));
  const overfetchLimit = overfetchHint * SYSTEM_CONFIG.RAG.ENGINE_OVERFETCH_FACTOR;

  // Step 1: Optional HyDE Expansion (Applied ONLY to Semantic Search)
  let semanticSearchContent = query;
  let hydePrompt: string | undefined;
  if (useHyde) {
    hydePrompt = await generateHydeDocument(query);
    semanticSearchContent = `${query} ${hydePrompt}`;
  }

  // Lexical search uses the clean original query
  const lexicalSearchContent = query;

  // Check if we can use real database connections
  const isPostgresActive = !!(getEnv('DATABASE_URL') || getEnv('POSTGRES_URL'));
  const isQdrantActive = !!getEnv('QDRANT_URL');

  let resultChunks: any[] = [];
  let totalCount = 0;
  let semanticMatches = 0;
  let lexicalMatches = 0;

  if (isPostgresActive || isQdrantActive) {
    try {
      // Run semantic and lexical search in parallel. The semantic backend is
      // asked for ALL chunks meeting the similarity floor (score_threshold),
      // capped only by an over-fetch hint that protects the round-trip cost
      // — Qdrant pre-filters below the floor server-side, so fused RRF ranks
      // over genuinely-relevant chunks instead of arbitrary rank truncation.
      const [semanticResults, lexicalResults] = await Promise.all([
        isQdrantActive
          ? generateEmbedding(semanticSearchContent).then((vector) =>
              searchQdrantSemantic({
                vector,
                tenantId,
                collectionIds,
                limit: overfetchLimit,
                scoreThreshold,
              }),
            )
          : Promise.resolve([]),
        isPostgresActive ? searchPostgresLexical(lexicalSearchContent, tenantId, overfetchLimit) : Promise.resolve([]),
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

      // Batch load document titles to eliminate N+1 queries
      const docIds = Array.from(
        new Set(
          Array.from(itemMap.values())
            .map((i) => i.documentId)
            .filter(Boolean),
        ),
      );
      const docMap = new Map<string, string>();
      if (docIds.length > 0) {
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

        // Apply Reciprocal Rank Fusion (RRF)
        const rrf = computeRrfScore(item.semanticRank, item.lexicalRank, semanticWeight, lexicalWeight);
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
      console.error('Real hybrid search failed, falling back to local storage:', realSearchError);
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
      console.warn(
        `[Search fallback] Tenant corpus has ${chunks.length} chunks; capping keyword fallback scan at ${FALLBACK_SCAN_CAP}.`,
      );
      chunks = chunks.slice(0, FALLBACK_SCAN_CAP);
    }

    const queryTerms = lexicalSearchContent
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    const scoredChunks = chunks.map((chunk) => {
      const textLower = chunk.content.toLowerCase();
      const titleLower = (chunk.documentTitle || '').toLowerCase();

      let lexicalScore = 0;
      queryTerms.forEach((term) => {
        if (textLower.includes(term)) lexicalScore += 0.25;
        if (titleLower.includes(term)) lexicalScore += 0.4;
      });
      lexicalScore = Math.min(1.0, lexicalScore);

      let semanticScore = 0.2;
      queryTerms.forEach((term) => {
        if (textLower.includes(term)) semanticScore += 0.35;
      });
      if (searchQuery.language && searchQuery.language !== 'auto' && chunk.language === searchQuery.language) {
        semanticScore += 0.1;
      }
      semanticScore = Math.min(0.98, semanticScore);

      // Deterministic RRF score for fallback local search
      const fusedScore = semanticScore * semanticWeight + lexicalScore * lexicalWeight;

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
  if (searchQuery.rerank && resultChunks.length > 1) {
    const preRerankTime = Date.now();
    resultChunks = await rerankChunks(query, resultChunks as DocumentChunk[], overfetchHint);
    console.log(`[Reranker] LLM Reranking applied, took ${Date.now() - preRerankTime}ms`);
  }

  // Defensive soft cap. Up to this point we have NOT truncated the answer
  // pool by a fixed count — every chunk above the semantic floor (or with an
  // exact lexical hit) is in `resultChunks`. We apply CONTEXT_CHUNK_CAP once
  // here, AFTER reranking, so the model context is bounded (~30 chunks for
  // the default 500-char chunk size) while preserving all relevance-ranked
  // pieces above the floor. Callers that genuinely need more can raise the
  // cap via SYSTEM_CONFIG.RAG.CONTEXT_CHUNK_CAP.
  const contextChunkCap = SYSTEM_CONFIG.RAG.CONTEXT_CHUNK_CAP;
  const preCapCount = resultChunks.length;
  if (resultChunks.length > contextChunkCap) {
    resultChunks = resultChunks.slice(0, contextChunkCap);
    console.log(
      `[Hybrid Search] Defensive context cap applied: ${preCapCount} above-floor chunks → ${resultChunks.length} (cap=${contextChunkCap})`,
    );
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

  // Format context block with citations
  const contextText = contextChunks
    .map((c, i) => `[المصدر ${i + 1} - ${c.documentTitle} (صفحة ${c.pageNumber || 1})]:\n${c.content}`)
    .join('\n\n');

  // Build conversation memory context (last 10 messages for short-term memory)
  const MAX_HISTORY_MESSAGES = 10;
  const recentHistory = conversationHistory.slice(-MAX_HISTORY_MESSAGES);
  const historyContext =
    recentHistory.length > 0
      ? recentHistory.map((msg) => `${msg.role === 'user' ? 'المستخدم' : 'المساعد'}: ${msg.content}`).join('\n')
      : '';

  let promptText = historyContext
    ? `سجل المحادثة السابقة:\n${historyContext}\n\n---\n\nالمستندات المسترجعة:\n${contextText || 'لا توجد مستندات مسترجعة.'}\n\nسؤال المستخدم الحالي: ${query}`
    : `المستندات المسترجعة:\n${contextText || 'لا توجد مستندات مسترجعة.'}\n\nسؤال المستخدم: ${query}`;
  const alreadyExecutedToolCalls: MCPToolCall[] = [];

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

    promptText = `${promptText}\n\n[تأكيد تنفيذ أداة الـ MCP]: تمت الموافقة البشرية بنجاح وتم إرجاع نتيجة الأداة (${approvedToolCall.scopedToolName}):\n${JSON.stringify(outcome.result, null, 2)}\n\nيرجى دمج هذه البيانات وصياغة الرد النهائي للمستخدم.${
      outcome.isError ? '\nملاحظة: فشل تنفيذ الأداة — وضّح ذلك للمستخدم بلطف واقترح بديلاً.' : ''
    }`;
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (apiKey) {
    try {
      const aiClient = getMcpAiClient();
      const modelAlias = modelToUse || (mode === 'analysis' ? getAiModel('analysisModel') : getAiModel('chatModel'));

      // Fetch Tenant MCP configuration to extract enabled/approved tools
      const servers = await db.getMcpServers(tenantId);
      const enabledTools: string[] = [];
      const requireApprovalTools: string[] = [];

      for (const server of servers) {
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

      const systemInstruction = `أنت مساعد ذكي ومحرك وكلاء متمكن (Agentic RAG Engine) ضمن منصة OmniRAG للمؤسسات.
أنت متصل مباشرة ببروتوكول سياق النموذج MCP (Model Context Protocol) لربط الأنظمة والخوادم الحية.
النموذج النشط: ${modelToUse} | الوضع الحالي: ${mode}.
الأدوات والخوادم المربوطة والمتاحة لك فوراً: ${toolsToOffer.length > 0 ? toolsToOffer.join(', ') : 'لا توجد أدوات خارجية مفعلة حالياً'}.

ذاكرة المحادثة والسياق:
1. تم تزويدك بسجل المحادثة السابقة بينك وبين المستخدم. استخدم هذا السياق لفهم السياق الكامل للمحادثة.
2. إذا أشار المستخدم بكلمات مثل "هذا"، "ذلك"، "المذكور"، "الموضوع"، "مرة أخرى" وغيرها من الإشارات، فاستخدم سياق المحادثة السابقة لفهم المراد.
3. لا تعيد ذكر معلومات سبق إخبار المستخدم بها إلا إذا طلب ذلك صراحة.
4. رد بشكل طبيعي ومتصل كأنك تعرف تاريخ المحادثة.

توجيهات واستخدام أدوات الـ MCP:
1. إذا طلب المستخدم إجراء أو استعلام يتطلب إرسال تنبيه أو رسالة (مثل slack_send_message أو slack_post_alert)، أو قراءة قناة (slack_read_channel)، أو البحث في كود GitHub أو إنشاء تذكرة (github_search_code / github_create_issue)، أو البحث المباشر في الويب (web_live_search / fetch_url_content)، أو الاستعلام عن قواعد البيانات (external_postgres_query)، أو البحث في قاعدة المعرفة (search_knowledge_base) أو فهرسة محتوى جديد فيها (knowledge_ingest_document)، فيجب عليك فوراً استدعاء الأداة المناسبة عبر Function Call.
2. اختر دائماً الأداة الأنسب لنية المستخدم، ومرّر المدخلات المطلوبة كاملة وصحيحة حسب مخطط كل أداة. إذا لم تكن أي أداة مناسبة، أجب من المستندات المتاحة مباشرة دون استدعاء.
3. ملاحظة صدق البيانات: بعض النتائج تأتي موسومة بـ "simulated: true" وهي بيانات تجريبية توضيحية وليست تكاملاً حياً — وضّح للمستخدم بلطف أن هذه البيانات تجريبية. أما النتائج الموسومة بـ "simulated: false" فهي من تكامل حقيقي.
4. إذا فشلت الأداة وأعادت خطأً، لا تختلق نتائج: اعتذر باختصار، اشرح سبب الفشل، واقترح خطوة بديلة.
5. بالنسبة للأدوات ذات الأثر الجانبي، سيتولى نظام الأمان طلب الموافقة البشرية قبل التنفيذ تلقائياً.

قواعد الإسناد والاستشهاد المضمن:
1. عند استخدام معلومة من المستندات المرفقة، ضع رقم الاستشهاد مباشرة في النص كرقم بين أقواس مربعة مثل [1] أو [2] المطابق لرقم المصدر.
2. لا تبتكر مراجع وهمية غير موجودة في النص.
3. لا تضع قائمة منفصلة للمصادر في نهاية الرد — فقط الأرقام المضمنة في النص.
${mode === 'private' ? 'تنبيه الأمان الحرج: الوضع الحالي مغلق وخاص بالكامل (Private Mode). تم إيقاف وتصفية جميع أدوات الـ MCP الخارجية لشبكة الويب أو الخدمات الخارجية للطرف الثالث حماية لسرية بيانات المستأجر.' : ''}`;

      const functionDeclarations: FunctionDeclaration[] = [];
      const seenToolNames = new Set<string>();

      if (!approvedToolCall) {
        for (const toolName of toolsToOffer) {
          if (seenToolNames.has(toolName)) continue;
          seenToolNames.add(toolName);

          // Schemas are derived from the central MCP registry — a single
          // source of truth shared with the protocol gateway.
          const def = getToolDefinition(toolName);
          if (def) {
            functionDeclarations.push(toGeminiFunctionDeclaration(def));
          }
        }
      }

      const response = await aiClient.models.generateContent({
        model: modelAlias,
        contents: promptText,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.2,
          tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
        },
      });

      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const fc = functionCalls[0];
        const toolName = fc.name || '';
        const args = (fc.args || {}) as Record<string, any>;
        const toolDef = getToolDefinition(toolName);

        // Approval gate: per-server confirmation list OR the registry's own
        // side-effect declaration for the tool.
        const isApprovalRequired = requireApprovalTools.includes(toolName) || (toolDef?.requireConfirmation ?? false);

        if (isApprovalRequired) {
          const pendingCall: MCPToolCall = {
            id: `tc-${Date.now()}`,
            tenantId,
            scopedToolName: toolName,
            inputParams: args,
            latencyMs: 0,
            status: 'pending',
            hasSideEffect: toolDef?.hasSideEffect ?? true,
            timestamp: new Date().toISOString(),
          };

          return {
            text: `⚠️ [بوابة موافقة الأدوات MCP]: يقترح المساعد تشغيل الأداة (${toolName}) بمدخلات: ${JSON.stringify(args)}. تتطلب هذه الأداة موافقة بشرية قبل التنفيذ. يرجى تأكيد العملية في القائمة الجانبية للمتابعة.`,
            citations: [],
            modelUsed: modelToUse,
            tokensUsed: { input: 200, output: 80 },
            pendingToolCall: pendingCall,
          };
        } else {
          // Auto-executed read-only call — same unified dispatcher as the
          // gateway (timeouts, audit persistence, simulation stamping).
          const outcome = await runToolSafely(tenantId, toolName, args);

          const secondPrompt = `${promptText}\n\n[أداة الـ MCP المنفذة تلقائياً]: تم استدعاء الأداة (${toolName}) وإرجاع المخرجات التالية:\n${JSON.stringify(outcome.result, null, 2)}\n\n${
            outcome.isError
              ? 'فشل تنفيذ الأداة — اعتذر للمستخدم بلطف، اشرح سبب الفشل باختصار، واقترح خطوة بديلة دون اختلاق نتائج.'
              : 'يرجى صياغة الاستجابة النهائية للمستخدم بناءً على هذه المخرجات والمستندات المتاحة.'
          }`;

          const secondResponse = await aiClient.models.generateContent({
            model: modelAlias,
            contents: secondPrompt,
            config: {
              systemInstruction: systemInstruction,
              temperature: 0.2,
            },
          });

          const citations: Citation[] = buildCitations(contextChunks);

          return {
            text: secondResponse.text || 'تم استدعاء الأداة بنجاح ولكن لم يتم توليد رد نهائي.',
            citations,
            modelUsed: modelToUse,
            tokensUsed: {
              input: Math.floor(secondPrompt.length / 4),
              output: Math.floor((secondResponse.text || '').length / 4),
            },
            toolCalls: [
              {
                id: `tc-${Date.now()}`,
                tenantId,
                scopedToolName: toolName,
                inputParams: args,
                outputResult: outcome.result,
                latencyMs: outcome.latencyMs,
                status: outcome.isError ? 'failed' : 'completed',
                hasSideEffect: toolDef?.hasSideEffect ?? false,
                timestamp: new Date().toISOString(),
              },
            ],
          };
        }
      }

      const citations: Citation[] = buildCitations(contextChunks);

      // AI-powered contextual follow-up suggestions
      let suggestions: string[] | undefined;
      if (generateSuggestions && response.text) {
        try {
          const suggestionsResponse = await aiClient.models.generateContent({
            model: modelAlias,
            contents: `بناءً على الإجابة التالية والمحادثة، اقترح 3 أسئلة متابعة سياقية قصيرة ومفيدة يمكن للمستخدم أن يسألها. أعد الأسئلة فقط، كل سؤال في سطر منفصل، بدون ترقيم أو نقاط:\n\nالإجابة: ${response.text.substring(0, 500)}\n\nسؤال المستخدم: ${query}`,
            config: {
              systemInstruction:
                'أنت مساعد يولد أسئلة متابعة سياقية ذكية. أجب بـ 3 أسئلة فقط، كل سؤال في سطر منفصل، بدون أي نص إضافي أو ترقيم أو رموز.',
              temperature: 0.7,
              maxOutputTokens: 200,
            },
          });
          const suggestionsText = suggestionsResponse.text || '';
          suggestions = suggestionsText
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
        tokensUsed: {
          input: Math.floor(promptText.length / 4),
          output: Math.floor((response.text || '').length / 4),
        },
        toolCalls: alreadyExecutedToolCalls.length > 0 ? alreadyExecutedToolCalls : undefined,
        suggestions,
      };
    } catch (err: any) {
      console.error('AI SDK/Google GenAI execution error, using deterministic fallback:', err);
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
