import { google } from './googleProvider';
import { generateText } from 'ai';
import { SearchQuery, SearchResult, DocumentChunk, Citation, MCPToolCall } from '../types/omnirag';
import { db } from '../storage/db';
import { searchPostgresLexical } from '../storage/postgres';
import { searchQdrantSemantic } from '../storage/qdrant';
import { generateEmbedding } from './embedding';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';

// Initialize the standard Gemini Client for direct agentic tool calling
const aiClient = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Definitions of supported MCP tools and their parameter schemas for Gemini
const MCP_TOOL_DEFINITIONS: Record<string, { description: string; properties: any; required: string[] }> = {
  'slack_send_message': {
    description: "Send a message to a slack channel for team communication/notification",
    properties: {
      channel: { type: Type.STRING, description: "The target slack channel starting with #, e.g. #general, #security-alerts" },
      message: { type: Type.STRING, description: "The message content to send" }
    },
    required: ["channel", "message"]
  },
  'slack_post_alert': {
    description: "Post a high-priority security or system alert to slack",
    properties: {
      channel: { type: Type.STRING, description: "The target channel starting with #, e.g. #security-alerts" },
      message: { type: Type.STRING, description: "The security/system alert description" }
    },
    required: ["channel", "message"]
  },
  'slack_read_channel': {
    description: "Read recent chat history or message logs from a slack channel",
    properties: {
      channel: { type: Type.STRING, description: "The slack channel name to read, e.g. #general" }
    },
    required: ["channel"]
  },
  'github_search_code': {
    description: "Search across the repository files for specific keywords, methods or classes",
    properties: {
      query: { type: Type.STRING, description: "The search query/keyword" }
    },
    required: ["query"]
  },
  'github_create_issue': {
    description: "Create a new issue in the GitHub repository for tracking bug reports or security concerns",
    properties: {
      repo: { type: Type.STRING, description: "The repository name, e.g. security-audit" },
      title: { type: Type.STRING, description: "The issue title" },
      body: { type: Type.STRING, description: "The issue body/description" }
    },
    required: ["repo", "title"]
  },
  'github_read_repo': {
    description: "Retrieve summary and information about the target GitHub repository",
    properties: {
      repo: { type: Type.STRING, description: "The repository name to read" }
    },
    required: ["repo"]
  },
  'web_live_search': {
    description: "Execute a web search query to retrieve real-time external information or security policies",
    properties: {
      query: { type: Type.STRING, description: "The search query" }
    },
    required: ["query"]
  },
  'fetch_url_content': {
    description: "Fetch and extract text content from a specific web URL",
    properties: {
      url: { type: Type.STRING, description: "The exact URL to fetch" }
    },
    required: ["url"]
  },
  'external_postgres_query': {
    description: "Execute a secure Postgres SQL query on the external registered database",
    properties: {
      query: { type: Type.STRING, description: "The safe SQL statement to execute" }
    },
    required: ["query"]
  },
  'get_table_schema': {
    description: "Describe the database schema/columns for a specific table",
    properties: {
      tableName: { type: Type.STRING, description: "The name of the database table" }
    },
    required: ["tableName"]
  }
};

/**
 * Execute MCP Tool in a simulated/secure manner and log to Audit Logs
 */
async function executeMcpTool(tenantId: string, toolName: string, args: any): Promise<any> {
  const startTime = Date.now();
  let result: any;
  let success = true;

  try {
    switch (toolName) {
      case 'slack_send_message':
      case 'slack_post_alert':
        result = {
          success: true,
          messageId: `msg-slack-${Math.floor(Math.random() * 90000) + 10000}`,
          channel: args.channel || '#general',
          message: args.message || '',
          timestamp: new Date().toISOString(),
          status: 'delivered'
        };
        break;

      case 'slack_read_channel':
        result = [
          { user: "سارة (أمن المعلومات)", text: `تم رصد هجمات محاكاة على بوابة المستأجر ${tenantId}`, timestamp: "قبل 10 دقائق" },
          { user: "منذر (مهندس النظم)", text: "جميع شهادات SSL نشطة ومحدثة لعام 2026", timestamp: "قبل ساعة" },
          { user: "Bot", text: "تم تحديث سياسات الحماية لمستوى Sandbox للجميع", timestamp: "قبل ساعتين" }
        ];
        break;

      case 'github_search_code':
        const queryVal = args.query || '';
        result = [
          { file: "src/lib/rag/engine.ts", line: 42, match: `found keyword: ${queryVal}`, repo: "omnirag-monorepo" },
          { file: "src/lib/storage/db.ts", line: 884, match: `getMcpServers query: ${queryVal}`, repo: "omnirag-monorepo" }
        ];
        break;

      case 'github_create_issue':
        result = {
          success: true,
          issueNumber: Math.floor(Math.random() * 100) + 200,
          title: args.title || 'تنبيه أمني من OmniRAG',
          repo: args.repo || 'security-audit',
          url: `https://github.com/omnirag-org/${args.repo || 'security-audit'}/issues/${Math.floor(Math.random() * 100) + 200}`
        };
        break;

      case 'github_read_repo':
        result = {
          repo: args.repo || 'security-audit',
          branches: ["main", "dev-v2"],
          languages: { TypeScript: "82%", CSS: "12%", HTML: "6%" },
          lastCommit: "Refactored HookHarness validation engine - 2026-08-09"
        };
        break;

      case 'web_live_search':
        const searchQuery = args.query || '';
        result = [
          { title: "معايير أمن المعلومات ISO27001 لعام 2026", snippet: "التحديثات الأخيرة تركز على عزل بيانات المستأجرين في بيئات الحوسبة السحابية المشتركة والمحسنة.", url: "https://iso.org/standards/27001-2026" },
          { title: "حماية تطبيقات الويب من ثغرات Prompt Injection", snippet: "تقنيات الفلترة الحتمية والحظر الاستباقي هي خط الدفاع الأول ضد محاولات تسريب المفاتيح السرية.", url: "https://owasp.org/www-project-top-ten" }
        ];
        break;

      case 'fetch_url_content':
        result = {
          url: args.url || 'https://example.com',
          title: "بيان الحماية والسرية المعتمد",
          content: "يلتزم النظام بأعلى معايير حماية البيانات وتشفيرها أثناء النقل والتخزين، مع الفحص المستمر عبر الحواجز الأمنية للتحقق من هوية المستأجرين وتصاريحهم."
        };
        break;

      case 'external_postgres_query':
        result = [
          { id: 1, table: "users_log", action: "LOGIN", status: "SUCCESS", ip: "192.168.1.45" },
          { id: 2, table: "users_log", action: "READ_DOCUMENT", status: "DENIED", ip: "192.168.1.110" }
        ];
        break;

      case 'get_table_schema':
        result = {
          tableName: args.tableName || 'users_log',
          columns: [
            { name: "id", type: "UUID", primary: true },
            { name: "tenant_id", type: "VARCHAR(50)", nullable: false },
            { name: "action", type: "VARCHAR(100)" },
            { name: "status", type: "VARCHAR(20)" },
            { name: "ip_address", type: "VARCHAR(45)" },
            { name: "timestamp", type: "TIMESTAMP", default: "NOW()" }
          ]
        };
        break;

      default:
        result = {
          success: true,
          tool: toolName,
          args: args,
          message: "تم تنفيذ الأداة المخصصة بنجاح عبر بوابة الـ MCP بنظام الحماية والـ Sandbox المحكم.",
          timestamp: new Date().toISOString()
        };
    }
  } catch (error: any) {
    success = false;
    result = { error: error.message || "Failed to execute tool" };
  }

  // Log in Audit Logs
  await db.addAuditLog({
    id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    tenantId,
    actorId: 'mcp_gateway_agent',
    action: 'MCP_TOOL_EXECUTED',
    resourceType: 'mcp_tool',
    resourceId: toolName,
    status: success ? 'success' : 'error',
    details: `تم تنفيذ الأداة (${toolName}) بنجاح. المدخلات: ${JSON.stringify(args)}.`,
    timestamp: new Date().toISOString()
  });

  return result;
}

/**
 * Smart Router: selects the optimal model based on query complexity and mode
 */
export function selectSmartModel(query: string, mode: string): string {
  if (mode === 'analysis' || query.length > 250 || query.includes('حلل') || query.includes('مقارنة')) {
    return 'gemini-2.5-pro';
  }
  if (query.length < 30) {
    return 'gemini-2.5-flash';
  }
  return 'gemini-2.5-flash';
}

/**
 * HyDE (Hypothetical Document Embeddings) Generator using Vercel AI SDK
 */
export async function generateHydeDocument(query: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return query;

  try {
    const { text } = await generateText({
      model: google('gemini-2.5-flash'),
      prompt: `اكتب مستنداً افتراضياً مثالياً يبين الإجابة الشاملة على السؤال التالي بغرض استخدامه في محرك الاسترجاع المتجهي (HyDE):\n\nالسؤال: ${query}`,
    });
    return text || query;
  } catch (e) {
    console.warn('HyDE generation fallback to raw query:', e);
    return query;
  }
}

/**
 * Hybrid Search Engine: Semantic Dense + Sparse Lexical + Reciprocal Rank Fusion (RRF)
 */
export async function performHybridSearch(searchQuery: SearchQuery): Promise<SearchResult> {
  const startTime = Date.now();
  const { tenantId, query, collectionIds, topK = 5, semanticWeight = 0.7, lexicalWeight = 0.3, useHyde } = searchQuery;

  // Step 1: Optional HyDE Expansion
  let searchContent = query;
  let hydePrompt: string | undefined;
  if (useHyde) {
    hydePrompt = await generateHydeDocument(query);
    searchContent = `${query} ${hydePrompt}`;
  }

  // Check if we can use real database connections
  const isPostgresActive = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  const isQdrantActive = !!process.env.QDRANT_URL;

  let resultChunks: any[] = [];
  let totalCount = 0;
  let semanticMatches = 0;
  let lexicalMatches = 0;

  if (isPostgresActive || isQdrantActive) {
    try {
      console.log(`Executing real hybrid search for tenant ${tenantId}. Postgres active: ${isPostgresActive}, Qdrant active: ${isQdrantActive}`);

      // Run semantic and lexical search in parallel
      const [semanticResults, lexicalResults] = await Promise.all([
        isQdrantActive 
          ? generateEmbedding(searchContent).then((vector) => 
              searchQdrantSemantic({
                vector,
                tenantId,
                collectionIds,
                limit: topK * 2,
              })
            )
          : Promise.resolve([]),
        isPostgresActive
          ? searchPostgresLexical(searchContent, tenantId, topK * 2)
          : Promise.resolve([])
      ]);

      const scoredMap = new Map<string, any>();

      // Put lexical results into map
      lexicalResults.forEach((r) => {
        scoredMap.set(r.id, {
          id: r.id,
          documentId: r.documentId,
          content: r.content,
          chunkIndex: r.chunkIndex,
          pageNumber: r.pageNumber,
          language: r.language,
          lexicalScore: r.lexicalScore,
          semanticScore: 0.0, // placeholder
        });
      });

      // Merge or insert semantic results
      semanticResults.forEach((r) => {
        const existing = scoredMap.get(r.id);
        if (existing) {
          existing.semanticScore = r.semanticScore;
          existing.documentTitle = r.documentTitle;
        } else {
          scoredMap.set(r.id, {
            id: r.id,
            documentId: r.documentId,
            content: r.content,
            chunkIndex: r.chunkIndex,
            pageNumber: r.pageNumber,
            language: r.language,
            lexicalScore: 0.0, // placeholder
            semanticScore: r.semanticScore,
            documentTitle: r.documentTitle,
          });
        }
      });

      const mergedList = Array.from(scoredMap.values());
      
      // Fill in titles and final scores
      for (const item of mergedList) {
        if (!item.documentTitle) {
          try {
            const doc = await db.getDocumentById(item.documentId, tenantId);
            item.documentTitle = doc ? doc.title : 'مستند مسترجع';
          } catch {
            item.documentTitle = 'مستند مسترجع';
          }
        }

        // Compute weighted fusion score
        const fusedScore = item.semanticScore * semanticWeight + item.lexicalScore * lexicalWeight;
        item.score = Number(fusedScore.toFixed(3));
        item.semanticScore = Number(item.semanticScore.toFixed(3));
        item.lexicalScore = Number(item.lexicalScore.toFixed(3));
        item.tenantId = tenantId;
      }

      // Sort and slice
      mergedList.sort((a, b) => b.score - a.score);
      resultChunks = mergedList.slice(0, topK);
      totalCount = mergedList.length;

      semanticMatches = resultChunks.filter((c) => c.semanticScore > 0.4).length;
      lexicalMatches = resultChunks.filter((c) => c.lexicalScore > 0.3).length;
    } catch (realSearchError) {
      console.error('Real hybrid search failed, falling back to local simulation:', realSearchError);
      resultChunks = [];
    }
  }

  // Fallback to simulated/Firestore chunks if we got zero results (or database is inactive)
  if (resultChunks.length === 0) {
    console.log(`Bypassing or falling back to local simulation for tenant ${tenantId}`);
    // Retrieve candidate chunks for tenant
    let chunks = await db.getChunks(tenantId);

    // Filter by collections if specified
    if (collectionIds && collectionIds.length > 0) {
      const docsInCollections = (await db.getDocuments(tenantId)).filter((d) =>
        d.collectionIds?.some((c) => collectionIds.includes(c))
      );
      const validDocIds = new Set(docsInCollections.map((d) => d.id));
      chunks = chunks.filter((c) => validDocIds.has(c.documentId));
    }

    const queryTerms = searchContent.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

    // Compute Semantic & Lexical Scores for each chunk
    const scoredChunks = chunks.map((chunk) => {
      const textLower = chunk.content.toLowerCase();
      const titleLower = chunk.documentTitle.toLowerCase();

      // Lexical Score (Term frequency match)
      let lexicalScore = 0;
      queryTerms.forEach((term) => {
        if (textLower.includes(term)) lexicalScore += 0.25;
        if (titleLower.includes(term)) lexicalScore += 0.4;
      });
      lexicalScore = Math.min(1.0, lexicalScore);

      // Simulated Dense Semantic Vector Score
      let semanticScore = 0.2;
      queryTerms.forEach((term) => {
        if (textLower.includes(term)) semanticScore += 0.35;
      });
      // Boost if language matches
      if (searchQuery.language && searchQuery.language !== 'auto' && chunk.language === searchQuery.language) {
        semanticScore += 0.1;
      }
      semanticScore = Math.min(0.98, semanticScore + Math.random() * 0.05);

      // Reciprocal Rank Fusion (RRF) calculation
      const fusedScore = semanticScore * semanticWeight + lexicalScore * lexicalWeight;

      return {
        ...chunk,
        score: Number(fusedScore.toFixed(3)),
        semanticScore: Number(semanticScore.toFixed(3)),
        lexicalScore: Number(lexicalScore.toFixed(3)),
      };
    });

    // Sort by RRF Fused Score and slice top_k
    scoredChunks.sort((a, b) => (b.score || 0) - (a.score || 0));
    resultChunks = scoredChunks.slice(0, topK);
    totalCount = scoredChunks.length;

    semanticMatches = resultChunks.filter((c) => (c.semanticScore || 0) > 0.4).length;
    lexicalMatches = resultChunks.filter((c) => (c.lexicalScore || 0) > 0.3).length;
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
 * Generates an Agentic RAG Completion with Citations & MCP context using Gemini
 */
export async function generateRagCompletion(params: {
  tenantId: string;
  query: string;
  mode: string;
  modelOverride?: string;
  contextChunks: DocumentChunk[];
  approvedToolCall?: MCPToolCall;
}): Promise<{
  text: string;
  citations: Citation[];
  modelUsed: string;
  tokensUsed: { input: number; output: number };
  pendingToolCall?: MCPToolCall;
  toolCalls?: MCPToolCall[];
}> {
  const { tenantId, query, mode, modelOverride, contextChunks, approvedToolCall } = params;
  const modelToUse = modelOverride || selectSmartModel(query, mode);

  // Format context block with citations
  const contextText = contextChunks
    .map((c, i) => `[المصدر ${i + 1} - ${c.documentTitle} (صفحة ${c.pageNumber || 1})]:\n${c.content}`)
    .join('\n\n');

  const systemInstruction = `أنت مساعد ذكي للمؤسسات ضمن منصة OmniRAG.
مهمتك الإجابة على استفسارات المستخدم بدقة عالية وبناءً على الوثائق والمستندات المرفقة فقط، أو نتائج أدوات الـ MCP المتاحة لديك.
النموذج المستخدم: ${modelToUse} | الوضع الحالي: ${mode}.

قواعد الإسناد والاستشهاد:
1. عند استخدام معلومة من المستندات المرفقة، أضف الرقم [1] أو [2] المطابق لرقم المصدر.
2. لا تبتكر مراجع وهمية غير موجودة في النص.
3. إذا لم تجد الإجابة في المستندات أو عبر أدوات الـ MCP، صرّح بوضوح: "بناءً على المستندات المتاحة، لا تتوفر معلومة كافية."`;

  let promptText = `المستندات المسترجعة:\n${contextText || 'لا توجد مستندات مسترجعة.'}\n\nسؤال المستخدم: ${query}`;
  
  // If we already have an approved tool call, execute it first and add its outcome directly to context!
  let alreadyExecutedToolCalls: MCPToolCall[] = [];
  if (approvedToolCall) {
    const executedResult = await executeMcpTool(tenantId, approvedToolCall.scopedToolName, approvedToolCall.inputParams);
    alreadyExecutedToolCalls.push({
      ...approvedToolCall,
      status: 'completed',
      outputResult: executedResult,
      latencyMs: 35,
      timestamp: new Date().toISOString()
    });

    promptText = `${promptText}\n\n[تأكيد تنفيذ أداة الـ MCP]: تمت الموافقة البشرية بنجاح وتم إرجاع نتيجة الأداة (${approvedToolCall.scopedToolName}):\n${JSON.stringify(executedResult, null, 2)}\n\nيرجى دمج هذه البيانات وصياغة الرد النهائي للمستخدم.`;
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (apiKey) {
    try {
      const modelAlias = modelToUse.includes('pro') ? 'gemini-2.5-pro' : 'gemini-2.5-flash';

      // 1. Fetch Tenant MCP configuration to extract enabled/approved tools
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

      // Build Function Declarations
      const functionDeclarations: FunctionDeclaration[] = [];
      // Only offer tools if we are NOT finishing an already approved execution (to prevent loops)
      if (!approvedToolCall) {
        for (const toolName of enabledTools) {
          const def = MCP_TOOL_DEFINITIONS[toolName];
          if (def) {
            functionDeclarations.push({
              name: toolName,
              description: def.description,
              parameters: {
                type: Type.OBJECT,
                properties: def.properties,
                required: def.required
              }
            });
          } else {
            functionDeclarations.push({
              name: toolName,
              description: `Execute custom tool ${toolName} on the server`,
              parameters: {
                type: Type.OBJECT,
                properties: {
                  argumentsJson: { type: Type.STRING, description: "JSON string parameters for tool" }
                },
                required: []
              }
            });
          }
        }
      }

      // Run generation (with tool definitions if available)
      const response = await aiClient.models.generateContent({
        model: modelAlias,
        contents: promptText,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.2,
          tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined
        }
      });

      // Check if Gemini wants to call a tool
      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const fc = functionCalls[0];
        const toolName = fc.name || '';
        const args = fc.args as Record<string, any>;
        const isApprovalRequired = requireApprovalTools.includes(toolName);

        if (isApprovalRequired) {
          // Requires Human Approval (SideEffectGate)
          const pendingCall: MCPToolCall = {
            id: `tc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            tenantId,
            scopedToolName: toolName,
            inputParams: args,
            latencyMs: 0,
            status: 'pending',
            hasSideEffect: true,
            timestamp: new Date().toISOString()
          };

          return {
            text: `⚠️ [بوابة موافقة الأدوات MCP]: يقترح المساعد تشغيل الأداة (${toolName}) بمدخلات: ${JSON.stringify(args)}. تتطلب هذه الأداة موافقة بشرية قبل التنفيذ. يرجى تأكيد العملية في القائمة الجانبية للمتابعة.`,
            citations: [],
            modelUsed: modelToUse,
            tokensUsed: { input: 200, output: 80 },
            pendingToolCall: pendingCall
          };
        } else {
          // Execute immediately on-the-fly (Read-only / No side-effects)
          const toolResult = await executeMcpTool(tenantId, toolName, args);

          // Second turn: call Gemini with tool outcome
          const secondPrompt = `${promptText}\n\n[أداة الـ MCP المنفذة تلقائياً]: تم تنفيذ الأداة (${toolName}) بنجاح وإرجاع المخرجات التالية:\n${JSON.stringify(toolResult, null, 2)}\n\nيرجى صياغة الاستجابة النهائية للمستخدم بناءً على هذه المخرجات والمستندات المتاحة.`;

          const secondResponse = await aiClient.models.generateContent({
            model: modelAlias,
            contents: secondPrompt,
            config: {
              systemInstruction: systemInstruction,
              temperature: 0.2
            }
          });

          const citations: Citation[] = contextChunks.map((chunk, idx) => ({
            index: idx + 1,
            chunkId: chunk.id,
            documentId: chunk.documentId,
            documentTitle: chunk.documentTitle,
            pageNumber: chunk.pageNumber,
            score: chunk.score || 0.85,
            snippet: chunk.content.substring(0, 120) + '...',
          }));

          return {
            text: secondResponse.text || 'تم استدعاء الأداة بنجاح ولكن لم يتم توليد رد نهائي.',
            citations,
            modelUsed: modelToUse,
            tokensUsed: {
              input: Math.floor(secondPrompt.length / 4),
              output: Math.floor((secondResponse.text || '').length / 4)
            },
            toolCalls: [{
              id: `tc-${Date.now()}`,
              tenantId,
              scopedToolName: toolName,
              inputParams: args,
              outputResult: toolResult,
              latencyMs: 25,
              status: 'completed',
              hasSideEffect: false,
              timestamp: new Date().toISOString()
            }]
          };
        }
      }

      // No tools called, return normal RAG generation
      const citations: Citation[] = contextChunks.map((chunk, idx) => ({
        index: idx + 1,
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        pageNumber: chunk.pageNumber,
        score: chunk.score || 0.85,
        snippet: chunk.content.substring(0, 120) + '...',
      }));

      return {
        text: response.text || 'لم يتم استخراج نص من النموذج.',
        citations,
        modelUsed: modelToUse,
        tokensUsed: {
          input: Math.floor(promptText.length / 4),
          output: Math.floor((response.text || '').length / 4),
        },
        toolCalls: alreadyExecutedToolCalls.length > 0 ? alreadyExecutedToolCalls : undefined
      };
    } catch (err: any) {
      console.error('AI SDK/Google GenAI execution error, using deterministic fallback:', err);
    }
  }

  // Fallback response if API key is missing or errored
  const fallbackCitations: Citation[] = contextChunks.map((chunk, idx) => ({
    index: idx + 1,
    chunkId: chunk.id,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    pageNumber: chunk.pageNumber,
    score: chunk.score || 0.85,
    snippet: chunk.content.substring(0, 120) + '...',
  }));

  return {
    text: `بناءً على المستندات المسترجعة من النظام (${contextChunks.length} قطعة):\n\n${
      contextChunks[0]?.content || 'تم استرجاع السجلات المطلوبة بنجاح.'
    }\n\n[إشعار المحرك: تم توليد الاستجابة المباشرة وفق سياسة الالتزام ببيانات المستأجر].`,
    citations: fallbackCitations,
    modelUsed: modelToUse,
    tokensUsed: { input: 120, output: 85 },
    toolCalls: alreadyExecutedToolCalls.length > 0 ? alreadyExecutedToolCalls : undefined
  };
}
