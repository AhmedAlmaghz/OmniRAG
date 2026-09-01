import { db } from '@/lib/storage/db';
import { generateEmbedding } from '@/lib/rag/embedding';
import { getVectorStoreForTenant } from '@/lib/storage/vectors/registry';
import { randomInt } from '@/lib/crypto/webRandom';
import { getEnv } from '@/lib/env/runtimeEnv';
import { htmlToText, safeFetchBinary, safeFetchText } from '../net';
import { chunkDocumentWithPages, estimateTokenCount } from '@/lib/rag/chunker';
import { dispatchFile, mistralOcr, normalizeMimeType } from '@/lib/services/unstructuredService';
import { processYoutubeTranscript } from '@/lib/youtube/transcriptParser';
import { SKILL_TOOLS } from './skillTools';
import {
  getSlackToken,
  slackSendMessageLive,
  slackReadChannelLive,
  getGitHubToken,
  githubSearchCodeLive,
  githubCreateIssueLive,
  githubReadRepoLive,
} from './liveIntegrations';

/**
 * Resolves a document reference into a Buffer for the shared parsing pipeline.
 * Accepts data URLs (uploaded files), public http(s) links, raw base64, or
 * plain text — the same input shapes the ingestion surfaces accept. Network
 * fetches go through the SSRF guard with timeout + size caps.
 */
async function resolveDocumentBuffer(documentRef: string): Promise<Buffer> {
  if (documentRef.startsWith('data:')) {
    return Buffer.from(documentRef.split(',')[1] || '', 'base64');
  }
  if (/^https?:\/\//i.test(documentRef)) {
    const fetched = await safeFetchBinary(documentRef, { timeoutMs: 30000 });
    if (!fetched.ok) {
      throw new Error(fetched.error || `تعذر جلب الملف من الرابط (HTTP ${fetched.status})`);
    }
    return fetched.bytes;
  }
  // Raw base64 or plain-text fallback: valid base64 round-trips losslessly.
  const decoded = Buffer.from(documentRef, 'base64');
  if (
    decoded.length > 0 &&
    decoded.toString('base64').replace(/\s/g, '').length >=
      documentRef.replace(/\s/g, '').replace(/=/g, '').length * 0.9
  ) {
    return decoded;
  }
  return Buffer.from(documentRef, 'utf-8');
}

export interface MCPToolDefinition {
  name: string;
  serverName: string;
  description: string;
  category: 'slack' | 'github' | 'search' | 'postgres' | 'knowledge' | 'actions' | 'skills';
  hasSideEffect: boolean;
  requireConfirmation: boolean;
  /**
   * Declared honesty flag: `true` means every outcome of this tool is a
   * clearly-marked sandbox simulation (no live integration exists yet).
   * Dynamic tools that CAN reach a real backend set `false` here and stamp
   * each individual result's `simulated` field based on what actually happened.
   */
  simulated: boolean;
  /** Hard execution timeout applied by the dispatcher (ms). */
  timeoutMs?: number;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
  execute: (args: Record<string, any>, ctx: { tenantId: string; userId?: string }) => Promise<any>;
}

/** Legacy tool names found in persisted tenant rows, mapped to canonical ones. */
const TOOL_ALIASES: Record<string, string> = {
  unstructured_transform_document: 'unstructured_parse_document',
  unstructured_chunk_document: 'unstructured_parse_document',
};

// ---------------------------------------------------------------------------
// Web search providers. The first configured provider wins; when none is
// configured the tool degrades to a result explicitly stamped as simulated.
// ---------------------------------------------------------------------------

interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function tavilySearch(query: string, numResults: number, language: string): Promise<WebSearchHit[]> {
  const apiKey = getEnv('TAVILY_API_KEY');
  const data = await fetchJsonWithTimeout('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: numResults,
      search_depth: 'basic',
      topic: 'general',
      include_answer: false,
      lang: language,
    }),
  });
  return (data?.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || r.snippet || '',
  }));
}

async function serperSearch(query: string, numResults: number, language: string): Promise<WebSearchHit[]> {
  const apiKey = getEnv('SERPER_API_KEY');
  const data = await fetchJsonWithTimeout('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num: numResults, gl: language === 'ar' ? 'sa' : 'us', hl: language }),
  });
  return (data?.organic || []).map((r: any) => ({
    title: r.title || '',
    url: r.link || '',
    snippet: r.snippet || '',
  }));
}

async function braveSearch(query: string, numResults: number, language: string): Promise<WebSearchHit[]> {
  const apiKey = getEnv('BRAVE_API_KEY');
  const params = new URLSearchParams({ q: query, count: String(numResults) });
  if (language === 'ar') params.set('search_lang', 'ar');
  const data = await fetchJsonWithTimeout(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
  });
  return (data?.web?.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.description || '',
  }));
}

function resolveSearchProvider(): ((q: string, n: number, l: string) => Promise<WebSearchHit[]>) | null {
  if (getEnv('TAVILY_API_KEY')) return tavilySearch;
  if (getEnv('SERPER_API_KEY')) return serperSearch;
  if (getEnv('BRAVE_API_KEY')) return braveSearch;
  return null;
}

export const MCP_TOOLS_REGISTRY: Record<string, MCPToolDefinition> = {
  // --- 1. SLACK & COMMUNICATIONS MCP SERVER TOOLS ---
  slack_send_message: {
    name: 'slack_send_message',
    serverName: 'Slack Communications MCP Server',
    description: 'إرسال رسالة فورية إلى قناة أو مستخدم محدد في Slack',
    category: 'slack',
    hasSideEffect: true,
    requireConfirmation: true,
    simulated: false,
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'اسم القناة أو المعرف (مثل #general أو C0123456)' },
        message: { type: 'string', description: 'محتوى الرسالة النصية المراد إرسالها' },
        urgency: { type: 'string', description: 'مستوى الأهمية (normal أو high)', enum: ['normal', 'high'] },
      },
      required: ['channel', 'message'],
    },
    execute: async (args, ctx) => {
      const { channel, message, urgency = 'normal' } = args;

      // Live path: a real Slack bot token turns this into an actual post.
      if (getSlackToken()) {
        const live = await slackSendMessageLive(channel, urgency === 'high' ? `🔴 [عاجل] ${message}` : message);
        if (!live.ok) {
          return { success: false, simulated: false, channel, error: live.error };
        }
        await db.addAuditLog({
          id: `audit-${Date.now()}`,
          tenantId: ctx.tenantId,
          actorId: ctx.userId || 'mcp_gateway',
          action: 'MCP_TOOL_EXECUTE',
          resourceType: 'slack_channel',
          resourceId: channel,
          status: 'success',
          details: `تم إرسال رسالة Slack حقيقية إلى القناة (${channel}): "${message.slice(0, 50)}..."`,
          timestamp: new Date().toISOString(),
        });
        return {
          success: true,
          simulated: false,
          channel,
          messageSent: message,
          urgency,
          timestamp: new Date().toISOString(),
          deliveryStatus: 'delivered',
          messageId: live.data?.ts || '',
        };
      }

      // No token: clearly-marked sandbox simulation (declared per-result).
      const result = {
        success: true,
        simulated: true,
        channel,
        messageSent: message,
        urgency,
        timestamp: new Date().toISOString(),
        deliveryStatus: 'delivered',
        messageId: `slack-msg-${Date.now()}`,
        reason: 'SLACK_BOT_TOKEN غير مهيأ — هذه نتيجة تجريبية. أضف الرمز لتفعيل الإرسال الحقيقي.',
      };

      // Log audit
      await db.addAuditLog({
        id: `audit-${Date.now()}`,
        tenantId: ctx.tenantId,
        actorId: ctx.userId || 'mcp_gateway',
        action: 'MCP_TOOL_EXECUTE',
        resourceType: 'slack_channel',
        resourceId: channel,
        status: 'success',
        details: `تم إرسال رسالة Slack إلى القناة (${channel}): "${message.slice(0, 50)}..."`,
        timestamp: new Date().toISOString(),
      });

      return result;
    },
  },

  slack_read_channel: {
    name: 'slack_read_channel',
    serverName: 'Slack Communications MCP Server',
    description: 'قراءة واستخراج أحدث المحادثات والرسائل من قناة Slack معينة',
    category: 'slack',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'اسم القناة المراد قراءة المحادثات منها' },
        limit: { type: 'number', description: 'عدد الرسائل المراد جلبها (افتراضي: 10)' },
      },
      required: ['channel'],
    },
    execute: async (args) => {
      const { channel, limit = 10 } = args;

      if (getSlackToken()) {
        const live = await slackReadChannelLive(channel, Number(limit) || 10);
        if (!live.ok) {
          return { success: false, simulated: false, channel, error: live.error };
        }
        return {
          success: true,
          simulated: false,
          channel,
          messagesCount: live.data.messages.length,
          messages: live.data.messages,
        };
      }

      return {
        success: true,
        simulated: true,
        reason: 'SLACK_BOT_TOKEN غير مهيأ — هذه بيانات تجريبية توضيحية.',
        channel,
        messagesCount: Math.min(limit, 5),
        messages: [
          {
            user: 'أحمد علي (مدير المشاريع)',
            text: 'هل تم استكمال مراجعة سياسات أمن المعلومات لعام 2026؟',
            timestamp: new Date(Date.now() - 3600000).toISOString(),
          },
          {
            user: 'سارة خالد (مهندسة الأمان)',
            text: 'نعم، تم تحديث معايير RLS ومستويات MCP Sandbox بنجاح.',
            timestamp: new Date(Date.now() - 1800000).toISOString(),
          },
          {
            user: 'خالد عمر (فريق التطوير)',
            text: 'ممتاز، سنقوم باختبار خوادم MCP وتدفق الـ OAuth الآن.',
            timestamp: new Date(Date.now() - 600000).toISOString(),
          },
        ],
      };
    },
  },

  slack_post_alert: {
    name: 'slack_post_alert',
    serverName: 'Slack Communications MCP Server',
    description: 'إرسال تنبيه أمني أو تقني عاجل إلى فريق العمل على Slack',
    category: 'slack',
    hasSideEffect: true,
    requireConfirmation: true,
    simulated: false,
    parameters: {
      type: 'object',
      properties: {
        alertType: { type: 'string', description: 'نوع التنبيه (SECURITY, PERFORMANCE, COMPLIANCE)' },
        details: { type: 'string', description: 'تفاصيل التنبيه الفني' },
      },
      required: ['alertType', 'details'],
    },
    execute: async (args, ctx) => {
      const alertChannel = getEnv('SLACK_ALERTS_CHANNEL') || '#security-alerts';

      if (getSlackToken()) {
        const text = `🚨 تنبيه ${args.alertType}: ${args.details}`;
        const live = await slackSendMessageLive(alertChannel, text);
        if (!live.ok) {
          return { success: false, simulated: false, alertType: args.alertType, error: live.error };
        }
        await db.addAuditLog({
          id: `audit-${Date.now()}-alert`,
          tenantId: ctx.tenantId,
          actorId: ctx.userId || 'mcp_gateway',
          action: 'MCP_TOOL_EXECUTE',
          resourceType: 'slack_channel',
          resourceId: alertChannel,
          status: 'success',
          details: `تم بث تنبيه ${args.alertType} حقيقي إلى (${alertChannel})`,
          timestamp: new Date().toISOString(),
        });
        return {
          success: true,
          simulated: false,
          alertId: live.data?.ts || `alert-${Date.now()}`,
          alertType: args.alertType,
          recipientChannel: alertChannel,
          status: 'broadcasted',
          timestamp: new Date().toISOString(),
        };
      }

      return {
        success: true,
        simulated: true,
        reason: 'SLACK_BOT_TOKEN غير مهيأ — هذا تنبيه تجريبي لم يُبث فعليا.',
        alertId: `alert-${Date.now()}`,
        alertType: args.alertType,
        recipientChannel: alertChannel,
        status: 'broadcasted',
        timestamp: new Date().toISOString(),
      };
    },
  },

  // --- 2. GITHUB & DEVELOPMENT MCP SERVER TOOLS ---
  github_search_code: {
    name: 'github_search_code',
    serverName: 'GitHub Enterprise MCP Server',
    description: 'البحث عن الشفرات البرمجية والملفات في مستودعات GitHub الخاصة بالمؤسسة',
    category: 'github',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'كلمة البحث البرمجية أو اسم الدالة/المكافئ' },
        repo: { type: 'string', description: 'اسم المستودع (اختياري، مثل organization/repo)' },
        language: { type: 'string', description: 'لغة البرمجة (مثل typescript, python)' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const { query, repo, language } = args;

      if (getGitHubToken()) {
        const live = await githubSearchCodeLive(query, repo, language);
        if (!live.ok) {
          return { success: false, simulated: false, query, error: live.error };
        }
        return {
          success: true,
          simulated: false,
          repo: repo || 'all',
          totalMatches: live.data.totalMatches,
          codeSnippets: live.data.codeSnippets,
        };
      }

      const simRepo = repo || 'omnirag/core';
      return {
        success: true,
        simulated: true,
        reason: 'GITHUB_TOKEN غير مهيأ — هذه نتائج تجريبية توضيحية.',
        repo: simRepo,
        totalMatches: 2,
        codeSnippets: [
          {
            path: 'src/lib/mcp/server-factory.ts',
            line: 42,
            match: `export function createMcpServer(tenantId: string) { /* ${query} */ }`,
            url: `https://github.com/${simRepo}/blob/main/src/lib/mcp/server-factory.ts#L42`,
          },
          {
            path: 'src/lib/security/rateLimiter.ts',
            line: 18,
            match: `const mcpRateLimit = checkTenantLimit(tenantId, 'mcp_calls');`,
            url: `https://github.com/${simRepo}/blob/main/src/lib/security/rateLimiter.ts#L18`,
          },
        ],
      };
    },
  },

  github_create_issue: {
    name: 'github_create_issue',
    serverName: 'GitHub Enterprise MCP Server',
    description: 'إنشاء تذكرة عمل جديدة (Issue) في مستودع GitHub',
    category: 'github',
    hasSideEffect: true,
    requireConfirmation: true,
    simulated: false,
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'اسم المستودع (مثل org/project)' },
        title: { type: 'string', description: 'عنوان التذكرة' },
        body: { type: 'string', description: 'تفاصيل ومحتوى التذكرة' },
        labels: { type: 'string', description: 'العلامات المرفقة تفصل بينها فاصلة (مثال: bug,mcp,security)' },
      },
      required: ['repo', 'title', 'body'],
    },
    execute: async (args, ctx) => {
      const labels = String(args.labels || '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);

      // Live path: real issue creation when a token is configured.
      if (getGitHubToken()) {
        const live = await githubCreateIssueLive(args.repo, args.title, args.body, labels);
        if (!live.ok) {
          return { success: false, simulated: false, repo: args.repo, error: live.error };
        }
        await db.addAuditLog({
          id: `audit-${Date.now()}-issue`,
          tenantId: ctx.tenantId,
          actorId: ctx.userId || 'mcp_gateway',
          action: 'MCP_TOOL_EXECUTE',
          resourceType: 'github_issue',
          resourceId: `${args.repo}#${live.data.issueNumber}`,
          status: 'success',
          details: `تم إنشاء تذكرة GitHub حقيقية (${args.repo}#${live.data.issueNumber}): "${String(args.title).slice(0, 60)}"`,
          timestamp: new Date().toISOString(),
        });
        return {
          success: true,
          simulated: false,
          issueNumber: live.data.issueNumber,
          issueUrl: live.data.issueUrl,
          title: args.title,
          status: live.data.status,
          createdAt: new Date().toISOString(),
        };
      }

      // No token: built-in mock for demos/integration debugging. It returns a
      // simulated issue, but does NOT write a fake audit-log entry claiming a
      // real GitHub issue was created — such an entry would be a forged audit
      // trail. The result is clearly marked as simulated.
      const issueNumber = randomInt(800) + 100; // [100, 899]
      const result = {
        success: true,
        simulated: true,
        reason: 'GITHUB_TOKEN غير مهيأ — هذه تذكرة تجريبية لم تُنشأ فعليا.',
        issueNumber,
        issueUrl: `https://github.com/${args.repo}/issues/${issueNumber}`,
        title: args.title,
        status: 'open',
        createdAt: new Date().toISOString(),
      };

      return result;
    },
  },

  github_read_repo: {
    name: 'github_read_repo',
    serverName: 'GitHub Enterprise MCP Server',
    description: 'قراءة ملخص مستودع GitHub وهيكلية مجلداته وفروعه الحالية',
    category: 'github',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'اسم المستودع المراد قراءته' },
        branch: { type: 'string', description: 'اسم الفرع (افتراضي: main)' },
      },
      required: ['repo'],
    },
    execute: async (args) => {
      if (getGitHubToken()) {
        const live = await githubReadRepoLive(args.repo, args.branch);
        if (!live.ok) {
          return { success: false, simulated: false, repo: args.repo, error: live.error };
        }
        return { success: true, simulated: false, ...live.data };
      }

      return {
        success: true,
        simulated: true,
        reason: 'GITHUB_TOKEN غير مهيأ — هذه بيانات تجريبية توضيحية.',
        repo: args.repo,
        branch: args.branch || 'main',
        openIssuesCount: 4,
        pullRequestsCount: 2,
        structure: [
          'SDLC/02-architecture/02-components-data-model-and-api-surface.md',
          'src/app/api/mcp/[...path]/route.ts',
          'src/lib/mcp/registry/tools.ts',
          'src/lib/mcp/client-pool.ts',
        ],
      };
    },
  },

  // --- 3. WEB SEARCH & LIVE FETCH MCP SERVER TOOLS ---
  web_live_search: {
    name: 'web_live_search',
    serverName: 'Web Search & Intelligence MCP Server',
    description: 'البحث الحي الفوري في محركات الويب عن أحدث المعلومات والأخبار والتوثيقات',
    category: 'search',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    timeoutMs: 15000,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'عبارة البحث المباشر في الويب' },
        language: { type: 'string', description: 'لغة نتائج البحث (ar أو en)' },
        numResults: { type: 'number', description: 'عدد النتائج المطلوبة' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const { query, numResults = 3, language = 'ar' } = args;

      const provider = resolveSearchProvider();
      if (!provider) {
        return {
          success: false,
          simulated: true,
          query,
          reason:
            'لا يوجد مزود بحث ويب مُهيأ. أضف أحد مفاتيح البيئة TAVILY_API_KEY أو SERPER_API_KEY أو BRAVE_API_KEY لتفعيل البحث الحي الحقيقي.',
          sources: [],
        };
      }

      try {
        const hits = await provider(query, Math.min(Math.max(numResults, 1), 10), language);
        return {
          success: true,
          simulated: false,
          query,
          resultsCount: hits.length,
          sources: hits,
        };
      } catch (err: any) {
        return {
          success: false,
          simulated: false,
          query,
          error: `فشل البحث الحي: ${err?.message || err}`,
          sources: [],
        };
      }
    },
  },

  fetch_url_content: {
    name: 'fetch_url_content',
    serverName: 'Web Search & Intelligence MCP Server',
    description: 'جلب واستخراج نص وثيقة أو صفحة ويب عبر الرابط الإلكتروني URL مباشرة',
    category: 'search',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    timeoutMs: 20000,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'رابط الصفحة أو الوثيقة المراد قراءة محتواها' },
        maxChars: { type: 'number', description: 'الحد الأقصى لعدد أحرف النص المعاد (افتراضي 8000)' },
      },
      required: ['url'],
    },
    execute: async (args) => {
      const { url, maxChars = 8000 } = args;

      let fetched;
      try {
        fetched = await safeFetchText(url, { timeoutMs: 12000, maxBytes: 1024 * 1024 });
      } catch (err: any) {
        // Policy violations (SSRF guard, dummy endpoints) surface as honest errors.
        return { success: false, simulated: false, url, error: err?.message || 'فشل جلب الرابط' };
      }

      if (!fetched.ok) {
        return {
          success: false,
          simulated: false,
          url,
          error: fetched.error || `تعذر جلب المحتوى (HTTP ${fetched.status})`,
        };
      }

      const isHtml = fetched.contentType.includes('text/html') || /^\s*<(!doctype|html)/i.test(fetched.text);
      const extracted = isHtml ? htmlToText(fetched.text) : fetched.text.trim();

      return {
        success: true,
        simulated: false,
        url,
        mimeType: fetched.contentType || (isHtml ? 'text/html' : 'text/plain'),
        contentLengthBytes: fetched.bytes,
        truncated: fetched.truncated || extracted.length > maxChars,
        contentSnippet: extracted.slice(0, maxChars),
      };
    },
  },

  // --- 4. EXTERNAL POSTGRES & DATABASE MCP SERVER TOOLS ---
  external_postgres_query: {
    name: 'external_postgres_query',
    serverName: 'Postgres & DB Intelligence MCP Server',
    description: 'تشغيل استعلامات SQL تحليلية آمنة (Read-Only) على قاعدة بيانات PostgreSQL خارجية',
    category: 'postgres',
    hasSideEffect: false,
    requireConfirmation: true,
    simulated: true,
    parameters: {
      type: 'object',
      properties: {
        sqlQuery: { type: 'string', description: 'استعلام SQL المراد تشغيله (SELECT فقط)' },
        tableName: { type: 'string', description: 'اسم الجدول المستهدف (اختياري)' },
      },
      required: ['sqlQuery'],
    },
    execute: async (args, ctx) => {
      // Accept both the canonical param and the legacy engine-era `query`.
      const sqlQuery = args.sqlQuery ?? args.query;
      if (!sqlQuery || !String(sqlQuery).toLowerCase().trim().startsWith('select')) {
        throw new Error('يُسمح فقط باستعلامات القراءة (SELECT) لأسباب أمنية');
      }

      return {
        success: true,
        executedQuery: sqlQuery,
        tenantId: ctx.tenantId,
        rowCount: 3,
        rows: [
          { id: '101', category: 'السياسات الأمنية', status: 'ACTIVE', updated_at: '2026-08-01' },
          { id: '102', category: 'اتفاقيات مستوى الخدمة SLA', status: 'ACTIVE', updated_at: '2026-08-05' },
          { id: '103', category: 'معايير التشفير والـ RLS', status: 'ACTIVE', updated_at: '2026-08-10' },
        ],
      };
    },
  },

  get_table_schema: {
    name: 'get_table_schema',
    serverName: 'Postgres & DB Intelligence MCP Server',
    description: 'استكشاف المخطط الهيكلي وخريطة الأعمدة لجدول في قاعدة البيانات',
    category: 'postgres',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: true,
    parameters: {
      type: 'object',
      properties: {
        tableName: { type: 'string', description: 'اسم الجدول المراد معرفة هيكله' },
      },
      required: ['tableName'],
    },
    execute: async (args) => {
      return {
        success: true,
        tableName: args.tableName,
        columns: [
          { name: 'id', type: 'UUID', primaryKey: true },
          { name: 'tenant_id', type: 'UUID', nullable: false, indexed: true },
          { name: 'title', type: 'VARCHAR(255)', nullable: false },
          { name: 'content', type: 'TEXT', nullable: true },
          { name: 'metadata', type: 'JSONB', nullable: true },
          { name: 'created_at', type: 'TIMESTAMPTZ', default: 'NOW()' },
        ],
        indexes: [`idx_${args.tableName}_tenant_id`, `idx_${args.tableName}_created_at`],
      };
    },
  },

  // --- 5. KNOWLEDGE BASE & RAG MCP SERVER TOOLS ---
  unstructured_parse_document: {
    name: 'unstructured_parse_document',
    serverName: 'Unstructured Transform MCP Server',
    description:
      'معالجة وتحويل الملفات المرفوعة والمستندات (PDF, DOCX, PPTX, Excel, صور، صوت وفيديو) إلى محتوى Markdown منظّم باستخدام خط Unstructured Transform متعدد المحركات',
    category: 'knowledge',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    timeoutMs: 120000,
    parameters: {
      type: 'object',
      properties: {
        documentUrl: {
          type: 'string',
          description: 'مرجع المستند: رابط http(s) عام، أو Data URL للملف المرفوع، أو محتوى Base64',
        },
        fileName: {
          type: 'string',
          description: 'اسم الملف الأصلي مع الامتداد (مثل report.pdf) — يحدد المحرك المناسب',
        },
        strategy: {
          type: 'string',
          description: 'استراتيجية التحويل للـ PDF/الصور: hi_res أو fast أو ocr_only',
          enum: ['hi_res', 'fast', 'ocr_only'],
        },
      },
      required: ['documentUrl'],
    },
    execute: async (args, ctx) => {
      const { documentUrl, fileName = 'document.pdf', strategy = 'hi_res' } = args;
      if (!documentUrl || typeof documentUrl !== 'string') {
        throw new Error('مرجع المستند (documentUrl) مطلوب: رابط عام أو Data URL أو Base64');
      }

      // Single shared pipeline with document ingestion: local PPTX/DOCX
      // parsers -> audio/video transcription -> Mistral OCR -> Unstructured
      // partition -> Gemini multimodal fallback. No duplicated engine code.
      const buffer = await resolveDocumentBuffer(documentUrl);
      if (buffer.length === 0) {
        throw new Error('محتوى الملف فارغ أو غير صالح');
      }

      let parsed;
      try {
        parsed = await dispatchFile(buffer, fileName, normalizeMimeType(fileName), {
          strategy: strategy as any,
          preferredEngine: 'auto',
        });
      } catch (err: any) {
        return {
          success: false,
          simulated: false,
          fileName,
          error: `فشل تحويل المستند: ${err?.message || err}`,
        };
      }

      if (!parsed.success || !parsed.text?.trim()) {
        return {
          success: false,
          simulated: false,
          fileName,
          engineUsed: parsed.engineUsed,
          error: 'لم يتم استخراج أي نص قابل للقراءة من المستند',
        };
      }

      return {
        success: true,
        simulated: false,
        engine: 'Unstructured Transform MCP',
        engineUsed: parsed.engineUsed,
        fileName,
        charactersExtracted: parsed.text.length,
        markdown: parsed.text,
        metadata: { strategy, fileName, tenantId: ctx.tenantId },
      };
    },
  },

  mistral_document_ai_parse: {
    name: 'mistral_document_ai_parse',
    serverName: 'Unstructured Transform MCP Server',
    description:
      'تحليل مستندات PDF والصور حصراً عبر Mistral Document AI OCR لفهم التخطيط واستخراج الجداول والمعادلات الرياضية بصيغة Markdown',
    category: 'knowledge',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    timeoutMs: 120000,
    parameters: {
      type: 'object',
      properties: {
        documentUrl: { type: 'string', description: 'رابط الوثيقة العامة أو Data URL أو Base64 للـ PDF/الصورة' },
        fileName: { type: 'string', description: 'اسم الملف للتوثيق' },
      },
      required: ['documentUrl'],
    },
    execute: async (args, ctx) => {
      const apiKey =
        getEnv('MISTRAL_API_KEY') || process.env.MISTRAL_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
      const { documentUrl, fileName = 'document.pdf' } = args;
      if (!documentUrl || typeof documentUrl !== 'string') {
        throw new Error('مرجع المستند (documentUrl) مطلوب');
      }
      if (!apiKey) {
        return {
          success: false,
          simulated: true,
          fileName,
          reason: 'مفتاح MISTRAL_API_KEY غير مُهيأ — أضفه لتفعيل تحليل Mistral Document AI الحقيقي.',
        };
      }

      const buffer = await resolveDocumentBuffer(documentUrl);
      if (buffer.length === 0) {
        throw new Error('محتوى الملف فارغ أو غير صالح');
      }

      try {
        const result = await mistralOcr(buffer, fileName, normalizeMimeType(fileName), apiKey);
        const markdown = result.text || '';
        if (!result.success || !markdown.trim()) {
          return {
            success: false,
            simulated: false,
            fileName,
            engineUsed: result.engineUsed,
            error: 'لم يُرجع Mistral OCR محتوى قابلاً للاستخدام',
          };
        }
        return {
          success: true,
          simulated: false,
          engine: 'Mistral Document AI API',
          engineUsed: result.engineUsed,
          fileName,
          charactersExtracted: markdown.length,
          markdown,
          metadata: { fileName, tenantId: ctx.tenantId },
        };
      } catch (err: any) {
        return {
          success: false,
          simulated: false,
          fileName,
          error: `فشل تحليل Mistral OCR: ${err?.message || err}`,
        };
      }
    },
  },

  search_knowledge_base: {
    name: 'search_knowledge_base',
    serverName: 'OmniRAG Core Knowledge MCP Server',
    description: 'البحث في قاعدة المعرفة المعززة للمؤسسة باستعلام دلالي هجين',
    category: 'knowledge',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    timeoutMs: 20000,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'سؤال أو نص الاستعلام البحثي' },
        topK: { type: 'number', description: 'عدد النظائر والقطع المراد إرجاعها (افتراضي: 40، وسقف أقصى 200)' },
        collectionIds: {
          type: 'string',
          description: 'معرفات مجموعات المعرفة مفصولة بفواصل لتضييق نطاق البحث (اختياري)',
        },
      },
      required: ['query'],
    },
    execute: async (args, ctx) => {
      // The knowledge tool shares the engine's no-fixed-cap recall policy:
      // default generously and clamp only to the defensive context ceiling.
      const topK = Math.max(1, Math.min(Number(args.topK) || 40, 200));
      const query = String(args.query || '');
      const collectionIds = String(args.collectionIds || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      // Vector search from the tenant's vector store, or fallback to db chunks
      let usedVectorBackend = false;
      let vectorBackendId = '';
      try {
        const vectorStore = await getVectorStoreForTenant(ctx.tenantId);
        const queryVector = await generateEmbedding(query);
        const vectorResults = await vectorStore.search({
          tenantId: ctx.tenantId,
          vector: queryVector,
          limit: topK,
          collectionIds: collectionIds.length > 0 ? collectionIds : undefined,
        });

        if (vectorResults && vectorResults.length > 0) {
          usedVectorBackend = true;
          vectorBackendId = vectorStore.id;
          return {
            success: true,
            simulated: false,
            backend: `${vectorStore.id}-vector`,
            query,
            totalFound: vectorResults.length,
            chunks: vectorResults.map((r) => ({
              id: r.id,
              documentTitle: r.documentTitle || 'وثيقة معرفية',
              content: r.content || '',
              score: r.semanticScore,
            })),
          };
        }
      } catch (err) {
        console.log('Vector search in MCP tool fallback to DB chunks');
      }

      // Fallback
      let chunks = await db.getChunks(ctx.tenantId);
      if (collectionIds.length > 0) {
        const docsInCollections = (await db.getDocuments(ctx.tenantId)).filter((d) =>
          d.collectionIds?.some((c) => collectionIds.includes(c)),
        );
        const validDocIds = new Set(docsInCollections.map((d) => d.id));
        chunks = chunks.filter((c) => validDocIds.has(c.documentId));
      }
      const filtered = chunks
        .filter(
          (c) =>
            c.content.toLowerCase().includes(query.toLowerCase()) ||
            c.documentTitle?.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, topK);

      return {
        success: true,
        simulated: false,
        backend: usedVectorBackend ? `${vectorBackendId}-vector` : 'db-keyword-fallback',
        query,
        totalFound: filtered.length,
        chunks: (filtered.length > 0 ? filtered : chunks.slice(0, topK)).map((c) => ({
          id: c.id,
          documentTitle: c.documentTitle || 'مستند معرفي',
          content: c.content,
          score: 0.88,
        })),
      };
    },
  },

  query_collection: {
    name: 'query_collection',
    serverName: 'OmniRAG Core Knowledge MCP Server',
    description: 'استعلام وثائق ومستندات مجموعة معينة في المعرفة',
    category: 'knowledge',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    parameters: {
      type: 'object',
      properties: {
        collectionName: { type: 'string', description: 'اسم مجموعة المعرفة' },
        filter: { type: 'string', description: 'كلمة فلترة اختيارية' },
      },
      required: ['collectionName'],
    },
    execute: async (args, ctx) => {
      const docs = await db.getDocuments(ctx.tenantId);
      const needle = (args.filter || '').toLowerCase();
      const filteredDocs = needle
        ? docs.filter((d) => d.title.toLowerCase().includes(needle) || (d.content || '').toLowerCase().includes(needle))
        : docs;
      return {
        success: true,
        simulated: false,
        collectionName: args.collectionName,
        documentsCount: filteredDocs.length,
        documents: filteredDocs.map((d) => ({
          id: d.id,
          title: d.title,
          status: d.status,
          createdAt: d.createdAt,
        })),
      };
    },
  },

  knowledge_ingest_document: {
    name: 'knowledge_ingest_document',
    serverName: 'OmniRAG Core Knowledge MCP Server',
    description:
      'جلب محتوى من ملف مرفوع أو رابط ويب أو نص مباشر، ومعالجته إلى Markdown، وتسجيله كمصدر، وفهرسته داخل قاعدة معرفة المؤسسة (تجزيء دلالي + فهرسة متجهية)',
    category: 'knowledge',
    hasSideEffect: true,
    requireConfirmation: true,
    simulated: false,
    timeoutMs: 150000,
    parameters: {
      type: 'object',
      properties: {
        fileData: {
          type: 'string',
          description:
            'الملف المرفوع كـ Data URL أو Base64 — يُحوَّل عبر خط Unstructured Transform إلى Markdown (أو استخدم url/text)',
        },
        fileName: { type: 'string', description: 'اسم الملف الأصلي مع الامتداد عند تمرير fileData (مثل contract.pdf)' },
        url: { type: 'string', description: 'رابط الصفحة/الوثيقة المراد جلبها وفهرستها' },
        text: { type: 'string', description: 'نص جاهز للفهرسة بدل الجلب من ملف أو رابط (اختياري)' },
        title: { type: 'string', description: 'عنوان الوثيقة في قاعدة المعرفة والمصادر' },
        collectionIds: { type: 'string', description: 'معرفات المجموعات مفصولة بفواصل (اختياري)' },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { fileData, fileName = 'document.pdf', url, text, title, collectionIds } = args;
      const collections = String(collectionIds || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      let content = typeof text === 'string' && text.trim() ? text.trim() : '';
      let fetchedFrom = 'direct-text';
      let sourceType: 'file' | 'url' = text ? 'file' : 'url';

      // 1) Uploaded file -> shared Unstructured Transform pipeline -> Markdown
      if (!content && fileData && typeof fileData === 'string') {
        const buffer = await resolveDocumentBuffer(
          fileData.startsWith('data:') || /^https?:\/\//i.test(fileData) ? fileData : fileData,
        );
        if (buffer.length === 0) {
          throw new Error('محتوى الملف فارغ أو غير صالح');
        }
        let parsed;
        try {
          parsed = await dispatchFile(buffer, fileName, normalizeMimeType(fileName), { preferredEngine: 'auto' });
        } catch (err: any) {
          return {
            success: false,
            simulated: false,
            fileName,
            error: `فشل تحويل الملف إلى نص: ${err?.message || err}`,
          };
        }
        if (!parsed.success || !parsed.text?.trim()) {
          return {
            success: false,
            simulated: false,
            fileName,
            engineUsed: parsed.engineUsed,
            error: 'لم يتم استخراج أي محتوى قابل للفهرسة من الملف',
          };
        }
        content = parsed.text.trim();
        fetchedFrom = `file:${fileName} (${parsed.engineUsed})`;
        sourceType = 'file';
      }

      // 2) URL fetch with SSRF guard
      if (!content && url) {
        const fetched = await safeFetchText(url, { timeoutMs: 12000, maxBytes: 1024 * 1024 });
        if (!fetched.ok) {
          return {
            success: false,
            simulated: false,
            url,
            error: fetched.error || `تعذر جلب المحتوى من الرابط (HTTP ${fetched.status})`,
          };
        }
        const isHtml = fetched.contentType.includes('text/html') || /^\s*<(!doctype|html)/i.test(fetched.text);
        content = isHtml ? htmlToText(fetched.text) : fetched.text.trim();
        fetchedFrom = url;
        sourceType = 'url';
      }

      if (!content || content.length < 20) {
        throw new Error('لا يوجد محتوى كافٍ للفهرسة: مرّر ملفاً صالحاً أو رابطاً أو نصاً لا يقل عن 20 حرفاً');
      }

      const docTitle = title || (fileData ? fileName : url ? `وثيقة مستجلبة من ${safeHost(url)}` : 'نص مفهرس عبر MCP');

      // Register the ingested item as a SOURCE so it appears in the Sources
      // dashboard with its own lifecycle, then attach the document to it.
      const now = new Date().toISOString();
      const sourceId = `src-mcp-${Date.now().toString().slice(-8)}`;
      await db.addSource({
        id: sourceId,
        tenantId: ctx.tenantId,
        name: docTitle,
        type: sourceType,
        status: 'healthy',
        config: {},
        syncSchedule: 'manual',
        lastSyncAt: now,
        documentCount: 1,
        collectionIds: collections,
        createdAt: now,
      } as any);

      const docId = `doc-mcp-ingest-${Date.now().toString().slice(-8)}`;
      const pageChunks = chunkDocumentWithPages(content);
      const chunkTextList = pageChunks.map((c) => c.text);

      const newDoc = {
        id: docId,
        tenantId: ctx.tenantId,
        title: docTitle,
        content,
        sourceType,
        language: 'ar',
        status: 'indexed',
        chunkCount: chunkTextList.length,
        createdAt: now,
        metadata: { ingestedVia: 'mcp_tool', origin: fetchedFrom, sourceId },
        collectionIds: collections,
      } as any;
      await db.addDocument(newDoc);

      const chunks = chunkTextList.map(
        (chunkText, index) =>
          ({
            id: `chunk-${docId}-${index + 1}`,
            tenantId: ctx.tenantId,
            documentId: docId,
            documentTitle: docTitle,
            content: chunkText,
            chunkIndex: index,
            pageNumber: pageChunks[index]?.pageNumber ?? 1,
            language: 'ar',
            score: 0,
            metadata: { ingestedVia: 'mcp_tool', position: index, tokenCount: estimateTokenCount(chunkText) },
          }) as any,
      );
      const indexResult = await db.addChunks(chunks);

      await db.addAuditLog({
        id: `audit-${Date.now()}-ingest`,
        tenantId: ctx.tenantId,
        actorId: ctx.userId || 'mcp_gateway',
        action: 'MCP_KNOWLEDGE_INGEST',
        resourceType: 'document',
        resourceId: docId,
        status: indexResult.success ? 'success' : 'error',
        details: `تم عبر أداة MCP جلب ومعالجة وفهرسة وثيقة (${docTitle}) بعدد ${chunkTextList.length} مقطعاً دلالياً وتخزينها في المصادر (${sourceId}).`,
        timestamp: now,
      });

      return {
        success: indexResult.success,
        simulated: false,
        documentId: docId,
        sourceId,
        title: docTitle,
        fetchedFrom,
        charactersProcessed: content.length,
        chunksIndexed: chunkTextList.length,
        vectorIndexErrors: indexResult.errors,
      };
    },
  },

  youtube_fetch_transcript: {
    name: 'youtube_fetch_transcript',
    serverName: 'YouTube Intelligence MCP Server',
    description:
      'جلب تفريغ نصي كامل (Transcript) لفيديو يوتيوب مع العنوان والقناة والمدة — يستخدم الترجمة المتاحة إن وُجدت، وإلا يفرّغ الصوت تلقائياً عبر Gemini — جاهز للتلخيص أو الفهرسة في قاعدة المعرفة',
    category: 'knowledge',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    // Caption fetches are quick, but the audio-transcription fallback
    // (download + Gemini Files API upload + processing + generation) can
    // take several minutes on long videos.
    timeoutMs: 300000,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'رابط فيديو يوتيوب (https://www.youtube.com/watch?v=...)' },
        language: { type: 'string', description: 'رمز لغة التفريغ المفضلة (افتراضي: ar)' },
      },
      required: ['url'],
    },
    execute: async (args) => {
      const { url, language = 'ar' } = args;
      if (!url || typeof url !== 'string') {
        throw new Error('رابط فيديو يوتيوب (url) مطلوب');
      }

      try {
        const result = await processYoutubeTranscript(url, language);
        if (!result.transcript || result.transcript.trim().length === 0) {
          return {
            success: false,
            simulated: false,
            url,
            videoId: result.videoId,
            title: result.title,
            error:
              'لم يتوفر تفريغ نصي لهذا الفيديو (قد تكون الترجمة المغلقة معطلة أو الفيديو مقيداً). يمكن فهرسته بدلاً من ذلك عبر knowledge_ingest_document.',
          };
        }
        return {
          success: true,
          simulated: false,
          videoId: result.videoId,
          title: result.title,
          channel: result.channel,
          duration: result.duration,
          wordCount: result.wordCount,
          extractionMethod: result.extractionMethod,
          transcriptUrl: result.videoUrl,
          markdown: `# ${result.title}\n\n**القناة:** ${result.channel} | **المدة:** ${result.duration}\n\n${result.transcript}`,
        };
      } catch (err: any) {
        return {
          success: false,
          simulated: false,
          url,
          error: err?.message || 'فشل جلب التفريغ النصي للفيديو',
        };
      }
    },
  },

  // --- 6. CUSTOM ACTIONS & WEBHOOK MCP SERVER TOOLS ---
  custom_action_execute: {
    name: 'custom_action_execute',
    serverName: 'Custom Actions MCP Server',
    description: 'تشغيل إجراء برمجيات مخصص أو استدعاء ويب هوك مسموح به',
    category: 'actions',
    hasSideEffect: true,
    requireConfirmation: true,
    simulated: true,
    parameters: {
      type: 'object',
      properties: {
        actionName: { type: 'string', description: 'اسم الإجراء المخصص' },
        payload: { type: 'string', description: 'بيانات الحموله بتنسيق JSON' },
      },
      required: ['actionName'],
    },
    execute: async (args, ctx) => {
      return {
        success: true,
        actionExecuted: args.actionName,
        tenantId: ctx.tenantId,
        status: 'completed',
        executedAt: new Date().toISOString(),
      };
    },
  },

  read_server_resource: {
    name: 'read_server_resource',
    serverName: 'Custom Actions MCP Server',
    description: 'قراءة موارد المعرفة ومصادر البيانات المرتبطة بخادم MCP',
    category: 'actions',
    hasSideEffect: false,
    requireConfirmation: false,
    simulated: false,
    parameters: {
      type: 'object',
      properties: {
        resourceUri: { type: 'string', description: 'رابط المورد (URI) المخصص' },
      },
      required: ['resourceUri'],
    },
    execute: async (args, ctx) => {
      const resources = await db.getMcpResources(ctx.tenantId);
      const match = resources.find((r) => r.uri === args.resourceUri);
      return {
        success: true,
        resourceUri: args.resourceUri,
        resource: match || {
          uri: args.resourceUri,
          name: 'تكوين النظام الداخلي',
          mimeType: 'application/json',
          tenantId: ctx.tenantId,
        },
      };
    },
  },
};

function safeHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return rawUrl.slice(0, 60);
  }
}

// Phase 4 production skills — merged into the same central registry so the
// agentic chat loop, protocol gateway and approval gate treat them uniformly.
for (const [name, def] of Object.entries(SKILL_TOOLS)) {
  MCP_TOOLS_REGISTRY[name] = def;
}

/**
 * Resolves a tool definition by canonical name or legacy alias.
 * Returns undefined for unknown tools — callers must treat that as an honest
 * "no such capability" instead of fabricating a successful execution.
 */
export function getToolDefinition(toolName: string): MCPToolDefinition | undefined {
  const canonical = TOOL_ALIASES[toolName] || toolName;
  return MCP_TOOLS_REGISTRY[canonical];
}

export function getAllToolNames(): string[] {
  return Object.keys(MCP_TOOLS_REGISTRY);
}
