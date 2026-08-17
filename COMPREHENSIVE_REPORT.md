# 📋 التقرير الشامل والمهني لمنصة OmniRAG

> تاريخ الفحص: 2026-08-16
> الإصدار المُفحوص: `v0.4.7` (commit `7bef984`)
> المُنفِّذ: مهندس برمجيات + مدير منتج

---

## 1) الملخص التنفيذي

**OmniRAG** منصة إنتاجية للمؤسسات متعددة المستأجرين تُطبّق نموذج **RAG المعزّز بالتوليد (Retrieval-Augmented Generation)** مع بوابة وكيلية لبروتوكول **MCP (Model Context Protocol)**. بُنيت بـ Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4، مدعومة بـ PostgreSQL (Drizzle ORM) للتخزين العلائقي و Qdrant للبحث المتجهي، مع Google Gemini كعمود LLM/تضمين.

البنية متماسكة ومصمَّمة باحتراف: مصادقة Postgres محلية (session token معتم + Argon2id + httpOnly cookie)، عزل المستأجرين عبر معامل `tenantId` في كل استدعاء، محرك بحث هجين (Dense Vector + Lexical FTS مع RRF)، طبقة سياسات أمان حتمية (HookHarness)، تشفير AES-256-GCM للبيانات السرية، وبيئة CI/CD متكاملة (Prettier/ESLint/Typecheck/Tests/Gitleaks/Dependabot/Husky).

لكن **اكتشفتُ ثلاث فجوات عالية الأثر على أمن المستأجرين**، وأخرى هيكلية/جمالية متفرقة. تُوجد هذه الفجوات في: تلوث `process.env` العام عبر API المُصدَّق، تسرّب البحث الـlexical عبر حدود المستأجرين، وغياب حد المعدل عن مسارات المصادقة.

---

## 2) نظرة عامة على المنصة

| البُعد           | الحالة                                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| نوع المشروع      | تطبيق ويب أحادي الصفحة (SPA) بنمط "تطبيق مكتبي" داخل Next.js App Router |
| الحجم            | ~103 ملف TS + 39 TSX؛ عدة ملفات تتجاوز 1500 سطر                         |
| الجمهور المستهدف | المؤسسات متعددة المستأجرين (Multi-tenant Enterprise)                    |
| اللغات           | عربي/إنجليزي ثنائي اللغة                                                |
| الترخيص          | خاص (private)                                                           |
| آخر commit       | `7bef984 feat: drop auth firebase and use auth postgres local`          |
| المؤلف           | Ahmed Almaghz                                                           |

### الحُزم الرئيسية (package.json)

- **AI / تضمين:** `@google/genai`, `@ai-sdk/google`, `ai`, `zod`
- **تخزين/بحث:** `drizzle-orm`, `pg`, `@qdrant/js-client-rest`
- **مستندات/وسائط:** `pdf-parse`, `pdf-lib`, `mammoth`, `@distube/ytdl-core`, `youtube-captions-scraper`, `youtube-transcript`, `remotion`/`@remotion/player`
- **UI:** `react`/`react-dom` 19, `tailwind-merge`, `clsx`, `lucide-react`, `motion`, `d3`, `katex`, `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`
- **أمان:** `@node-rs/argon2`

---

## 3) البنية المعمارية

التطبيق مقسَّم إلى ست طبقات منطقية، كلها تعتمد على عقد (contract) مشترك:

```
┌────────────────────────────────────────────────────────────┐
│ الواجهة (src/components/*) — SPA بتبويب tab state واحد       │
│  landing/chat/knowledge/mcp/analytics/settings              │
└───────────────┬────────────────────────────────────────────┘
                │ fetchWithAuth (httpOnly cookie)
┌───────────────▼────────────────────────────────────────────┐
│ API Routes (src/app/api/v1/*) + withAuthAndRateLimit wrapper│
│  Auth / Chat / Documents / Sources / MCP / Search / Analytics│
└───────────────┬────────────────────────────────────────────┘
                │
   ┌────────────┼────────────┬─────────────────┐
   │            │            │                 │
┌──▼────┐  ┌───▼──────┐  ┌───▼──────┐  ┌───────▼─────────┐
│HookH- │  │RAG Engine│  │ Auth Lib │  │ MCP Manager/OAuth│
│arness │  │ (engine) │  │ apiAuth  │  │ (oauth-mgr/pkce) │
└───────┘  └────┬─────┘  └──────────┘  └──────────────────┘
      ↓ performHybridSearch (RRF + HyDE + Reranker)
┌──────────────────────────────────┐
│ IOmniRAGDatabase (contract)       │
├──────────────────────────────────┤
│ OmniRAGDatabase (Postgres ⇄ memory│   ┌─────────────────────┐
│  write-through shadow + fallback) │←→ │ Qdrant (semantic)   │
│ MemoryDatabase (test/dev store)   │   └─────────────────────┘
└──────────────────────────────────┘
                │
        Drizzle schema (13 جدول) + raw-SQL migrations
```

العقد `IOmniRAGDatabase` (`src/lib/storage/IOmniRAGDatabase.ts`, 113 سطر) هو القلب المعماري: يفرض على كل المستودعات الخلفية تنفيذ ~35 دالة async موحّدة، ما يجعل التبديل بين Postgres والذاكرة وكالات `db.*` لا يلتصقون بفئة محددة. كل دالة تستقبل `tenantId` صراحةً — لا يوجد سياق مستأجر جهري (ambient).

---

## 4) تحليل الطبقات بعمق

### 4.1 الواجهة الأمامية (~8700 سطر عبر 11 view رئيسي)

**Orchestrator — `MainApp.tsx`:** يدير `activeTab`, auth, theme, lang. بوابة مصادقة ذكية: لا يثق بـ `localStorage['omnirag-auth']` إلا كعلم تقليل وميض، ويعيد اشتقاق `tenantId/userEmail` من الطرف الخادم عبر `/api/v1/auth/session` (الأثر موثّق في الأسطر 65–71). اختصارات Ctrl/Cmd+1..4 للتبويبات.

**الواجهات الرئيسية:**

- **`ChatStudio`** (~1840 سطر) — الرائد: محادثات/رسائل، مفتش الاستشهادات، طابور موافقة أدوات MCP، ريل جانبي citations/mcp/logs. (27 useState — مرشح قوي لإعادة هيكلة)
- **`KnowledgeBase`** (~1980 سطر) — مساحة عمل 9 تبويبات تدمج منطق المصادر والوثائق
- **`DocumentIngestionStudio`** (~1886 سطر) — خط أنابيب استيعاب كامل متعدد الخطوات مع `useDocumentCache`
- **`McpGateway`** (~1524 سطر), **`SourcesDashboard`** (~1611 سطر), **`SettingsView`** (~1149 سطر), **`AnalyticsCenter`** (~719)
- **`AuthScreen`** — تسجيل دخول/إنشاء حساب + "ضيف" يستخدم بيانات عشوائية cryptographically حقيقية (لا تجاوز demo)
- **`LandingPage`** — صفحة تسويقية بتبويب animation Remotion حيّ

**`RichMessageRenderer`** (`chat/RichMessageRenderer.tsx`, 442 سطر): يعالج Markdown + GFM + KaTeX (math `$...$`/`$$...$$`) مع شريط أدوات لمفتاح MathJax/النطق TTS/التصدير `.md`. يدمج صور/فيديو/صوت تلقائياً من روابط المخرجات، ويحوّل YouTube→iframe. لكنه يفتقر إلى تطهير الـ`href`/`src` قبل حقنها في `<img>/<iframe>/<video>/<audio>`، فيه خاصية `onCitationClick` مُعلَنة لكن غير مستخدمة (dead prop)، وتمثيل الرياضيات العربية تجميلي وليس KaTeX حقيقي.

**ميزات Remotion:** `RagAnimation.tsx` (لقطة بصرية 210 إطار @30fps تصوّر Ingestion→Embeddings→Hybrid Retrieval→Guardrails→Answer ثنائية اللغة) + `RemotionHeroPlayer.tsx`. ميزة صقل بصرية حقيقية بدون اقتران بالخادم.

**ملاحظات جودة:**

- ملفات ميتة (`ClientHome.tsx`, `CounterDemo.tsx`, `ClientNotFound.tsx` غير مُستوردة)
- `showFirstLaunchEnvModal` في MainApp يُهيَّأ `false` ولا يُضبط true أبداً (ميزة معطّلة)
- `KnowledgeBase` يستخدم `tenantId='tenant-acme-01'` كـ default prop — خطير لو نسي مُتصل تمرير المستأجر الحقيقي

### 4.2 طبقة الـ API والـ Backend

**35+ مسار API** تحت `src/app/api/v1/` بالإضافة إلى أربعة جذرية. جميعها `export const dynamic = 'force-dynamic'`. 30 من 36 ملفاً مغلّفون بـ `withAuthAndRateLimit`؛ الست غير مغلَّفين هم `health` + أربعة auth + `mcp/oauth/callback` (كلها مقصودة).

**الـ Wrapper `withAuthAndRateLimit`:** يحمّل env → rate limit (30/دقيقة) → `verifyApiAuth` → handler → 500 عام مع رسالة عربية لا تُسرّب التفاصيل الداخلية.

**التوزيع حسب المجال:**

| المجال                    | النقاط الحرجة                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Auth                      | CSRF على mutations، Argon2، cookie httpOnly، 409 عند تكرار الإيميل                                                |
| Chat                      | `completions` متزامن بكامل التدفّق (citation + موافقة على بودوات + PII)، و `stream` بـ `streamText` (SSE)         |
| Documents                 | `parse` يدعم JSON/multipart/raw، MIME allowlist، cap 50MB غير قابل للتحكم عميلياً                                 |
| Collections/Conversations | CRUD + `save_message` يثق بـ `msg.id` من العميل رغم تعليق يزعم إعادة توليده                                       |
| Sources                   | encrypt-on-write / redact-on-read للسرّ config؛ مزامنة أولية تُشغّل inline عند الإنشاء                            |
| MCP                       | endpoint موحّد `servers` بخمس إجراءات: add/edit/ping/delete/toggle + pool حقيقي + Gemini tool-gen                 |
| Search/Analytics          | `search` retrieval-only؛ `analytics` يحسب P95 و `blockedAttacks` لكن MRR/Recall مُزيّف بصيغة العلاقة بصحة الوثائق |
| Diagnostics               | probes Postgres/Qdrant/Mistral في تفرّة + env audit بنقاط جاهزية 0–100، بـ masking للسلاسل/المفاتيح               |

**الـ HookHarness** (`src/lib/harness/hook-harness.ts`): آلة حالة حتمية بمحطات `pre_auth/pre_inference/pre_tool/post_inference`:

- **H1 TenantGate** — يرفض tenantId فارغ
- **H6 InputSanitizer** — كاشف حقن prompt بسبعة أنماط regex (إنجليزي+عربي)
- **H2 ModeGuard** — يحظر `web_search`/`بحث مباشر` في الوضع Private
- **H3/H5 ScopeGuard + SideEffectGate** — يدقق موافقة على الأدوات العابرة `slack_send_message`, `github_create_issue`, `external_postgres_query`, `email_send`
- **H9 PIIRedactor** — يقنّع بريد/هاتف بـ `[REDACTED:*]` مع معالجة صحيحة لمتلازمة الـ`/g` `lastIndex` (نقطة جودة عالية)
- **H12 AuditLogger** — يكتب كل قرار لـ Postgres (≥2 صف audit لكل طلب chat/search)

### 4.3 طبقة التخزين والبيانات

**`db.ts` (1842 سطر):** Singleton مع `OmniRAGDatabase` (Postgres-first) و `MemoryDatabase` (mem كامل) خلف عقد واحد. **Fallback لاصق أحادي الاتجاه**: متغيّر `useMemory` يُقلب true على أي خطأ postgres ولا يستعيد ذاته — أي ومضة Postgres عابرة تُخفض العملية لـ memory بصمت بتباين بيانات دائم. الكتابة write-through: كل mutation تكتب memory دائماً ثم Postgres شرطياً.

**`postgres.ts` (1688 سطر):** Pool واحد `pg.Pool` (max 10، idle 30s، connect 8s) مشترك بين raw-SQL و Drizzle. كل handlers يستعملون `WHERE tenant_id = $1` ما عدا **`searchPostgresLexical`**. RLS Postgres **مُعطّل صراحةً** (`DISABLE ROW LEVEL SECURITY`). Timestamps كلها `VARCHAR(100)` ISO — لا date math ولا now() DB-default.

**النتيجة الخطيرة:** البحث المُعجمي (lexical FTS) لا يُقاوِل على `tenant_id`، فقط يستدعِ `set_config('app.current_tenant', ...)` لمعاملة زينة — وبما أن RLS معطّل فلا يفعل شيء. النتيجة: محرك البحث الهجين قد يُعيد قطع/عناوين/معرّفات وثائق من مستأجرين آخرين عبر الذراع الـ lexical. هذا الأثر الوحيد الأعلى في طبقة البيانات.

**`qdrant.ts` (296 سطر):** كل المستأجرين يتشاركون collection واحد `omnirag_chunks`، عزله بالفلاتر payload فقط (مفتاح `tenantId` keyword index مُنشأ). البحث `searchQdrantSemantic` **يفرض** فلتر `tenantId` إلزامياً (صحيح هنا). **عيب:** coerc لنقطة-ID Qdrant يستعمل hash 32-بت Java-style عند تخلّف UUID — احتمال تصادم حقيقي، وقد يتسبّب في استبدال/حذف متّجهات بعضوية خاطئة.

**المهاجرات (Migrations):** يوجد **ثلاث نسخ DDL مكررة** (`postgres.ts` ensurePostgresTables، `lib/db/migrate.ts`، `lib/db/migrateAndSeedDrizzle.ts`) + Drizzle schema.ts الذي لا يولّد مهاجرات في مسار runtime. يُعدّ هذا مخاطر تزحزّح schema. لا فهرس btree على `tenant_id` رغم كل استعلام يفلتر به = seq-scan. لا مفاتيح خارجية (cascade يدوي مُترك في العميل).

**Embedding/Reranker:** `embedding.ts` يولّد تضمين 3072-بُعد مع LRU cache (500 مدخ)، batched مع `embedBatch` (concurrency 5). مشكلة `normalizeTo3072`: يقوم **tiling** متّجهات الأبعاد المنخفضة وتكرارها ثم L2-normalize، ما يُشوّش الهندسة الدلالية عند خلط نماذج بأبعاد مختلفة. `reranker.ts`: cross-encoder LLM (70% LLM score + 30% RRF)، يخفّق بسلاسة دون فشل.

**Chunking:** `pdfChunker.ts` يدعم تقطيع PDF حسب الصفحات (مكيّف حسب الحجم 5/10/25 صفحة) ونسق OCR متعدد المتعالجات (native pdf-parse → Mistral → Unstructured → Gemini). لكن **chunking النصي** الفعلي للـ DocumentChunk المنخزنة متضارب: `syncSource` 1000 حرف بلا overlap؛ `createDocumentVersion`/`revertDocumentVersion` 1000 حرف بـ 200 overlap؛ ولا يبالي بإعداد `chunkSize:500/chunkOverlap:50` المُهيأ للمستأجر — الإعداد ميت لهذه المسارات.

### 4.4 المصادقة والأمان

**نقاط القوة الحقيقية:**

- **Session model صحيح:** token معتم 256-bit CSPRNG، لا JWT، مخزّن في Postgres، Levin فوري بحذف الصف، cookie httpOnly+SameSite=Lax+Secure-in-prod
- **Argon2id** OWASP (19MiB memCost، timeCost 2)
- **AES-256-GCM** مع auth tag، يرمي إلزامي في الإنتاج عند غياب `MCP_OAUTH_ENCRYPTION_KEY`
- **CSRF custom-header** دفاع-in-depth لأن SameSite-Lax كافٍ بحد ذاته
- **معالجة سرّات المصادر** encrypt-on-write / redact-on-read فعّالة
- **CI جودة واعٍ أمنياً:** ESLint rule targeted لمنع تسريب `err.message` في routes, Gitleaks

**نقاط الضعف الحرجة الأمنية:**

1. **تلوث env عبر `process.env` مشاع لكل المستأجرين (النتيجة الأعلى خطورة):** طريقان يكتبان إلى `process.env` العام للعملية المشتركة:
   - Headers `x-env-*` على طلب wrapper `withAuthAndRateLimit` (محصور بـ dev إلا عند `ALLOW_CLIENT_ENV=true`)
   - `POST /api/v1/env-config` (action `save`/`sync`) — مصدّق فقط، **بلا قائمة مفاتيح مرخّصة ولا عزل ولا gate على NODE_ENV**: أي مستخدم موثّق في مستأجره يضبط `DATABASE_URL/QDRANT_URL/GEMINI_API_KEY` لكل العملية/المستأجرين. استدعاء `resetPostgresPool()` يُعيد الربط للمستأجر الذي يتحكم بما تعملون. هذا ناقل redirect/exfiltration/ATO شامل.
2. **حد المعدل غائب عن مسارات auth.** `login`/`register` غير مغلّفين؛ غير ذلك الـ limiter في memory فقط (بير instance، غير جاهز لـ serverless)، ويثق بأول قيمة `X-Forwarded-For` (قابل للتزييف ما لم يكن خلف proxy موثوق).
3. **Oracle توقيت في login يُكشف وجود الحساب:** تعليق `login/route.ts:33` يَعِد "dummy verify" لكن الكود لا يستدعِه عند غياب المستخدم — `verifyPassword` لا يعمل. المستخدم المفقود أسرع من كلمة سر خاطئة.
4. **"درع الحقن" غير مطابق للإعلان:** README يَعِد "فحص حتمي قبل إرسال الطلب للنموذج" والحقيقة 7 أنماط regex bypass بسهولة، فحصاً فقط على `ctx.prompt` ولا يمس المستندات المسترجَعة (الناقل المهيمن للحقن غير المباشر في RAG).
5. **MCP OAuth مُحاكاة لا حقيقية:** `pkce.ts` صحيح RFC 7636 لكن `oauth-manager.ts:handleCallback` يولّد `accessToken = "mcp-token-<ts>-<uuid>"` **محلياً دون استدعاء token endpoint للمزوّد**. PKCE مُتنمّط عميل بلا استخدام. `iss` check يقبل substring معكوس ويستطيع أن يطابق `https://slack.com.evil`. الـ session state في `Map` في-memory — ينكسر في serverless الـ restart. لا OAuth حقيقي ممكن قيد النشر.
6. **RLS معطّل صراحةً**: عزل المستأجر 100% application-enforced. README يَعِد "RLS مطبق" لكن `storage/db.ts` نفسه ينفي ذلك. أي handler يُغفل `tenant_id = $1` يتسرّب (وهو ما حدث في `searchPostgresLexical`).
7. **Cross-tenant OCR cache:** `SERVER_OCR_CACHE` في `documents/parse` مُفعل بمفتاح file hash فقط (بدون tenant) — مستأجر يحمّل PDF بنفس بايتات مستأجر آخر يحصل على نصه المستخرج.
8. **PII redaction ناقصة في `chat/stream`** (لا post_inference فالـ PII Redactor لا يعمل في المخرجات المُتدفّقة على خلاف `completions`).
9. **RichMessageRenderer يحقن روابط LLM في iframe/img بلا تطهير** (XSS/tracking surface).

**خلاصة إزالة Firebase:** نظيفة (تبقى سلاسل تعليقات فقط، لا استيراد فعلية).

### 4.5 محرك RAG

`performHybridSearch` (engine.ts:324–508):

- HyDE اختياري (عبر Vercel AI SDK `generateText`) — يُوسّع استعلام الدلالي فقط
- يُشغّل `searchQdrantSemantic` و `searchPostgresLexical` في تفرّة، كل منهما يُحصر بـ `topK*3`
- يدمج في `Map` keyed بـ chunk ID، يحمّل عناوين الوثائق في دفعة واحدة (إصلاح N+1)
- **RRF** `computeRrfScore`: `(1/(k+rank_sem))·w_sem + (1/(k+rank_lex))·w_lex`، k=60، أوزان 0.7/0.3 (تطابق إعدادات المستأجر الافتراضية)
- خيار cross-encoder reranking
- fallback محلي للحصول على 0 نتائج: scorer bag-of-words على `db.getChunks` الـ in-memory

`selectSmartModel` موجِّه ذكي: تحليل/استعلامات طويلة → analysisModel، وإلا chatModel.

`generateRagCompletion` (engine.ts:513–752): قراءة إعدادات MCP للمستأجر، يبني `systemInstruction` عربي، يفصّل Function declarations، يفرّق الأدوات المحظورة في الوضع private (prefixes slack/github/web/fetch)، ينفّذ function calls ويطلق مدفوعة الجواب الثانية. كل executions تُسجَّل audit.

**ملاحظة هامة:** `MCP_TOOL_DEFINITIONS` ونص `executeMcpTool` **مُحاكاة محلية** في engine.ts — يُرجِع مخرجات منظمة مهيّأة بالعربية لكن لا تنفّذ MCP حقيقية ضد مزوّدات حقيقية على هذا المسار. البنية موجودة لكن backend الـ MCP tool execution يحتاج wiring فعلي.

---

## 5) الجودة والاختبارات

**11 ملف test Vitest** تحت `src/__tests__/`. تغطية ضيقة لكن عميقة على الأمن/الاسترجاع:

- `rrfScore.test.ts` — اختبار رياضي نقي RRF بـ `toBeCloseTo(...,10)` (الأقوى)
- `rrf.test.ts` — تكامل `performHybridSearch` مع عزل tenantId
- `encryption.test.ts`, `password.test.ts`, `apiAuth.test.ts`, `authRoundtrip.test.ts` (ضد الـ `MemoryDatabase` حقيقية), `hookHarness.test.ts`, `memoryDbContract.test.ts` (تطابق العقد structurally), `batchIngestion.test.ts`, `webRandom.test.ts`, `ingestion.test.ts`

**فجوات:** لا اختبارات DOM/RTL، لا middleware/route integration tests، لا chunker/embedding model tests، لا coverage reporter مُهيأ.

---

## 6) DevOps والبناء

- `next.config.ts`: `reactStrictMode`, `ignoreBuildErrors:false` (جيد)، `serverActions.bodySizeLimit:'10mb'`, `allowedDevOrigins` للـ Cloud Run. **لا** React Compiler ولا PPR flag رغم أن `next16Features.ts` يُعلنهما.
- `server.ts`: خادم Node إنتاجي `0.0.0.0:3000`. لكن معلّق `// @ts-ignore` على `next()`.
- `dev-server.js`: launcher بحل `pkill -9` (Linux/Mac فقط — no-op على Windows لهذه البيئة)
- **CI (`.github/workflows`):** quality job 15د (Prettier→ESLint→typecheck→tests) + audit job (npm audit high) + Gitleaks + Dependabot (patch+minor مُجمّع مع auto-merge allow-list). عمل احترافي.
- **Husky + lint-staged:** pre-commit وحيد فعّال
- **Tailwind v4:** CSS-first بدون `tailwind.config.js`. **bug فعلي:** الـ `dark:` utilities في `SettingsView`/`FirstLaunchEnvModal`/`EnvVariablesManager` تستجيب لـ `prefers-color-scheme` وليس لقلاق البوابة الداخلية. `globals.css` تفتقر `@custom-variant dark (&:where(.dark, .dark *))`. نتيجة: تبديل الـ theme غير ثابت عبر الواجهة.

**SDLC documentation corpus:** مجلد SDLC احترافي كبير (8 أقسام مرقّمة PRD/architecture/spec/tests/guardrails/deployment/roadmap + agents) — **نقطة قوة بارزة** لمشروع بهذا الحجم.

---

## 7) نقاط القوة المعمارية

1. **عقد `IOmniRAGDatabase` القابل للتبديل** — يفصل المستودعات عن call sites
2. **Bootstrap anti-impersonation** — client storage لعلم flash فقط، identity دائماً من الطرف الخادم عبر `/session`
3. **Auth model صحيح** معتم/Argon2id/httpOnly (لا JWT قابل للتسريب)
4. **محرّك RAG هجين كامل** ويغطي RRF+HyDE+Reranker+Citations (إن كانت الذراع الـlexical لا تتسرّب عبر tenant)
5. **CI/CD أمني الوعي** (Gitleaks، ESLint target لمنع التسريب، Dependabot محدّد الأثر)
6. **SDLC corpus توثيقي احترافي** نادر الوجود في هذا الحجم
7. **Remotion hero animation** ميزة صقل بصرية حقيقية

---

## 8) المخاطر المُرتّبة حسب الأولوية

### 🔴 P0 — حرجة

| #   | المخاطرة                                                      | الموقع                                   |
| --- | ------------------------------------------------------------- | ---------------------------------------- |
| 1   | ناقل تلوث `process.env` العام للعمليات عبر `POST /env-config` | `env-config/route.ts`, `runtimeEnv.ts`   |
| 2   | تسرّب عزل المستأجر في البحث الـlexical                        | `postgres.ts: searchPostgresLexical`     |
| 3   | حد المعدل غائب عن auth endpoints + limiter في-memory          | `rateLimiter.ts`, auth routes غير مغلّفة |

### 🟠 P1 — عالية

| #   | المخاطرة                                                                    | الموقع                       |
| --- | --------------------------------------------------------------------------- | ---------------------------- |
| 4   | MCP OAuth مُحاكى تماماً (لا token endpoint، PKCE غير مستخدم، iss substring) | `mcp/auth/oauth-manager.ts`  |
| 5   | Timing Oracle في login يكشف وجود المستأجر                                   | `auth/login/route.ts`        |
| 6   | OCR cache cross-tenant بـ hash فقط                                          | `documents/parse/route.ts`   |
| 7   | Qdrant point-id hash 32-بت قابل للتصادم                                     | `qdrant.ts: toQdrantPointId` |
| 8   | PII redaction ناقصة في chat/stream (لا post_inference)                      | `chat/stream/route.ts`       |
| 9   | "درع الحقن" regex على الـ prompt فقط، لا المستندات المسترجَعة               | `hook-harness.ts`            |

### 🟡 P2 — متوسطة

| #   | المخاطرة                                                                  |
| --- | ------------------------------------------------------------------------- |
| 10  | Fallback لاصق أحادي الاتجاه إلى memory على أي خطأ postgres                |
| 11  | ثلاث نسخ DDL مكررة — خطر تزحزّج schema؛ `./drizzle` غير مستخدم في runtime |
| 12  | لا فهرس btree على `tenant_id` — كل reads seq-scan                         |
| 13  | Timestamps `VARCHAR` — لا date math، تَرتيب هش                            |
| 14  | Text chunking غير متّسق ويتجاهل إعداد `chunkSize` للمستأجر                |
| 15  | `normalizeTo3072` tiling يُشوّش هندسة embeddings للأبعاد المختلفة         |
| 16  | Pretend/ping MCP يُزيّن `healthy` للنقاط المستحيلة الداخلية               |

### 🟢 P3 — جمالية/هيكلية

| #   | المخاطرة                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------- |
| 17  | Dark-mode غير ثابت (Tailwind custom-variant ناقص)                                                         |
| 18  | `showFirstLaunchEnvModal` ميت، مكونات ميتة، dead prop `onCitationClick`                                   |
| 19  | Version drift (v0.4.7 vs `OMNIRAG v2.4`، Gemini 3.6 vs 3.7)                                               |
| 20  | `analytics` MRR/Recall مُفترى بصيغة العلاقة بصحة الوثائق                                                  |
| 21  | `conversations/save_message` يعتمد `msg.id` من العميل رغم تعليق يَعِد إعادة توليده                        |
| 22  | `mcp/generate-tool` يبني GoogleGenAI في module load من `process.env` (لا يلتقط المفاتيح المُهيأة runtime) |
| 23  | `sdlc-analyze` catch يُعيد HTTP 200 مع rating مزيف                                                        |
| 24  | ملفات ضخمة + `any` واسعة + تكرار منطق بين KnowledgeBase و SourcesDashboard                                |
| 25  | `tsconfig.tsbuildinfo` في git، root test-* scripts دِفْر، `1MB JPEG` كـ favicon                           |

---

## 9) الجاهزية للإنتاج والخلاصة

تطبيق احترافي البنية، قوي الـ RAG، لكن **غير جاهز للنشر متعدد المستأجرين في الإنتاج كما هو**. ثلاث نتائج P0 (تلوث env شامل، تسرّب الـlexical عبر tenant، غياب throttling على auth) يجب سدها قبل أن يقبل المشروع أي مستخدم حقيقي. تعليق README بأن العزل "محمي بـ RLS" غير دقيق ويجب تعديله أو تفعيل الـ RLS فعلاً.

**الحكم النهائي:** الأرضية الهندسية ثابتة على الأعمدة التالية: عقد تخزين قابل للتبديل + مصادقة معتم صحيحة + محرك RAG مع RRF قوي + CI أمني + SDLC توثيقي. لكن المُحاكاة اللا OAuth وناقل المفاتيح من الـ header/body إلى `process.env` يُمثّل خطراً على ثقة المؤسسات متعددة المستأجرين.
