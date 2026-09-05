# تقرير الفحص الشامل — منصة OmniRAG

**التاريخ:** 2026-08-29 | **النسخة:** 0.10.0 | **الفرع:** `dev-pro` | **الفاحص:** ZCode (فحص آلي شامل ثلاثي المسارات)

---

## 1. الملخص التنفيذي

OmniRAG منصة **Enterprise Agentic RAG** متعددة المستأجرين (Multi-tenant)، ثنائية اللغة (عربي/إنجليزي)، مبنية على Next.js 16.3.1 (App Router) + React 19.2.8 + TypeScript 5.9.3 (strict) + Tailwind CSS v4، مع طبقة خلفية مركزها 61 نقطة نهاية API، قاعدة بيانات PostgreSQL عبر Drizzle ORM و`pg` Pool، مخزن متجهات Qdrant، بوابة MCP كاملة، ومصادقة مخصصة قوية.

**الحكم العام:** التطبيق فوق المتوسط بوضوح في الأمان (Argon2id بمعايير OWASP، جلسات معتمة قابلة للإلغاء، تشفير AES-256-GCM للاعتمادات، 49 ملف اختبار) لكنه يعاني من:

| المحور         | التقييم   | الخلاصة                                                                                                                   |
| -------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| الأمان         | 🟠 7/10   | أساس ممتاز، لكن ثغرة XSS حقيقية عبر mermaid، لا CSP، وrate limiting معنوي فقط على serverless                              |
| الأداء         | 🔴 5/10   | استعلامات بلا pagination تعيد بيانات المستأجر كاملة، لا فهرس للبحث النصي، حزمة عميل ضخمة بلا تقسيم                        |
| تجربة المستخدم | 🟠 6.5/10 | شاشة بيضاء عند الإقلاع (لا loading fallback)، `<html lang>` لا يتغير مع اللغة، هجرة i18n 30% فقط، لا جوال لواجهة المحادثة |
| جودة الكود     | 🟡 7.5/10 | TypeScript strict، CI كامل، اختبارات جيدة، لكن مكونات عملاقة (KnowledgeBase 2263 سطرًا) وأنماط مكررة                      |

---

## 2. البنية والتقنيات (Tech Stack)

| المجال         | التقنية                                                                                                                                                        | الدليل                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| الإطار         | Next.js 16.3.1 (App Router، `serverActions bodySizeLimit 10mb`)                                                                                                | `next.config.ts`                                 |
| UI Runtime     | React 19.2.8 / react-dom 19.2.8، TypeScript 5.9.3 strict                                                                                                       | `package.json`، `tsconfig.json`                  |
| التنسيق        | Tailwind CSS v4 (CSS-first عبر `@tailwindcss/postcss`، لا ملف config)                                                                                          | `postcss.config.mjs`، `src/app/globals.css`      |
| مكونات UI      | مخصصة يدويًا (4 primitives فقط: Modal, Toast, ConfirmDialog, CodeBlock)، أيقونات lucide-react، رسوم echarts + d3، حركة `motion` + Remotion لفيديو الـ hero     | `src/components/ui/`                             |
| قاعدة البيانات | PostgreSQL عبر `pg` Pool خام **و** Drizzle ORM 0.45.2 فوق نفس الـ pool                                                                                         | `src/db/index.ts`، `src/lib/storage/postgres.ts` |
| المتجهات       | Qdrant (أساسي) مع adapters قابلة للتبديل (pgvector، memory)، أبعاد ثابتة 3072                                                                                  | `src/lib/storage/vectors/adapters/`              |
| التخزين        | S3-compatible (Tigris/R2/MinIO)، Vercel Blob، نظام ملفات محلي                                                                                                  | `src/lib/storage/objects/adapters/`              |
| المصادقة       | مخصصة: Argon2id، جلسات معتمة بـ DB (ليست JWT)، API keys بـ SHA-256 hash، OIDC SSO بـ PKCE                                                                      | `src/lib/auth/`، `src/db/schema.ts`              |
| AI/RAG         | Vercel AI SDK v7 (`ai` 7.0.x) مع 6 adapters (OpenAI، Anthropic، Google، Groq، Mistral، openai-compatible)، استرجاع هجين (لفظي + متجهي + RRF fusion + reranker) | `src/lib/ai/registry/adapters/`، `src/lib/rag/`  |
| MCP            | `@modelcontextprotocol/sdk` — بوابة كاملة، OAuth مشفرة AES-256-GCM، 10 جداول                                                                                   | `src/lib/mcp/`                                   |
| المدفوعات      | **لا شيء** — خطط مجانية بالكامل (`planService.ts`)                                                                                                             | —                                                |
| البريد         | nodemailer + imapflow                                                                                                                                          | `src/lib/skills/emailSender.ts`                  |
| Cron           | Vercel cron يومي `/api/v1/jobs/tick` + قائمة انتظار pg-boss                                                                                                    | `vercel.json`، `src/lib/jobs/queue.ts`           |
| i18n           | مخصص: قواميس ar/en مطبوعة (typed) بـ 25 namespace، ~1030 سطرًا لكل لغة                                                                                         | `src/lib/i18n/`                                  |
| الاختبارات     | Vitest 4 (node env)، 49 ملف اختبار                                                                                                                             | `vitest.config.ts`، `src/__tests__/`             |
| النشر          | Vercel (رئيسي) + Docker + سيرفر Node مخصص (`server.ts`)                                                                                                        | ملفات الجذر                                      |
| مدير الحزم     | npm فقط (`package-lock.json` lockfileVersion 3، 1314 حزمة)                                                                                                     | الجذر                                            |

**البنية الفعلية:** تطبيق SPA بمسار واحد — `src/app/page.tsx` يحمّل `MainApp` بـ `ssr: false`، وكل "الصفحات" عبارة عن تبويبات داخل الـ shell. لا توجد Server Components تُنتج UI (الاستثناء الوحيد: error boundaries). هذا رهان معماري مقصود لكنه يكلف الإقلاع وSEO.

**جدول قاعدة البيانات:** 22 جدولًا في `src/db/schema.ts` — كلها تحمل `tenantId` (عزل يدوي بلا FK constraints):

- **الهوية:** `users` → `tenants` → `memberships` (owner/admin/editor/viewer)، `sessions`، `sso_flows`، `invitations`، `teams` + `team_members`، `resource_shares`
- **نواة RAG:** `documents` → `chunks` (المتجهات في Qdrant)، `collections` (علاقات many↔many عبر jsonb لا جداول ربط)
- **التشغيل:** `sources` (10 موصلات) → `sync_logs`، `conversations` → `messages`، `mcp_servers`، `tool_calls`، `audit_logs`، `webhook_endpoints`، `api_keys`، `provider_credentials`

**قرار هندسي موثق:** كل الطوابع الزمنية `varchar(100)` ISO-8601 وليست `timestamptz` — مقصود مع تعليق تحذيري في `schema.ts:4-18` لكنه يمنع فهارس SQL الزمنية.

---

## 3. صحة التبعيات (Dependency Health)

57 runtime deps + 33 devDeps. الملخص: قاعدة حديثة جدًا (React 19.2.8 هو الأحدث، Tailwind 4.3.3 الأحدث، Drizzle 0.45.2 الأحدث، pg 8.23.0 الأحدث).

### أبرز الفجوات

| الحزمة        | المثبتة             | الأحدث | الفجوة                                                                            |
| ------------- | ------------------- | ------ | --------------------------------------------------------------------------------- |
| next          | 16.3.1              | 16.3.3 | تحديث patch خفيف                                                                  |
| nodemailer    | 7.0.13              | 9.0.6  | **Majorان متأخرة — أكبر فجوة حقيقية**                                             |
| typescript    | 5.9.3               | 7.0.2  | Major متاح لكن typescript-eslint لم يدعمه بعد — البقاء على 5.9.x قرار صحيح حاليًا |
| zod           | 4.4.3               | 4.5.2  | minor                                                                             |
| ai            | 7.0.66→7.0.83 مثبتة | 7.0.84 | patch                                                                             |
| lucide-react  | 1.31.0              | 1.37.0 | minor                                                                             |
| @google/genai | 2.17.1              | 2.19.0 | minor                                                                             |
| vitest        | 4.1.10              | 4.1.11 | patch                                                                             |

### ملاحظات صحية

1. **Loose caret floors**: `@qdrant/js-client-rest ^1.11.0` مثبت فعليًا 1.19.0 (9 minors انجراف)، `pg ^8.13.0 → 8.23.0` — الأرضيات المعلنة تقلل واقع المثبت.
2. **`@types/pdf-parse` في `dependencies`** بدل `devDependencies` — misplaced.
3. **لا lockfile مشترك** (npm فقط) — نظيف.
4. `experimental.webpackBuildWorker: false` في next.config — يعطل تحسين بناء، يستحق توثيق سببه.
5. `.env` مهمل gitignore بشكل صحيح + `.env.example` موثق جيدًا (لكنه يشحن قيمة تشبه مفتاحًا لـ `MCP_OAUTH_ENCRYPTION_KEY` قد تُنسخ كما هي).
6. `mysql2` runtime dep فقط لموصل قواعد البيانات — سطح هجوم/تعقيد إضافي.

---

## 4. الأمان — المخاطر مرتبة حسب الخطورة

### 🔴 عالية

1. **XSS عبر mermaid** — `src/components/chat/RichMessageRenderer.tsx:176` يحقن مخرجات `mermaid.render()` (محتوى متحكم به من LLM/المستخدم) عبر `dangerouslySetInnerHTML` **بدون أي تعقيم (لا DOMPurify)**. mermaid له تاريخ ثغرات XSS-in-SVG. أعلى سطح هجوم قابل للاستغلال.
2. **لا CSP / HSTS / Referrer-Policy إطلاقًا** — `src/middleware.ts:32-41` يضيف nosniff/X-Frame-Options **فقط** عند تطابق Origin مع قائمة CORS؛ الطلبات غير المتطابقة لا تحصل على أي تحصين. `grep` يؤكد غياب `Content-Security-Policy` و`Strict-Transport-Security` من الكود كله. البند 1 يصبح غير قابل للاستغلال غالبًا مع CSP صارم.
3. **Rate limiting بالذاكرة فقط** — `src/lib/security/rateLimiter.ts:7` مخزن module-level. الكود نفسه يوثق الضعف (سطور 12-16): per-process، يُمسح مع كل cold start، الحد الفعلي = N× عدد النسخ على serverless. حماية brute-force لتسجيل الدخول ونقاط share tokens ضعيفة على Vercel.
4. **RLS معطل عن قصد** — `src/lib/storage/postgres.ts:369-372` ينفذ `DISABLE ROW LEVEL SECURITY` ويحذف السياسات؛ العزل يعتمد كليًا على إدراج `tenant_id = $N` يدويًا في كل استعلام عبر ملف SQL خام بـ 2273 سطرًا. أي predicate مفقود = تسريب بين المستأجرين. يوجد اختبار عزل (`lexicalTenantIsolation.test.ts`) لكن شبكة الأمان مُزالة.
   **[معالج v0.12.8]** القرار: بقاء العزل على مستوى التطبيق (توثيق كامل في `docs/06-security/overview.md` — قسم "وضع Row Level Security")، مع شبكة اختبارات `src/__tests__/tenantPredicateCoverage.test.ts` التي تفشل على أي SQL يلامس جدولاً tenant-scoped بلا predicate مستأجر. تصحيح نص شروط الخدمة في `constants.ts` الذي ادّعى تفعيل RLS.

### 🟠 متوسطة

5. **SSRF بـ hostname-regex فقط** — `src/lib/mcp/net.ts:21-35` يمنع أنماط IP الخاصة كنص، لكنه لا يحل DNS — أسماء عامة تحل إلى IP داخلي (nip.io، DNS rebinding) تتجاوزه في كل مسارات الخروج (web-fetch، أدوات MCP، مزامنة الموصلات).
6. **CSRF رفيع على غير مسارات المصادقة** — ترويسة `x-requested-with` قابلة للتزييف من أي سكربت؛ كل مسارات تعديل الحالة غير المصادقية تعتمد على `SameSite=Lax` وحده.
7. **قراءات كاملة غير مقسمة** — `GET /api/v1/documents` يعيد كل محتوى المستندات (حتى 4M حرف للمستند)؛ `?documentId=` يحمّل كل chunks ثم يرشّح في JS؛ `/api/v1/sources` يعيد كل سجلات المزامنة. مع جلسة/مفتاح مسروق = exfiltration بطلب واحد.
8. **ترقية خطة مجانية إلى غير محدود** — `PUT /api/v1/plan` يمنح `enterprise` (كل الحصص null) لأي owner بلا دفع، ولا توجد حصة tokens على استهلاك LLM — مستأجر واحد يحرق مفاتيح المنصة.
9. **درع حقن التعليمات regex-based** — `hook-harness.ts:24-46` يُتجاوز بإعادة الصياغة؛ جيد كطبقة، خطر إن عُدّcontrolًا.

### 🟡 منخفضة/تشغيلية

10. **مفتاح AES احتياطي dev ملتزم في الكود** — `encryption.ts:19-29` (يفشل hard في الإنتاج، لكنه موجود) + قيمة placeholder في `.env.example:44`.
    **[معالج v0.12.8]** أُزيلت القيمة المعبأة من `.env.example` وأصبحت سلسلة فارغة مع تحذير صريح بعدم وضع مفتاح حقيقي فيها.
11. Swagger UI من unpkg CDN بلا CSP على `/api/docs`.
12. `mysql2` كسطح استعلام إضافي.

### ما هو قوي فعلًا (يُحفظ)

- Argon2id بمعاملات OWASP (m=19456, t=2, p=1) + **دفاع timing-oracle** (تحقق dummy-hash لمستخدمين غير موجودين) في `login/route.ts:63-71`
- جلسات معتمة 32-byte قابلة للإلغاء فورًا بحذف الصف (ليست JWT)
- API keys: SHA-256 hash فقط + scopes + حدود لكل مفتاح
- تشفير AES-256-GCM لاعتمادات الموفرين وأسرار webhooks مع إلزام المفتاح في الإنتاج
- OIDC SSO بـ PKCE S256 + state أحادي الاستخدام + ربط redirect URI
- RBAC بمصفوفة 22 صلاحية، قائمة سماح إيجابية
- اختبارات: mcpNetSsrf، injectionShield، piiStreamRedactor، lexicalTenantIsolation، apiKeys، webRandom…
- تحقق zod في المسارات الأخطر (documents، search، web-fetch)
- حماية SSRF نصية + PII redactor على كل streamed delta
- Gitleaks CI + `npm audit --omit=dev --audit-level=high`

---

## 5. الأداء — الاختناقات مرتبة حسب التأثير

1. **استعلامات unpaginated لكامل المستأجر** — `getDocuments/getChunks/getSources/getSyncLogs` تعيد كل شيء؛ documents GET يرشّح في JS (`documents/route.ts:59-62`)؛ الذاكرة والزمن والحجم يتضخمون خطيًا مع البيانات. أكبر مضاعف تكلفة على Vercel.
2. **لا فهرس GIN للبحث النصي** — `searchPostgresLexical` (`postgres.ts:1566-1578`) يفحص ts_rank على كل chunk للمستأجر **seq-scan** لكل استعلام؛ ولا فهرس مركب `(tenant_id, document_id)` على chunks (أحر الاستعلامات ترشّح الاثنين).
3. **Lazy migration عند أول طلب** — 47 عبارة DDL (مجمعة 12/رحلة بعد إصلاح `e16f72b`) + فحص seeds داخل أول استدعاء DB لكل نسخة باردة — يجب أن تكون migration وقت النشر لا وقت الطلب.
4. **حزمة عميل ضخمة بلا تقسيم** — مسار واحد، وKnowledgeBase (2263 سطرًا) + McpGateway (1866) + ChatStudio (1292) + DocumentIngestionStudio (2211) كلها في حزمة الإقلاع؛ `ReactMarkdown`+KaTeX+katex4arabic مستوردة استاتيكيًا في مسار المحادثة؛ `motion` (framer-motion) يشحن لرسمين فقط.
5. **خطوط Google `@import` حاجب للرسم** — `globals.css:1` يستورد 4 عائلات (13 ملف weight) بلا next/font — يضرب FCP مباشرة.
6. **Cron يومي واحد بعقد 45 ثانية** — `/api/v1/jobs/tick` هو العامل الوحيد؛ الموصلات المجدولة أكثر من يوميًا تتدهور صامتًا؛ `maxDuration 300` على عدة مسارات يتجاوز سقف Hobby الفعلي ويُقص.
7. **كل مسار force-dynamic بلا كاش** — لا revalidateTag ولا KV؛ capabilities/system-status/presets تعاد حسابها لكل طلب رغم أنها شبه ثابتة.
8. **كاشات في الذاكرة تضيع لكل نسخة** — embedding LRU (500)، OCR LRU، اختيار vector-store (60s) — تكلفة embedding API تُدفع مجددًا لكل cold instance.
9. **مسارات N+1** — `addChunk` المنفرد يفعل lookup لكل chunk؛ حلقات seeds متسلسلة؛ `getDocuments` بـ `documentId` يحمّل الكل ثم يرشّح.
10. **OCR الثقيل فوق حدود Hobby** — OCR كتاب كامل ≈ 7.4 دقيقة (موثق في تعليقات المسار) مقابل 60 ثانية maxDuration.

---

## 6. تجربة المستخدم و a11y و i18n

### الحرجة

1. **شاشة بيضاء عند الإقلاع** — `page.tsx` يحمّل `MainApp` بـ `ssr:false` **بدون** `loading:` fallback؛ ملف `ClientHome.tsx` المُعد لهذا الغرض موجود لكنه غير مستخدم. المستخدم يحدق في فراغ حتى اكتمال حزمة ~23k سطر + markdown/KaTeX/framer-motion. أسوأ UX في التطبيق + HTML فارغ لـ SEO/share previews.
2. **`<html lang="ar" dir="rtl">` لا يتغير أبدًا** — `layout.tsx:32` مثبت، والـ preferences store يكتب `data-*` لكنه لا يلمس `lang`/`dir` (لا `setAttribute('lang')` في أي مكان). مستخدم الإنجليزية يحصل على مستند معلن عربيًا: تشكيل خط خطأ، قراءة قارئ شاشة بلهجة عربية لنص إنجليزي. كل تبويب يعوّض محليًا بـ `dir={...}` في 12+ موضعًا.
3. **هجرة i18n ~30% فقط** — 370 نصًا ثنائيًا مضمّنًا `lang === 'ar' ? ... : ...` في 38 ملفًا، منها 148 في KnowledgeBase وحده، وLandingPage كامل (سطور 58-120)، وجدول `KB_TABS` موازٍ للقواميس (سطور 74-90) — انحراف ar/en مضمون مستقبلًا في نفس النصوص التي بُنيت القواميس لحمايتها.

### المتوسطة

4. **لا تخطيط جوال لواجهة المحادثة** — تخطيط 3 لوحات gated بـ `matchMedia('(min-width: 1280px)')` (`ChatStudio.tsx:71-77`)؛ تحت ذلك الـ inspector لا يُركب أصلًا — السطح الرئيسي للمنصة غير صالح على الهاتف.
5. **لا React Query/SWR** — كل view يكرر `useState(loading/error)` + `fetchWithAuth` + `finally` (24 مكونًا)؛ لا كاش ولا dedupe، وrefetch storm بعد كل mutation.
6. **Toast مبني لكن مهمل** — 3 مكونات فقط تستهلك `useToast` من ~20.
7. **SettingsView يركب 12 قسمًا دفعة واحدة** بـ `hidden` toggles (سطور 320-773) — كل تبديل يعيد رسم كل شيء.
8. **a11y متفرقة** — 79 aria في 50 ملفًا؛ tabs بلا `role="tab"`/`aria-selected`؛ لا skip-link؛ 14 `htmlFor` فقط؛ 34 `ml-/mr-/pl-/pr-` و34 `text-left/right` فيزيائية متبقية مقابل 104 منطقية.
9. **localStorage كقاعدة بيانات** — 50 استدعاء في 8 ملفات + ناقل أحداث مخصص `omnirag_profile_changed` للمزامنة.
10. **نماذج بلا inline errors ولا مؤشر قوة كلمة مرور**؛ zod عميل متاح لكنه غير مستخدم.

### ما هو جيد فعلًا (يُحفظ)

- القواميس ar/en المطابقة مطبوعة (typo في ar = خطأ compile) مع fallback إنجليزي
- `Modal` يحقق focus trap/restore/scroll lock/`aria-modal`
- بث AI SDK بـ transport مستقر + `ChatMessage` memo بمقارن مخصص
- `useSyncExternalStore` في preferences store (hydration-safe)
- KaTeX4Arabic للرياضيات RTL
- تمييز outage عن empty state في KnowledgeBase (معلق في الكود)
- طبقة dark-mode retrofit موثقة بعناية + CSS طباعة/PDF مخصص

---

## 7. جودة الكود والاختبارات والبنية التحتية

- **TypeScript strict** عبر الكود (302 ملف .ts/.tsx في src/)، ESLint flat + Prettier + husky/lint-staged.
- **CI**: lint + typecheck + vitest + npm audit على `main` فقط — **الفرع الحالي dev-pro غير مغطى**. Gitleaks منفصل. لا coverage ولا e2e ولا deploy-preview smoke.
- **اختبارات**: 49 ملف vitest تغطي الأسطح الأمنية (login، passwords، apiAuth، encryption، SSRF، tenant isolation، PII، RRF، quotas).
- **Docs**: README بالعربية (يذكر Next.js 15+ وv0.1.8 بينما package 0.10.0 — يحتاج تحديث)، شجرة SDLC/ ثرية (PRD→roadmap)، تقرير openapi.json حي. لا docs/ للعمليات: لا توثيق أن `CRON_SECRET` و`MCP_OAUTH_ENCRYPTION_KEY` إلزاميان في الإنتاج.
- **فوضى الجذر**: سكربتات test-*.ts/js مؤقتة، todo.md، .todo.json، 7.7MB traineddata (gitignored لكنها على القرص).

---

## 8. خلاصة أولويات التحرك

| #   | البند                                         | التصنيف  | الجهد |
| --- | --------------------------------------------- | -------- | ----- |
| 1   | XSS mermaid + CSP/HSTS/رؤوس شاملة             | أمان حرج | صغير  |
| 2   | Rate limiting بـ Postgres/Redis دائم          | أمان حرج | متوسط |
| 3   | قفل ترقية الخطة + حصة tokens                  | أمان حرج | صغير  |
| 4   | CSRF مركزي Origin-check                       | أمان     | صغير  |
| 5   | SSRF بـ DNS resolution                        | أمان     | صغير  |
| 6   | Pagination + فهارس GIN/مركب                   | أداء     | متوسط |
| 7   | loading fallback + تقسيم حزم + next/font      | UX/أداء  | متوسط |
| 8   | كوكي lang/theme + `lang`/`dir` من الخادم      | UX/a11y  | صغير  |
| 9   | تحويل تدريجي لمسارات متعددة                   | بنية     | كبير  |
| 10  | إكمال هجرة i18n + جوال المحادثة + React Query | UX       | كبير  |

_الفجوات التفصيلية بأدلة الملف:السطر موثقة في خطة التحسين المصاحبة `2026-08-29-improvement-plan.md`._
