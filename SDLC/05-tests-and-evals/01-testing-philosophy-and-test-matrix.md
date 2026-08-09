# Testing Philosophy and Test Matrix

> **القسم 1 من 2** ضمن `05-TESTS-AND-EVALS.md` — يليه: [Eval Suite and CI Quality Gates](./02-eval-suite-and-ci-quality-gates.md)

## 1. فلسفة الاختبار (Testing Philosophy)

يتبع OmniRAG نموذج **"العقد المزدوج" (Tests + Evals)** المُقترح في إطار عمل The New SDLC:

| المبدأ | التطبيق في OmniRAG |
|---|---|
| **الاختبارات = عقد حتمي** | تتحقق من السلوك القابل للتكرار: مخطط قاعدة البيانات، استعلامات RLS، مطابقة الأنواع، عقود API، صحة المخرجات المُهيكلة |
| **التقييمات = عقد غير حتمي** | تتحقق من جودة مخرجات الذكاء الاصطناعي (RAG، التضمين، التوليد) عبر حُكام LM ومقاييس رياضية — مغطاة في [القسم 2](./02-eval-suite-and-ci-quality-gates.md) |
| **الاختبارات يجب أن تفشل عند كسر العقد فقط** | لا تُربط اختبارات الكود بنتائج التقييمات (تقييمات RAG لا تُكسر خط البناء حتى تُعالَج في [القسم 2](./02-eval-suite-and-ci-quality-gates.md)) |
| **التوجيه بالاقتصاد** | اختبارات سريعة وحتمية → نماذج صغيرة (gemini-3.5-flash-lite، Haiku). تقييمات معقدة → نماذج كبيرة (gemini-3.6-flash، Claude Sonnet) |
| **تغطية طبقات العزل الخمس** | كل طبقة من طبقات العزل الخمس (Auth, RLS, Qdrant payload, File Storage, API Middleware) لها اختبارات مخصصة مستقلة |

> **⚠️ مشكلة الـ 80%**: يفترض وكلاء الذكاء الاصطناعي عادةً أن "الاختبار يمر = العمل سليم". في OmniRAG، الاختبارات الحتمية وحدها لا تكفي للتحقق من جودة البحث الهجين، أو دقة التضمين ثنائي اللغة، أو سلوك الوكيل المدمج مع MCP — هذه مسؤولية التقييمات في القسم التالي.

---

## 2. مصفوفة طبقات الاختبار (Test Layers Matrix)

| الطبقة | الأداة | النطاق | زمن التنفيذ المستهدف | الفشل يقفل CI؟ |
|---|---|---|---|---|
| **L1: Static Analysis** | TypeScript `tsc --noEmit`, ESLint, `biome`, Knip | أنواع، قواعد، كود ميت | < 30 ث | ✅ نعم |
| **L2: Unit Tests** | Vitest | دوال منفردة: تطبيع عربي، RRF، tokenization | < 60 ث | ✅ نعم |
| **L3: Contract Tests** | Zod schemas + drizzle-zod | مطابقة مخططات API، أنواع DB، مخططات MCP tools | < 30 ث | ✅ نعم |
| **L4: Integration Tests** | Vitest + testcontainers | Qdrant + Neon + Blob stack داخل Docker | < 3 د | ✅ نعم |
| **L5: RLS Isolation Tests** | SQL fixtures مع `SET app.current_tenant` | كل جدول × 5 طبقات عزل | < 90 ث | ✅ نعم |
| **L6: E2E Browser Tests** | Playwright | تدفقات المستخدم الحرجة (تسجيل، رفع، محادثة، MCP-Hub) | < 5 د | ✅ نعم |
| **L7: Smoke (Preview)** | curl + scripts | نشر Vercel Preview → فحوصات صحة | < 2 د | ✅ نعم |
| **L8: Evals (غير حتمية)** | LM Judges + rubrics | جودة RAG، الهلوسة، ثنائية اللغة | 5–20 د | ⚠️ عبر بوابة منفصلة — مغطاة في [القسم 2](./02-eval-suite-and-ci-quality-gates.md) |

---

## 3. مصفوفة حالات الاختبار الحرجة (Critical Test Cases)

### 3.1 طبقات العزل والخصوصية (Multi-Tenant Isolation)

> **الأولوية القصوى** — أي فشل هنا = خرق GDPR/HIPAA/PCI.

| المعرف | الحالة | السيناريو | النجاح المتوقع |
|---|---|---|---|
| `ISO-001` | تسرب أفقي بين مستخدمَين | مستخدم A يحاول قراءة مستندات مستخدم B عبر REST API | إرجاع 403 + فارغ + Audit Log |
| `ISO-002` | تسرب عبر البحث الدلالي | استعلام من مستخدم A يطابق vector مرتبط بمستند مستخدم B | `score_threshold` يحجب، ولا تُعاد أي نقطة |
| `ISO-003` | تسرب عبر البحث المعجمي | استعلام `MATCH` على `chunks.content_tsv` يتجاوز RLS | RLS يرفض الصف، حتى لو تم حذف `WHERE tenant_id` يدوياً |
| `ISO-004` | حقن `current_setting` | محاولة ضبط `app.current_tenant` من اتصال المستخدم | يُمنع — الإعداد فقط عبر JWT middleware |
| `ISO-005` | تسرب عبر MCP tool | أداة MCP مثل `knowledge_semantic_search` تُستدعى بـ `tenant_id` مختلف عن الـ JWT | رفض + Audit |
| `ISO-006` | عزل ملف في Blob | طلب Signed URL لمسار `/other-tenant/files/x.pdf` | رفض 403 |
| `ISO-007` | تسرب عبر pgvector | استعلام `SELECT` على `embedding_id` المرتبط بـ tenant آخر | 0 صفوف |
| `ISO-008` | نسيان WHERE clause | تشغيل استعلام دون فلتر tenant (audit script) | يفشل الاختبار — قاعدة `eslint-plugin-rls` تمنعه |

### 3.2 خط أنابيب الاستيعاب (Ingestion Pipeline)

| المعرف | الحالة | المدخل | النجاح المتوقع |
|---|---|---|---|
| `ING-001` | PDF عربي ممسوح | ملف PDF بـ Arabic OCR | أجزاء بفهرس `language='ar'` + تضمين 3072-dim |
| `ING-002` | PDF مختلط اللغات | صفحات عربية + إنجليزية | أجزاء موسومة بـ `ar` و `en` و `mixed` |
| `ING-003` | DOCX مع جداول | ملف Word يحوي جداول معقدة | الحفاظ على بنية الجدول في `metadata` |
| `ING-004` | ملف صوتي MP3 | ملف صوتي 10 دقائق | تحويل → نص → أجزاء → تضمين |
| `ING-005` | استيعاب دفعة 50 ملف | Bulk import | نجاح متوازي + idempotency بمحتوى hash |
| `ING-006` | فشل Mid-pipeline | انقطاع خدمة Mistral عند الجزء 30 | يُعلَّم المستند `failed` + retry queue |
| `ING-007` | Chunk overlap للنص العربي | chunkSize=512, overlap=15% | عدم قطع جملة عربية عبر جزأين |
| `ING-008` | إزالة التكرار | رفع نفس الملف مرتين | detection عبر hash + رسالة للمستخدم |
| `ING-009` | ملف ضخم (>100MB) | PDF 500 صفحة | streaming + progress + chunks صحيحة |
| `ING-010` | صيغة غير مدعومة | رفع `.exe` | رفض 415 مع رسالة عربية/إنجليزية |

### 3.3 خط أنابيب الاستعلام الهجين (Hybrid Query Pipeline)

| المعرف | الحالة | الاستعلام | النجاح المتوقع |
|---|---|---|---|
| `QRY-001` | بحث معجمي نقي | مصطلح تقني دقيق غير موجود في التضمين | نتيجة من FTS بترتيب صحيح |
| `QRY-002` | بحث دلالي نقي | سؤال مفاهيمي بدون تطابق لفظي | نتيجة من Qdrant |
| `QRY-003` | RRF يدمج القائمتين | استعلام يظهر في كليهما | نتيجة واحدة مُدمجة بالـ RRF |
| `QRY-004` | HyDE query expansion | استعلام غامض | تحسّن Recall@5 ≥ 15% مقارنة بدون HyDE |
| `QRY-005` | Cross-lingual | سؤال عربي عن محتوى إنجليزي فقط | نتيجة (cross-lingual embedding) |
| `QRY-006` | Top-K = 0 | طلب 0 نتائج | مصفوفة فارغة + لا خطأ |
| `QRY-007` | score_threshold مرتفع | عتبة 0.95 لاستعلام عام | نتائج أقل + لا خطأ |
| `QRY-008` | Re-ranking مفعّل | 20 مرشّح → 5 نهائيين | تحسّن NDCG@5 |
| `QRY-009` | نتائج بلا صلة | استعلام خارج النطاق | 0 نتائج + رسالة "لا توجد إجابة" |
| `QRY-010` | MMR diversity | نتائج متشابهة جداً | تنويع في الإخراج |

### 3.4 طبقة MCP Gateway

| المعرف | الحالة | السيناريو | النجاح المتوقع |
|---|---|---|---|
| `MCP-001` | Stateless per-request | طلبان متتاليان بدون `Mcp-Session-Id` | كلاهما ينجح (مواصفة 2026-07-28) |
| `MCP-002` | RFC 8707 Resource Indicator | رمز OAuth لمورد A يُستخدم لمورد B | رفض |
| `MCP-003` | RFC 9207 iss validation | `iss` غير متطابق | رفض + تسجيل محاولة هجوم |
| `MCP-004` | Side effect confirmation | استدعاء `slack_send_message` | `user_confirmed=true` مطلوب قبل التنفيذ |
| `MCP-005` | Rate limit per server | 61 استدعاء/دقيقة لخادم | الاستدعاء 61 → 429 |
| `MCP-006` | Tool scoping | تعطيل `github_create_issue` ثم استدعاؤها | رفض + Audit |
| `MCP-007` | Concurrent tools | استدعاء 5 أدوات بالتوازي | جميعها تنجح بدون race condition على tenant_id |
| `MCP-008` | Timeout | خادم بطيء > 30s | timeout + `status='timeout'` في `mcp_tool_calls` |
| `MCP-009` | Audit log integrity | كل استدعاء | إدخال في `mcp_tool_calls` بـ `tenant_id` صحيح |
| `MCP-010` | Tenant isolation | أداة `notion_fetch_page` بـ tenant_id مختلف عن JWT | رفض |

### 3.5 الواجهة والـ E2E (User-Facing Flows)

| المعرف | التدفق | المسار | النجاح المتوقع |
|---|---|---|---|
| `E2E-001` | تسجيل + Tenant creation | `/auth/register` → `/dashboard` | إنشاء `tenant_id` + Redirect |
| `E2E-002` | رفع PDF والاستعلام عنه | `/sources` → `/chat` → "ماذا يحوي؟" | استرجاع المحتوى + Citations |
| `E2E-003` | تبديل اللغة RTL↔LTR | `/settings/language` | تحديث فوري لـ `dir` و i18n |
| `E2E-004` | إضافة MCP server | `/mcp-hub` → OAuth flow → اختبار | اتصال ناجح + قائمة أدوات |
| `E2E-005` | تصدير البيانات (GDPR) | `/settings/export` | ZIP خلال < 30 ثانية |
| `E2E-006` | حذف حساب | `/settings/delete-account` | حذف كامل + audit log |
| `E2E-007` | Streaming chat | إرسال سؤال | أول token خلال < 1.5s |
| `E2E-008` | Multi-modal input | رفع صورة + سؤال | تضمين الصورة + إجابة مُستندة |

---

## 4. بوابات الجودة الحتمية (Deterministic Quality Gates)

### 4.1 بوابات `pre-commit` و `pre-push`

```yaml
# .husky/pre-commit
- pnpm lint         # ESLint + Biome
- pnpm typecheck    # tsc --noEmit
- pnpm test:unit    # Vitest unit only
```

### 4.2 بوابات CI (Pull Request)

| البوابة | الأمر | العتبة | الإجراء عند الفشل |
|---|---|---|---|
| **Lint + Types** | `pnpm lint && pnpm typecheck` | 0 errors | ❌ Block merge |
| **Unit + Contract** | `pnpm test:unit test:contract` | 100% pass, ≥ 80% coverage | ❌ Block merge |
| **Integration** | `pnpm test:integration` | 100% pass | ❌ Block merge |
| **RLS Isolation** | `pnpm test:rls` | 100% pass | ❌ Block merge + Slack alert (security) |
| **E2E (smoke)** | `pnpm test:e2e --grep @critical` | 100% pass | ❌ Block merge |
| **Bundle size** | `pnpm size-limit` | < 250KB initial JS | ⚠️ Warn (block على +20%) |

### 4.3 بوابات ما بعد الدمج (Post-merge على `main`)

| البوابة | الهدف |
|---|---|
| **Vercel Preview deploy** | نشر تلقائي لكل PR |
| **Preview smoke** | `curl` لفحوصات `/api/health`, `/api/health/db`, `/api/health/qdrant` |
| **Contract diff** | مقارنة مخططات API مع الإصدار السابق؛ فشل عند breaking change بدون `major` |
| **Migration safety** | التحقق من أن migrations Postgres لا تُسقط بيانات |

---

## 5. بنية مجموعة الاختبارات (Test Suite Structure)

```
/tests
├── unit/
│   ├── rag/
│   │   ├── rrf-fusion.test.ts
│   │   ├── hybrid-search.test.ts
│   │   └── query-expansion.test.ts
│   ├── ingestion/
│   │   ├── chunking-arabic.test.ts
│   │   ├── normalization.test.ts
│   │   └── embedding-task-prefix.test.ts
│   ├── mcp/
│   │   ├── tool-registry.test.ts
│   │   ├── oauth-pkce.test.ts
│   │   └── audit-logger.test.ts
│   └── utils/
├── contract/
│   ├── api-schemas.test.ts          # Zod round-trip
│   ├── db-schemas.test.ts           # drizzle-zod
│   └── mcp-tool-schemas.test.ts
├── integration/
│   ├── ingestion-pipeline.spec.ts
│   ├── retrieval-pipeline.spec.ts
│   ├── chat-completion.spec.ts
│   └── mcp-gateway.spec.ts
├── rls/                              # ⚠️ حرجة — حراسة مستقلة
│   ├── sources-isolation.test.ts
│   ├── documents-isolation.test.ts
│   ├── chunks-isolation.test.ts
│   ├── conversations-isolation.test.ts
│   ├── messages-isolation.test.ts
│   └── mcp-tables-isolation.test.ts
├── e2e/
│   ├── auth.spec.ts
│   ├── upload-and-chat.spec.ts
│   ├── mcp-hub.spec.ts
│   └── bilingual-rtl.spec.ts
├── fixtures/
│   ├── tenants/                      # مستأجرون تجريبيون
│   ├── documents/                    # PDFs عربية/إنجليزية
│   └── mcp-responses/                # تسجيلات Mock
└── helpers/
    ├── testcontainers.ts
    ├── neon-rls.ts
    └── qdrant-test.ts
```

---

## 6. قواعد البيانات الاختبارية (Test Database Strategy)

| البيئة | التكوين | الاستخدام |
|---|---|---|
| **Local dev** | `testcontainers` (Qdrant + Postgres ephemeral) | تشغيل `pnpm test` بدون خدمات خارجية |
| **CI ephemeral** | Postgres branch جديد في Neon لكل PR + Qdrant container | عزل كامل بين الـ PRs |
| **Preview (Vercel)** | Neon branch Preview + Qdrant Staging | E2E في بيئة شبه إنتاج |
| **Production** | Neon primary + Qdrant production | لا اختبارات مباشرة — فقط smoke synthetic |

> **⚠ مشكلة الـ 80%**: الاختبارات على Docker قد تتجاوز بسبب اختلاف أداء Qdrant. نستخدم **timeouts مطلقة** بدل `toMatch` على السرعة، ونترك قياس الأداء لـ Locust في بيئة staging.

---

## 7. العقود النوعية (Type & Schema Contracts)

### 7.1 نقطة قرار: المصدر الوحيد للحقيقة (Source of Truth)

نستخدم **Zod v4** + **drizzle-zod** ليكون مخطط Zod هو المصدر المُشتق من مخطط Drizzle. كل عقد API يُولَّد تلقائياً، ويُستخدم في:

- التحقق من المدخلات في `route.ts`
- تعريف أنواع TypeScript المُشتقة (`z.infer`)
- إنشاء OpenAPI schema للـ `/api-docs`
- التحقق في اختبارات العقد (`contract/*.test.ts`)

### 7.2 قائمة العقود الحرجة

| العقد | الملف | حالات اختبار مطلوبة |
|---|---|---|
| `POST /api/v1/chat/completions` | `app/api/v1/chat/completions/route.ts` | valid, missing tenant_id, oversized input, invalid model |
| `POST /api/v1/sources` | `app/api/v1/sources/route.ts` | جميع أنواع المصادر الـ 15 |
| `POST /api/v1/search` | `app/api/v1/search/route.ts` | top_k boundaries, weights sum to 1.0 |
| `MCP tool: knowledge_semantic_search` | `lib/mcp/registry.ts` | tenant_id missing, top_k > 20 |
| `MCP tool: slack_send_message` | `lib/mcp/registry.ts` | side-effect path, message > 4000 |

---

## 8. Fixtures والبيانات الاختبارية

| النوع | الموقع | المحتوى |
|---|---|---|
| **مستأجرون** | `fixtures/tenants/` | 5 مستأجرين مع بيانات معزولة متعمدة لاختبار التسرب |
| **مستندات عربية** | `fixtures/documents/ar/` | 10 ملفات (PDF, DOCX, MD) تشمل: مقالات، عقود، تقارير |
| **مستندات إنجليزية** | `fixtures/documents/en/` | 10 ملفات بمواضيع متنوعة |
| **مستندات مختلطة** | `fixtures/documents/mixed/` | 5 ملفات بأقسام بلغتين |
| **استعلامات مرجعية** | `fixtures/queries/eval-set.ts` | 50 استعلام مع ground truth للأدلة (تُستخدم في [القسم 2](./02-eval-suite-and-ci-quality-gates.md)) |
| **MCP recordings** | `fixtures/mcp-responses/` | JSON لتسجيلات استجابات خوادم MCP |

> **⚠ مشكلة الـ 80%**: تجاهل الوكلاء عادةً اختبار النصوص المختلطة (عربي + إنجليزي + أرقام + رموز). نُضيف fixture يحوي نصاً مختلطاً فعلياً من مستندات قانونية حقيقية.

---

## 9. معايير النجاح لكل طبقة (Acceptance Criteria per Layer)

### L2 — Unit Tests

| المعيار | العتبة |
|---|---|
| تغطية الفروع (branch coverage) | ≥ 80% |
| تغطية الدوال الحساسة (RRF, RLS middleware, normalization) | 100% |
| زمن التنفيذ الكامل | < 60 ثانية |
| استقلالية (لا يعتمد على شبكة) | 100% |

### L3 — Contract Tests

| المعيار | العتبة |
|---|---|
| مطابقة المخططات مع OpenAPI المُولَّد | 100% |
| عدم وجود breaking changes بدون bump | إلزامي |
| تغطية كل route في `/api/v1/` | 100% |

### L4 — Integration Tests

| المعيار | العتبة |
|---|---|
| نجاح كل اختبار | 100% |
| idempotency لإعادة التشغيل | إلزامي |
| تنظيف البيانات بعد كل اختبار | إلزامي (cleanup hooks) |

### L5 — RLS Isolation Tests

| المعيار | العتبة |
|---|---|
| عدد سيناريوهات التسرب المفحوصة | ≥ 8 (انظر ISO-001 → ISO-008) |
| زمن التنفيذ | < 90 ثانية |
| مراجعة بشرية قبل تغيير سياسة RLS | إلزامي |

### L6 — E2E Tests

| المعيار | العتبة |
|---|---|
| المسارات الحرجة المغطاة | 8/8 من القائمة أعلاه |
| زمن التنفيذ | < 5 دقائق |
| إعادة المحاولة على الفشل | ≤ 2 (لفلترة flakiness) |

---

## 10. سياسات CI/CD (CI/CD Policies)

### 10.1 ما يُمنع منعاً باتاً في `main`

- ❌ أي تغيير على سياسات RLS دون موافقة أمنية + اختبار RLS جديد
- ❌ أي تغيير على مخططات MCP tools دون contract test جديد
- ❌ أي dependency جديد يضيف > 50KB للـ bundle بدون تبرير
- ❌ أي تعطيل لاختبار (`skip`, `xfail`) بدون تعليق `// REVIEW:` ورقم issue

### 10.2 ما يُسمح به في feature branch

- ✅ تعطيل اختبار E2E مع علامة `@flaky` لمدة ≤ 14 يوم
- ✅ تخطي اختبارات بطيئة محلياً عبر `pnpm test:fast`

### 10.3 استراتيجية الـ Flaky Tests

| الإجراء | التفصيل |
|---|---|
| Quarantine | نقل لملف `*.flaky.test.ts` + GitHub label `flaky` |
| Retry | ≤ 2 محاولات تلقائية في CI |
| Tracking | لوحة أسبوعية لأعلى 5 اختبارات flakiness |
| SLA | إصلاح خلال 7 أيام أو حذف |

---

## 11. قائمة مراجعة قبل الإطلاق (Pre-launch Checklist)

- [ ] تغطية اختبارات الوحدة ≥ 80% (الفروع) و 100% للحرجة
- [ ] جميع اختبارات RLS الحرجة الـ 8 خضراء
- [ ] جميع مسارات E2E الـ 8 خضراء على Preview
- [ ] لا اختبارات `xfail`/`skip` بدون تبرير موثق
- [ ] لا warnings في `tsc --noEmit` أو `eslint`
- [ ] Bundle size ضمن الحدود (< 250KB initial JS)
- [ ] زمن CI الكامل < 12 دقيقة
- [ ] Contract diff بدون breaking changes
- [ ] Migrations تم اختبارها على branch staging
- [ ] تقييمات RAG مغطاة في [القسم التالي](./02-eval-suite-and-ci-quality-gates.md) ومستمرة في nightly

---

> **الانتقال**: تستعرض الأقسام أعلاه البنية الحتمية للاختبار. للجزء غير الحتمي (جودة RAG، الهلوسة، ثنائية اللغة، سلوك الوكيل) انتقل إلى: [Eval Suite and CI Quality Gates](./02-eval-suite-and-ci-quality-gates.md)