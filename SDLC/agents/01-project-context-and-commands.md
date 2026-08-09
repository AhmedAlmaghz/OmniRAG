# Project Context and Commands

> وثيقة السياق الثابت لوكلاء OmniRAG. اقرأ هذا القسم قبل أي مهمة برمجية. للاطلاع على قواعد الترميز وعقد الاختبار، انتقل إلى [Coding Rules and Testing Contract](./02-coding-rules-and-testing-contract.md). لتدفق العمل ومعايير الإنهاء، انتقل إلى [Workflow, Done Criteria, and Boundaries](./03-workflow-done-criteria-and-boundaries.md).

## 1. نظرة عامة على المشروع

| البُعد | التفاصيل |
|---|---|
| **الاسم** | OmniRAG — منصة الاسترجاع التوليدي الهجين ثنائية اللغة |
| **النوع** | تطبيق ويب مؤسسي كامل (Full Enterprise Web App) |
| **النطاق المستهدف** | مؤسسي واسع النطاق (Enterprise Scale) |
| **الجمهور** | مستخدمون عامون |
| **المنصات** | الويب (Vercel Edge + Serverless) |
| **الامتثال** | GDPR / HIPAA / PCI |
| **اللغات المدعومة** | العربية (RTL أصلي) والإنجليزية مع معالجة مختلطة |
| **التوثيق التقني** | تُحفظ كل وثيقة في مجلد `/docs` بأسماء إنجليزية ثابتة |

## 2. المكدس التقني المعتمد (Stack)

### 2.1 طبقة الواجهة والتطبيق

| التقنية | الإصدار | التبرير |
|---|---|---|
| **Next.js** | 15+ (App Router) | Server Components + Server Actions + Edge Runtime يتيح لنا تنفيذ منطق RAG قرب المستخدم |
| **React** | 19+ | يُمكّن من Actions و`use()` للأحداث غير المتزامنة ودفق SSE |
| **TypeScript** | 5.x (strict) | يضمن نوعية صارمة لحدود API وعقود أدوات MCP |
| **Tailwind CSS** | 3.4+ | تكامل سريع مع دعم RTL عبر `dir="rtl"` |
| **shadcn/ui** | أحدث | مكتبة مكوّنات قابلة للتملك (owned) تتوافق مع متطلبات المؤسسات |
| **next-intl** | 3.x | ترجمة كاملة (عربي/إنجليزي) مع تبديل RTL/LTR |
| **Zod** | 4.x | مخططات التحقق في حدود API وأدوات MCP |
| **Vercel AI SDK** | 4.x | دفق الإجابات + Tool Use + `generateText` للوكلاء |

### 2.2 طبقة الذكاء الاصطناعي ومعالجة المستندات

| التقنية | الدور |
|---|---|
| **gemini-embedding-2** | التضمين متعدد الوسائط (3072 بُعداً، يدعم 100+ لغة) |
| **gemini-3.5-flash-lite** | المهام منخفضة التأخير: التصنيف، التلخيص، أسئلة المتابعة |
| **gemini-3.6-flash** | الاستدلال المعقد، التحليل متعدد المستندات، البرمجة الوكيلة |
| **Mistral Document AI (OCR 4)** | معالجة PDF الممسوح والمستندات المعقدة بـ 170 لغة |
| **Unstructured Transform API** | تحويل 60+ نوع ملف إلى بيانات منظمة |

### 2.3 طبقة البيانات والتخزين

| التقنية | الدور | الموقع |
|---|---|---|
| **Neon Postgres** | بيانات وصفية، مستخدمون، محادثات، سجلات MCP، RLS | خادم مُدار |
| **pgvector** | بحث متجهي احتياطي داخل Postgres | ملحق Neon |
| **Qdrant Cloud** | البحث الدلالي الأساسي، ANN + Payload Filtering | خادم مُدار |
| **Vercel KV (Redis)** | تخزين جلسات، كاش الاستعلامات، حدود المعدل | مُدار |
| **Vercel Blob / S3** | تخزين الملفات الخام بمسارات معزولة | `/tenants/{tenant_id}/...` |

### 2.4 المصادقة والبنية التحتية

| التقنية | الدور |
|---|---|
| **NextAuth.js / Clerk** | المصادقة الأساسية + OAuth (Google, GitHub) |
| **JWT + Refresh Tokens** | رموز API قصيرة العمر مع تجديد |
| **Row-Level Security (RLS)** | عزل على مستوى الصفوف في كل جدول Postgres |
| **Inngest / Trigger.dev** | مهام غير متزامنة (استيعاب، إعادة تضمين، مزامنة) |
| **Vercel Edge + Serverless** | النشر مع دوال Edge للمصادقة والتوجيه، Serverless للعمليات الثقيلة |

### 2.5 طبقة MCP (Model Context Protocol)

| التقنية | الإصدار |
|---|---|
| **@modelcontextprotocol/server** | 2.0.0 |
| **@modelcontextprotocol/client** | 2.0.0 |
| **@modelcontextprotocol/node** | 2.0.0 |
| **مواصفة البروتوكول** | 2026-07-28 (Stateless) |
| **النقل** | Streamable HTTP (لا stdio في الإنتاج) |
| **المصادقة** | OAuth 2.0 + RFC 8707 Resource Indicators + RFC 9207 ISS Validation |

> **تبرير اختيار MCP:** البروتوكول الجديد 2026-07-28 أصبح stateless بالكامل، مما يلغي الحاجة إلى sticky sessions وموازن تحميل خاص، ويعمل خلف round-robin عادي على Vercel. هذا يبسّط البنية ويتيح التوسع الأفقي دون أي تكلفة إضافية.

## 3. خريطة المستودع (Repository Map)

```
omnirag/
├── app/                            # Next.js 15 App Router
│   ├── (auth)/                     # مجموعة مسارات المصادقة
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── layout.tsx
│   ├── (dashboard)/                # مجموعة مسارات محمية
│   │   ├── dashboard/page.tsx      # لوحة التحكم الرئيسية
│   │   ├── chat/                   # واجهة المحادثة
│   │   ├── sources/                # إدارة المصادر
│   │   ├── knowledge/              # إدارة قاعدة المعرفة
│   │   ├── analytics/              # التحليلات
│   │   ├── settings/               # الإعدادات
│   │   └── mcp-hub/                # مركز تكاملات MCP
│   ├── api/                        # نقاط نهاية API
│   │   ├── v1/
│   │   │   ├── auth/               # المصادقة
│   │   │   ├── sources/            # المصادر
│   │   │   ├── documents/          # المستندات
│   │   │   ├── chat/               # المحادثة + SSE
│   │   │   ├── search/             # البحث الهجين
│   │   │   ├── collections/        # المجموعات
│   │   │   ├── conversations/      # المحادثات
│   │   │   ├── analytics/          # التحليلات
│   │   │   └── settings/           # الإعدادات
│   │   ├── mcp/                    # بوابة MCP (Stateless)
│   │   │   └── [...path]/route.ts
│   │   └── webhooks/               # Webhooks واردة
│   ├── layout.tsx                  # التخطيط الجذر + RTL/LTR
│   └── globals.css
├── components/                     # مكوّنات React القابلة لإعادة الاستخدام
│   ├── ui/                         # مكوّنات shadcn/ui
│   ├── chat/                       # مكوّنات المحادثة
│   ├── dashboard/                  # مكوّنات لوحة التحكم
│   ├── mcp/                        # مكوّنات MCP-Hub
│   └── shared/                     # مكوّنات مشتركة
├── lib/
│   ├── auth/                       # منطق المصادقة + RLS
│   ├── db/                         # عملاء + استعلامات Neon
│   │   ├── schema/                 # مخططات Drizzle/Prisma
│   │   └── migrations/             # هجرات قاعدة البيانات
│   ├── rag/                        # محرك RAG الهجين
│   │   ├── ingestion/              # خط أنابيب الاستيعاب
│   │   ├── chunking/               # استراتيجيات التقسيم
│   │   ├── embedding/              # منطق التضمين
│   │   ├── search/                 # البحث الدلالي + المعجمي + RRF
│   │   ├── rerank/                 # إعادة الترتيب
│   │   ├── generation/             # التوليد + التدفق
│   │   └── agentic-engine.ts       # محرك الوكيل
│   ├── mcp/                        # طبقة MCP
│   │   ├── gateway.ts              # البوابة (Stateless)
│   │   ├── registry.ts             # سجل الأدوات الديناميكي
│   │   ├── resources.ts            # الموارد (Resources)
│   │   ├── client-pool.ts          # تجمع العملاء
│   │   ├── auth/                   # OAuth + RFC 8707/9207
│   │   ├── audit.ts                # سجل التدقيق
│   │   └── servers/                # تكاملات الخوادم الخارجية
│   ├── i18n/                       # رسائل عربي/إنجليزي
│   ├── validation/                 # مخططات Zod مشتركة
│   └── utils/                      # أدوات مساعدة عامة
├── messages/                       # ملفات الترجمة
│   ├── ar.json
│   └── en.json
├── public/                         # أصول ثابتة
├── tests/
│   ├── unit/                       # اختبارات وحدة
│   ├── integration/                # اختبارات تكامل
│   ├── e2e/                        # اختبارات شاملة (Playwright)
│   └── evals/                      # تقييمات LM (rubrics)
├── docs/                           # الوثائق التقنية
├── scripts/                        # سكربتات مساعدة
├── .env.example                    # مثال للمتغيرات البيئية
├── AGENTS.md                       # نقطة دخول الوكلاء
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

### 3.1 قواعد تسمية الملفات

| الفئة | القاعدة | مثال |
|---|---|---|
| صفحات | `kebab-case.tsx` | `chat-history-panel.tsx` |
| مكوّنات React | `PascalCase.tsx` | `MessageBubble.tsx` |
| أدوات/دوال | `kebab-case.ts` | `hybrid-search.ts` |
| مخططات Zod | `kebab-case.schema.ts` | `chat.schema.ts` |
| مخططات قاعدة البيانات | `snake_case.sql` | `001_create_users.sql` |
| اختبارات | `{name}.test.ts(x)` | `hybrid-search.test.ts` |
| تقييمات | `{name}.eval.ts` | `rag-quality.eval.ts` |
| وثائق | `NN-kebab-case.md` | `01-project-context-and-commands.md` |

## 4. المتغيرات البيئية (.env.example)

| المتغير | الوصف | إلزامي |
|---|---|---|
| `DATABASE_URL` | اتصال Neon Postgres مع pooling | نعم |
| `DATABASE_URL_UNPOOLED` | اتصال مباشر للهجرات | نعم |
| `QDRANT_URL` + `QDRANT_API_KEY` | نقطة نهاية Qdrant | نعم |
| `GOOGLE_GENERATIVE_AI_API_KEY` | مفاتيح Gemini | نعم |
| `MISTRAL_API_KEY` | مفتاح Mistral Document AI | نعم |
| `UNSTRUCTURED_API_KEY` | مفتاح Unstructured | نعم |
| `NEXTAUTH_SECRET` + `NEXTAUTH_URL` | مصادقة NextAuth | نعم |
| `KV_URL` + `KV_REST_API_TOKEN` | Vercel KV | نعم |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob | نعم |
| `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` | Inngest | نعم |
| `MCP_ENCRYPTION_KEY` | مفتاح AES-256 لتشفير رموز MCP (32 بايت) | نعم |
| `MCP_RESOURCE_BASE_URL` | URI الأساسي لموارد MCP | نعم |
| `ALLOWED_MCP_DOMAINS` | قائمة بيضاء بنطاقات MCP (مفصولة بفواصل) | نعم |
| `WEB_SEARCH_PROVIDER` | `google` / `bing` / `searxng` | اختياري |
| `WEB_SEARCH_API_KEY` | مفتاح مزود البحث | اختياري |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` | لا (افتراضي `info`) |
| `NODE_ENV` | `development` / `production` / `test` | نعم |

> **قاعدة صارمة:** أي مفتاح API يجب أن يُقرأ فقط عبر `lib/env.ts` الذي يستخدم `@t3-oss/env-nextjs`. أي وصول مباشر لـ `process.env` خارج هذا الملف يُرفض في مراجعة الكود.

## 5. الأوامر التشغيلية (Operational Commands)

### 5.1 التطوير المحلي

| الأمر | الوصف |
|---|---|
| `pnpm install` | تثبيت التبعيات (يُفضل pnpm للإدارة الموحدة) |
| `pnpm dev` | تشغيل خادم التطوير على `http://localhost:3000` |
| `pnpm build` | بناء إنتاجي مع فحص الأنواع |
| `pnpm start` | تشغيل البناء الإنتاجي محلياً |
| `pnpm lint` | ESLint مع قواعد Next.js وTypeScript |
| `pnpm typecheck` | فحص الأنواع فقط عبر `tsc --noEmit` |
| `pnpm format` | Prettier على كامل المشروع |
| `pnpm format:check` | فحص التنسيق دون تعديل |

### 5.2 قاعدة البيانات

| الأمر | الوصف |
|---|---|
| `pnpm db:generate` | توليد عميل ORM من المخططات |
| `pnpm db:migrate` | تطبيق الهجرات على بيئة التطوير |
| `pnpm db:migrate:prod` | تطبيق الهجرات على الإنتاج (يتطلب تأكيد) |
| `pnpm db:push` | دفع المخطط مباشرة (للتطوير فقط) |
| `pnpm db:studio` | فتح واجهة Drizzle/Prisma Studio |
| `pnpm db:seed` | إدخال بيانات تجريبية |
| `pnpm db:reset` | حذف وإعادة بناء قاعدة البيانات المحلية (مع تأكيد) |
| `pnpm db:diff` | مقارنة المخطط الحالي مع الهجرات |

### 5.3 الاختبارات والتقييمات

| الأمر | الوصف | الهدف |
|---|---|---|
| `pnpm test` | تشغيل اختبارات الوحدة + التكامل | العقد الحتمي (Deterministic) |
| `pnpm test:watch` | وضع المراقبة أثناء التطوير | حلقة TDD |
| `pnpm test:coverage` | تقرير التغطية (الحد الأدنى 80%) | ضمان الجودة |
| `pnpm test:e2e` | اختبارات شاملة عبر Playwright | تدفقات المستخدم |
| `pnpm eval` | تشغيل تقييمات LM عبر rubric | السلوك غير الحتمي |
| `pnpm eval:rag` | تقييم جودة الاسترجاع (Recall@K, MRR, NDCG) | جودة RAG |
| `pnpm eval:arabic` | تقييم جودة التعامل مع العربية | ثنائية اللغة |
| `pnpm eval:safety` | تقييم رفض Prompt Injection والحماية | الأمان |

### 5.4 MCP والوكلاء

| الأمر | الوصف |
|---|---|
| `pnpm mcp:list` | قائمة خوادم MCP المُهيأة |
| `pnpm mcp:test <server-id>` | اختبار اتصال خادم MCP مع `tenant_id` تجريبي |
| `pnpm mcp:audit` | تصدير سجل استدعاءات MCP |
| `pnpm mcp:keys:rotate` | تدوير مفاتيح تشفير MCP (يتطلب تأكيد) |
| `pnpm agent:trace <conversation-id>` | استرجاع أثر خطوات الوكيل |

### 5.5 الجودة والامتثال

| الأمر | الوصف |
|---|---|
| `pnpm audit:deps` | فحص ثغرات التبعيات (`pnpm audit`) |
| `pnpm audit:secrets` | كشف أسرار مسرّبة في الكود (`gitleaks`) |
| `pnpm lint:rtl` | فحص دعم RTL في المكوّنات |
| `pnpm check:i18n` | التحقق من اكتمال مفاتيح الترجمة في كل اللغات |
| `pnpm check:accessibility` | فحص إمكانية الوصول (axe-core) |
| `pnpm bundle:analyze` | تحليل حجم الحزمة |

### 5.6 النشر

| الأمر | الوصف |
|---|---|
| `pnpm deploy:preview` | نشر معاينة على Vercel Preview |
| `pnpm deploy:production` | نشر إنتاجي (يحتاج مراجعة + موافقة CI) |
| `pnpm deploy:rollback` | التراجع إلى إصدار سابق |
| `pnpm logs:tail` | تتبّع السجلات المباشرة من Vercel |

## 6. عقد البيئة (Environment Contract)

لكل بيئة ثلاثة متطلبات دنيا قبل اعتبارها جاهزة للعمل:

| الطبقة | التطوير | المعاينة | الإنتاج |
|---|---|---|---|
| **CI أخضر** | اختياري | إلزامي | إلزامي |
| **الهجرات مُطبّقة** | نعم | نعم | نعم + تأكيد يدوي |
| **الأسرار مُحققة** | `.env.local` فقط | Vercel Env | Vercel Env + تدوير |
| **RLS مفعّل** | نعم | نعم | نعم + اختبار اختراق |
| **Health Check MCP** | تخطي | نعم | نعم + تنبيهات |
| **Backup سحابي** | لا | نعم | نعم + اختبار استعادة |

## 7. المسارات الحرجة التي يجب على الوكلاء معرفتها

| المسار | الوصف | حساسية |
|---|---|---|
| `app/api/mcp/[...path]/route.ts` | بوابة MCP Stateless | حرجة — أي خطأ يُعرّض جميع العملاء للخطر |
| `lib/mcp/auth/oauth-manager.ts` | إدارة OAuth لـ MCP | حرجة — RFC 8707/9207 إلزامي |
| `lib/auth/tenant.ts` | استخراج `tenant_id` من الطلب | حرجة — فشل العزل = اختراق |
| `lib/rag/agentic-engine.ts` | محرك الوكيل مع `maxSteps` | حرجة — حقن الأوامر |
| `lib/rag/ingestion/` | معالجة المستندات | حرجة — تنفيذ OCR خارجي |
| `lib/db/schema/` | مخططات قاعدة البيانات | حرجة — تغيير يؤثر على RLS |
| `app/api/chat/completions/route.ts` | تدفق SSE للمحادثة | عالية — تسريب بيانات |
| `app/api/v1/settings/account/route.ts` | حذف الحساب (GDPR) | حرجة — لا تراجع |

## 8. نقاط التوقف الإلزامية (Hard Stop Points)

يجب على الوكيل التوقف وطلب تأكيد بشري في الحالات التالية:

- أي تعديل على سياسات RLS أو تعريفات الجداول الحساسة (`users`, `documents`, `chunks`, `mcp_oauth_tokens`).
- أي تغيير في مخططات أدوات MCP التي تحمل علامة `[SIDE EFFECT]`.
- أي إضافة لمزود MCP جديد لم يُراجع أمنياً (التحقق من النطاق، طريقة المصادقة، الأذونات).
- أي تعديل على `agentic-engine.ts` يتعلق بـ `maxSteps` أو حلقة الوكيل.
- أي تغيير في طريقة تشفير الأسرار (`MCP_ENCRYPTION_KEY`).
- أي نشر إلى الإنتاج يتجاوز CI أو فحوصات الأمان.
- أي قرار يتطلب تفسيراً للناتج (مثل حدود درجة الثقة، عتبات RRF).

## 9. معايير القبول لهذا القسم

لكي يُعتبر هذا القسم صالحاً ومحدّثاً:

- [ ] تطابق قائمة المسارات في §7 الهيكل الفعلي للمستودع (يُتحقق بـ `tree -L 3 -I node_modules`).
- [ ] جميع المتغيرات في §4 موثقة في `.env.example` الفعلي.
- [ ] جميع الأوامر في §5 تعمل بدون أخطاء (`pnpm run` يعرضها).
- [ ] رقم المواصفة `2026-07-28` محدّث؛ أي إصدار أقدم يُعتبر منتهكاً.
- [ ] كل مكوّن في §2 مُفعّل عبر وصلة في `package.json`.
- [ ] روابط الأقسام الشقيقة (`./02-...md` و`./03-...md`) تعمل.

> **القاعدة الذهبية للوكلاء:** عند الغموض في أي من البنود أعلاه، توقف واسأل بدلاً من الافتراض. وثيقة PRD الأصلية مرجع ثانوي، لكن هذا المستند هو عقد التشغيل.