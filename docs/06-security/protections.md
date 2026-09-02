# طبقات الحماية المتقدمة (Protections)

يصف هذا المستند طبقات الحماية العميقة في OmniRAG: حدود المعدّل المستمرة، حراسة SSRF متعددة الطبقات، درع حقن الأوامر وحقن الـ prompt، تعقيم المخرجات (SVG/HTML/PII)، تشفير AES-256-GCM للسروم، وسجلات التدقيق (audit logs). تستند هذه الطبقات إلى مبدأ **الفشل الآمن**: كل طبقة تُسقط الطلب عند انتهاك السياسة بدلاً من الرجوع إلى سلوك ضعيف صامت.

## نظرة عامة على الطبقات

| الطبقة                         | الموقع                                                                                                                      | الهدف                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| حدود المعدّل المستمرة          | `src/lib/security/rateLimiter.ts`, `src/lib/security/durableRateLimiter.ts`, `src/db/schema.ts` (جدول `rate_limit_windows`) | منع القوة العمياء و credential stuffing و DoS      |
| حراسة SSRF                     | `src/lib/mcp/net.ts`                                                                                                        | منع جلب عناوين شبكة داخلية أو بيانات اعتماد سحابية |
| درع حقن الأوامر / حقن الموجهات | `src/lib/harness/hook-harness.ts` (H6, H6b)                                                                                 | رفض الموجهات العدائية وحقن المستندات المسترجعة     |
| تعقيم المخرجات (HTML/SVG)      | `src/lib/security/svgSanitizer.ts`                                                                                          | منع XSS عبر SVG المُولَّد من LLM (mermaid)         |
| تشفير AES-256-GCM              | `src/lib/mcp/auth/encryption.ts`                                                                                            | تشفير OAuth tokens وسجلات الاعتماد                 |
| إخفاء PII في التدفقات          | `src/lib/security/piiStreamRedactor.ts`, `src/lib/harness/hook-harness.ts` (H9)                                             | منع تسرّب البريد/الهاتف من خرج LLM                 |
| رؤوس الأمان و CSP              | `src/lib/security/securityHeaders.ts`                                                                                       | دفاع متعمّق على مستوى الـ middleware               |
| سجلات التدقيق                  | `src/db/schema.ts` (جدول `audit_logs`), `src/lib/harness/hook-harness.ts` (H12)                                             | تتبع إجراءات H1–H9                                 |

## حدود المعدّل (Rate Limit)

### المُحدِّد المستدام (`src/lib/security/durableRateLimiter.ts`)

المُحدِّد القديم كان in-memory لكل عملية: على serverless، الحد الفعلي يتضاعف بعدد النسخ الباردة وكل cold start يمسح العدّادات (هجوم brute-force على تسجيل الدخول كان الأكثر تعرّضاً). الإصدار المستدام يعتمد على **Postgres** عبر upsert ذرّي واحد لكل طلب، مع انتقال graceful إلى in-memory عند تعذّر الـ DB.

**SQL الذرّي:**

```sql
INSERT INTO rate_limit_windows (bucket_id, count, window_start)
VALUES ($1, 1, $3)
ON CONFLICT (bucket_id) DO UPDATE SET
  count = CASE
    WHEN rate_limit_windows.window_start <= $2 THEN 1
    ELSE rate_limit_windows.count + 1
  END,
  window_start = CASE
    WHEN rate_limit_windows.window_start <= $2 THEN $3
    ELSE rate_limit_windows.window_start
  END
RETURNING count, window_start;
```

**آلية الاستبدال (degradation latch):** عند فشل استعلام DB، يُقفل الانتقال إلى in-memory لمدة 30 ثانية لتجنّب إضافة latency لكل طلب. عند غياب الجدول (pre-migration) يُستخدم in-memory بدلاً من رفض الطلب.

### الواجهة (`src/lib/security/rateLimiter.ts`)

- `checkRateLimit(req, limit=30, windowMs=60000, customKey?)`: مفتاح السلة الافتراضي `${ip}:${path}`. عند تمرير `customKey` (مثل بريد تسجيل الدخول)، يُستبدل البُعد القائم على IP — يهزم تدوير IP في credential stuffing. الاستخدام المعتاد هو تشغيل **كلا** المُحدِّدين (IP + credential) وقبول الأشد صرامة.
- `checkKeyedRateLimit(bucketKey, limit, windowMs=60000)`: فحص مستقل عن الـ Request، للسلال المعتمدة على الهوية (`apikey:${id}` في `src/lib/auth/apiAuth.ts`).
- عند التجاوز: استجابة 429 برمز `429_TOO_MANY_REQUESTS` ورأس `Retry-After` بالثواني.

### الحدود المعتمدة في المصادقة

| المسار                       | الحد                   | النافذة  | المصدر                                  |
| ---------------------------- | ---------------------- | -------- | --------------------------------------- |
| `POST /api/v1/auth/register` | 5 لكل IP               | 60 ثانية | `src/app/api/v1/auth/register/route.ts` |
| `POST /api/v1/auth/login`    | 10 لكل IP + 5 لكل بريد | 60 ثانية | `src/app/api/v1/auth/login/route.ts`    |

### مخطط جدول `rate_limit_windows`

| العمود         | النوع                  | الوصف                                                                                 |
| -------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `bucket_id`    | varchar(300) — PK      | معرّف السلة (مثل `${ip}:${path}`، `${email}:/api/v1/auth/login`، `apikey:key-<uuid>`) |
| `count`        | integer (default 1)    | عدّاد النافذة الحالية                                                                 |
| `window_start` | varchar(100) — indexed | ISO timestamp لبداية النافذة                                                          |

تعريف الجدول في `src/db/schema.ts`.

## حراسة SSRF (`src/lib/mcp/net.ts`)

كل طلب صادر ينفّذ نيابة عن أداة MCP (جلب URL، فحص خادم بعيد، إرسال أداة مخصصة) يمر عبر حراسة SSRF متعددة الطبقات. وسائط الأدوات متأثرة بالمهاجم (النموذج يختار الروابط)، فهذه حدود أمنية لا رتوش.

### قائمة الرفض الحرفية (`PRIVATE_HOST_PATTERNS`)

```regex
/^localhost$/i
/^127\./
/^10\./
/^192\.168\./
/^172\.(1[6-9]|2\d|3[01])\./
/^169\.254\./
/^0\./
/^::1$/
/^\[?::1\]?$/
/^fc00:/i
/^fd[0-9a-f]{2}:/i
/^fe80:/i
```

### قائمة النقاط التجريبية (`DUMMY_HOST_FRAGMENTS`)

`['.internal', 'example.com', '.local', 'mcp.transform.unstructured.io']` — نقاط تجريبية مزروعة لا يمكن جلبها فعلياً؛ تُعتبر نقاطاً صحّية مسجَّلة فقط.

### المسارات

1. **`assertPublicHttpUrl(rawUrl)`**:
   - تحليل URL. فشل التحليل → رمي.
   - البروتوكول يجب أن يكون `http:` أو `https:` فقط — يُرفض أي `file:`، `ftp:`، `data:`، إلخ.
   - فحص المضيف ضد `PRIVATE_HOST_PATTERNS`.
   - فحص `isDummyEndpoint()`.
   - **تثبيت DNS (`assertResolvablePublicHost`):** تحلّل DNS حقيقي لكل A/AAAA. لو **أيّ** عنوان محلول داخل/خاص/loopback/link-local/unique-local → الرفض. هذا يُغلق فجوة DNS rebinding وأسماء مثل `nip.io`/`localtest.me` التي تحل إلى عناوين داخلية. فشل/تعذّر الـ DNS → رفض (مضيف غير قابل للتحقّق ليس مضيف قابلاً للجلب).

2. **`guardedFetch()`**:
   - يستخدم `redirect: 'manual'` ويُعيد تشغيل `assertPublicHttpUrl` على **كل hop**. URL عام قد يحوّل (302) إلى `127.0.0.1` أو نقطة metadata link-local — لا يمكنه تجاوز الحراسة.
   - سلسلة التحويلات محدودة بـ 5 قفزات مثل المتصفحات.

3. **`safeFetchText()`** / **`safeFetchBinary()`**:
   - مهلة: 12 ثانية للنصوص، 30 ثانية للثنائي.
   - حد حجم: 1 MiB للنصوص، 20 MiB للثنائي.
   - User-Agent: `OmniRAG-MCP-Gateway/2.0`.
   - على المهلة يُرجع `result.error = 'تجاوز المهلة (...)'` بدون رمي.

4. **`probeEndpoint()`**:
   - فحص سريع (≤2.5 ثانية، 64 KiB) للخوادم المسجَّلة في `mcp_servers`.
   - النقاط التجريبية (`isDummyEndpoint`) تعامل كنقاط `healthy` مسجَّلة فقط — لا يتم الاتصال فعلاً.

## درع حقن الأوامر وحقن الموجهات

### حقن الموجهات (Prompt Injection) — `src/lib/harness/hook-harness.ts`

طبقتان متكاملتان:

**H6. InputSanitizer (pre_inference):** يفحص **موجّه المستخدم** ضد قائمة `PROMPT_INJECTION_PATTERNS` قبل وصوله للنموذج. القائمة موسَّعة لتشمل أنماط Reset/Override، استخراج system prompt / API keys، أوضاع الـ jailbreak (DAN، developer mode، unrestricted mode)، ومحاولات تجاوز عزل المستأجرين. الأنماط case-insensitive وتسمح بتفاوت بسيط في الفراغات.

عند المطابقة: `logAudit(..., 'pre_inference', 'blocked', …)` ثم رفض حتمي برمز `400_PROMPT_INJECTION_DETECTED`.

**H6b. RetrievedContentSanitizer (pre_generation):** يفحص **كل chunk مسترجع** قبل حقنه في سياق النموذج. السطح الأخطر في RAG: مستند مُعدَّى يمكنه تجاوز تعليمات النظام بشكل غير مباشر. عند المطابقة في **أيّ** chunk: رفض **الطلب كاملاً** (السياسة الحتمية: مستند عدوائي لا يمكن الوثوق به جزئياً)، برمز `400_INDIRECT_PROMPT_INJECTION_DETECTED`.

`findInjectionPattern()` يستخدم regex غير-global (دفاع ضد `lastIndex` mutation) ويستعيد `lastIndex = 0` عند الاستخدام.

### حقن أوامر النظام (Command Injection)

النظام لا يستدعي shell تنفيذاً على مدخلات المستخدم. كل عمليات الاستخراج (`src/lib/pdf/pdfChunker.ts`، `src/lib/services/localOcr.ts`، `src/lib/services/extraction/engines.ts`) تستخدم APIs Node المباشرة (`pdfjs-dist`، مكتبات JS النقية، fetch لخدمات خارجية). لا توجد استدعاءات `child_process` أو `exec/spawn` على مدخلات مهاجم — الحدود الدفاعية:

- تعقيم SVG/HTML عبر DOMPurify (انظر أدناه).
- التحقق من نوع MIME والحد الأقصى للحجم عند رفع الملفات في `src/lib/uploads/directUpload.ts` و `src/lib/storage/constants.ts`.
- رفض أي URL خاص في جلب المستندات (`src/app/api/v1/documents/web-fetch/route.ts` يستخدم `assertPublicHttpUrl`).

## تعقيم المخرجات

### تعقيم SVG (`src/lib/security/svgSanitizer.ts`)

الرسوم البيانية المُولَّدة من LLM (mermaid) تُحقن في الـ DOM عبر `dangerouslySetInnerHTML`. التعقيم يعتمد على **DOMPurify** مع تهيئة موحَّدة لكل sinks (اليوم `MermaidBlock`؛ مستقبلاً أي SVG مُولَّد).

**ضمانات صلبة:**

- `USE_PROFILES: { svg: true, svgFilters: true }`.
- `FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed']`.
- `FORBID_ATTR: ['style']` (لا سمات `style` — mermaid في strict mode لا يصدرها).
- `ADD_TAGS: ['foreignObject']` (mermaid يُصدرها لتسميات HTML، وأطفالها يخضعون لنفس تمرير DOMPurify).
- **خطاف `afterSanitizeAttributes`** مضاف مرة واحدة لكل instance: يزيل أي سمة URI-type (`href`، `xlink:href`، `src`، `poster`، `background`، `cite`، `action`، `formaction`) قيمتها تطابق `/^\s*(javascript|vbscript|data):/i`. هذا belt-and-braces: تغطية jsdom أظهرت أن ALLOWED_URI_REGEXP الافتراضي قد يسمح بـ `data:` في `href/xlink:href`.
- `ALLOW_DATA_ATTR: false`.
- **Idempotent:** `sanitize(sanitize(x)) === sanitize(x)`.
- الفشل آمن: عند فشل DOMPurify، يُرجع سلسلة فارغة — **لا يسقط إلى النص غير المعقّم**.

### تعقيم المحتوى المُتدفق (Streaming PII Redaction)

المسار غير التدفقي لـ `/api/v1/chat/completions` يشغّل H9 PIIRedactor مرة واحدة على كامل الاستجابة. المسار التدفقي `/api/v1/chat/stream` يصدر الـ response delta-by-delta، ما كان سيتجاوز H9 ويُسرّب بريد/هاتف خام إلى العميل. `src/lib/security/piiStreamRedactor.ts` يُطبّق نفس أنماط البريد/الهاتف **مع lookahead** يضمن انتهاء النمط قبل الإصدار، و**tail-hold-back** بطول 256 محرف (الحد الأقصى لبريد هو 254 محرفاً وفق RFC 3696) حتى لا يصل نمط PII قيد التشكّل إلى العميل قبل اكتمال المصطلح المُنهي.

**مجموعتان من الـ regex:**

- **Final stage:** `EMAIL_REDACT_G`، `PHONE_REDACT_G` — تُشغَّل على الـ tail فقط.
- **Streaming stage:** `EMAIL_STREAM_G`، `PHONE_STREAM_G` — تشترط محرفاً غير-extension بعد التطابق.

الاستخدام:

```ts
const redactor = createPIIStreamRedactor();
// لكل chunk:
const safe = redactor.push(chunk);
// stream → safe
// عند انتهاء الـ stream:
const tail = redactor.end();
// stream → tail
```

### رؤوس الأمان و CSP (`src/lib/security/securityHeaders.ts`)

- **`buildCsp(nonce)`** — CSP للتطبيق. `default-src 'self'`، `script-src 'self' 'nonce-${nonce}'`، `frame-ancestors 'none'`، `form-action 'self'`، `base-uri 'self'`، `object-src 'none'`، `img-src 'self' data: blob:` (لدعم صور markdown المُولَّدة)، `style-src 'self' 'unsafe-inline'` (Tailwind v4 + styled components).
- **`buildDocsCsp(nonce)`** — CSP لصفحة Swagger على `/api/docs` فقط. `default-src 'none'` مع `unpkg.com` مسموح للـ scripts/styles. لا تُطبَّق على بقية التطبيق.
- **`baseSecurityHeaders(isProd)`** — رؤوس مشتركة لكل الاستجابات: `X-Content-Type-Options: nosniff`، `X-Frame-Options: DENY`، `Referrer-Policy: strict-origin-when-cross-origin`، `Permissions-Policy` يحجب camera/microphone/geolocation/payment/usb/interest-cohort، `Cross-Origin-Opener-Policy: same-origin`، `X-DNS-Prefetch-Control: off`. HSTS (`max-age=31536000; includeSubDomains`) في الإنتاج فقط.
- **`isSameOriginRequest()`** — بوابة CSRF على مستوى الـ Origin/Referer (تفصيل في `authentication.md`).

## تشفير AES-256-GCM (`src/lib/mcp/auth/encryption.ts`)

يستخدم لتشفير OAuth tokens وسجلات اعتماد الموصلات قبل تخزينها.

- **الخوارزمية:** `aes-256-gcm` (Node `crypto.createCipheriv` / `createDecipheriv`).
- **مفتاح:** مشتق عبر `crypto.scryptSync(envKey, 'mcp-salt', 32)` (256 بت). المفتاح نفسه يُخزَّن مؤقتاً مع المصدر لإعادة الاشتقاق عند تغيّر المفتاح فقط.
- **مصدر المفتاح:** `MCP_OAUTH_ENCRYPTION_KEY`. **مرفوض في الإنتاج عند الغياب** — النظام يرمي `Error` بدلاً من استخدام fallback dev-key منشور (الذي سيكشف جميع سروم المستأجرين لأي قارئ للكود).
- **بنية النص المشفّر:** `${iv_hex}:${authTag_hex}:${ciphertext_hex}`. IV عشوائي 12 بايت لكل عملية تشفير. `authTag` يُحقَّق على فك التشفير؛ التلاعب يُسبّب رمي.
- **الفشل آمن:** `encryptToken` يرمي عند الفشل (يجب على المتعامل أن يعتبر التخزين مرفوضاً، **لا** أن يُسقط إلى نص صريح).

## سجلات التدقيق (Audit Logs)

### مخطط الجدول `audit_logs` (`src/db/schema.ts`)

| العمود          | النوع                   | الوصف                                                                                           |
| --------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `id`            | varchar(100) — PK       | `audit-<uuid>`                                                                                  |
| `tenant_id`     | varchar(100) — NOT NULL | معرّف المستأجر                                                                                  |
| `actor_id`      | varchar(100) — NOT NULL | معرّف الفاعل (مستخدم أو `agentic_engine`)                                                       |
| `action`        | text — NOT NULL         | المرحلة المُكبَّرة: `PRE_AUTH`، `PRE_INFERENCE`، `PRE_GENERATION`، `PRE_TOOL`، `POST_INFERENCE` |
| `resource_type` | varchar(100) — NOT NULL | نوع المورد (نمط الـ hook)                                                                       |
| `resource_id`   | varchar(100) — NOT NULL | معرّف المورد (نمط الـ hook)                                                                     |
| `status`        | varchar(50) — NOT NULL  | `success` / `blocked` / `error`                                                                 |
| `details`       | text                    | تفاصيل وصفيّة (مثلاً: `H6 InputSanitizer: Detected Prompt Injection pattern: /…/`)              |
| `timestamp`     | varchar(100) — NOT NULL | ISO-8601 (اتفاق الـ repo: تخزين timestamps كـ varchar)                                          |

### مسجِّل H12 (`src/lib/harness/hook-harness.ts`)

`logAudit(ctx, action, status, details)` يكتب إلى `audit_logs` عبر `db.addAuditLog`. تُستدعى من كل طبقة في الـ HookHarness:

- **H1 TenantGate** (pre_auth): يسجل نجاح/فشل فحص `tenantId`.
- **H2 ModeGuard** (pre_inference): يسجل رفض طلبات `web_search` في الوضع الخاص.
- **H6 InputSanitizer** (pre_inference): يسجل نمط prompt-injection المرفوض.
- **H6b RetrievedContentSanitizer** (pre_generation): يسجل النمط المرفوض في chunk مع رقم الـ chunk وعنوان المستند.
- **H3 ScopeGuard** (pre_tool): يسجل رفض أدوات غير معتمدة.
- **H5 SideEffectGate** (pre_tool): يسجل طلب الموافقة البشرية على أدوات side-effect.
- **H9 PIIRedactor** (post_inference): يسجل إخفاء PII.

**Default للـ `tenantId`:** `'system'` عند الغياب. **Default للـ `actorId`:** `'agentic_engine'` عند الغياب.

## انظر أيضاً

- [نظرة عامة على الأمان](./overview.md)
- [المصادقة (الجلسات، CSRF، OIDC، مفاتيح API)](./authentication.md)
- [بنية النظام — Hook Harness](../02-architecture/overview.md)
- [مرجع API — الحماية](../04-api/overview.md)
- [تشغيل وصيانة — استكشاف الأخطاء](../09-operations/troubleshooting.md)
