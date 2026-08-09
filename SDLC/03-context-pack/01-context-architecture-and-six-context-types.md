# Context Architecture and Six Context Types

> يُحدد هذا القسم البنية السياقية لـ **OmniRAG** عبر تطبيق نموذج الأنواع الستة للسياق (Instructions, Knowledge, Memory, Examples, Tools, Guardrails)، مع رسم حدود صارمة بين السياق **الثابت** (Static) والسياق **الديناميكي** (Dynamic) بما يضمن أعلى جودة مخرجات من وكلاء الذكاء الاصطناعي مع تحكم دقيق في الميزانية الرمزية.

---

## 1. فلسفة التصميم السياقي لـ OmniRAG

تعتمد OmniRAG نموذج **"الحدود الثابتة/الديناميكية"** (Static/Dynamic Boundary) لتقسيم السياق الممنوح للنماذج. الهدف: تحميل ثابت منخفض (يُحمل مرة واحدة لكل طلب)، وديناميكي عالي الدقة (يُسترجع حسب الحاجة فقط).

```
┌─────────────────────────────────────────────────────────────────────┐
│              🧠 سياق OmniRAG — الحدود بين الثابت والديناميكي       │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────┐               │
│  │   🔒 STATIC CONTEXT   │    │   🌊 DYNAMIC CONTEXT  │              │
│  │   (يُحمّل مرة واحدة) │    │   (يُسترجع عند الطلب) │              │
│  │                      │    │                       │              │
│  │  • AGENTS.md         │    │  • Skill Manifests    │              │
│  │  • Memory Files      │    │  • Retrieved Docs     │              │
│  │  • System Prompts    │    │  • Tool Schemas       │              │
│  │  • Tool Catalogs     │    │  • Examples Bank      │              │
│  │  • Guardrails Spec   │    │  • Live MCP Catalog   │              │
│  │                      │    │  • Conversation Hist. │              │
│  │  Budget: ~12K tokens │    │  Budget: متغير حسب    │              │
│  │  (ثابت لكل نموذج)   │    │  المهمة (حتى 200K)    │              │
│  └──────────────────────┘    └──────────────────────┘               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. مصفوفة الأنواع الستة للسياق في OmniRAG

| # | النوع (Type) | التعريف | المحتوى في OmniRAG | طبيعته | التخزين | ميزانية تقديرية |
|---|---|---|---|---|---|---|
| 1 | **Instructions** (التعليمات) | قواعد السلوك والشخصية وحدود الصلاحيات | `AGENTS.md`, `system-prompts/*.md`, `roles/*.md` | ثابت (Static) | Git + Vercel Edge KV | ~3K tokens |
| 2 | **Knowledge** (المعرفة) | وثائق معمارية، مراجع API، أدلة | `/docs/architecture/`, `/docs/api/`, مخططات Qdrant/Neon | ثابت مع تجزئة (Static + Chunked) | Vercel Blob + RAG Index | عند الطلب |
| 3 | **Memory** (الذاكرة) | تفضيلات المستخدم، تاريخ المحادثات، إعدادات | `users.settings` (JSONB), `messages`, `conversations.summary` | شبه ثابت (Semi-Static) | Neon Postgres + Vercel KV | ~1K tokens/طلب |
| 4 | **Examples** (الأمثلة) | حالات Few-Shot، مخرجات مرجعية، أنماط تكرار | `/examples/chat-modes/`, `/examples/tool-calls/`, `/examples/rag-eval/` | ثابت (Static) | Git + ذاكرة RAG | ~2K tokens/طلب |
| 5 | **Tools** (الأدوات) | مخططات MCP، إمكانيات الوظائف، عقود API | MCP Tool Registry, Function Schemas, OAuth configs | ديناميكي (Dynamic) | Neon + MCP Pool | ~4K tokens/طلب |
| 6 | **Guardrails** (الحواجز) | سياسات الأمان، حدود PII، قواعد الامتثال | `guardrails/policies/`, `redaction-rules/`, `compliance/`, RLS filters | ثابت (Static) | قاعدة بيانات + كود | ~2K tokens |

> **القاعدة الذهبية في OmniRAG**: كل ما هو ثابت يُحمَّل في `system prompt` و`AGENTS.md`؛ كل ما هو ديناميكي يُسترجع عبر Agent Skills (انظر [Agent Skills and Retrieval Strategy](./02-agent-skills-and-retrieval-strategy.md)) أو أدوات MCP.

---

## 3. تفصيل السياق الثابت (Static Context)

### 3.1 ملف `AGENTS.md` الجذري

الملف الرئيسي الذي يُقرأ في بداية كل جلسة وكلاء. يُوضع في جذر المستودع (`/AGENTS.md`).

```markdown
# AGENTS.md — OmniRAG Agent Constitution

## Mission
OmniRAG منصة Hybrid RAG ثنائية اللغة (عربية/إنجليزية) توفر استرجاعاً توليدياً 
آمناً ومعزولاً لكل مستخدم عبر 5 طبقات عزل.

## Identity
- اسم الكود: omnirag
- الإصدار: 2.0.0
- المواصفة: MCP 2026-07-28 (Stateless)

## Core Stack
- Frontend: Next.js 15+ (App Router, RSC, TypeScript)
- Backend: Next.js API Routes + Edge Functions
- DB: Neon Postgres (RLS) + Qdrant Cloud
- Models: gemini-embedding-2 | gemini-3.5-flash-lite | gemini-3.6-flash
- Queue: Inngest | Cache: Vercel KV | Storage: Vercel Blob
- Protocol: MCP 2026-07-28 (Streamable HTTP, Stateless)

## Non-Negotiable Rules
1. عزل المستأجر إلزامي — لا استعلام بدون tenant_id
2. RLS مفعل على كل الجداول الحساسة
3. لا أسرار في الكود — دائماً من Environment Variables
4. لا سجلات PII خام — إخفاء الهوية قبل التخزين
5. كل إجراء ذي أثر جانبي يتطلب تأكيد المستخدم
6. الالتزام بـ GDPR/HIPAA/PCI في كل ميزة
```

### 3.2 System Prompts حسب الدور

| الدور | الملف | الحجم التقريبي | الاستخدام |
|---|---|---|---|
| `RAG_ASSISTANT` | `system-prompts/rag-assistant.md` | ~800 tokens | وضع Private RAG |
| `AGENTIC_RAG` | `system-prompts/agentic-rag.md` | ~1.2K tokens | وضع Hybrid/Agentic |
| `DOC_PROCESSOR` | `system-prompts/doc-processor.md` | ~600 tokens | خط أنابيب الاستيعاب |
| `CHUNKING_AGENT` | `system-prompts/chunking-agent.md` | ~700 tokens | التقسيم الذكي |
| `QUERY_ANALYZER` | `system-prompts/query-analyzer.md` | ~500 tokens | تحليل النية والكيانات |
| `ARABIC_NORMALIZER` | `system-prompts/arabic-normalizer.md` | ~400 tokens | معالجة النص العربي |
| `EVAL_JUDGE` | `system-prompts/eval-judge.md` | ~900 tokens | تقييمات LM Judge |

### 3.3 كتالوج الأدوات الثابت (Static Tool Catalog)

كتالوج مختصر ومُختصر للأدوات الأساسية يُدمج دائماً في الـ system prompt:

```typescript
// يُولّد وقت البناء ويُحقن في كل طلب
export const STATIC_TOOL_CATALOG = {
  core: [
    'search_knowledge_base(query, topK)',
    'fetch_document(doc_id)',
    'list_collections()',
    'get_conversation_history(conv_id, last_n)',
  ],
  admin: [
    'create_collection(name, config)',
    'update_settings(key, value)',
    'export_user_data()', // GDPR
    'delete_user_data()', // GDPR
  ],
} as const;
```

> ملاحظة: الكتالوج الكامل للأدوات الخارجية (MCP) يُحمَّل ديناميكياً عند تفعيل الوكيل.

---

## 4. تفصيل السياق الديناميكي (Dynamic Context)

### 4.1 مصادر الاسترجاع الديناميكي

| المصدر | متى يُسترجع | مزود الاسترجاع | حجم الإرجاع |
|---|---|---|---|
| **Knowledge Base** (مستندات المستخدم) | عند كل استعلام RAG | Hybrid Search (Qdrant + Neon FTS) | 5–20 chunk |
| **MCP Tool Schemas** | عند تفعيل خوادم MCP نشطة | MCPClientPool.listTools() | 1–50 أداة |
| **Conversation History** | عند الاستمرار في محادثة | Neon Postgres + Vercel KV cache | آخر 10–20 رسالة |
| **User Settings** | عند كل طلب (مُكاش) | Vercel KV (TTL 5min) | JSONB واحد |
| **Examples (Few-Shot)** | عند نمط استعلام جديد | RAG over examples index | 2–5 أمثلة |
| **Live MCP Catalog** | عند اكتشاف خوادم جديدة | MCP Registry API | حسب الطلب |

### 4.2 استراتيجية التجميع الديناميكي (Dynamic Assembly)

```
طلب وارد
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│  Dynamic Context Assembler                                   │
│                                                              │
│  ① Budget Allocator                                          │
│     • يقرأ إعدادات النموذج (max_input_tokens)                │
│     • يخصم: Static Context (~12K)                            │
│     • يخصم: Reserved Output (e.g., 4K)                       │
│     • المتاح للديناميكي = max_input - 16K                    │
│                                                              │
│  ② Priority Queue                                            │
│     1. Conversation History (مُلخص)         → 1K tokens      │
│     2. User Settings (language, mode)        → 0.2K tokens   │
│     3. Retrieved Knowledge (Hybrid RAG)      → حتى 8K tokens │
│     4. Active MCP Tool Schemas              → حتى 4K tokens  │
│     5. Few-Shot Examples (مُختار)           → 0–2K tokens   │
│                                                              │
│  ③ Truncation & Compression                                  │
│     • Long history → Sliding window + Summary               │
│     • Many tools → Top-K relevance + names-only fallback     │
│     • Many chunks → Rerank + diversity (MMR)                 │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 حدود الاسترجاع (Retrieval Limits)

| المعامل | القيمة الافتراضية | قابل للتهيئة | الموقع |
|---|---|---|---|
| `topK` للبحث الدلالي | 10 | 1–20 | `users.settings.retrieval.topK` |
| `topK` للبحث المعجمي | 10 | 1–20 | `users.settings.retrieval.topK` |
| `maxContextChunks` المُجمَّع | 12 | 4–25 | `users.settings.retrieval.maxChunks` |
| `maxMCPConcurrentTools` | 8 | 1–20 | `users.settings.mcp.maxTools` |
| `maxHistoryMessages` | 10 | 0–50 | `users.settings.chat.historyDepth` |
| `examplesToRetrieve` | 3 | 0–8 | internal constant |

---

## 5. حدود الذاكرة (Memory Boundaries)

### 5.1 طبقات الذاكرة الأربع في OmniRAG

| الطبقة | النوع | النطاق | مدة البقاء | التخزين |
|---|---|---|---|---|
| **L1: Session Memory** | ديناميكي | محادثة واحدة | حتى الإغلاق | Vercel KV (TTL: 2h) |
| **L2: User Preferences** | شبه ثابت | المستخدم | دائم حتى الحذف | Neon `users.settings` (JSONB) |
| **L3: Conversation Summary** | شبه ثابت | محادثة | حتى الحذف اليدوي | Neon `conversations.summary` |
| **L4: Tenant Policy** | ثابت | المستأجر (Tenant) | دائم | Neon `tenant_policies` (JSONB) |

### 5.2 ما يُسمح بدخول الـ System Prompt (Static Memory)

| العنصر | يُسمح؟ | السبب |
|---|---|---|
| اسم المستخدم ولغة التفضيل | ✅ نعم | أساسي للاستجابة |
| إعدادات النموذج الافتراضي | ✅ نعم | ضروري للتوجيه |
| مفتاح API للـ Tenant (مُجزّأ) | ❌ لا | خطر تسرب — يُحقن في الخلفية فقط |
| سجل محادثات خام | ❌ لا | يتم التلخيص أولاً |
| نتائج بحث سابقة | ❌ لا | ديناميكي بالكامل |
| ملخص المحادثة الحالية | ✅ نعم (مُكاش) | يحافظ على السياق |

---

## 6. الحدود بين Knowledge Retrieval و Tool Calling

يجب التمييز الحاد بين المعرفة (Knowledge) والأدوات (Tools) لتجنب هدر الميزانية:

| المعيار | Knowledge (RAG) | Tools (MCP/API) |
|---|---|---|
| **المصدر** | مستندات المستخدم المفهرسة | خدمات خارجية حية |
| **التحديث** | عند إعادة الفهرسة | فوري (Live) |
| **الإفصاح عن الآثار الجانبية** | لا (قراءة فقط) | نعم (يجب الإفصاح) |
| **العزل** | عبر tenant_id في payload | عبر tenant_id + OAuth |
| **الميزانية الرمزية** | حصة كبيرة (~8K) | حصة أصغر (~4K) |
| **التخزين المؤقت** | Vercel KV (TTL 5min) | لا يُكاش (Stateless) |
| **مثال** | نتائج البحث في المستندات | إرسال رسالة Slack |

> **قاعدة الفصل**: إذا كان الإجراء يتطلب تغييراً في نظام خارجي، فهو **Tool**. إذا كان قراءة بيانات مفهرسة، فهو **Knowledge**.

---

## 7. أمان السياق وحماية PII (Guardrails Layer)

### 7.1 قائمة الفئات المحمية

| الفئة | مثال | الإجراء |
|---|---|---|
| **PII مباشرة** | اسم، بريد، هاتف، عنوان | إخفاء + تجزئة قبل التضمين |
| **PII مالية** | أرقام بطاقات، IBAN | لا تُخزن في الـ RAG أصلاً |
| **بيانات صحية** | تشخيصات، أدوية | فحص HIPAA — لا تخزين |
| **أسرار** | API keys، tokens | كاشف regex + رفض |
| **حقوق ملكية** | محتوى محمي | watermark في الـ metadata |

### 7.2 قواعد Guardrails الثابتة في السياق

```yaml
# /guardrails/policies/core.yaml — يُحمّل في كل طلب
content_safety:
  prompt_injection_detection: required
  jailbreak_attempts: block
  pii_in_output: redact

operational_safety:
  side_effect_confirmation: required
  destructive_actions: explicit_consent
  bulk_operations: rate_limited

compliance:
  gdpr:
    right_to_be_forgotten: enforced
    data_export: available
    consent_tracking: required
  hipaa:
    phi_detection: active
    audit_log: retained_7_years
  pci:
    card_data: never_stored
    payment_metadata: tokenized_only
```

### 7.3 Redaction Rules المدمجة في السياق

| النمط | الإجراء | الأسبقية |
|---|---|---|
| أرقام بطاقات ائتمان (16 رقم) | حذف كامل قبل التضمين | حرجة |
| أرقام IBAN | تجزئة (إبقاء آخر 4) | حرجة |
| أرقام الهواتف | تجزئة | عالية |
| عناوين البريد الإلكتروني | استبدال بـ `[EMAIL]` | عالية |
| أرقام الهوية الوطنية | حذف | حرجة |
| تواريخ الميلاد + أسماء | علامة `[REDACTED:PII]` | عالية |

---

## 8. حدود الميزانية الرمزية لكل طلب

### 8.1 ميزانية السياق حسب النموذج

| النموذج | نافذة السياق الكلية | حصة Static | حصة Dynamic | حصة Output |
|---|---|---|---|---|
| `gemini-embedding-2` | 8K (مدخل فقط) | 0 | 8K (النص المُضمَّن) | 0 |
| `gemini-3.5-flash-lite` | 1M | 12K | حتى 200K | 4K |
| `gemini-3.6-flash` | 1M | 12K | حتى 200K | 8K |

### 8.2 الأولوية عند تجاوز الميزانية (Priority Cascade)

```
إذا تجاوز الإجمالي → تطبيق الأولويات بالترتيب:
  ① تقليص Few-Shot Examples إلى 0 (أول من يُحذف)
  ② تقليص MCP Tool Schemas (الأقل استخداماً أولاً)
  ③ تقليص Retrieved Chunks (MMR diversity)
  ④ تقليص Conversation History (Sliding window)
  ⑤ تقليل max_output_tokens
  ❌ لا تُلمس Static Core أبداً (السلامة قبل الميزانية)
```

### 8.3 استثناءات ثابتة (Hard Exclusions)

ما **لا** يدخل السياق أبداً في OmniRAG:

- مفاتيح API، tokens OAuth، credentials (حتى المُشفَّرة)
- محتوى مُصنَّف كـ `sensitivity_level: critical`
- مستندات غير مفلترة بـ `tenant_id` (خطأ أمني)
- سجلات تدقيق خام (تُجمَّع فقط)
- محتوى يزيد عمره عن `data_retention_policy` المحدد
- نتائج استعلامات مستخدمين آخرين (انتهاك عزل)

> للتفاصيل الكاملة عن ميزانيات التوكنات ودورة حياة السياق وصيانته، راجع [Token Economics and Maintenance](./03-token-economics-and-maintenance.md).

---

## 9. معايير القبول (Acceptance Criteria)

لكي يُعتبر قسم بنية السياق مُنجزاً، يجب التحقق من:

### 9.1 معايير البنية

- [ ] ملف `AGENTS.md` موجود في جذر المستودع ولا يتجاوز 3K tokens
- [ ] كل دور وكلاء له ملف `system-prompts/<role>.md` محدد ومُراجع
- [ ] كتالوج الأدوات الثابت لا يتجاوز 50 أداة (Static Tool Catalog)
- [ ] كل نوع سياق له موقع تخزين واحد محدد (Single Source of Truth)

### 9.2 معايير العزل والأمان

- [ ] كل استعلام RAG مُلزم بفلتر `tenant_id` في Qdrant payload
- [ ] لا تظهر أسرار (API keys, tokens) في أي ملف سياق ثابت
- [ ] كل إجراء ذي أثر جانبي له policy في `guardrails/policies/`
- [ ] Redaction rules مُختبرة بنصوص PII معروفة (100% كشف)

### 9.3 معايير الميزانية والأداء

- [ ] Static Context ≤ 12K tokens لكل نموذج
- [ ] Dynamic Context له ميزانية قصوى مُعرفة ومعروضة في `users.settings`
- [ ] Priority Cascade مُختبر بمحاكاة تجاوز الميزانية (5 سيناريوهات)
- [ ] Hard Exclusions مُحققة بـ integration test (لا تسرب أبداً)

### 9.4 معايير التشغيل

- [ ] كل ملف سياق ثابت له `owner` و`review_cycle` (ربع سنوي)
- [ ] أي تغيير في AGENTS.md يتطلب PR معتمد من Architecture Owner
- [ ] System prompts لها إصدارات (`v1.2.0`) في Git
- [ ] تغيير السياق لا يتطلب إعادة نشر قاعدة البيانات

---

## 10. خارطة الربط مع الأقسام المجاورة

```
┌────────────────────────────────────────────────────────┐
│  03-CONTEXT-PACK.md                                    │
│                                                        │
│  ┌──────────────────────────────────────────────┐     │
│  │ 1️⃣ Context Architecture  ← أنت هنا            │     │
│  │    (الحدود الثابتة/الديناميكية + 6 أنواع)     │     │
│  └──────────────────────────────────────────────┘     │
│                       │                                │
│                       ▼                                │
│  ┌──────────────────────────────────────────────┐     │
│  │ 2️⃣ Agent Skills & Retrieval                  │     │
│  │    [→ ./02-agent-skills-and-retrieval-...]    │     │
│  │    (Progressive Disclosure + RAG over Docs)  │     │
│  └──────────────────────────────────────────────┘     │
│                       │                                │
│                       ▼                                │
│  ┌──────────────────────────────────────────────┐     │
│  │ 3️⃣ Token Economics & Maintenance             │     │
│  │    [→ ./03-token-economics-and-maintenance.md]│     │
│  │    (الميزانيات، الإصدارات، المراجعة)         │     │
│  └──────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────┘
```

> **انتقال القسم التالي**: لمعرفة كيف تُسترجع هذه السياقات ديناميكياً عبر **Agent Skills** بنمط **Progressive Disclosure**، انتقل إلى [Agent Skills and Retrieval Strategy](./02-agent-skills-and-retrieval-strategy.md). ولتفاصيل الميزانيات ودورة حياة السياق، راجع [Token Economics and Maintenance](./03-token-economics-and-maintenance.md).