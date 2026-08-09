# Token Economics and Maintenance

> تحدد هذه الوثيقة الميزانيات الرمزية، الاستبعادات، الملكية، المراجعة، والإصدارات لجميع ملفات السياق في OmniRAG. تُكمل [Section 1: Context Architecture](./01-context-architecture-and-six-context-types.md) و[Section 2: Agent Skills and Retrieval Strategy](./02-agent-skills-and-retrieval-strategy.md).

---

## 1. فلسفة الاقتصاد الرمزي

تُطبَّق قاعدة **"السياق الكثيف عالي الإشارة يفوز على السياق المتفرق المنخفض الإشارة"**. كل رمز يُحمَّل في نافذة النموذج يُكلِّف مالاً وزمناً ودقة. الهدف ليس تعظيم المعلومات بل **تعظيم الإشارة لكل رمز**.

### 1.1 المبادئ الثلاثة

| المبدأ | التطبيق في OmniRAG |
|---|---|
| **الحدود الساكنة فقط** | `AGENTS.md`, `CLAUDE.md`, قواعد الـ Harness، قواميس العقود — لا تتغير أثناء المهمة |
| **الديناميكي عند الطلب فقط** | مستندات API، سجلات، ملفات كبيرة، لقطات — تُجلب عبر Skills ومهام `read_file` |
| **التوجيه بالاقتصاد** | المهام الحتمية → نموذج صغير. المهام الاستدلالية/الإبداعية → نموذج كبير |

### 1.2 خريطة توزيع الميزانية

```
┌────────────────────────────────────────────────────────────────┐
│                  توزيع ميزانية السياق في OmniRAG                │
│                                                                │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  System Prompt (ثابت):  2,000 tokens                   │    │
│   │  ├─ الدور + الهوية + Tenant isolation rules          │    │
│   │  ├─ قائمة النماذج المتاحة + الحدود                   │    │
│   │  └─ قائمة قصيرة بالأدوات النشطة                      │    │
│   └──────────────────────────────────────────────────────┘    │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  Instructions (AGENTS.md + Rules):  3,000 tokens      │    │
│   │  ├─ قواعد TypeScript / Next.js / Tailwind            │    │
│   │  ├─ معايير الكود المؤسسي                             │    │
│   │  └─ قوائم المراجعة (Checklists)                      │    │
│   └──────────────────────────────────────────────────────┘    │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  Skills Catalog (Manifest):  500 tokens               │    │
│   │  └─ أسماء + أوصاف مختصرة فقط                       │    │
│   └──────────────────────────────────────────────────────┘    │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  Memory (Conversation summary):  1,000 tokens          │    │
│   └──────────────────────────────────────────────────────┘    │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  Tools Schemas (Active tools only):  2,500 tokens     │    │
│   │  └─ MCP tools المُفعّلة فقط + RAG tools             │    │
│   └──────────────────────────────────────────────────────┘    │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  Retrieved Context (Dynamic, on-demand): متغير       │    │
│   │  ├─ RAG chunks:  max 4,000 tokens                    │    │
│   │  ├─ Doc snippets: max 2,000 tokens                   │    │
│   │  └─ Logs/error traces: max 1,000 tokens              │    │
│   └──────────────────────────────────────────────────────┘    │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  User Message + History: متغير                        │    │
│   └──────────────────────────────────────────────────────┘    │
│                                                                │
│   ► الهدف للسائق الكبير (gemini-3.6-flash, 1M):              │
│     ≤ 15K system + ≤ 10K retrieved = 25K total                │
│   ► الهدف للسائق الصغير (gemini-3.5-flash-lite):             │
│     ≤ 8K system + ≤ 5K retrieved = 13K total                  │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. ميزانيات السياق لكل نموذج

### 2.1 مصفوفة الميزانيات الصارمة

| المكوّن | `gemini-3.6-flash` | `gemini-3.5-flash-lite` | يُحسب في |
|---|---|---|---|
| System Prompt | 2,000 | 1,200 | System |
| `AGENTS.md` (loaded) | 3,000 | 2,000 | System |
| Skills Manifest | 500 | 400 | System |
| Active Tool Schemas | 2,500 | 1,500 | System |
| Conversation Memory | 1,000 | 600 | System |
| **System Subtotal** | **9,000** | **5,700** | — |
| Retrieved RAG chunks | 4,000 | 2,500 | Input |
| Document snippets | 2,000 | 1,500 | Input |
| Tool call history | 2,000 | 1,000 | Input |
| User message + history | 2,000 | 1,500 | Input |
| **Input Subtotal** | **10,000** | **6,500** | — |
| **Generation Budget** | **4,000** | **2,000** | Output |
| **Grand Total Target** | **23,000** | **14,200** | All |

### 2.2 هوامش الأمان

- **حد التحذير (Warning)**: 80% من الميزانية → يُسجَّل في `telemetry.events` ويُرسل تنبيه للـ conductor.
- **حد المنع (Hard cap)**: 95% → يُقص الـ retrieved context تلقائياً ويُسجَّل `context_overflow` event.
- **تجاوز السقف**: أي طلب يتجاوز 95% يُرفض مع رسالة `CONTEXT_BUDGET_EXCEEDED` وإرجاع skeleton مهمته فقط.

---

## 3. الاستبعادات الصريحة (Never-Include List)

### 3.1 ما لا يُوضع أبداً في System Prompt

| النوع | السبب | البديل |
|---|---|---|
| محتوى المستندات الخام (PDF/DOCX) | ضخم + غير منظم | استرجاع عبر RAG chunks |
| سجلات Stack Traces كاملة | عالية الضوضاء | ملخص الخطأ + أول 50 سطر |
| محتوى `node_modules/` | لا قيمة | لا تُقرأ أصلاً |
| لقطات قواعد بيانات كاملة | ضخم جداً | استعلام مخصص عبر أداة |
| محتوى `package-lock.json` | لا فائدة للنموذج | لا يُقرأ |
| مفاتيح API / أسرار OAuth | خطر أمني + GDPR/HIPAA | تُجلب من `MCPSecretVault` وقت الاستدعاء فقط |
| نصوص مستخرجة من مستندات > 50K رمز | يتجاوز الميزانية | chunking + retrieval |
| سجلات محادثات سابقة كاملة | تاريخ قديم غير ذي صلة | ملخص مضغوط فقط |
| تعليقات الكود `// TODO` القديمة | ضوضاء | تنظيف في CI قبل الـ context loading |
| توثيق المكتبات الخارجية الكامل | متاح عبر Skills | رابط `skill:docs-{library}` |
| بيانات اعتماد اختبارات (test fixtures) | حساسة + ضخمة | مرجع فقط: `fixtures/auth.fixture.json` |
| نصوص ملفات ثنائية (صور كـ base64) | لا يمكن قراءتها | وصف metadata + مرجع URI |
| سجلات `git log` كاملة | ضوضاء تاريخية | آخر 10 commits فقط |
| خرائط `tsconfig` الكاملة | غير قابل للقراءة الفعالة | ملخص الإعدادات النشطة |

### 3.2 ما لا يُوضع في Memory

- بيانات اعتماد (`credentials`, `tokens`, `keys`) — **ممنوع مطلقاً** بموجب GDPR/HIPAA/PCI.
- محتوى محادثات مستخدمين آخرين (isolation violation).
- سجلات `audit` الخام — فقط الإحصائيات المُجمَّعة.
- نتائج استعلامات SQL كاملة — فقط ملخص + عدد الصفوف.

### 3.3 ما لا يُوضع في Tool Schemas

- أدوات MCP غير مُفعّلة للمستخدم الحالي.
- أدوات بيانات (read) و إجراءات (write) في نفس schema session بدون فصل.
- أدوات `stdio` المحلية (لا تعمل في Vercel Serverless).

---

## 4. الملكية والمسؤوليات (Ownership Matrix)

### 4.1 جدول المالكين

| ملف/مكوّن السياق | المالك الأساسي | المراجع | تكرار المراجعة |
|---|---|---|---|
| `AGENTS.md` (root) | Tech Lead | Security Lead | ربع سنوي |
| `.claude/rules/*.md` | Frontend Lead | UX Lead | شهري |
| `lib/mcp/registry.ts` | Backend Lead | Security Lead | عند كل إضافة أداة |
| `lib/prompts/system-prompts/*.ts` | AI Engineering Lead | Product Manager | شهري |
| `skills/*/SKILL.md` | Domain Owner لكل skill | AI Engineering Lead | عند كل تحديث |
| `lib/context/budgets.json` | Platform Engineer | AI Engineering Lead | ربع سنوي |
| `lib/context/exclusions.json` | Security Lead | Compliance Officer | ربع سنوي + عند كل خرق |
| `telemetry/context-events.schema` | Observability Lead | AI Engineering Lead | نصف سنوي |
| `tests/evals/context-*.test.ts` | QA Lead | AI Engineering Lead | عند كل تغيير ميزانية |
| `docs/context-pack/*` | Documentation Lead | كل الأدوار | شهري |

### 4.2 مصفوفة RACI للمهام الحرجة

| المهمة | Tech Lead | Security | AI Eng | Backend | Frontend | Compliance |
|---|---|---|---|---|---|---|
| إضافة أداة MCP جديدة | A | C | R | R | I | I |
| تغيير ميزانية نموذج | A | I | R | C | C | I |
| تعديل قواعد RLS في السياق | C | A | I | R | I | C |
| تحديث قائمة الاستبعادات | C | A/R | C | I | I | C |
| إضافة skill جديد | A | C | R | C | C | I |
| مراجعة أمنية ربع سنوية | C | R/A | I | I | I | R |
| تسريب عرضي لسياق حساس | I | A | R | R | R | C |

> A = Accountable, R = Responsible, C = Consulted, I = Informed

---

## 5. دورة المراجعة (Review Cadence)

### 5.1 المراجعة الدورية

| التكرار | النشاط | المالك | المُخرج |
|---|---|---|---|
| **يومي** | فحص تنبيهات `context_overflow` و `budget_warning` | Observability Lead | تقرير انتهاكات |
| **أسبوعي** | مراجعة `mcp_tool_calls` للأدوات ذات الاستخدام المنخفض/الفاشل | Backend Lead | قرار: تعطيل / إصلاح / إزالة |
| **شهري** | مراجعة AGENTS.md + skills + prompts | AI Engineering Lead | إصدار جديد (`v0.X+1`) |
| **ربع سنوي** | مراجعة الميزانيات + الاستبعادات + حدود النماذج | Tech Lead + Security | إصدار رئيسي (`vX.0`) |
| **نصف سنوي** | مراجعة شاملة لهيكل السياق | كل الأدوار | قرار إعادة هيكلة |
| **سنوي** | تدقيق خارجي للامتثال (GDPR/HIPAA/PCI) | Compliance Officer | شهادة امتثال |

### 5.2 المراجعة المُحفَّزة بالأحداث (Event-Triggered)

| الحدث | الإجراء | المالك | SLA |
|---|---|---|---|
| اكتشاف أسرار في مستودع السياق | إزالة + تدقيق + تنبيه أمني | Security Lead | 1 ساعة |
| تجاوز ميزانية نموذج بنسبة >20% | تخفيض الميزانية + تحليل السبب | AI Engineering Lead | 24 ساعة |
| خرق عزل مستأجر (tenant leakage) | إيقاف فوري + تحقيق جذري | Security Lead | فوري |
| فشل >10% من استدعاءات أداة MCP | فحص اتصال + قرار تعطيل | Backend Lead | 4 ساعات |
| تحديث مواصفة MCP (2026-XX-XX) | ترقية SDK + مراجعة التوافق | Backend Lead | أسبوع |
| تغيير نموذج Google (إصدار/إيقاف) | تقييم بديل + تحديث router | AI Engineering Lead | 3 أيام |
| اكتشاف prompt injection | تحديث exclusions + إبلاغ Security | AI Engineering Lead | 1 ساعة |
| تجاوز حصة API بنسبة >80% | تنبيه المستخدم + تخفيض حد | Backend Lead | تلقائي |

### 5.3 قائمة المراجعة للمراجعة الشهرية

- [ ] هل لا تزال AGENTS.md Rules نشطة ومُطبَّقة؟ (تحقق عبر grep)
- [ ] هل أي skill لم يُستخدم منذ 30 يوماً؟ (مرشح للحذف)
- [ ] هل متوسط استخدام الميزانية ضمن النطاق المستهدف؟
- [ ] هل هناك أسرار مكشوفة في `git log`؟ (فحص `gitleaks`)
- [ ] هل استدعاءات MCP فاشلة > 5%؟ (مراجعة health checks)
- [ ] هل تم تحديث Prisma schema للسياق دون تحديث RLS؟
- [ ] هل نماذج Google المُستخدمة لا تزال نشطة؟
- [ ] هل وثائق Privacy Policy لا تزال تعكس البيانات المُعالجة؟

---

## 6. الإصدارات والتغييرات (Versioning)

### 6.1 مخطط الإصدار الدلالي للسياق

**`MAJOR.MINOR.PATCH`** مثال: `ctx-pack-v2.4.1`

| المكون | الزناد | مثال |
|---|---|---|
| **MAJOR** | إعادة هيكلة كبيرة / تغيير نموذج افتراضي / تغيير مواصفة MCP / تغيير جوهري في RLS | `1.4.2 → 2.0.0` |
| **MINOR** | إضافة skill / أداة MCP جديدة / ترقية SDK / توسيع ميزانية | `2.4.1 → 2.5.0` |
| **PATCH** | إصلاح typo / تحديث رقم إصدار / تحديث URL / تصحيح قائمة استبعاد | `2.4.1 → 2.4.2` |

### 6.2 سجل التغييرات (CHANGELOG) إلزامي

كل تغيير في حزمة السياق يجب أن يُسجَّل في `docs/context-pack/CHANGELOG.md`:

```markdown
## [2.5.0] - 2026-XX-XX

### Added
- Skill جديد: `mcp-github-pr-reviewer` لتحليل Pull Requests
- دعم MCP مواصفة 2026-07-28 (Stateless)

### Changed
- ترقية @modelcontextprotocol/server من 1.x إلى 2.0
- تخفيض ميزانية RAG chunks من 5000 إلى 4000 tokens (تحسين زمن الاستجابة)

### Deprecated
- أداة `web_legacy_search` (استخدم `web_live_search`)

### Removed
- Skill: `pdf-legacy-extractor` (استخدم Mistral Document AI)

### Security
- إضافة `api_key` إلى Never-Include List بعد اكتشاف محاولة تسريب

### Migration Guide
- استبدل `mcp_client_v1.connect()` بـ `MCPClientPool.getClient()` 
  (لا حاجة لإدارة الجلسات في 2026-07-28)
```

### 6.3 استراتيجية الترحيل (Migration)

| نوع التغيير | الاستراتيجية | فترة الدعم |
|---|---|---|
| تغيير MAJOR | دعم الإصدار القديم لمدة 90 يوماً + `migration guide` + `deprecation warnings` في skills | 90 يوم |
| تغيير MINOR | فوري بدون فترة دعم | فوري |
| تغيير PATCH | فوري بدون تنبيه | فوري |
| تغيير أمني عاجل | فوري بدون دعم الإصدار القديم + نشر CVE إن لزم | فوري |

### 6.4 علامات الإهمال (Deprecation)

كل مهارة أو أداة أو قاعدة قبل إزالتها يجب أن:

1. تُعلَّم بـ `@deprecated` في الكود.
2. تُضاف إلى `skills/DEPRECATED.md` مع تاريخ الإزالة.
3. تُطلق تحذيراً صريحاً عند التحميل (عبر `console.warn` + `telemetry.deprecation_warning`).
4. تُمنح بديل مُوصى به في الوصف.

---

## 7. مراقبة السياق وقياساته (Telemetry)

### 7.1 المقاييس الأساسية (KPIs)

| المقياس | الهدف | تنبيه عند |
|---|---|---|
| `context.system_prompt_tokens` (avg) | ≤ 8,000 | > 9,500 |
| `context.retrieved_tokens` (avg) | ≤ 6,000 | > 8,000 |
| `context.total_input_tokens` (avg) | ≤ 16,000 | > 20,000 |
| `context.budget_overflow_rate` | < 0.5% | > 2% |
| `context.skill_load_latency_ms` (p95) | ≤ 200ms | > 500ms |
| `context.cache_hit_rate` (skills) | > 70% | < 40% |
| `context.never_include_violation` | 0 | > 0 (حادث أمني) |
| `context.skill_staleness_days` (avg) | < 30 | > 90 |
| `mcp.tool_failure_rate` | < 3% | > 10% |
| `llm.cost_per_conversation` | < $0.05 | > $0.15 |

### 7.2 أحداث التدقيق الحرجة

كل حدث من التالية يُسجَّل مع `tenant_id`, `timestamp`, `actor`, `severity`:

| Event | Severity | الإجراء |
|---|---|---|
| `context.never_include.violation` | CRITICAL | تنبيه فوري لـ Security Lead |
| `context.budget.exceeded.hard` | HIGH | تخفيض تلقائي + تنبيه AI Eng |
| `context.budget.warning.soft` | MEDIUM | لوحة المراقبة |
| `context.skill.deprecated.used` | LOW | تنبيه Documentation Lead |
| `context.version.major.migrated` | INFO | تحديث CHANGELOG |
| `mcp.token.refresh.failed` | HIGH | إعادة المصادقة + تنبيه المستخدم |
| `mcp.side_effect.confirmed` | INFO | تسجيل في `mcp_tool_calls` |
| `mcp.side_effect.rejected` | MEDIUM | تنبيه AI Eng |

### 7.3 لوحات المراقبة (Dashboards)

| اللوحة | المحتوى | الجمهور |
|---|---|---|
| **Context Health** | توزيع الميزانيات، الانتهاكات، أنماط الاستخدام | AI Eng, Tech Lead |
| **Security Posture** | محاولات انتهاك Never-Include، OAuth failures | Security Lead |
| **Cost Tracker** | تكلفة API لكل نموذج، لكل tenant | Finance, Product |
| **Skill Usage** | عدد التحميلات، نسبة cache hit، latency | AI Eng |
| **MCP Operations** | حالة الخوادم، failure rate، latency | Backend Lead |

---

## 8. استراتيجية التخزين المؤقت (Caching Strategy)

### 8.1 طبقات التخزين

| الطبقة | المحتوى | TTL | المكان |
|---|---|---|---|
| **L1: In-memory** | System prompts مُحلَّة | الجلسة | Edge Function memory |
| **L2: Vercel KV** | Skills Manifest + Tool Schemas | 5 دقائق | Redis |
| **L3: Postgres cache table** | Retrieved RAG chunks (مُفهرسة بـ hash) | 1 ساعة | Neon |
| **L4: Vercel CDN Cache** | وثائق skills الثابتة (SKILL.md) | 24 ساعة | Edge CDN |
| **L5: Browser cache** | ملفات AGENTS.md و rules | 1 ساعة | Service Worker |

### 8.2 مفاتيح الكاش (Cache Keys)

| النوع | الصيغة | مثال |
|---|---|---|
| Skill | `skill:{tenant_id}:{skill_name}:v{version}` | `skill:uuid-123:mcp-github-pr:v2` |
| RAG result | `rag:{tenant_id}:{collection_hash}:{query_hash}` | `rag:uuid-123:a3f9:9b2c` |
| Tool schema | `tools:{tenant_id}:{mcp_server_id}:v{protocol}` | `tools:uuid-123:notion:v2026-07-28` |
| System prompt | `system:{model}:{mode}:{language}` | `system:gemini-3.6-flash:hybrid:ar` |

### 8.3 إبطال الكاش (Cache Invalidation)

| الحدث | الإجراء |
|---|---|
| تحديث skill | إبطال `skill:*` للـ version الجديدة + قائمة الإبطال |
| تغيير إعدادات tenant | إبطال `tools:*` و `system:*` |
| تحديث النظام | إبطال `system:*` |
| تعديل RAG corpus | إبطال `rag:*` المرتبطة |
| ترقية مواصفة MCP | إبطال `tools:*` للـ protocol الجديد |

---

## 9. استراتيجية التحميل (Loading Strategy)

### 9.1 ترتيب التحميل (Priority Order)

```
1. System Prompt (إلزامي، ثابت)         ← أولوية قصوى
2. AGENTS.md + Rules (إلزامي)            ← مرتبط بـ repo
3. Skills Manifest (إلزامي، خفيف)        ← فهرس فقط
4. Active Tool Schemas (حسب الوضع)       ← lazy load
5. Conversation Memory (حسب السياق)      ← من KV cache
6. Retrieved Context (حسب الحاجة)        ← RAG / web / docs
7. User Input (الأخير)                   ← ديناميكي بالكامل
```

### 9.2 آليات التحميل الشرطي

| الشرط | ما يُحمَّل | ما يُستبعد |
|---|---|---|
| وضع `private` (RAG مقيد) | RAG tools + knowledge tools | Web search tools, MCP external actions |
| وضع `hybrid` (ويب+RAG) | + Web search tool | External write actions |
| وضع `agentic` | + جميع MCP tools النشطة | (الكل حسب `enabledMCPServers`) |
| مهمة `code-review` | Skills: `code-review`, `git-context` | Skills: `pdf-extract`, `image-ocr` |
| مهمة `ingest-document` | Skills: `pdf-extract`, `ocr-arabic`, `chunking` | Skills: `chat`, `web-search` |
| لغة عربية فقط | Prompts: `ar-system-prompt` | Prompts: `en-system-prompt` |
| tenant enterprise plan | + Analytics skills + audit tools | — |

---

## 10. اختبارات وعيّنات السياق (Context Tests & Evals)

### 10.1 اختبارات الميزانية (Deterministic)

```typescript
// tests/context/budgets.test.ts
import { calculateContextBudget } from '@/lib/context/budgets';
import { NEVER_INCLUDE_PATTERNS } from '@/lib/context/exclusions';

describe('Context Budget Enforcement', () => {
  test.each([
    ['gemini-3.6-flash', 'private', 23000],
    ['gemini-3.6-flash', 'hybrid', 25000],
    ['gemini-3.5-flash-lite', 'private', 14200],
  ])('budget for %s in %s mode ≤ %d tokens', (model, mode, max) => {
    const budget = calculateContextBudget({ model, mode });
    expect(budget.total).toBeLessThanOrEqual(max);
  });

  test('system prompt never exceeds 2000 tokens', () => {
    const prompt = loadSystemPrompt('hybrid', 'ar');
    expect(countTokens(prompt)).toBeLessThanOrEqual(2000);
  });

  test.each(NEVER_INCLUDE_PATTERNS)('never include: %s', (pattern) => {
    expect(loadContext('/test/fixtures/full-context.json'))
      .not.toMatch(pattern);
  });
});
```

### 10.2 عيّنات الجودة (Evals)

| نوع العيّنة | الحكم | العتبة |
|---|---|---|
| **Efficiency Eval** | هل الوكيل أكمل المهمة في < N استدعاء أداة؟ | ≥ 85% |
| **Context Relevance Eval** | هل الـ retrieved chunks مرتبطة بالاستعلام؟ (LM Judge) | ≥ 0.8 |
| **No-Leakage Eval** | هل استجاب الوكيل بدون الكشف عن بيانات tenant آخر؟ | = 100% |
| **Skill Routing Eval** | هل اختار الوكيل الـ skill الصحيح للمهمة؟ | ≥ 90% |
| **Budget Adherence Eval** | هل المهمة اكتملت ضمن الميزانية؟ | ≥ 95% |
| **Citation Quality Eval** | هل كل ادعاء في الإجابة مدعوم بمصدر؟ | ≥ 90% |
| **Arabic Quality Eval** | هل الإجابة بالعربية صحيحة نحوياً ودلالياً؟ | ≥ 0.85 (LM Judge) |
| **Side-Effect Safety Eval** | هل طُلب تأكيد قبل أي إجراء ذي أثر جانبي؟ | = 100% |

### 10.3 حالات اختبار الانعكاس (Regression Cases)

كل خلل في الميزانية أو الاستبعاد أو الأداء يُضاف كحالة اختبار ثابتة:

```typescript
// tests/context/regressions.test.ts
describe('Context Regression Cases', () => {
  test('REGR-001: large PDF ingestion does not load entire file into system prompt', async () => {
    const result = await ingestPDF({ size: 50_000_000 });
    expect(result.systemPromptTokens).toBeLessThan(2000);
    expect(result.chunksRetrieved).toBeGreaterThan(0);
  });

  test('REGR-015: tenant A search never returns tenant B chunks', async () => {
    const results = await search({
      tenantId: 'A',
      query: 'sensitive data',
    });
    expect(results.every(r => r.tenant_id === 'A')).toBe(true);
  });

  test('REGR-023: deprecated skill warns on load', async () => {
    const warnings = await loadSkill('pdf-legacy-extractor');
    expect(warnings).toContain('DEPRECATED');
  });
});
```

---

## 11. الاستجابة للحوادث (Incident Response)

### 11.1 مصفوفة شدة الحوادث

| المستوى | الوصف | مثال | SLA الاستجابة |
|---|---|---|---|
| **P0** | خرق أمني / تسريب بيانات بين tenants | ظهور بيانات tenant آخر في استعلام | فوري (< 15 دقيقة) |
| **P1** | فشل كامل في طبقة السياق | جميع وكلاء الذكاء الاصطناعي معطلون | < 1 ساعة |
| **P2** | تدهور كبير في الأداء | تجاوز ميزانية > 50% لجميع المهام | < 4 ساعات |
| **P3** | تدهور بسيط | skill واحد فاشل، تجاوز ميزاني لمستخدم واحد | < 24 ساعة |
| **P4** | تحسين / تنبيه | skill بطيء، تحذير ميزاني متكرر | < أسبوع |

### 11.2 إجراء الطوارئ لتسريب السياق

```yaml
incident_response_context_leak:
  detection:
    - alert: "context.never_include.violation"
    - alert: "tenant.isolation.breach"
  immediate_actions:
    - action: "إيقاف خدمة الـ RAG للمستخدم المتأثر"
      sla: "1 دقيقة"
    - action: "تنبيه Security Lead + Tech Lead"
      sla: "فوري"
    - action: "حفظ snapshot لقاعدة البيانات للطب الشرعي"
      sla: "5 دقائق"
  investigation:
    - action: "تحليل stack trace للاستعلام الخاطئ"
      sla: "30 دقيقة"
    - action: "مراجعة RLS policies + Qdrant payload filters"
      sla: "2 ساعة"
  remediation:
    - action: "نشر إصلاح RLS/filter"
      sla: "4 ساعات"
    - action: "إبلاغ المستخدم المتأثر (GDPR Art. 34)"
      sla: "72 ساعة"
  post_mortem:
    - deliverable: "تقرير جذر السبب خلال 7 أيام"
    - deliverable: "إضافة regression test خلال 7 أيام"
    - deliverable: "تحديث Never-Include List خلال 14 يوم"
```

---

## 12. معايير القبول (Acceptance Criteria)

### 12.1 معايير الإصدار (Release Gates)

لا يُنشر إصدار جديد من حزمة السياق (`MAJOR` أو `MINOR`) إلا بعد تحقق **كل** الشروط:

- [ ] جميع اختبارات الميزانية (`budgets.test.ts`) خضراء
- [ ] جميع اختبارات الانعكاس (`regressions.test.ts`) خضراء
- [ ] عيّنات الجودة (Evals) ضمن العتبات المحددة في §10.2
- [ ] CHANGELOG.md محدّث بقسم للإصدار الجديد
- [ ] Migration guide مُكتوب (إذا كان MAJOR)
- [ ] Telemetry events الجديدة مُعرَّفة في `events.schema`
- [ ] لا توجد أسرار في `git diff` (فحص `gitleaks`)
- [ ] مراجعة Security Lead على التغييرات
- [ ] مراجعة AI Engineering Lead على تغييرات النظام
- [ ] جميع المهارات الجديدة مُختبرة بـ dry-run واحد على الأقل
- [ ] وثائق `docs/context-pack/*` محدّثة
- [ ] لا تحذيرات `console.warn` غير معالَجة في CI
- [ ] تم اختبار الاسترجاع (rollback procedure)

### 12.2 معايير الإزالة (Removal Criteria)

تُزال مهارة أو أداة أو قاعدة عند تحقق أي من:

- لم تُستخدم لمدة 90 يوماً متواصلة.
- تجاوز معدل الفشل 15% لمدة أسبوعين.
- تم استبدالها ببديل أفضل (deprecation كاملة).
- تحتوي على ثغرة أمنية لم تُعالَج خلال 30 يوماً.
- تخالف مبدأ من مبادئ السياق الست (راجع [Section 1](./01-context-architecture-and-six-context-types.md)).

---

## 13. المراجع المتقاطعة

| الموضوع | الوثيقة المرجعية |
|---|---|
| هيكل السياق والأنواع الستة | [Section 1](./01-context-architecture-and-six-context-types.md) |
| Skills واستراتيجية الاسترجاع | [Section 2](./02-agent-skills-and-retrieval-strategy.md) |
| بنية قاعدة البيانات و RLS | PRD §7 — Data Isolation |
| طبقة MCP التفصيلية | PRD §MCP Layer |
| حماية الأسرار والامتثال | PRD §13 — Security |

---

## 14. ملخص تنفيذي

| الجانب | القرار |
|---|---|
| **الميزانية الكلية للنموذج الكبير** | ≤ 23,000 رمز (System 9K + Input 10K + Output 4K) |
| **الميزانية الكلية للنموذج الصغير** | ≤ 14,200 رمز |
| **حد التحذير** | 80% من الميزانية |
| **حد المنع** | 95% من الميزانية |
| **دورة المراجعة الكاملة** | نصف سنوي |
| **دورة المراجعة الدورية** | شهري للـ AGENTS/skills/prompts |
| **استراتيجية الإصدار** | Semantic Versioning (MAJOR.MINOR.PATCH) |
| **فترة دعم الإصدارات القديمة (MAJOR)** | 90 يوم |
| **أحداث التدقيق الحرجة** | 8 (انظر §7.2) |
| **عيّنات الجودة الإلزامية** | 8 (انظر §10.2) |
| **آلية الاستجابة لـ P0** | < 15 دقيقة |

> **قاعدة ذهبية:** كل رمز في نافذة السياق يجب أن يُبرر وجوده. إذا لم يكن حرجاً للمهمة الحالية، فهو مُكلِّف دون فائدة. عند الشك، انقله إلى Skills (lazy load) أو Memory (compressed) أو احذفه.