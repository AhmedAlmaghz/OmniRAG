# Risk Register and Feedback Loops

> القسم الثالث من `04-SPEC-PLAN.md`. يحدّد هذا القسم نقاط فشل الوكلاء الأكثر احتمالاً في مشروع OmniRAG، ويربط كل فشل بمسار تغذية راجعة (Feedback Loop) قابل للقياس عبر الاختبارات وعمليات التقييم (Evals). يُكمل هذا القسم ما ورد في [Delivery Strategy and Milestones](./01-delivery-strategy-and-milestones.md) و[Agent-Sized Task Decomposition](./02-agent-sized-task-decomposition.md)؛ فهو يحوّل نقاط الضعف المتوقعة إلى بوابات تحقق قابلة للتنفيذ.

---

## 1. الإطار العام (Risk Framework)

### 1.1 نموذج التصنيف

تُصنَّف المخاطر على ثلاثة محاور متعامدة:

| المحور | المستويات | الوصف |
|---|---|---|
| **الاحتمال (L)** | Low (L) / Medium (M) / High (H) | احتمال أن يقع الفشل أثناء تنفيذ الوكيل |
| **الأثر (I)** | Low (L) / Medium (M) / High (H) / Critical (C) | شدة الضرر على المستخدم أو النظام أو الامتثال |
| **الكشف (D)** | Hard (H) / Soft (S) | هل يمكن للاختبارات/التقييمات التقليدية كشفه؟ |

كلما كان `D = Soft`، زادت الحاجة إلى **LM Judge / Rubric Eval** بدلاً من الاختبارات القطعية. كلما كان `I = Critical`، يجب أن يكون المسار مُلزماً (Mandatory Gate) قبل أي نشر.

### 1.2 مبدأ "الفشل القابل للاكتشاف"

كل بطاقة خطر يجب أن تُجيب عن ثلاثة أسئلة قبل أن تُعتبر صالحة:

1. **ما المؤشر المرصود (Observable Signal)؟** — ماذا نقيس لنعرف أن الفشل وقع؟
2. **ما البوابة (Gate)؟** — اختبار أو تقييم يَصدُر عنه حكم Pass/Fail قابل للأتمتة.
3. **ما الإجراء العلاجي (Remediation)?** — ما الذي يفعله نظام CI أو المراجع البشري عند الفشل؟

إذا تعذّر الإجابة عن أحد هذه الأسئلة، يُعتبر الخطر **غير قابل للإدارة حالياً** ويجب إعادة تصميمه.

---

## 2. السجل الرئيسي للمخاطر (Master Risk Register)

### 2.1 مخاطر الأمان والعزل متعدد المستأجرين (Tenant Isolation)

مصدر القلق: هذا أكبر محور امتثال لأن النظام يتعامل مع بيانات قد تكون مشمولة بـ **GDPR / HIPAA / PCI**، وأي تسرب عبر المستأجرين يُعد خرقاً كارثياً.

| المعرّف | المخاطرة | L | I | D | الإشارة المرصودة | البوابة (Test/Eval) | الإجراء العلاجي |
|---|---|---|---|---|---|---|---|
| **R-SEC-01** | تسرب بيانات عبر RLS في Neon Postgres بسبب غياب `SET app.current_tenant` في جلسة ما | M | C | H | استعلام يُرجِع صفوفاً من مستأجر آخر | اختبار خصائص (Property-based) يُولِّد معرّفات مستأجرين عشوائية ويُحاول كل استعلام محمي | رفض الدمج (Block Merge) + تنبيه PagerDuty P0 |
| **R-SEC-02** | استعلام Qdrant يُغفل فلتر `tenant_id` في الـ Payload | M | C | H | نتيجة بحث من مستأجر آخر | Contract Test على كل دالة بحث مع tenant وهمي آخر | رفض الدمج + فتح تذكرة قانونية محتملة |
| **R-SEC-03** | نقطة نهاية API تتلقى `tenant_id` من جسم الطلب بدلاً من الـ JWT | L | C | S | طلب مزوّر يُمرّر التحقق | Eval يحاكي 1000 طلب مُعدَّل (Manual Penetration + Eval) | رفض النشر + مراجعة معمارية |
| **R-SEC-04** | تسرب معلومات في استجابة MCP Gateway تكشف بيانات tenant آخر | L | C | S | سجلات تحتوي معرّفات مستأجرين مختلطة | Rubric Eval على 500 عينة استجابة MCP، LM Judge | إيقاف الميزة (Feature Flag Off) |
| **R-SEC-05** | فقدان الرموز (Tokens) المخزّنة لـ OAuth الخاص بخوادم MCP | L | H | H | تنبيه فساد قاعدة البيانات أو اختراق مفاتيح KMS | اختبار اختراق + فحص دوري لـ `mcp_oauth_tokens.encryption_at_rest` | تدوير جميع الرموز + إشعار المستخدمين |
| **R-SEC-06** | Prompt Injection عبر محتوى مستند مُستوعب يُغيّر سلوك الوكيل | H | H | S | الوكيل ينفذ إجراءً غير مطلوب أو يكشف بيانات | Red Team Eval يومي على 200 مستند خبيث + LM Judge لتصنيف النوايا | تعطيل الـ Agentic Mode افتراضياً + تأكيد بشري إلزامي |

### 2.2 مخاطر جودة الاسترجاع (Retrieval Quality)

مصدر القلق: جودة RAG غير قطعية بطبيعتها. لا يمكن للاختبارات التقليدية وحدها ضمان دقة الاسترجاع.

| المعرّف | المخاطرة | L | I | D | الإشارة المرصودة | البوابة (Test/Eval) | الإجراء العلاجي |
|---|---|---|---|---|---|---|---|
| **R-RET-01** | Hybrid Search يُرجِع أجزاءً غير مرتبطة بسبب وزن دلالي مرتفع جداً | H | M | S | Recall@10 < 0.75 على مجموعة Gold | LM Judge Eval يومي على 100 استعلام مع Ground Truth | تخفيض `semanticWeight` تلقائياً + تنبيه |
| **R-RET-02** | نتائج RRF (Reciprocal Rank Fusion) متحيزة لصالح البحث المعجمي مع استعلامات عربية | H | M | S | دقة الاستعلامات العربية أقل من الإنجليزية بـ > 15% | Eval مُقارن عبر-لغوي على 500 زوج استعلام/إجابة | تعديل `languageBoost` في إعدادات الدمج |
| **R-RET-03** | HyDE (Query Expansion) يولّد فرضية مضللة تُبعد الاستعلام عن الإجابة الصحيحة | M | M | S | نسبة الهلوسة في الوضع المقيّد > 5% | LM Judge Eval: هل الإجابة مدعومة بالمصدر؟ | تعطيل HyDE عند `confidence < 0.6` |
| **R-RET-04** | Cross-Encoder Re-ranking بطيء جداً يُخرق اتفاقية SLA | M | M | H | p95 latency > 800ms | اختبار أداء (k6) على 1000 طلب متوازٍ | تخطي Re-ranking ديناميكياً |
| **R-RET-05** | Chunks الناتجة من PDFs الممسوحة ضوئياً تحتوي نصاً مبتوراً أو مشوّهاً | H | M | S | نسبة Chunks منخفضة الجودة > 10% | Eval: مخطط تفصيلي لـ Mistral vs Unstructured على 50 PDF ممسوح | تحويل تلقائي لمحرك بديل + تنبيه المستخدم |
| **R-RET-06** | أجزاء الجداول لا تُحفظ بنيتها بعد التقسيم فتتعطل القراءة | H | M | S | LM Judge يكشف أن الجدول في الإجابة غير قابل للقراءة | Rubric Eval: "هل الجدول قابل لإعادة البناء؟" | إعادة تشغيل التقسيم مع `preserveStructure=true` |

### 2.3 مخاطر معالجة اللغة العربية (Arabic NLP)

| المعرّف | المخاطرة | L | I | D | الإشارة المرصودة | البوابة (Test/Eval) | الإجراء العلاجي |
|---|---|---|---|---|---|---|---|
| **R-AR-01** | التطبيع (Normalization) يفصل البادئات والضمائر عن الكلمات فيُضعف التضمين | M | M | S | Recall@10 للعربية < 0.7 | Eval على مجموعة Gold عربية بحتة | تعطيل خطوة إزالة التشكيل افتراضياً |
| **R-AR-02** | كشف اللغة يُصنّف نصاً مختلطاً (عربي+إنجليزي) خطأً | H | L | S | Chunking يفصل النص المختلط فيُضعف السياق | LM Judge على 300 عينة مختلطة | فرض `language=mixed` يدوياً في الإعدادات |
| **R-AR-03** | الواجهة (RTL) تتكسر في MessageBubble عند احتواء الإجابة على كود إنجليزي | H | L | H | لقطة Cypress تُظهر تداخل اتجاهات | اختبار E2E بصري على 20 نموذج إجابة | إصلاح CSS في مكون Bubble |
| **R-AR-04** | gemini-embedding-2 يُولِّد متجهات ضعيفة للنصوص التي فيها تعتيم أو لهجات | M | M | S | تقييم جودة التضمين على 1000 نص متنوع | Eval داخلي مقارنة بـ multilingual-e5-large | تقديم Fallback Embedding Model |

### 2.4 مخاطر خط أنابيب الاستيعاب (Ingestion Pipeline)

| المعرّف | المخاطرة | L | I | D | الإشارة المرصودة | البوابة (Test/Eval) | الإجراء العلاجي |
|---|---|---|---|---|---|---|---|
| **R-ING-01** | فشل صامت: المستند يُسجَّل `status=indexed` بينما التضمينات لم تُخزَّن فعلياً | M | H | H | مستند لا يظهر في البحث | اختبار سلامة (Integrity Test): استعلام بعد الفهرسة مباشرة | إعادة الفهرسة + تنبيه |
| **R-ING-02** | استيعاب PDF كبير (500 صفحة) يتجاوز حدود الذاكرة في Vercel Serverless | H | M | H | خطأ `FUNCTION_INVOCATION_TIMEOUT` | اختبار تحميل بأحجام 10MB/50MB/200MB | نقل المعالجة إلى Inngest/Trigger.dev |
| **R-ING-03** | معالجة OCR تعيد نصاً بترتيب قراءة خاطئ للمستندات ثنائية اللغة | H | M | S | النص النهائي غير قابل للقراءة | LM Judge على 30 مستند ثنائي اللغة | تطبيق `readingOrder=auto` + تحقق بشري |
| **R-ING-04** | تكامل Notion/Google Drive يكتب بيانات اعتماد مكشوفة في السجلات | L | C | H | Regex match على token في logs | مسح آلي للسجلات + اختبار أسرار (Secret Scan) | تنقيح السجلات + تدوير الرموز |
| **R-ING-05** | تكلفة API تتجاوز الميزانية بسبب معالجة غير فعّالة | M | M | H | Cost Tracker يومي > 1.5× الميزانية | اختبار تكلفة مع Mock Fixtures | تبديل إلى `gemini-3.5-flash-lite` |
| **R-ING-06** | المصادر الخارجية تفشل بصمت (مثلاً Notion rate-limited) ولا يُعلم المستخدم | M | M | H | غياب `last_synced_at` تحديث رغم مرور الوقت | اختبار Heartbeat كل 5 دقائق | تنبيه + إيقاف المزامنة التلقائية |

### 2.5 مخاطر النموذج والاستدلال (LLM Behavior)

| المعرّف | المخاطرة | L | I | D | الإشارة المرصودة | البوابة (Test/Eval) | الإجراء العلاجي |
|---|---|---|---|---|---|---|---|
| **R-LLM-01** | هلوسة (Hallucination) في الوضع المقيّد رغم توفر السياق | H | C | S | إجابة تحتوي ادعاء غير موجود في المصدر | LM Judge يومي على 200 محادثة: "هل كل ادعاء مدعوم؟" | رفض الرد + طلب توضيح |
| **R-LLM-02** | تسرّب System Prompt عبر Prompt Injection في محتوى المستند | M | C | S | الوكيل يكشف تعليماته الداخلية | Red Team Eval أسبوعي + Rubric "هل الرد يكشف قواعد النظام؟" | تصفية المحتوى + تنبيه |
| **R-LLM-03** | الحلقة الوكيلة (Agent Loop) تتجاوز الحد المسموح من الأدوات وتنفق رموزاً زائدة | M | M | H | `tokens_used > 50K` في محادثة واحدة | اختبار وحدة على منطق `maxSteps` | قطع الحلقة + عرض تنبيه |
| **R-LLM-04** | النموذج يخلط بين نتائج MCP ويصفها كمصدر محلي | H | H | S | استجابة تحتوي "📁 من بياناتك" لأداة MCP فعلاً | Eval: تصنيف دقيق لمصادر كل ادعاء | فرض شارات إلزامية + مراجعة بشرية |
| **R-LLM-05** | تأخير النموذج يُخرق اتفاقية Streaming (< 200ms first token) | L | M | H | p95 TTFT > 500ms | اختبار أداء Synthetic Load | تبديل إلى `gemini-3.5-flash-lite` |
| **R-LLM-06** | التوجيه الذكي للنماذج يختار نموذجاً ضعيفاً لاستعلام معقد | M | M | S | دقة منخفضة على الأسئلة التحليلية | Eval على 500 استعلام مصنّف حسب التعقيد | تعديل قواعد Router |

### 2.6 مخاطر النظام الموزع والبنية التحتية (Infrastructure)

| المعرّف | المخاطرة | L | I | D | الإشارة المرصودة | البوابة (Test/Eval) | الإجراء العلاجي |
|---|---|---|---|---|---|---|---|
| **R-INF-01** | انقطاع Vercel KV يُوقف جلسات المستخدم | L | H | H | خطأ 500 في `/auth/me` | اختبار حقن الفشل (Chaos Test) | Fallback إلى Database Sessions |
| **R-INF-02** | Qdrant Cloud يتباطأ عند > 10K متجه لكل مستأجر | M | M | H | p95 search > 300ms | اختبار تحميل تدرّجي | تقسيم المجموعات (Sharding) |
| **R-INF-03** | قاعدة بيانات Neon تُجمَّد (Cold Start) عند أول طلب بعد الخمول | H | M | H | TTFB > 2s في الطلب الأول | اختبار Ping Warm-up | Keep-alive Cron Job |
| **R-INF-04** | Vercel Serverless Function Timeout عند معالجة فيديو | H | M | H | 504 Gateway Timeout | اختبار تحميل مع فيديو 50MB | تجزئة الفيديو للمعالجة |
| **R-INF-05** | حدود Rate Limit في Mistral/Unstructured APIs تُسبب فشلاً متتالياً | M | M | H | ارتفاع عدد `status=failed` | اختبار Circuit Breaker + Backoff | وضع قائمة انتظار بـ Retry |
| **R-INF-06** | تسريب مفاتيح API إلى Frontend Bundle | L | C | H | Regex match على bundle | اختبار Bundle Analyzer + CI Scan | رفض النشر |

### 2.7 مخاطر MCP والتكاملات الخارجية

| المعرّف | المخاطرة | L | I | D | الإشارة المرصودة | البوابة (Test/Eval) | الإجراء العلاجي |
|---|---|---|---|---|---|---|---|
| **R-MCP-01** | خادم MCP خارجي يُغيّر مخطط أداة (Tool Schema) دون إشعار فيكسر الاستدعاء | H | H | H | `tool_use_error: schema_mismatch` | Contract Test يومي ضد سجل الأدوات المُسجَّل | تعطيل الخادم + تنبيه المستخدم |
| **R-MCP-02** | تنفيُذ إجراء ذي أثر جانبي (Side Effect) دون تأكيد المستخدم | M | C | S | سجل يحتوي `user_confirmed=false` مع `has_side_effect=true` | اختبار E2E لتدفق التأكيد | إيقاف الوكيل + مراجعة |
| **R-MCP-03** | استجابة خادم MCP كبيرة جداً (Multi-MB) تُسبب OOM في الوكيل | M | M | H | خطأ `Maximum call stack` | اختبار تحميل ببيانات مُولَّدة | فرض حد `MAX_TOOL_RESPONSE_BYTES` |
| **R-MCP-04** | OAuth Refresh يفشل بسبب تغيير في `iss` (RFC 9207) | L | M | H | 401 Unauthorized متكرر | اختبار إعادة المصادقة التلقائية | إجبار إعادة OAuth |
| **R-MCP-05** | Resource Indicator (RFC 8707) غير مطابق فيُستخدم الرمز في خاطئ خادم | L | C | S | خادم Notion يحصل على رمح Slack | Contract Test على كل خادم مُضاف | رفض الإعداد + تنبيه |
| **R-MCP-06** | MCP Server يُعيد استجابة بطيئة تُجمّد حلقة الوكيل | M | M | H | Latency > `mcpCallTimeout` | اختبار Deadline Propagation | قتل الطلب + Fallback |
| **R-MCP-07** | أسماء أدوات متعارضة (مثلاً `notion__search` و `confluence__search`) | M | M | H | خطأ تكرار في `tools` | اختبار Scoped Tool Naming | namespace إلزامي |

### 2.8 مخاطر الامتثال والخصوصية (GDPR / HIPAA / PCI)

| المعرّف | المخاطرة | L | I | D | الإشارة المرصودة | البوابة (Test/Eval) | الإجراء العلاجي |
|---|---|---|---|---|---|---|---|
| **R-CMP-01** | فشل حذف جميع بيانات المستخدم عند طلب GDPR Right-to-Erasure | L | C | H | بقايا سجلات في جداول النسخ الاحتياطي | اختبار E2E لـ `/settings/delete-account` | إيقاف الخدمة للحساب + تدقيق يدوي |
| **R-CMP-02** | بيانات PHI مُرسلة إلى نموذج ذكاء اصطناعي خارجي دون موافقة صريحة | L | C | S | تتبع تدفق البيانات (Data Lineage) | Eval: هل الاستدعاء يحتوي حقول PHI؟ | تشفير + إعدادات "no-AI mode" |
| **R-CMP-03** | لا يوجد Audit Log لعمليات الوصول (HIPAA requirement) | M | C | H | غياب سجل لعملية وصول | اختبار اكتمال Audit Trail | تنبيه + مراجعة معمارية |
| **R-CMP-04** | فترة الاحتفاظ بالبيانات تتجاوز المدة المُصرَّح بها | M | C | H | سجلات أقدم من 90 يوم | اختبار Cron Job للحذف التلقائي | تنفيذ فوري + تنبيه |
| **R-CMP-05** | سجلات المحادثات تحتوي معلومات PCI (أرقام بطاقات) | L | C | S | Regex match على لوحات المفاتيح | Data Loss Prevention Scanner | تنقيح + تنبيه |

---

## 3. حلقات التغذية الراجعة (Feedback Loops)

### 3.1 الهيكل العام

كل حلقة تغذية راجعة تتكوّن من خمس مراحل تُشكّل **دورة مغلقة** (Closed Loop):

```
┌─────────────────────────────────────────────────────────────┐
│                   Feedback Loop Architecture                  │
│                                                             │
│  1. INSTRUMENT  → 2. OBSERVE  → 3. EVALUATE → 4. DECIDE      │
│       ▲                                            │        │
│       └────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

| المرحلة | الوصف | الأدوات في OmniRAG |
|---|---|---|
| **Instrument** | إضافة قياس غير قابل للالتفاف (Mandatory Telemetry) | OpenTelemetry + Custom Hooks في `lib/observability/` |
| **Observe** | تجميع الإشارات في مخزن مركزي | Vercel Observability + Sentry + Postgres Audit Tables |
| **Evaluate** | تشغيل اختبارات + Evals على الإشارات | Playwright + Vitest + LM Judge Pipeline |
| **Decide** | صدور حكم Pass/Fail مع عتبة قابلة للضبط | GitHub Actions + Argo-style Gates |
| **Remediate** | تطبيق إجراء علاجي آلي أو فتح تذكرة بشرية | Auto-rollback + Linear/Jira |

### 3.2 حلقات التغذية الراجعة الحرجة (Critical Loops)

#### Loop A: Tenant Isolation Verification

```
المشغّل:      كل طلب CI + كل ساعة في الإنتاج (Synthetic)
المُدخل:      استعلام مُولَّد مع tenant_id وهمي آخر
الاختبار:     R-SEC-01, R-SEC-02, R-SEC-03
العتبة:       0 تسريبات
الإجراء عند الفشل:
  ├─ CI:    رفض الدمج + تعليق الـ PR
  ├─ Prod:  تنبيه PagerDuty P0 + تشغيل Kill Switch (تعطيل الميزة)
  └─ Postmortem إلزامي خلال 24 ساعة
المسؤول:      Security Champion
```

#### Loop B: Retrieval Quality Drift Detection

```
المشغّل:      يومي (Scheduled Eval)
المُدخل:      100 استعلام مع Gold Standard + 100 استعلام Hybrid
الاختبار:     R-RET-01, R-RET-02, R-RET-03, R-RET-05, R-RET-06
القياسات:
  ├─ Recall@10 ≥ 0.75
  ├─ MRR ≥ 0.65
  ├─ Arabic/English accuracy gap ≤ 15%
  └─ Hallucination rate ≤ 5%
الإجراء عند الفشل:
  ├─ فوري:    تعطيل الإصدار الحالي + Rollback
  ├─ تحليل:   تحديد المُحفِّز (تغيير Embedding/Chunking/Model)
  └─ إعادة المعايرة: تعديل hyperparameters في Hybrid Search
المسؤول:      ML Engineer + Domain Expert
```

#### Loop C: LLM-as-Judge Hallucination Sweep

```
المشغّل:      يومي بعد كل تغيير في System Prompt أو Model
المُدخل:      200 محادثة حقيقية (مُجهَّلة الهوية) + 50 محادثة مُصنَّعة
الاختبار:     R-LLM-01, R-LLM-04, R-LLM-02 (Prompt Injection)
الحكم:        LM Judge (gemini-3.6-flash) مع Rubric من 5 معايير
العتبة:       ≥ 95% Pass
الإجراء عند الفشل:
  ├─ إيقاف الميزة عبر Feature Flag
  ├─ تصنيف الأسباب في 4 فئات: retrieval/faithfulness/style/safety
  └─ إعادة بناء System Prompt + Human Review
المسؤول:      Prompt Engineer + Reviewer
```

#### Loop D: Cost Anomaly Detection

```
المشغّل:      كل ساعة
المُدخل:      سجلات `tokens_used` و `api_cost` من Neon
الاختبار:     R-ING-05, R-LLM-03
القياسات:
  ├─ Hourly spend ≤ 1.5× المتوسط الأسبوعي
  ├─ Cost per query ≤ target ($0.02)
  └─ Tokens per conversation ≤ 50K (p95)
الإجراء عند الفشل:
  ├─ تبديل النموذج تلقائياً إلى lite
  ├─ تخفيض maxSteps للوكيل
  └─ تنبيه Slack للقناة #finance-alerts
المسؤول:      FinOps + Backend
```

#### Loop E: Side Effect Confirmation Integrity

```
المشغّل:      كل استدعاء أداة MCP ذات أثر جانبي
المُدخل:      Event من MCP Client Pool قبل التنفيذ
الاختبار:     R-MCP-02, R-MCP-05
القياسات:
  ├─ 100% من Side Effects لها user_confirmed=true
  └─ 0 استدعاء لـ webhook غير مُعتمد
الإجراء عند الفشل:
  ├─ Kill Switch فوري لـ Agentic Mode
  ├─ تدقيق في mcp_tool_calls خلال آخر 24 ساعة
  └─ إشعار جميع المستخدمين المتأثرين
المسؤول:      Security + Product
```

#### Loop F: Ingestion Pipeline Health

```
المشغّل:      مستمر (Streaming) + اختبارات تكامل يومية
المُدخل:      مستندات تجريبية بأنواع متعددة
الاختبار:     R-ING-01, R-ING-02, R-ING-03, R-ING-06
القياسات:
  ├─ Ingestion Success Rate ≥ 99%
  ├─ p95 latency ≤ 60s لملفات < 10MB
  └─ Text Reconstruction Quality ≥ 0.85 (LM Judge)
الإجراء عند الفشل:
  ├─ إعادة محاولة تلقائية (3x مع Backoff)
  ├─ إن فشل: تخزين في Dead Letter Queue + تنبيه
  └─ Fallback إلى محرك معالجة بديل
المسؤول:      Data Engineering
```

#### Loop G: Compliance & Data Retention

```
المشغّل:      يومي + عند كل طلب حذف حساب
المُدخل:      مستخدمو Soft-Deleted + سجلات الأقدم من 90 يوم
الاختبار:     R-CMP-01, R-CMP-02, R-CMP-03, R-CMP-04, R-CMP-05
القياسات:
  ├─ 100% من طلبات الحذف نُفّذت خلال 30 يوم
  ├─ 0 سجلات قديمة في Production
  └─ Audit Log اكتمال ≥ 99.99%
الإجراء عند الفشل:
  ├─ P0 Alert + تعيين DPO (Data Protection Officer)
  └─ توثيق في سجل الامتثال (Compliance Log)
المسؤول:      Legal + DPO + Security
```

#### Loop H: MCP Schema Drift Detection

```
المشغّل:      يومي (Health Check + Schema Diff)
المُدخل:      استدعاء `tools/list` على كل خادم MCP مُفعَّل
الاختبار:     R-MCP-01
المقارنة:     Schema المُسجَّل في `mcp_server_configs` مقابل المُعاد
الإجراء عند الفشل:
  ├─ تعطيل الخادم تلقائياً
  ├─ إشعار المستخدم بالاختلاف
  └─ فتح تادثة لتحديث السجل يدوياً (Human-in-the-Loop)
المسؤول:      Integrations Lead
```

### 3.3 مصفوفة الحلقات مقابل المراحل (Loops × Phases)

| المرحلة \ الحلقة | A: Tenant | B: Retrieval | C: Hallucination | D: Cost | E: Side Effect | F: Ingestion | G: Compliance | H: MCP Schema |
|---|---|---|---|---|---|---|---|---|
| **P0: Foundation** | ✓ | – | – | – | – | ✓ | ✓ | – |
| **P1: RAG Core** | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | – |
| **P2: MCP Layer** | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | ✓ |
| **P3: Integrations** | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **P4: Production** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## 4. مصفوفة الاختبارات والتقييمات (Test × Eval Matrix)

### 4.1 التقسيم النوعي

| النوع | الأداة | يَصدُر عن | قابل للأتمتة | يلتقط |
|---|---|---|---|---|
| **Unit Test** | Vitest | المطور | ✓ | المنطق القطعي |
| **Integration Test** | Vitest + Testcontainers | المطور | ✓ | التفاعل بين الوحدات |
| **Contract Test** | Pact | المطور | ✓ | تطابق مخططات API/MCP |
| **E2E Test** | Playwright | QA + CI | ✓ | تدفقات المستخدم |
| **Property-Based** | fast-check | المطور | ✓ | خصائص لا أمثلة |
| **Load Test** | k6 | SRE | ✓ | الأداء تحت الضغط |
| **Chaos Test** | Chaos Mesh | SRE | ✓ | مقاومة الفشل |
| **Rubric Eval** | Custom + LM Judge | ML Engineer | ✓ | الجودة الذاتية |
| **Red Team Eval** | Manual + Automated | Security | جزئياً | Prompt Injection و Misuse |
| **Human Eval** | Reviewers يدويون | QA Lead | ✗ | حكم نهائي للحالات الحدّية |

### 4.2 النسبة المطلوبة في CI

| الفئة | النسبة في Pipeline |
|---|---|
| Unit + Integration + Contract | يجب أن تكون ≥ 80% من البوابات |
| E2E | ≥ 10% (التدفقات الحرجة فقط) |
| Evals (Rubric + Red Team) | ≥ 5% (عشوائي على الإنتاج) |
| Load + Chaos | ربع سنوي + قبل أي release كبير |
| Human Review | شرط لـ Critical features فقط |

---

## 5. بوابات النشر (Release Gates)

### 5.1 تعريف البوابات الإلزامية

لا يُسمح بنشر أي تغيير يلامس نظاماً حيّاً دون اجتياز جميع البوابات التالية:

| البوابة | المُشغِّل | العتبة | الحظر |
|---|---|---|---|
| **G1: Security Scan** | CI على كل PR | 0 ثغرات Critical/High | ✗ |
| **G2: Tenant Isolation** | CI + Production Synthetic | 0 تسريبات | ✗ |
| **G3: Test Suite** | CI | 100% Pass + تغطية ≥ 80% | ✗ |
| **G4: Retrieval Quality** | Eval يومي | Recall@10 ≥ 0.75 | ✗ |
| **G5: LLM Judge** | Eval يومي | Pass rate ≥ 95% | ✗ |
| **G6: Cost Anomaly** | Eval يومي | ضمن النطاق المقبول | تنبيه فقط |
| **G7: Schema Drift** | Eval يومي | 0 خوادم مكسورة | ✗ على المتأثرين |
| **G8: Human Sign-off** | Manual | موافقة Tech Lead + Product | ✗ لـ P0 features |

### 5.2 استراتيجية الـ Rollback

```
┌────────────────────────────────────────────────────────┐
│                   Rollback Decision Tree                 │
│                                                        │
│  بوابة فشلت                                           │
│       │                                                │
│       ▼                                                │
│  هل الفشل في R-SEC-* أو R-CMP-*؟                      │
│       │                                                │
│   ┌───┴────┐                                           │
│  نعم     لا                                            │
│   │        │                                           │
│   ▼        ▼                                           │
│ Rollback  هل الفشل في R-RET-* أو R-LLM-*؟             │
│ فوري +   │                                             │
│ P0        ┌────┴────┐                                  │
│          نعم       لا                                   │
│           │         │                                  │
│           ▼         ▼                                  │
│        Feature     هل الفشل في R-INF-*؟               │
│        Flag Off    │                                    │
│        + Eval       ┌────┴────┐                        │
│                    نعم       لا                         │
│                     │         │                        │
│                     ▼         ▼                        │
│                  Rollback   Deploy + Monitor            │
│                  خلال 1h    تنبيه فقط                  │
└────────────────────────────────────────────────────────┘
```

---

## 6. عمليات المراقبة المستمرة (Continuous Observability)

### 6.1 المؤشرات الرئيسية (Key Metrics)

| المعرّف | المؤشر | الهدف | التنبيه |
|---|---|---|---|
| **KM-01** | Tenant Isolation Violations | 0/يوم | أي انتهاك |
| **KM-02** | Retrieval Recall@10 (Production Sample) | ≥ 0.75 | < 0.70 |
| **KM-03** | LLM Hallucination Rate (Sample) | ≤ 5% | > 7% |
| **KM-04** | P95 End-to-End Latency | ≤ 2.5s | > 4s |
| **KM-05** | Ingestion Success Rate | ≥ 99% | < 97% |
| **KM-06** | MCP Tool Call Success Rate | ≥ 98% | < 95% |
| **KM-07** | Hourly API Spend | ≤ $X | > 1.5× المتوسط |
| **KM-08** | Prompt Injection Blocks | غير محدود | ارتفاع مفاجئ × 3 |
| **KM-09** | Compliance Audit Gap | 0 سجل مفقود | أي فجوة |
| **KM-10** | User-Reported Quality Issues | ≤ 2% من المحادثات | > 5% |

### 6.2 لوحات المراقبة (Dashboards)

- **Security Dashboard:** KM-01, KM-08, R-SEC-*
- **Quality Dashboard:** KM-02, KM-03, KM-10
- **Performance Dashboard:** KM-04, KM-05, KM-06
- **Cost Dashboard:** KM-07, R-ING-05
- **Compliance Dashboard:** KM-09, R-CMP-*

### 6.3 سياسة التنبيهات (Alerting Policy)

| الخطورة | القناة | زمن الاستجابة | زمن الحل |
|---|---|---|---|
| **P0** | PagerDuty + Slack #p0 + إيميل | 5 دقائق | 1 ساعة |
| **P1** | Slack #incidents + إيميل | 30 دقيقة | 4 ساعات |
| **P2** | Slack #alerts | 4 ساعات | 1 يوم |
| **P3** | لوحة المعلومات فقط | أسبوع | Sprint التالي |

---

## 7. تبعيات الحلقات وتكرارها (Cadence)

| الحلقة | التكرار | زمن التنفيذ | التخزين | المراجعة |
|---|---|---|---|---|
| Loop A (Tenant) | مستمر + كل ساعة Synthetic | < 5 دقائق | Sentry + Postgres | أسبوعية |
| Loop B (Retrieval) | يومي | ~ 30 دقيقة | BigQuery | أسبوعية |
| Loop C (Hallucination) | يومي + عند كل تغيير | ~ 45 دقيقة | BigQuery + GCS | أسبوعية |
| Loop D (Cost) | كل ساعة | < 1 دقيقة | Vercel KV | يومية |
| Loop E (Side Effect) | عند كل استدعاء | < 100ms | Postgres | فورية |
| Loop F (Ingestion) | مستمر | مستمر | Postgres | يومية |
| Loop G (Compliance) | يومي | ~ 15 دقيقة | Postgres | أسبوعية |
| Loop H (MCP Schema) | يومي | ~ 10 دقائق | Postgres | أسبوعية |

---

## 8. خارطة المخاطر عبر المراحل (Risk Heatmap Evolution)

```
     Impact →
        Low    Medium    High    Critical
P   ┌────────┬────────┬────────┬────────┐
r   │ R-AR-03│ R-AR-02│R-ING-02│R-LLM-02│
o   │R-MCP-07│R-LLM-06│R-LLM-03│R-SEC-04│
b   │        │R-INF-04│R-MCP-01│R-SEC-06│
a   ├────────┼────────┼────────┼────────┤
b   │ R-AR-04│R-RET-04│R-MCP-03│R-SEC-02│
i   │        │R-INF-02│R-MCP-06│R-CMP-02│
l   │        │R-LLM-05│R-CMP-04│R-CMP-01│
i   │        │        │        │        │
t   ├────────┼────────┼────────┼────────┤
y   │        │R-RET-01│R-RET-05│R-SEC-01│
↓   │        │R-RET-02│R-RET-06│R-SEC-03│
    │        │R-RET-03│R-LLM-04│R-SEC-05│
    │        │R-ING-03│R-ING-04│R-CMP-03│
    │        │R-ING-05│R-INF-01│R-CMP-05│
    │        │R-ING-06│R-MCP-04│R-MCP-05│
    │        │R-LLM-01│        │        │
    │        │R-AR-01│        │        │
    │        │R-INF-03│        │        │
    │        │R-INF-05│        │        │
    │        │R-MCP-02│        │        │
    └────────┴────────┴────────┴────────┘
```

> **الزاوية العلوية اليمنى (High × Critical)** هي الأكثر أولوية. كل خطر فيها يمتلك حلقة تغذية راجعة إلزامية (Loop A أو E أو G) ولا يُسمح بنشر أي تغيير دون اجتيازها.

---

## 9. معايير النجاح والقياس (Definition of Done for Risk Coverage)

تعتبر تغطية المخاطر **مكتملة** عند تحقق جميع البنود التالية:

- [ ] كل بطاقة خطر في السجل تملك اختباراً واحداً على الأقل مُسجَّلاً في CI.
- [ ] كل Risk ذو `I = Critical` له حلقة تغذية راجعة مُجدوَلة ومُنفَّذة.
- [ ] لا يوجد Risk مُصنَّف `D = Soft` بدون LM Judge مُعرَّف.
- [ ] لوحات المراقبة جاهزة ومُختبرة قبل أول نشر.
- [ ] سياسة التنبيهات تم اختبارها بـ Chaos Drill واحد على الأقل.
- [ ] جميع مالكو الحلقات (Loop Owners) مُعيَّنون بالاسم.
- [ ] آلية Rollback مُختبرة End-to-End في بيئة Staging.
- [ ] إجراءات Postmortem موثقة لنمطين من الفشل (R-SEC و R-RET).

---

## 10. الربط بالأقسام المجاورة

- **استراتيجيات التسليم والمراحل** — يحدّد هذا القسم المخاطر التي تُعطِّل كل مرحلة من مراحل [Delivery Strategy and Milestones](./01-delivery-strategy-and-milestones.md). كل مرحلة لها اختبارات بوابة مذكورة في هذا القسم.
- **تفكيك المهام بحجم الوكيل** — كل بطاقة مهمة في [Agent-Sized Task Decomposition](./02-agent-sized-task-decomposition.md) تُشير صراحةً إلى المخاطر المرتبطة بها من السجل أعلاه (مثلاً: مهمة `Ingestion Pipeline v1` تُشير إلى `R-ING-01..06`). الوكلاء الذين يعملون على هذه البطاقات مُلزَمون باجتياز الاختبارات المعرَّفة قبل اعتبار المهمة "Done".
- **التغذية الراجعة كعقد مع الذكاء الاصطناعي** — كما يصف الإطار، الاختبارات تتحقق من الأجزاء القطعية، أما التقييمات (Evals) فتحكم على الأجزاء غير القطعية. كلاهما مطلوب ولا يُغني أحدهما عن الآخر.

---

> **خلاصة القسم:** السجل أعلاه ليس قائمة مخاوف سلبية، بل هو **خريطة حماية نشطة**. كل خطر مرتبط بمسار قياس → اختبار → تقييم → إجراء علاجي. الوكلاء الذين يعملون على OmniRAG يحصلون على هذه الوثائق كسياق إلزامي (`AGENTS.md` + Memory Files) قبل أي مهمة، وتُحدَّث السجلات تلقائياً كل أسبوع بناءً على الحوادث والبيانات الميدانية.