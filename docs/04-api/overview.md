# مرجع واجهة برمجة التطبيقات (API Reference)

مرجع شامل لكل مسارات HTTP الفعلية في منصة OmniRAG. كل المسارات مكتوبة يدوياً في الكود (لا توليد آلي)، والمصدر المرجعي الموثوق هو:

- `src/lib/api/openapi.ts` — مستند OpenAPI 3.1 الرسمي.
- `src/app/api/docs/route.ts` — واجهة Swagger UI التفاعلية.
- `src/app/api/docs/openapi.json/route.ts` — JSON الخام للمواصفة.

## اتفاقية عامة

| العنصر               | التفاصيل                                                                                |
| -------------------- | --------------------------------------------------------------------------------------- |
| المسار الجذري        | `/api/v1` (مسارات `/api/health` و `/api/mcp/[...path]` و `/api/genai` خارج هذه الواجهة) |
| صيغة الطلب/الاستجابة | `application/json` (ما عدا `chat/stream` و `files/[...key]` و `share/[token]`)          |
| صيغة الترميز         | UTF-8                                                                                   |
| الإصدار الحالي       | OpenAPI `0.9.0` (انظر `VERSION` في `src/lib/api/openapi.ts`)                            |
| الوثائق التفاعلية    | `GET /api/docs` (Swagger UI)                                                            |
| المواصفة الخام       | `GET /api/docs/openapi.json`                                                            |

## المصادقة (Authentication)

تدعم الواجهة طريقتين متكافئتين لتحديد هوية المستأجر (tenant) والمستخدم (user):

### 1. جلسة المتصفح (Cookie Session)

- ملف تعريف ارتباط httpOnly باسم `omnirag-session` يُصدَر من `/api/v1/auth/login` و `/api/v1/auth/register` و `/api/v1/auth/sso/callback`.
- شفّاف على مستوى الكود — يحل الخادم الـ token إلى جلسة في جدول `sessions`.
- مطلوب في جميع المسارات التي تعتمد على المستخدم الفردي (تبديل workspaces، قبول دعوات، إلخ).
- يُخفّض تلقائياً في كل طلب عبر `isCsrfOk` (الطلبات المتغيرة للحالة يجب أن تكون same-origin).

### 2. مفتاح API للمُستأجر (Bearer API Key)

- ترويسة `Authorization: Bearer omnirag_live_…`.
- يُنشأ من `/api/v1/api-keys` ويُعرض مرة واحدة فقط بصيغة cleartext (يُخزَّن SHA-256 hash فقط).
- يدعم حد معدل لكل مفتاح (`rateLimitPerMinute`)، وقائمة بيضاء لأدوات MCP الصادرة (`mcpTools`)، ونطاق صلاحيات (`scopes`).
- مناسب للأنظمة الخارجية headless، الـ CI، وعملاء MCP.

### التحقق من السياق

كل طلب يمر عبر `withAuthAndRateLimit` (انظر `src/lib/api/withAuthAndRateLimit.ts`) يفعل ما يلي بالترتيب:

1. تحميل متغيرات البيئة الديناميكية (DB / Qdrant / Gemini / Mistral / Unstructured) من ترويسات أو env-config store.
2. فحص حد المعدل (`checkRateLimit`) — افتراضياً 30 طلب/دقيقة لكل IP، مع إمكانية التخصيص عبر `options.limit` و `options.windowMs` في `withAuthAndRateLimit(handler, { limit, windowMs })`.
3. بوابة CSRF same-origin — `isSameOriginRequest` يرفض الطلبات المتغيرة للحالة من أصول غير مسموح بها؛ حركة Bearer API key معفاة.
4. `verifyApiAuth` — صارم، يرفض الترويسة المفقودة أو غير الصالحة.
5. ربط السياق عبر `runWithRequestContext` حتى تتمكن طبقات الخادم (provider credentials، tenant config، audit) من حل المستأجر.

## ترويسات الطلب

| الترويسة                               | الاستخدام                              | الإلزامية      |
| -------------------------------------- | -------------------------------------- | -------------- |
| `Authorization: Bearer omnirag_live_…` | مصادقة مفتاح API                       | أحد طريقتين    |
| `Cookie: omnirag-session=…`            | مصادقة جلسة المتصفح                    | أحد طريقتين    |
| `Content-Type: application/json`       | كل طلبات POST/PUT                      | نعم (للـ JSON) |
| `Content-Type: multipart/form-data`    | رفع ملفات إلى `/documents/parse`       | اختياري        |
| `x-env-*`                              | حقن متغيرات بيئة ديناميكية لكل مستأجر  | اختياري        |
| `x-ai-model-config`                    | تجاوز إعدادات النماذج لكل طلب          | اختياري        |
| `x-max-file-size-mb`                   | حد حجم الملف (افتراضي 10MB، الحد 50MB) | اختياري        |
| `x-pages-per-chunk`                    | صفحات لكل chunk (1–200)                | اختياري        |
| `x-skip-cache: true`                   | تعطيل كاش OCR على `/documents/parse`   | اختياري        |

## صيغة الاستجابة والأخطاء

كل المسارات ترجع JSON باستثناء `chat/stream` (SSE عبر `createUIMessageStreamResponse`) و `files/[...key]` (بايت ثنائي) و `share/[token]` (JSON) و `docs` (HTML).

الاستجابة الناجحة تختلف حسب المسار — مثال:

```json
{
  "documents": [{ "id": "doc-…", "title": "…", "status": "indexed" }],
  "chunkCount": 42
}
```

صيغة الخطأ الموحدة (يُرجعها `serverErrorResponse` في `src/lib/api/safeError.ts`):

```json
{
  "error": "رسالة عربية + إنجليزية موجهة للمستخدم",
  "code": "CODE_CONSTANT_SNAKE_UPPER"
}
```

### رموز الأخطاء الشائعة

| الرمز                                         | المعنى                         |
| --------------------------------------------- | ------------------------------ |
| `400_INVALID_*`                               | حقل مطلوب أو غير صالح          |
| `400_VALIDATION_ERROR`                        | فشل Zod schema                 |
| `400_BAD_FORM_DATA`                           | فشل تحليل الـ multipart        |
| `400_MISSING_PROMPT`                          | prompt مفقود في chat           |
| `400_WEAK_PASSWORD`                           | كلمة المرور أقل من 8 أحرف      |
| `400_INVITATION_EMAIL_MISMATCH`               | الدعوة موجهة لبريد آخر         |
| `401_INVALID_CREDENTIALS`                     | بريد/كلمة مرور خاطئة           |
| `401_NO_SESSION` / `401_EXPIRED_SESSION`      | جلسة مفقودة/منتهية             |
| `403_FORBIDDEN` / `403_RBAC`                  | مخالفة صلاحيات                 |
| `403_STORAGE_KEY_FORBIDDEN`                   | محاولة قراءة كائن مستأجر آخر   |
| `404_NOT_FOUND`                               | مورد غير موجود                 |
| `409_*` (DUPLICATE_NAME, EMAIL_EXISTS…)       | تعارض                          |
| `413_FILE_TOO_LARGE`                          | تجاوز حد الحجم                 |
| `415_UNSUPPORTED_TYPE`                        | امتداد/MIME غير مدعوم          |
| `422_*` (PDF_UNREADABLE…)                     | محتوى غير قابل للمعالجة        |
| `429_TOO_MANY_REQUESTS`                       | تجاوز حد المعدل                |
| `429_TOKEN_BUDGET_EXHAUSTED`                  | تجاوز حصة الرموز الشهرية       |
| `500_INTERNAL_ERROR` / `500_SERVER_ERROR`     | خطأ داخلي (التفاصيل لا تُسرّب) |
| `503_BLOB_NOT_CONFIGURED` / `503_UNAVAILABLE` | خدمة غير مهيأة                 |

### القاعدة الذهبية

> التفاصيل الداخلية (stack traces، driver codes، connection strings) **لا** تتسرّب أبداً للعميل. `serverErrorResponse` في `src/lib/api/safeError.ts` يسجل الخطأ كاملاً في `console.error` ثم يرجع رسالة عامة فقط:

```ts
{ error: "حدث خطأ داخلي في الخادم. يرجى المحاولة مرة أخرى لاحقاً.", code: "INTERNAL_ERROR" }
```

## حدود المعدل (Rate Limits)

| المسار/الفئة                       | الحد            | النافذة  | المصدر                                            |
| ---------------------------------- | --------------- | -------- | ------------------------------------------------- |
| `withAuthAndRateLimit` افتراضي     | 30 req          | 60 ثانية | `src/lib/api/withAuthAndRateLimit.ts`             |
| `/auth/login` (IP)                 | 10 req          | 60 ثانية | `LOGIN_RATE_LIMIT`                                |
| `/auth/login` (per-email)          | 5 req           | 60 ثانية | `LOGIN_EMAIL_RATE_LIMIT`                          |
| `/auth/register` (IP)              | 5 req           | 60 ثانية | `REGISTER_RATE_LIMIT`                             |
| `/auth/sso/initiate` و `/callback` | 10 req          | 60 ثانية | `src/app/api/v1/auth/sso/*`                       |
| `/documents/upload-session`        | 20 req          | 60 ثانية | `withAuthAndRateLimit(…, { limit: 20 })`          |
| `/share/[token]` (عام)             | 20 req          | 60 ثانية | `checkRateLimit(req, 20, …, 'public-share-link')` |
| `/sources/sync-status`             | 60 req          | 60 ثانية | `withAuthAndRateLimit(…, { limit: 60 })`          |
| `/files/[...key]`                  | 120 req         | 60 ثانية | `withAuthAndRateLimit(…, { limit: 120 })`         |
| `/api/docs/*` (عام)                | 30 req          | 60 ثانية | `src/app/api/docs/route.ts`                       |
| `/jobs/tick` (CRON)                | حسب CRON_SECRET | —        | `src/app/api/v1/jobs/tick/route.ts`               |

عند تجاوز الحد تُرجع `429` مع حقل اختياري `retryAfterMs` (آمن في `Error` schema) وترويسة `Retry-After` القياسية.

## التقسيم إلى صفحات (Pagination)

التقسيم في OmniRAG يعتمد على **معاملات استعلام بسيطة** وليس على cursors:

- `GET /api/v1/documents?documentId=…&limit=200&offset=0` — جلب قطع مستند بصفحات (افتراضي 200).
- `GET /api/v1/analytics` — يُرجع آخر 100 سجل تدقيق (`AUDIT_LOG_PAGE_SIZE`) + العدد الكلي في `auditLogsTotal`.
- `GET /api/v1/files/[...key]` — بدون تقسيم؛ ملف واحد لكل طلب.

لا توجد صفحات cursor-based في v1.

## CORS و CSRF

- **CORS**: `getAllowedOrigins()` في `src/lib/security/securityHeaders.ts` يحدد قائمة الأصول المسموح بها. تُطبَّق ترويسات `Access-Control-Allow-*` تلقائياً.
- **CSRF**: `isCsrfOk(req)` يفحص أن الطلبات المتغيرة للحالة القادمة من cookie auth تكون same-origin أو ضمن قائمة الأصول المسموح بها. حركة Bearer API key معفاة (ليست credentials ضمنية).

## الوثائق الذاتية

| المسار                       | الوصف                                            | المصدر                                   |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------- |
| `GET /api/docs`              | واجهة Swagger UI تفاعلية (HTML، CSP مخصّص).      | `src/app/api/docs/route.ts`              |
| `GET /api/docs/openapi.json` | وثيقة OpenAPI 3.1 خام (JSON، cache عام 5 دقائق). | `src/app/api/docs/openapi.json/route.ts` |

كلاهما عام ومحدود بـ 30 req/دقيقة.

## انظر أيضاً

- [الأمان](../06-security/overview.md)
- [البنية العامة](../02-architecture/overview.md)
- [محرك RAG](../03-rag-engine/overview.md)
