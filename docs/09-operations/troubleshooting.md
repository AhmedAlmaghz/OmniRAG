# استكشاف الأخطاء وإصلاحها (Troubleshooting)

دليل عملي لتشخيص المشكلات الشائعة في OmniRAG. يصف أدوات التشخيص الحيّة (real-time) وكيفية تفسير مخرجاتها، ثم يفصّل المشكلات المتكررة (الاتصال، المصادقة، الجلسات، حدود المعدّل، SSRF، الاستخراج) مع خطوات الإصلاح ومراجع الكود.

## أدوات التشخيص

### `GET /api/health` — الفحص السريع (Liveness)

المسار في `src/app/api/health/route.ts`. **بدون مصادقة** — يصلح لـ load balancers و Kubernetes probes.

**الاستجابة:**

```json
{ "status": "ok", "timestamp": "<ISO-8601>" }
```

| السمة     | التفاصيل                                |
| --------- | --------------------------------------- |
| المصادقة  | غير مطلوبة                              |
| المعدّل   | غير مقيَّد                              |
| الاستخدام | نقطة liveness فقط؛ لا تتحقق من التبعيات |

### `GET /api/v1/diagnostics` — الفحص العميق (Real Diagnostics)

المسار في `src/app/api/v1/diagnostics/route.ts`. خلف `withAuthAndRateLimit` (يتطلب جلسة أو مفتاح API).

**الاستجابة:**

```json
{
  "timestamp": "...",
  "environment": "production",
  "overallStatus": "healthy | degraded | critical",
  "readinessScore": 0..100,
  "diagnostics": {
    "postgresql": { "service": "postgresql", "status": "...", "latencyMs": ..., "...": "..." },
    "qdrant":     { "service": "qdrant",     "status": "...", "latencyMs": ..., "...": "..." },
    "mistral":    { "service": "mistral",    "status": "...", "latencyMs": ..., "...": "..." }
  },
  "envAudit": [ { "name": "...", "present": true, "preview": "..." } ]
}
```

**حساب درجة الجاهزية (`readinessScore`):**

| الخدمة           | الحالة           | النقاط              |
| ---------------- | ---------------- | ------------------- |
| PostgreSQL       | `connected`      | +35                 |
| PostgreSQL       | `missing_config` | +10 (fallback mock) |
| Qdrant           | `connected`      | +35                 |
| Qdrant           | `missing_config` | +10                 |
| Mistral          | `connected`      | +20                 |
| `GEMINI_API_KEY` | حاضر             | +10                 |

**تصنيف الحالة الإجمالية:**

| الدرجة | `overallStatus` |
| ------ | --------------- |
| ≥ 85   | `healthy`       |
| 50–84  | `degraded`      |
| < 50   | `critical`      |

**حالات الخدمة المُعرَّفة (`ServiceStatus`):**

| الحالة           | المعنى                                                            |
| ---------------- | ----------------------------------------------------------------- |
| `connected`      | الخدمة متصلة وتعمل                                                |
| `missing_config` | متغيّر البيئة غير مُهيَّأ                                         |
| `auth_failed`    | الـ endpoint ردَّ بـ HTTP غير 2xx (مفتاح غير صالح، صلاحيات ناقصة) |
| `disconnected`   | تعذّر الوصول (DNS، شبكة، رفض اتصال)                               |

### `POST /api/v1/diagnostics` — فحص مخصّص

يقبل JSON body:

```json
{ "target": "all" | "postgres" | "postgresql" | "qdrant" | "mistral" }
```

يُعيد نفس بنية `result.postgresql|qdrant|mistral` للهدف المُحدَّد. مفيد لإعادة فحص خدمة واحدة بعد تعديل الإعدادات دون انتظار الفحص الكامل.

### `HealthDiagnosticsModal` — واجهة المستخدم

الموقع: `src/components/knowledge/HealthDiagnosticsModal.tsx`.

- يستدعي `fetchWithAuth('/api/v1/diagnostics')` (مع ترويسة CSRF تلقائياً).
- يعرض ثلاث بطاقات خدمات (PostgreSQL، Qdrant، Mistral) + حالة corpus المعرفة (عدد المستندات والمقاطع).
- زر **Re-run** يعيد الفحص. زر **Close** يغلق. **Escape** يغلق أيضاً.
- في حال فشل الجلب: شريط خطأ وردي بـ "تعذر الوصول إلى خدمة التشخيصات على الخادم" / "Could not reach the diagnostics service".
- إصدار سابق كان استعراضاً شكلياً (interval 600ms مع نتائج مُعدَّة سلفاً)؛ الإصدار الحالي **حيّ ويقيس** الزمن والاتصال فعلياً.

### إخفاء المعلومات الحساسة في التشخيص

- `maskConnectionString()`: يستبدل كلمة مرور Postgres بـ `••••••••`.
- `maskUrl()`: يحتفظ بـ protocol + hostname + port فقط (بدون path/query).
- `maskKey()`: يعرض `first4••••••••last4` للمفاتيح الأطول من 8 محارف.
- جميع القيم المرتجعة آمنة للعرض في الواجهة.

## المشكلات الشائعة وحلولها

### 1. فشل المصادقة (401)

| الرمز                       | المعنى                                  | الحل                                                                             |
| --------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| `401_NO_SESSION`            | لا ملف كوكي ولا Bearer                  | سجّل الدخول من جديد؛ عند استخدام API، أضف `Authorization: Bearer omnirag_live_…` |
| `401_INVALID_SESSION`       | الرمز غير موجود في `sessions`           | الكوكي منتهي أو تم تسجيل الخروج من جلسة أخرى                                     |
| `401_EXPIRED_SESSION`       | `expiresAt` مضى                         | مدة الجلسة 7 أيام — سجّل الدخول من جديد                                          |
| `401_BAD_API_KEY`           | الـ Bearer ليس omnirag_live أو غير صالح | تحقّق من البادئة والطول                                                          |
| `401_INVALID_API_KEY`       | التجزئة غير موجودة في `api_keys`        | المفتاح مُلغى أو من بيئة مختلفة                                                  |
| `401_API_KEY_INACTIVE`      | `revokedAt` أو `expiresAt` انتهى        | أنشئ مفتاحاً جديداً عبر `POST /api/v1/api-keys`                                  |
| `401_SESSION_LOOKUP_FAILED` | Postgres غير متاح                       | راجع قسم "فشل اتصال PostgreSQL" أدناه                                            |
| `401_API_KEY_LOOKUP_FAILED` | مثل ما سبق لمسار المفاتيح               | نفس الحل                                                                         |

**مكان الفحص:** `src/lib/auth/apiAuth.ts` (دوال `verifyApiKeyAuth`، `verifyApiAuth`).

### 2. رفض CSRF (403)

| الرمز              | المعنى                                            | الحل                                                                                       |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `403_CSRF`         | ترويسة `X-Requested-With: XMLHttpRequest` غائبة   | استعمل `fetchWithAuth` (يضيفها تلقائياً) — لا تستدعي `fetch` الخام لطلبات state-changing   |
| فحص Origin/Referer | قيمة Origin لا تطابق المضيف ولا `ALLOWED_ORIGINS` | أضف Origin إلى `ALLOWED_ORIGINS` في بيئة الإنتاج؛ أو ضمن استدعاء الـ API من نفس الـ origin |

**مكان الفحص:** `src/lib/auth/csrf.ts`، `src/lib/security/securityHeaders.ts` (`isSameOriginRequest`).

### 3. تجاوز حد المعدّل (429)

| الرمز                      | المعنى                                                      | الحل                                                                     |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `429_TOO_MANY_REQUESTS`    | السلة `(${ip}:${path})` أو `(${email}:${path})` تجاوزت الحد | احترم رأس `Retry-After`؛ انتظر حتى إعادة ضبط النافذة                     |
| `429_API_KEY_RATE_LIMITED` | المفتاح وصل لـ `rateLimitPerMinute` المُهيَّأ               | ارفع السقف عبر `POST /api/v1/api-keys` أو انتظر                          |
| تسجيل الدخول محظور         | 10 لكل IP + 5 لكل بريد                                      | إذا كنت مستخدماً شرعياً، انتظر 60 ثانية؛ إذا كنت تتكامل آلياً، أضف تباعد |

**مكان الفحص:** `src/lib/security/rateLimiter.ts`، `src/lib/security/durableRateLimiter.ts`.

### 4. فشل اتصال PostgreSQL

**الأعراض:** `diagnostics.postgresql.status === 'disconnected'`، خطأ `ECONNREFUSED` أو انتهاء مهلة.

**خطوات التشخيص:**

1. تحقق من `DATABASE_URL` (أو `POSTGRES_URL`) في بيئة التشغيل.
2. شغّل `GET /api/v1/diagnostics` وتحقق من `postgres.maskedUrl` و `latencyMs` و `activeTablesCount`.
3. راجع سجلات الخادم لـ `[diagnostics] PostgreSQL connection failed` ورمز `err.code`.

**الحلول حسب الرمز:**

| الرمز             | السبب                            | الحل                                              |
| ----------------- | -------------------------------- | ------------------------------------------------- |
| `missing_config`  | `DATABASE_URL` غير معيَّن        | أضف المتغيّر وأعد النشر                           |
| `ECONNREFUSED`    | الـ DB غير قابل للوصول من البيئة | تحقق من الشبكة، security groups، allowlist الـ IP |
| `28P01` / `28000` | كلمة مرور/مستخدم خاطئ            | تحقق من الـ credentials                           |
| `3D000`           | قاعدة البيانات غير موجودة        | أنشئ قاعدة البيانات أو صحّح المسار                |
| pool init فشل     | تبعيات npm مفقودة                | أعد `npm install` ونشر                            |

**مكان الفحص:** `src/app/api/v1/diagnostics/route.ts` (`runPostgresDiagnostic`).

### 5. فشل اتصال Qdrant

**الأعراض:** `diagnostics.qdrant.status === 'disconnected'` أو `missing_config`.

**خطوات التشخيص:**

1. تحقق من `QDRANT_URL` و `QDRANT_API_KEY` (اختياري).
2. في الواجهة، `collectionInfo` يظهر فقط عند وجود collection `omnirag_chunks`. غيابه طبيعي في التثبيتات الجديدة — يُنشأ تلقائياً عند أول إدراج.
3. راجع `qdrant.maskedUrl` و `latencyMs`.

**الحلول:**

| الحالة                            | الحل                                      |
| --------------------------------- | ----------------------------------------- |
| `missing_config`                  | عيّن `QDRANT_URL`                         |
| `ECONNREFUSED`                    | تحقق من تشغيل مجموعة Qdrant ومن allowlist |
| `401`/`403` من Qdrant             | تحقق من `QDRANT_API_KEY`                  |
| collection غير موجودة             | طبيعي؛ تُنشأ عند أول إدراج                |
| `status: 'red'` في collectionInfo | مشاكل تخزين أو نسخ على Qdrant cluster     |

**مكان الفحص:** `src/app/api/v1/diagnostics/route.ts` (`runQdrantDiagnostic`).

### 6. فشل مصادقة Mistral

**الأعراض:** `diagnostics.mistral.status === 'auth_failed'` أو `disconnected`.

**التفسير:**

| الحالة                   | السبب                                               |
| ------------------------ | --------------------------------------------------- |
| `missing_config`         | `MISTRAL_API_KEY` غير معيَّن                        |
| `auth_failed` (HTTP 401) | المفتاح غير صالح أو مُلغى                           |
| `auth_failed` (HTTP 429) | تجاوز حصة Mistral                                   |
| `disconnected`           | تعذّر الوصول إلى `https://api.mistral.ai/v1/models` |

**الحل:**

1. تحقق من المفتاح على لوحة Mistral.
2. تحقق من حصة الاستخدام (Rate Limit / Quota).
3. إذا استمر الفشل، افحص خادم الشبكة الوسيطة (proxy, firewall).

**مكان الفحص:** `src/app/api/v1/diagnostics/route.ts` (`runMistralDiagnostic`).

### 7. رفض حقن الموجهات

| الرمز                                    | المعنى                             | الإجراء                                                         |
| ---------------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| `400_PROMPT_INJECTION_DETECTED`          | H6 رصد نمطاً في موجه المستخدم      | أزل العبارات المُشتبه بها؛ لا تُدرج تعليمات للنموذج داخل الموجه |
| `400_INDIRECT_PROMPT_INJECTION_DETECTED` | H6b رصد نمطاً في chunk مُسترجع     | المستند المصدر مُلغَّم أو مُعدَّى — احذفه من الـ KB أو نظّفه    |
| `403_MODE_ESCAPE_BLOCKED`                | محاولة `web_search` في الوضع الخاص | غيّر الوضع أو أزل طلب البحث                                     |

**مكان الفحص:** `src/lib/harness/hook-harness.ts` (المراحل `pre_inference` و `pre_generation`).

### 8. رفض SSRF على جلب الروابط

**الأعراض:** خطأ "تم رفض الوصول لعناوين الشبكة الداخلية أو الخاصة لأسباب أمنية (SSRF)" أو "المضيف (...) يحل إلى عنوان شبكة داخلية".

**الأسباب المحتملة:**

- الـ URL يشير إلى `localhost`، `127.0.0.1`، شبكة خاصة (10/8، 192.168/16، 172.16-31/12)، link-local (169.254/16)، أو unique-local IPv6 (fc/fd).
- الـ hostname عام لكنه يحل إلى عنوان خاص (هجوم DNS rebinding).
- الـ hostname ينتمي لقائمة `DUMMY_HOST_FRAGMENTS` (`.internal`، `example.com`، `.local`، `mcp.transform.unstructured.io`).

**الحل:**

1. استخدم فقط URLs عامة حقيقية.
2. للنقاط التجريبية (مثل seeded MCP servers)، عوّل على بيانات التسجيل دون الاتصال.
3. إذا كنت تشغّل خادم OIDC خاصاً للمصادقة، عرِّف الـ issuer كمضيف عام يحل إلى عنوان عام؛ أو تعطيل فحص الـ SSRF لهذا المسار فقط (لا يُنصح).

**مكان الفحص:** `src/lib/mcp/net.ts` (`assertPublicHttpUrl`، `assertResolvablePublicHost`).

### 9. أدوات Side-Effect تتطلب موافقة

**السلوك:** استدعاء أداة في `SIDE_EFFECT_TOOLS` (`slack_send_message`، `github_create_issue`، `external_postgres_query`، `email_send`) يُرجع `requiresConfirmation: true` مع `warning` يطلب موافقة بشرية صريحة.

**الحل:**

- في الواجهة: اضغط زر التأكيد المرتبط.
- في الـ API: لا يمكن تجاوز هذا الحاجز برمجياً — يجب على المستخدم النهائي الموافقة.

**مكان الفحص:** `src/lib/harness/hook-harness.ts` (`runPreToolHooks`، `SIDE_EFFECT_TOOLS`).

### 10. تعذّر توليد الجلسة (OmniRAG لا يفتح جلسة)

| السبب المحتمل                 | الحل                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| CSRF مرفوض                    | استخدم `fetchWithAuth` بدلاً من `fetch` الخام                                                              |
| تجاوز معدل تسجيل الدخول (429) | انتظر 60 ثانية                                                                                             |
| البريد مشوّه                  | تحقق من regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`                                                                 |
| كلمة المرور أقصر من 8         | زد الطول                                                                                                   |
| بريد مكرر (409)               | سجّل الدخول بدلاً من إنشاء حساب جديد                                                                       |
| Rate-limit قبل فحص المدخلات   | ترتيب الفحوصات في `src/app/api/v1/auth/login/route.ts`: IP-rate → CSRF → email regex → email-rate → verify |

### 11. تشفير OAuth Tokens يفشل

**الخطأ:** `MCP_OAUTH_ENCRYPTION_KEY must be set in production`.

**السبب:** المتغيّر البيئي غائب في بيئة الإنتاج. النظام **يرفض** استخدام fallback dev-key المُنشور في الكود.

**الحل:**

1. ولّد مفتاحاً قوياً (32+ بايت عشوائي).
2. عيّن `MCP_OAUTH_ENCRYPTION_KEY` في بيئة الإنتاج.
3. بعد تدوير المفتاح، **اعمد إلى إعادة تشفير** جميع السجلات الموجودة في DB (`oauth_tokens`، `webhook_secrets`، إلخ) — وإلا ستفشل قراءتها.

**مكان الفحص:** `src/lib/mcp/auth/encryption.ts` (`resolveEncryptionKey`).

### 12. Webhook أو OAuth Callback يفشل

**الأعراض:** استجابة `401` أو `invalid_grant` أو `redirect_uri_mismatch`.

**خطوات:**

1. تحقق من تطابق `redirectUri` المسجَّل في المستأجر مع الـ Redirect URI في موفر OIDC.
2. تحقق من أن `state` المُعاد من الموفر مطابق لما خزّنه الخادم في `sso_flows` (single-use).
3. تحقق من صحة `id_token` (RS256، issuer، audience، expiry).
4. راجع `src/lib/auth/sso/oidc.ts` لمزيد من التفاصيل.

### 13. تسرّب PII في الإخراج

**السلوك:** المنظومة تستبدل البريد بـ `[REDACTED:EMAIL]` ورقم الهاتف بـ `[REDACTED:PHONE]` تلقائياً (H9 + `piiStreamRedactor`).

**إذا ظهر PII غير مُخفي:**

1. تحقق أن تدفق الـ stream يمر عبر `createPIIStreamRedactor()` (`src/lib/security/piiStreamRedactor.ts`).
2. تحقق أن المسار غير التدفقي يستدعي `HookHarness.run('post_inference', ctx)` (H9).
3. إذا كانت صيغة PII غير معروفة (مثل جواز سفر، IBAN)، أضف نمطاً جديداً في `piiStreamRedactor.ts` و `hook-harness.ts` H9.

### 14. تشخيص الواجهة لا يعمل

| السبب المحتمل                                      | الحل                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `fetchWithAuth('/api/v1/diagnostics')` يفشل بـ 401 | انتهت الجلسة — سجّل الدخول                                                                                          |
| الـ Modal يعرض "تعذر الوصول إلى خدمة التشخيصات"    | تحقق من `/api/health` أولاً (liveness)، ثم `/api/v1/diagnostics` (مصادقة)                                           |
| النسخة لا تزال تعرض "100% Optimal" بدون فحص فعلي   | تأكد أنك على إصدار يَستخدم `HealthDiagnosticsModal` المحدث في `src/components/knowledge/HealthDiagnosticsModal.tsx` |

## قائمة مراجعة سريعة

عند مواجهة مشكلة غير معروفة:

1. **`GET /api/health`** — هل التطبيق نفسه حيّ؟
2. **`GET /api/v1/diagnostics`** — هل PostgreSQL/Qdrant/Mistral سليمون؟ ما هي درجة الجاهزية؟
3. **`POST /api/v1/diagnostics`** مع `target: "<service>"` — أعد فحص خدمة واحدة بعد تعديل إعداداتها.
4. **سجلات الخادم** — ابحث عن `[diagnostics] … failed`، `[apiAuth] … rejecting`، `[auth/register] … failed`.
5. **سجلات التدقيق (`audit_logs`)** — تحقق من حالة كل طلب H1–H9 (`PRE_AUTH`، `PRE_INFERENCE`، إلخ).
6. **مراجعة الـ env vars** عبر `envAudit` في استجابة التشخيصات (لا تسرّب قيم حقيقية — تُعرض بشكل آمن).

## انظر أيضاً

- [أدوات السكربتات](./scripts-tools.md)
- [الوظائف الخلفية](./background-jobs.md)
- [الاختبار](./testing.md)
- [المصادقة (CSRF، الجلسات، OIDC)](../06-security/authentication.md)
- [طبقات الحماية المتقدمة (Rate Limit، SSRF، AES)](../06-security/protections.md)
- [مرجع API — التشخيصات](../04-api/overview.md)
