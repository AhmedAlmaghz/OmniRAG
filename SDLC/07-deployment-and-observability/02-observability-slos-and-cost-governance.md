# Observability, SLOs, and Cost Governance

> تتبع هذه الوثيقة القسم الأول المتعلق بالبيئات وخطوط CI/CD: [Environments, CI/CD, and Deployment](./01-environments-ci-cd-and-deployment.md).

---

## 1. الرؤية والغرض

تُحدد هذه الوثيقة الركائز التشغيلية الثلاث لـ **OmniRAG**:

1. **القابلية للرصد (Observability):** سجلات + آثار + مقاييس + تتبع وكلاء (Agent Telemetry).
2. **أهداف مستوى الخدمة (SLOs):** اتفاقيات قابلة للقياس مع المستخدمين، مع تنبيهات مرتبطة.
3. **حوكمة التكلفة (Cost Governance):** ميزانيات شهرية لكل طبقة + إنذارات مبكرة + توجيه ذكي للنماذج.

التطبيق يستهدف نشر **مؤسسي واسع النطاق** بمستوى جودة **مؤسسي صارم**، مع التزامات GDPR وHIPA وPCI على بيانات المستندات والمحادثات.

---

## 2. ركائز الرصد الثلاث (Three Pillars) في OmniRAG

### 2.1 خريطة الإشارات حسب المكوّن

| الإشارة | المصدر | الأداة | الاحتفاظ |
|---|---|---|---|
| **سجلات منظمة (JSON Logs)** | Next.js Server/Edge Functions، Inngest، Vercel Functions | Vercel Logs + Logflare → BigQuery | 30 يوم (ساخن) + 1 سنة (بارد) |
| **آثار موزعة (Traces)** | OpenTelemetry SDK عبر API، MCP Gateway، RAG Pipeline، استدعاءات LLM | OpenTelemetry Collector → Honeycomb | 14 يوم |
| **مقاييس (Metrics)** | Prometheus client في كل خدمة + Vercel Metrics | Prometheus → Grafana Cloud | 90 يوم |
| **تتبع الوكلاء (Agent Telemetry)** | حقل `onStepStart`/`onStepFinish` في `AgenticRAGEngine` | جدول `agent_runs` في Neon Postgres + تصدير إلى BigQuery | 90 يوم |
| **تدقيق MCP (Audit)** | `MCPAuditLogger.log` | جدول `mcp_tool_calls` | 180 يوم (متوافق مع متطلبات التدقيق المؤسسي) |
| **سجلات تدقيق الوصول (Access Audit)** | Middleware المصادقة + استعلامات RLS | جدول `access_audit_log` | 1 سنة |

### 2.2 معرف الارتباط (Correlation ID)

**يُولّد `trace_id` لكل طلب** بصيغة W3C `traceparent` ويُمرَّر عبر:

```
Client Request
   │
   ▼
HTTP Header: traceparent → Next.js Edge Middleware
   │
   ├─→ Server Action → OpenTelemetry Span: "rag.query"
   │       │
   │       ├─→ Span: "embedding.generate" (gemini-embedding-2)
   │       ├─→ Span: "qdrant.search" (ANN)
   │       ├─→ Span: "postgres.fts" (BM25)
   │       ├─→ Span: "rrf.fusion"
   │       └─→ Span: "llm.generate" (gemini-3.5-flash-lite | gemini-3.6-flash)
   │
   ├─→ MCP Gateway → Span: "mcp.call" → Span: "mcp.notion.fetch_page"
   │
   └─→ جداول Neon: عمود trace_id في messages, agent_runs, mcp_tool_calls
```

**معيار القبول:** كل سجل خطأ في الإنتاج يجب أن يحتوي على `trace_id` و`tenant_id` و`request_id`. يتم رفض أي نشر يفشل هذا التحقق في خط أنابيب CI.

---

## 3. تتبعات الوكلاء (Agent Telemetry) — ركيزة خاصة بـ OmniRAG

نظراً لاعتماد OmniRAG على **Agentic RAG + MCP**، يُسجَّل كل تكرار (iteration) في حلقة الوكيل بشكل منظم.

### 3.1 مخطط جدول `agent_runs`

```sql
CREATE TABLE agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    conversation_id UUID NOT NULL,
    message_id UUID NOT NULL,
    trace_id TEXT NOT NULL,
    
    -- إعدادات التشغيل
    model TEXT NOT NULL,                 -- gemini-3.5-flash-lite | gemini-3.6-flash
    mode TEXT NOT NULL,                  -- private | hybrid | general | analysis | agentic
    max_iterations INTEGER NOT NULL,
    
    -- نتائج كل خطوة (JSONB Array)
    steps JSONB NOT NULL DEFAULT '[]',
    -- كل عنصر: {iteration, type: 'plan'|'tool_call'|'llm_generate',
    --           tool_name?, input?, output?, latency_ms, tokens_used, error?}
    
    -- ملخص التنفيذ
    total_iterations INTEGER NOT NULL,
    tools_used TEXT[] DEFAULT '{}',
    total_latency_ms INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
    
    -- الحالة
    status TEXT NOT NULL DEFAULT 'success', -- success | error | timeout | user_cancelled
    finish_reason TEXT,                  -- end_turn | max_iterations | tool_error | safety
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_runs_tenant_date ON agent_runs(tenant_id, created_at DESC);
CREATE INDEX idx_agent_runs_trace ON agent_runs(trace_id);
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
```

### 3.2 المقاييس المستخرجة من `agent_runs`

| المقياس | الصيغة | مصدر البيانات | الغرض |
|---|---|---|---|
| `agent.iterations.avg` | متوسط `total_iterations` لكل تشغيل | `agent_runs` | كشف الانحرافات في تعقيد المهام |
| `agent.tools.usage_topk` | أعلى 10 أدوات استخداماً | `agent_runs.tools_used` | تحسين السجلات |
| `agent.hallucination_rate` | نسبة الرسائل بدون citations | `messages.citations` | مقياس الجودة |
| `agent.confirmation_rate` | نسبة تأثيرات جانبية التي وافق عليها المستخدم | `mcp_tool_calls.user_confirmed` | ضبط سياسة Side Effects |
| `agent.cost_per_query` | متوسط `cost_usd` لكل رسالة | `agent_runs` | تخصيص التكلفة لكل مستأجر |

---

## 4. السجلات المنظمة (Structured Logs)

### 4.1 مخطط السجل الموحد (Log Schema v1)

```typescript
// /lib/observability/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: {
    service: 'omnirag',
    env: process.env.VERCEL_ENV ?? 'development',
    version: process.env.APP_VERSION ?? 'dev',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // حقول إلزامية في كل سجل:
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    '*.password',
    '*.apiKey',
    '*.accessToken',
    '*.refreshToken',
    'mcp.params.credentials',
  ],
});
```

**الحقول الإلزامية في كل سجل إنتاج:**

| الحقل | النوع | الوصف |
|---|---|---|
| `timestamp` | ISO-8601 | وقت الحدوث (UTC) |
| `level` | enum | debug / info / warn / error / fatal |
| `service` | string | اسم الخدمة (omnirag-api, omnirag-worker, omnirag-mcp) |
| `trace_id` | string | معرف الارتباط W3C |
| `span_id` | string | معرف المرحلة الحالية |
| `tenant_id` | UUID | معرف المستأجر (مُعلَّم عند وجوده) |
| `user_id` | UUID | معرف المستخدم (مُعلَّم عند وجوده) |
| `request_id` | string | معرف فريد لكل طلب HTTP |
| `route` | string | مسار API |
| `latency_ms` | number | زمن التنفيذ (إن كان متاحاً) |
| `status_code` | number | كود HTTP أو كود خطأ داخلي |
| `error.code` | string | رمز الخطأ الموحد |
| `error.message` | string | رسالة الخطأ (بعد التعقيم) |
| `error.stack` | string | تتبع المكدس (لـ error/fatal فقط) |

### 4.2 مستويات السجل والضوضاء

| المستوى | الاستخدام | معدل العينات |
|---|---|---|
| `debug` | تشخيص المطورين فقط | 0% في الإنتاج (يُفعَّل يدوياً) |
| `info` | أحداث العمل العادية: تسجيل دخول، استيعاب مستند، استعلام مكتمل | 100% |
| `warn` | حالات قابلة للاسترداد: إعادة محاولة، تجاوز Rate Limit، Rerank fallback | 100% |
| `error` | فشل طلب أو ميزة دون انقطاع الخدمة | 100% + تنبيه |
| `fatal` | انقطاع الخدمة أو فقدان بيانات | 100% + تنبيه فوري |

---

## 5. المقاييس (Metrics) — كتالوج Golden Signals

### 5.1 المقاييس الأساسية لكل خدمة

| الفئة | المقياس | النوع | الوصف |
|---|---|---|---|
| **Latency** | `http_request_duration_seconds` | Histogram | زمن استجابة جميع نقاط نهاية API |
| | `rag_pipeline_duration_seconds` | Histogram | زمن خط أنابيب RAG من الاستعلام حتى أول رمز |
| | `llm_time_to_first_token_ms` | Histogram | زمن وصول أول رمز من النموذج |
| | `mcp_call_duration_seconds` | Histogram | زمن استدعاء أداة MCP |
| | `ingestion_duration_seconds` | Histogram | زمن معالجة مستند كامل |
| **Traffic** | `http_requests_total{route, status}` | Counter | عدد الطلبات |
| | `chat_messages_total{mode, model}` | Counter | رسائل المحادثة |
| | `mcp_tool_calls_total{tool, status}` | Counter | استدعاءات أدوات MCP |
| | `documents_ingested_total{engine, type}` | Counter | المستندات المُستوعبة |
| **Errors** | `http_errors_total{route, code}` | Counter | الأخطاء بم codes موحدة |
| | `llm_errors_total{model, code}` | Counter | أخطاء النماذج |
| | `qdrant_errors_total{operation}` | Counter | أخطاء قاعدة المتجهات |
| | `ingestion_failures_total{stage}` | Counter | فشل مراحل الاستيعاب |
| **Saturation** | `neon_db_connections_active` | Gauge | اتصالات Postgres النشطة |
| | `qdrant_collections_total` | Gauge | عدد المجموعات |
| | `vercel_function_concurrent_executions` | Gauge | التنفيذ المتزامن |
| | `agent_iterations_per_run` | Histogram | توزيع تكرارات الوكيل |

### 5.2 رموز الأخطاء الموحدة (Error Code Catalog)

| الرمز | المعنى | الإجراء |
|---|---|---|
| `AUTH_INVALID_TOKEN` | رمز JWT منتهي أو مزور | 401 |
| `AUTH_TENANT_MISMATCH` | محاولة وصول بين مستأجرين | 403 + تنبيه فوري |
| `RLS_DENIED` | انتهاك Row-Level Security | 403 |
| `RATE_LIMIT_EXCEEDED` | تجاوز الحد المسموح | 429 |
| `EMBEDDING_TIMEOUT` | فشل gemini-embedding-2 | إعادة محاولة مع backoff |
| `QDRANT_UNAVAILABLE` | قاعدة المتجهات غير متاحة | تنبيه + Fallback إلى Postgres FTS |
| `LLM_CONTEXT_TOO_LONG` | تجاوز نافذة السياق | تلخيص + إعادة المحاولة |
| `LLM_SAFETY_BLOCKED` | حجب من مرشحات الأمان | إبلاغ المستخدم |
| `MCP_AUTH_EXPIRED` | رمز OAuth لخادم MCP منتهي | إعادة المصادقة |
| `MCP_SIDE_EFFECT_DENIED` | رفض المستخدم لتأثير جانبي | تسجيل + استمرار |
| `INGESTION_OCR_FAILED` | فشل OCR | Fallback إلى محرك آخر |
| `INGESTION_TIMEOUT` | تجاوز مهلة المعالجة | إعادة جدولة |

---

## 6. أهداف مستوى الخدمة (SLOs)

### 6.1 مصفوفة SLOs لـ OmniRAG

| الخدمة | المقياس | الهدف | نافذة القياس | خطأ الميزانية (EB) |
|---|---|---|---|---|
| **API العامة** | Availability (طلبات 2xx/3xx) | **99.9%** | 30 يوم متدرج | 0.1% = ~43 دقيقة/شهر |
| **API العامة** | Latency p95 (`POST /api/chat/completions` حتى أول رمز) | **≤ 1.8 ثانية** | 28 يوم | 5% |
| **API العامة** | Latency p99 (نفس المسار) | **≤ 3.5 ثانية** | 28 يوم | 1% |
| **RAG Pipeline** | Retrieval Recall@10 (مُقاس بمجموعة تقييم) | **≥ 0.85** | أسبوعي | 10% |
| **RAG Pipeline** | Citation Coverage (إجابات بـ citations) | **≥ 95%** | 7 أيام | 5% |
| **Ingestion** | نسبة نجاح الاستيعاب | **≥ 99%** | 7 أيام | 1% |
| **Ingestion** | زمن p95 لاستيعاب PDF (≤ 50 صفحة) | **≤ 45 ثانية** | 7 أيام | 5% |
| **MCP Gateway** | Availability لطلبات `tools/call` | **99.5%** | 30 يوم | 0.5% |
| **MCP Gateway** | Latency p95 لاستدعاء أداة | **≤ 2.5 ثانية** | 28 يوم | 5% |
| **Auth & RLS** | زمن التحقق من المستأجر p95 | **≤ 50 مللي ثانية** | 7 أيام | 1% |

### 6.2 مؤشرات مستوى الخدمة (SLIs) — كيفية القياس

| SLI | طريقة الحساب | مصدر البيانات |
|---|---|---|
| **Availability** | `sum(rate(http_requests_total{status!~"5.."}[28d])) / sum(rate(http_requests_total[28d]))` | Prometheus |
| **Latency p95** | `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))` | Prometheus |
| **Retrieval Recall@10** | تشغيل يومي على مجموعة تقييم 200 استعلام مع إجابات مُعتمدة | مهلة Inngest + جدول `eval_results` |
| **Citation Coverage** | نسبة الرسائل في آخر 7 أيام التي لديها `citations` غير فارغة | استعلام Neon Postgres |

### 6.3 سياسات تنبيه SLO (Alerting Policies)

| الفئة | الحالة | الإجراء | القناة | المستلم |
|---|---|---|---|---|
| **استهلاك EB** | EB مُستهلك بنسبة 50% خلال 28 يوم | تنبيه تحذيري | Slack + Email | فريق SRE |
| **استهلاك EB** | EB مُستهلك بنسبة 75% | تنبيه عاجل | PagerDuty + Slack | مهندس متاح |
| **استهلاك EB** | EB مُستهلك بنسبة 100% (انتهاك SLO) | تجميد النشر التلقائي + P1 | PagerDuty + Slack | قائد SRE |
| **Burn Rate عالي** | معدل استهلاك EB > 14.4× خلال 1 ساعة (سيرفر SLO سريع الانتهاك) | P2 فوري | PagerDuty | مهندس متاح |
| **Burn Rate عالي** | معدل استهلاك EB > 6× خلال 6 ساعات | P3 | Slack | فريق SRE |
| **خطأ 5xx** | > 0.5% من الطلبات لمدة 5 دقائق | P2 | PagerDuty | مهندس متاح |
| **p95 Latency** | تجاوز 1.5× الهدف لمدة 10 دقائق | P3 | Slack | فريق SRE |

**صيغة Burn Rate المعتمدة:** نافذة قصيرة (1 ساعة) × 14.4 + نافذة طويلة (6 ساعات) × 6 — متوافق مع منهجية Google SRE Workbook.

---

## 7. حوكمة التكلفة (Cost Governance)

### 7.1 تصنيف التكلفة حسب الطبقة

| الطبقة | البند | مالك التكلفة | طريقة القياس |
|---|---|---|---|
| **النماذج** | `gemini-embedding-2` | فريق AI | رموز مُدخلة × سعر/1M رمز |
| | `gemini-3.5-flash-lite` | فريق AI | رموز مُدخلة + مُخرجة |
| | `gemini-3.6-flash` | فريق AI | رموز مُدخلة + مُخرجة |
| **معالجة المستندات** | Mistral Document AI | فريق المنتج | صفحات × سعر/صفحة |
| | Unstructured Transform | فريق المنتج | ملفات × سعر/ملف |
| **البنية التحتية** | Vercel Functions | فريق المنصة | GB-seconds + invocations |
| | Vercel Edge | فريق المنصة | requests + CPU time |
| | Vercel KV | فريق المنصة | GB-hours + ops |
| | Vercel Blob | فريق المنصة | GB stored + bandwidth |
| **قواعد البيانات** | Neon Postgres | فريق المنصة | Compute-hours + storage |
| | Qdrant Cloud | فريق المنصة | vectors stored + queries |
| **التكاملات** | استدعاءات MCP خارجية | فريق المنتج | حسب مزود |
| | OAuth Providers | فريق المنتج | حسب خطة |

### 7.2 الميزانيات الشهرية والحدود

| البند | الميزانية الشهرية | الحد الصلب | إجراء التجاوز |
|---|---|---|---|
| **إجمالي Gemini API** | $4,000 | $5,500 | تبديل تلقائي لـ Flash-Lite فقط |
| **معالجة المستندات** | $1,200 | $1,800 | إيقاف الاستيعاب التلقائي + تنبيه |
| **Vercel** | $800 | $1,200 | ترقية الخطة أو تقليل Edge |
| **Qdrant** | $500 | $750 | أرشفة المجموعات غير النشطة |
| **Neon** | $400 | $600 | تقليص compute |
| **MCP + تكاملات** | $600 | $900 | تعطيل الخوادم غير الأساسية |

### 7.3 التوجيه الذكي للنماذج (Smart Model Routing) — أداة التحكم في التكلفة

```typescript
// /lib/llm/router.ts
// يُحقق وفرة 60-70% في تكاليف Gemini مقارنة بالاستخدام الأحادي

export async function routeModel(params: {
  prompt: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  mode: 'private' | 'hybrid' | 'general' | 'analysis' | 'agentic';
  tenantTier: 'free' | 'pro' | 'enterprise';
}): Promise<'gemini-3.5-flash-lite' | 'gemini-3.6-flash'> {
  
  // قواعد التوجيه:
  // 1. المستخدمون في الخط المجاني → Flash-Lite دائماً
  // 2. وضع analysis أو agentic + tokens > 8000 → Flash
  // 3. وضع private/hybrid + tokens ≤ 4000 → Flash-Lite
  // 4. خلاف ذلك → Flash-Lite (الافتراضي)
  
  if (params.tenantTier === 'free') return 'gemini-3.5-flash-lite';
  
  const needsDeepReasoning = 
    params.mode === 'analysis' || 
    params.mode === 'agentic' ||
    params.estimatedInputTokens > 8000;
  
  if (needsDeepReasoning) return 'gemini-3.6-flash';
  
  // تجاوز المستخدم اليدوي محفوظ في params.userPreference
  return 'gemini-3.5-flash-lite';
}
```

### 7.4 لوحات Grafana للتكلفة

| اللوحة | المقاييس | التكرار |
|---|---|---|
| **Cost by Service** | `cost_usd_total{service}` | يومي |
| **Cost per Tenant** | Top 20 مستأجرين استهلاكاً | يومي |
| **Cost per Conversation** | متوسط تكلفة المحادثة | يومي |
| **Model Mix Ratio** | نسبة Flash-Lite إلى Flash | أسبوعي |
| **Embedding Cost Trend** | تكلفة التضمين يومياً | يومي |
| **Forecast vs Budget** | الإنفاق المتوقع مقابل الميزانية | كل 6 ساعات |
| **MCP Cost Breakdown** | تكلفة كل خادم MCP | أسبوعي |

### 7.5 آلية Capping لكل مستأجر (Tenant Cost Caps)

| الطبقة | حد يومي | حد شهري | الإجراء عند التجاوز |
|---|---|---|---|
| **Free** | $0.50 | $5 | رفض الطلب + رسالة واضحة |
| **Pro** | $10 | $200 | تنبيه للمستخدم + موافقة |
| **Enterprise** | قابل للتفاوض | قابل للتفاوض | تنبيه للإدارة فقط |

**معيار القبول:** يجب أن يكون كل مستأجر قادراً على رؤية استهلاكه المباشر عبر `/analytics` وتصديره كـ CSV.

---

## 8. التنبيهات المتقدمة (Advanced Alerts)

### 8.1 تنبيهات الأمان والامتثال (مُعززة لـ GDPR/HIPA/PCI)

| التنبيه | الحالة | الإجراء | الأهمية |
|---|---|---|---|
| **محاولة اختراق RLS** | 3+ محاولات `AUTH_TENANT_MISMATCH` لنفس IP في 5 دقائق | حظر IP + P1 | حرجة |
| **استعلام بيانات حساسة خارج النطاق** | أي استعلام على جداول PHI/PII خارج ساعات العمل المعتمدة | P2 | عالية |
| **تسريب أسرار في السجلات** | كشف نمط API Key أو Token في حقل `redact` | P1 + إبطال فوري | حرجة |
| **محاولة Prompt Injection** | نمط مكتشف في مدخلات المستخدم | تسجيل + P3 | متوسطة |
| **تصدير بيانات جماعي** | طلب `exportData` لـ > 1000 سجل | تأكيد يدوي + P3 | متوسطة |
| **حذف حساب** | أي استدعاء لـ `deleteAccount` | تأكيد يدوي + تدقيق | عالية |

### 8.2 تنبيهات صحة النظام

| التنبيه | الحالة | الإجراء |
|---|---|---|
| **استهلاك EB سريع** | > 14.4× خلال ساعة | P2 فوري |
| **ارتفاع p95 latency** | > 1.5× الهدف لمدة 10 دقائق | P3 |
| **فشل MCP متعدد** | > 30% من خوادم MCP في حالة `down` | P2 |
| **Qdrant بطيء** | p95 query > 500ms لمدة 5 دقائق | P3 |
| **Neon CPU > 80%** | لمدة 10 دقائق | P3 + ترقية |
| **Ingestion queue backlog** | > 1000 مهمة معلقة لمدة 15 دقيقة | P2 |
| **Agent loops** | تشغيل يتجاوز max_iterations | تسجيل + مراجعة |

---

## 9. التقييمات (Evals) — عقد الجودة غير القطعي

**Tests تتحقق من الأجزاء القطعية، Evals تتحقق من السلوك غير القطعي** (جودة الإجابات، دقة الاسترجاع، هلوسة النماذج).

### 9.1 مجموعات التقييم الدائمة

| المجموعة | الحجم | التحديث | التشغيل |
|---|---|---|---|
| **Retrieval Golden Set** | 200 استعلام مع إجابات مُعتمدة | شهرياً | يومياً 03:00 UTC |
| **Arabic Quality Set** | 100 استعلام عربي مع توقعات | شهرياً | يومياً |
| **English Quality Set** | 100 استعلام إنجليزي | شهرياً | يومياً |
| **Citation Accuracy Set** | 50 استعلام للتحقق من دقة المراجع | شهرياً | أسبوعياً |
| **MCP Tool Selection Set** | 50 سيناريو لوكلاء | ربع سنوي | أسبوعياً |
| **Safety & Refusal Set** | 50 حالة اختبار | شهرياً | يومياً |
| **Hallucination Probe Set** | 75 استعلام محرج | شهرياً | يومياً |

### 9.2 تقييمات LM-as-a-Judge

```typescript
// /evals/judges/answer-quality.ts
// يحكم نموذج LM (gemini-3.6-flash) على جودة الإجابة

export const answerQualityJudge = {
  model: 'gemini-3.6-flash',
  rubric: {
    faithfulness: 'هل الإجابة مدعومة فقط بالمعلومات من المصادر؟',
    relevance: 'هل الإجابة تعالج الاستعلام بدقة؟',
    completeness: 'هل الإجابة شاملة بما يكفي؟',
    citation_accuracy: 'هل كل ادعاء يستشهد بمصدر صحيح؟',
    language_appropriateness: 'هل اللغة مناسبة للسؤال؟',
    safety_compliance: 'هل الإجابة خالية من المحتوى الضار؟',
  },
  scale: { min: 1, max: 5 },
  passing_threshold: 4.0, // المتوسط يجب أن يكون ≥ 4.0
};
```

### 9.3 بوابة الجودة في CI/CD

**يُمنع النشر إلى Production إذا:**

| الفحص | العتبة | الفشل |
|---|---|---|
| Retrieval Recall@10 | ≥ 0.85 | ✅ / ❌ |
| Faithfulness Score | ≥ 4.0 (LM judge) | ✅ / ❌ |
| Citation Accuracy | ≥ 90% | ✅ / ❌ |
| Hallucination Rate | ≤ 5% | ✅ / ❌ |
| p95 Latency E2E | ≤ 1800ms | ✅ / ❌ |
| PII Detection FP Rate | ≤ 2% | ✅ / ❌ |

---

## 10. لوحة المعلومات المؤسسية (Executive Dashboard)

### 10.1 الأقسام الرئيسية في Grafana

```
┌─────────────────────────────────────────────────────────────┐
│                  OmniRAG — لوحة SRE                         │
├─────────────────────────────────────────────────────────────┤
│  AVAILABILITY                                               │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────┐  │
│  │ API: 99.94% │ │RAG: 99.91%  │ │ MCP: 99.62% ⚠️       │  │
│  │ EB: 37%     │ │ EB: 41%     │ │ EB: 76%              │  │
│  └─────────────┘ └─────────────┘ └──────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  LATENCY (p95)                                              │
│  Chat: 1.4s ✅ │ RAG: 620ms ✅ │ MCP: 1.8s ✅ │ Embed: 180ms│
├─────────────────────────────────────────────────────────────┤
│  COST (Month-to-Date)                                       │
│  Gemini: $2,847/$4,000 (71%) ✅ │ Docs: $612/$1,200 (51%)│
│  Vercel: $423/$800 (53%) ✅ │ Qdrant: $289/$500 (58%)   │
├─────────────────────────────────────────────────────────────┤
│  QUALITY (Evals — 24h)                                      │
│  Recall@10: 0.87 ✅ │ Faithfulness: 4.2 ✅ │ Cites: 96% ✅ │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 المقاييس المعروضة لكل مستأجر (Tenant Self-Service)

- استخدام API خلال 24 ساعة / 7 أيام / 30 يوم
- نسبة Flash-Lite إلى Flash
- توزيع زمن الاستجابة p50/p95/p99
- الميزانية المتبقية
- عدد أخطاء 4xx/5xx الأخيرة
- صحة خوادم MCP المتصلة

---

## 11. التكامل مع النظام البيئي

### 11.1 مصدّر OpenTelemetry الموحد

```typescript
// /lib/observability/otel.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

const sdk = new NodeSDK({
  serviceName: 'omnirag',
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),
  metricReader: new PrometheusExporter(),
  instrumentations: [
    new HttpInstrumentation(),
    new IORedisInstrumentation(),
    new PostgresInstrumentation(),
    new GraphQLInstrumentation(),
  ],
});

sdk.start();
```

### 11.2 ربط CI/CD بالملاحظة (CI/CD Observability Integration)

| المرحلة | الربط |
|---|---|
| **PR** | نشر Preview → تشغيل Evals → نشر التعليقات على PR |
| **Merge to main** | نشر Staging → Smoke tests + Evals |
| **Promotion to Production** | نشر تدريجي 10% → 50% → 100% مع مراقبة Burn Rate |
| **Rollback** | عند انتهاك SLO → Vercel rollback تلقائي + P1 |

---

## 12. معايير القبول (Acceptance Criteria)

### 12.1 قبول المرحلة (Production Readiness Checklist)

- [ ] جميع الخدمات تصدر مقاييس Prometheus بأسماء موحدة
- [ ] كل سجل في الإنتاج يحتوي على `trace_id` و`tenant_id` (للطلبات المصادق عليها)
- [ ] OpenTelemetry Collector يعمل ويجمع 95%+ من الآثار
- [ ] لوحات Grafana الثلاثة الرئيسية (SLO, Cost, Quality) منشورة
- [ ] تنبيهات PagerDuty مفعلة مع سياسة Escalation
- [ ] SLOs مُعرَّفة في ملف `slo.yaml` وتُحفظ في Git
- [ ] Evals تعمل يومياً وتُبلّغ إلى Slack `#ai-quality`
- [ ] ميزانيات التكلفة مُعرَّفة في `cost-budgets.yaml` ومرتبطة بتنبيهات
- [ ] دليل Incident Response موجود في `/runbooks/`
- [ ] اختبار Game Day مُنفَّذ ربع سنوياً (استعادة كاملة من حادثة SLO)

### 12.2 معايير الرفض (أي عنصر يفشل = تأخير النشر)

- عدم وجود `trace_id` في ≥ 5% من السجلات
- تجاوز p95 latency للهدف بنسبة 25% خلال آخر 7 أيام
- تجاوز الميزانية الشهرية بنسبة 90% قبل اليوم 25
- تقييم Faithfulness < 4.0 في آخر تشغيل
- غياب توثيق Runbook لأي تنبيه P1/P2

---

## 13. حوكمة البيانات والامتثال (Data Governance)

### 13.1 سياسات الاحتفاظ

| نوع البيانات | الساخن | البارد | الحذف |
|---|---|---|---|
| **السجلات التطبيقية** | 30 يوم في Hot storage | 1 سنة في Cold storage (BigQuery) | حذف تلقائي |
| **الآثار (Traces)** | 14 يوم | لا يُحفظ | حذف تلقائي |
| **سجلات التدقيق (Access Audit)** | 90 يوم | 1 سنة (WORM Storage) | حذف يدوي بعد موافقة |
| **محادثات المستخدمين** | حسب إعداد `dataRetention` للمستخدم | — | حذف ناعم ثم صلب بعد 30 يوم |
| **سجلات MCP Calls** | 180 يوم | — | حذف تلقائي |
| **Agent Runs** | 90 يوم | — | حذف تلقائي |

### 13.2 دعم GDPR وHIPA وPCI

| الالتزام | التطبيق في الرصد |
|---|---|
| **حق الحذف (GDPR Art. 17)** | عند `deleteAccount`: حذف فوري لجميع السجلات والـ traces والـ agent_runs عبر job في Inngest |
| **حق الوصول (GDPR Art. 15)** | `/settings/export` يُصدّر جميع السجلات بصيغة JSON + CSV |
| **تشفير البيانات** | جميع المتغيرات البيئية والأسرار في السجلات مُحوَّلة عبر `redact` |
| **سجل الوصول لـ PHI (HIPA)** | كل قراءة لبيانات حساسة تُسجَّل في `access_audit_log` |
| **عزل بيانات PCI** | لا تُسجَّر أرقام البطاقات أبداً في السجلات أو Traces |
| **تدقيق الوصول (HIPA §164.312(b))** | تقارير تدقيق ربع سنوية تلقائية |

---

## 14. ربط بخطوط CI/CD (Cross-References)

| الموضوع | القسم المرجعي |
|---|---|
| **Promote / Rollback** | [Environments, CI/CD, and Deployment](./01-environments-ci-cd-and-deployment.md) — القسم 4 (نموذج Promotion) |
| **Canary Monitoring** | نفس الملف — القسم 5 (Rollback Strategy) |
| **Environment Tags** | نفس الملف — القسم 2 (Environment Matrix) |

---

> **متابعة:** هذا القسم يُكمل دورة حياة النشر من القسم الأول. أي انتهاك SLO أثناء النشر يُفعّل Rollback تلقائي عبر آلية PagerDuty + Vercel Aliases الموضحة في القسم السابق.