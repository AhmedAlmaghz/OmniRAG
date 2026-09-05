# نظرة عامة على الأمان (Security Overview)

تقدّم هذه الوثيقة نموذج الأمان الشامل لمنصة OmniRAG (v0.12.x) كما هو مُنفَّذ فعلياً في الكود: العزل متعدد المستأجرين (multi-tenant isolation)، مصفوفة الأدوار والصلاحيات، رؤوس الأمان (security headers)، سياسة CORS، والمتغيرات الإنتاجية الإلزامية أمنياً. كل بند مُوثَّق بمسار ملف ودوال حقيقية — لا شيء مُخترَع.

## فلسفة الأمان (Security Posture)

تعتمد OmniRAG سياسة "الرفض الافتراضي" (default-deny):

- لا توجد مسارات demo أو bypass؛ كل طلب `/api/*` يمر عبر `withAuthAndRateLimit` الذي يفرض Rate Limit ثم CSRF Origin gate ثم المصادقة، وكل فشل يُرجِع `401/403/429` صريح (راجع `src/lib/api/withAuthAndRateLimit.ts`).
- مفاتيح API تُخزَّن كتجزئة SHA-256 فقط (لا يُحفظ النص الأصلي أبداً)، في حين الجلسات صفوف opaque في Postgres (ليست JWT) فالإبطال فوري بحذف الصف.
- كل خطأ داخلي يُسجَّل في الخادم ويُعاد للعميل رسالة عامة عبر `serverErrorResponse` لمنع تسرّب البيانات (information disclosure — OWASP A01/A05)؛ راجع `src/lib/api/safeError.ts`.
- تهديد SSRF يُعالَج على ثلاث طبقات: قائمة أنماط حرفية + فحص DNS حقيقي + إعادة التحقق يدوياً من كل redirect.

## العزل متعدد المستأجرين (Multi-Tenant Isolation)

### tenantId كحدود أمان

كل سياق مصادقة (`AuthenticatedContext` في `src/lib/auth/apiAuth.ts`) يحمل `tenantId`. هذا المعرف يُمرَّر إلى طبقة التخزين عبر `runWithRequestContext` (في `src/lib/api/withAuthAndRateLimit.ts`) ليُستخدم في جميع استعلامات Postgres وQdrant اللاحقة:

```ts
return await runWithRequestContext(
  { tenantId: authCtx.tenantId, userId: authCtx.userId, apiKeyId: authCtx.apiKeyId },
  () => handler(req, authCtx, props),
);
```

### المرحلة 5: عضويات بدلاً من مالك واحد

ابتداءً من Phase 5، الأدوار لا تأتي من عمود `owner_id` على `tenants` بل من جدول `memberships`. دالة `resolveMembershipRole` في `src/lib/services/membershipService.ts` تجلب دور المستخدم داخل المستأجر، وأي مستخدم غير عضو في المستأجر يُرجِع `null` ويُمنع افتراضياً. المستأجرون القدامى (قبل Phase 5) يتراجعون إلى `owner` لمنشئ المستأجر ثم تُسجَّل عضويتهم تلقائياً.

### حراسة حدود المستأجر (H1 TenantGate)

داخل `src/lib/harness/hook-harness.ts`، الخطّاف `H1 TenantGate` (مرحلة `pre_auth`) يرفض أي عملية استدلال (inference) لا تحمل `tenantId` صالح، ويُسجِّل المحاولة في `audit_logs` بوسم `blocked`. هذا يحمي من تسريب عبر تدفّق RAG يُسرّب بيانات مستأجرين آخرين.

### وضع Row Level Security: سياسات فاشلة-مغلقة مفعّلة (v0.12.9)

> **الحقيقة المنفَّذة** (اعتباراً من v0.12.9): سياسات RLS **مثبَّتة فعلياً** على كل الجداول الـ 19 الحاملة لـ `tenant_id`، والعزل الأساسي يبقى في طبقة التطبيق — الدفاع مزدوج.

في `ensurePostgresTables` (المسار الاحتياطي) وفي مهاجر Drizzle (`migrateAndSeedDrizzle.ts` — مراجعة المخطط `2026-09-05-rls-policies`) وفي `scripts/manual-migration.sql` (القسم 9)، تُنشأ لكل جدول tenant-scoped سياسة idempotent:

```sql
CREATE POLICY tenant_isolation_documents ON documents
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
```

- **فشل-مغلق بطبيعته:** `current_setting(..., true)` يعيد `NULL` عند عدم ضبط المتغير → المقارنة `NULL` → صفر صفوف في القراءة ورفض في الكتابة — لا يوجد سيناريو "allow-all".
- **وضع التفعيل منذ v0.12.10 — مفعّل فعلياً:** فصلت طبقتا الاتصال: `DATABASE_URL` (المالك) للهجرات/الـ DDL/البذر فقط، و`DATABASE_APP_URL` (دور `omnirag_app` الأقل امتيازاً) لكل القراءة/الكتابة التشغيلية — وعندها تُطبَّق السياسات بكل استعلام تشغيلي. Docker compose يفعّل هذا **افتراضياً**؛ حذف `DATABASE_APP_URL` يعيد الوضع الخامل (تجاوز المالك). كل الدوال التشغيلية في `postgres.ts` (44 دالة) تضبط `app.current_tenant` عند سحب الاتصال وتبدّده (`RESET`) عند الإرجاع، فلا يحمل اتصال مُجمَّع مستأجراً عبر الطلبات.
- **المسارات العابرة-للمستأجرين المصرّح بها (10 دوال `SECURITY DEFINER`):** مصادقة مفتاح API بالهاش، ختم آخر-استخدام، توريد المصادر المجدولة، عضويات المستخدم (مبدّل مساحات العمل)، الدعوة بالتوكن، الدعوات المعلقة بالبريد، تعديل حالة الدعوة، مشاركة برابط التوكن العام، استهلاك تدفق SSO بالحالة، وتنظيف تدفقات SSO المنتهية. كلها: مملوكة للمالك، بـ `search_path` مثبّت، غير قابلة للتنفيذ من `PUBLIC`، ومساحة سطحها استعلام واحد مقيّد بمعامل المتصل (توكن/معرف/حالة).
- **أداة إثبات العقد:** `npm run db:verify-rls` (`scripts/verify-rls.ts`) تنشئ دوراً مؤقتاً غير مالك وتتحقق حياً من: الفشل-المغلق (بدون متغير → 0 صفوف)، نطاق القراءة، حارس الكتابة (`WITH CHECK` يرفض `tenant_id` أجنبياً)، وأن قراءة `api_keys` المباشرة محجوبة بينما بحث الهاظ عبر الدالة الـ definer يعمل — وتنظف أثرها ذاتياً.
- **سابقة تاريخية:** قبل v0.12.2 كان مسار البحث اللفظي يُصدر FTS بلا predicate مستأجر إطلاقاً — اكتُشف وأُصلح وأُثبّت باختبار. وشبكة `src/__tests__/tenantPredicateCoverage.test.ts` (منذ v0.12.8) تمنع رجوع هذا الصنف كلياً.

### اختبار العزل المعجمي

ملف `src/__tests__/lexicalTenantIsolation.test.ts` يتحقق صراحةً أن استعلامات lexical لا تتجاوز حدود المستأجر، و`src/__tests__/tenantPredicateCoverage.test.ts` يمدّد الضمانة لكل عبارات SQL في طبقة Postgres.

## الأدوار والصلاحيات (Roles & Permissions)

### مصفوفة الأدوار

مصفوفة الصلاحيات وحيدة المصدر ومُعرَّفة في `src/lib/auth/permissions.ts` ضمن الثابت `ROLE_PERMISSIONS`. الأذونات تتبع الصيغة `resource:action` ويُمنَح أيّ شيء غير مذكور ضمنياً.

| الدور (Role) | المستندات                | المحادثات                | الإعدادات    | الإدارة                                 | الفوترة |
| ------------ | ------------------------ | ------------------------ | ------------ | --------------------------------------- | ------- |
| `owner`      | read + write + delete    | read + write + delete    | read + write | providers, mcp, apiKeys, members, audit | billing |
| `admin`      | read + write + delete    | read + write + delete    | read + write | providers, mcp, apiKeys, members, audit | لا      |
| `editor`     | read + write (لا delete) | read + write (لا delete) | read فقط     | لا                                      | لا      |
| `viewer`     | read فقط                 | read فقط                 | read فقط     | لا                                      | لا      |

### قائمة الصلاحيات الكاملة

مُستخرَجة حرفياً من `PERMISSIONS` في `src/lib/auth/permissions.ts`:

```
documents:read, documents:write, documents:delete
collections:read, collections:write
sources:read, sources:write, sources:delete
chat:use
conversations:read, conversations:write, conversations:delete
settings:read, settings:write
providers:manage, mcp:manage, apiKeys:manage
members:read, members:manage
billing:manage, audit:read
```

### بوابة التحقق من الصلاحية

| الدالة                                | الملف                         | الاستخدام                                                                           |
| ------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| `roleHasPermission(role, permission)` | `src/lib/auth/permissions.ts` | فحص منطقي يُرجِع `boolean`.                                                         |
| `requirePermission(ctx, permission)`  | `src/lib/auth/permissions.ts` | يُرجِع `{allowed, role, permission}`، لا يرمي — المتحكم بالمسار يقرر شكل الاستجابة. |
| `guardPermission(ctx, permission)`    | `src/lib/auth/permissions.ts` | يُرجِع `NextResponse` بـ 403 إذا مُنع، أو `null` إذا سُمح.                          |

مثال واقعي من `src/app/api/v1/mcp/servers/route.ts`:

```ts
const denied = await guardPermission(authCtx, 'mcp:manage');
if (denied) return denied;
```

## رؤوس الأمان وسياسة CORS

### الرؤوس الأساسية (تُطبَّق على كل استجابة)

مُعرَّفة في `baseSecurityHeaders` ضمن `src/lib/security/securityHeaders.ts` ويُطبّقها الـ middleware `src/middleware.ts` على كل طلب (API وصفحات HTML على حدّ سواء):

| الرأس                        | القيمة                                                                             | الغرض                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `X-Content-Type-Options`     | `nosniff`                                                                          | منع MIME sniffing                                       |
| `X-Frame-Options`            | `DENY`                                                                             | منع clickjacking                                        |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`                                                  | تقييد تسرّب المُحيل                                     |
| `Permissions-Policy`         | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` | تعطيل الميزات الحساسة                                   |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                                      | عزل نافذة cross-origin                                  |
| `X-DNS-Prefetch-Control`     | `off`                                                                              | منع تسريب DNS                                           |
| `Strict-Transport-Security`  | `max-age=31536000; includeSubDomains`                                              | **الإنتاج فقط** — يُضاف فقط عندما `NODE_ENV=production` |

### Content-Security-Policy للصفحات

`buildCsp(nonce)` في `src/lib/security/securityHeaders.ts` يُنتج CSP صارم بـ `nonce` لكل طلب، يُولَّد داخل الـ middleware عبر `crypto.randomUUID()`. يُسمح فقط بـ `script-src 'self' 'nonce-${nonce}'` بدون `unsafe-eval`. صفحة Swagger UI تحصل على CSP منفصل عبر `buildDocsCsp` يسمح بـ `https://unpkg.com` فقط لهذه الصفحة بالذات.

### سياسة CORS

دالة `applyCors` داخل `src/middleware.ts` لا تعكس أبداً (reflect) origins غير موثوقة؛ تتطابق فقط مع القائمة المسموحة من `getAllowedOrigins()`:

- متغير البيئة `ALLOWED_ORIGINS` (قائمة مفصولة بفواصل) هو المصدر الإنتاجي.
- في وضع التطوير فقط، يُرجِع `['http://localhost:3000', 'http://127.0.0.1:3000', 'http://0.0.0.0:3000']` كقيم افتراضية.
- في الإنتاج، القائمة الفارغة ترفض كل cross-origin.

عند المطابقة، تُضَاف: `Access-Control-Allow-Origin` و`Access-Control-Allow-Credentials: true` و`Vary: Origin` ومنع origins بقيمة `null`.

## بوابة CSRF (Origin Gate)

لأنّ الجلسة httpOnly يُلحَقة تلقائياً عبر `SameSite=Lax` على التنقلات cross-site، فإنّ كل طلب POST/PUT/DELETE عبر `withAuthAndRateLimit` يخضع لبوابة `isSameOriginRequest` في `src/lib/security/securityHeaders.ts`:

- GET/HEAD/OPTIONS لا تُفحَص (لا تنقل حالة).
- الطلبات الحاملة لـ `Authorization: Bearer …` (مفاتيح API) لا تُفحَص لأنّها ليست credentials تلقائية (ambient cookies)، فلا يمكن لـ CSRF ركوبها.
- خلاف ذلك، `Origin` (أو `Referer` كبديل) يجب أن يطابق host الطلب أو يكون في قائمة `ALLOWED_ORIGINS`، وإلا يُرجَع `403 Forbidden` قبل أي عملية تحقق.
- غياب Origin وReferer معاً يُعتبر same-origin (لأنّ `SameSite=Lax` يمنع إرسال الكوكي أصلاً).

الاختبار `src/__tests__/csrfOriginGate.test.ts` يُثبِّت أنّ المسارات الـ50 الملفوفة الآن ترفض cross-origin POST قبل لمس المصادقة.

## متطلبات الإنتاج الإلزامية أمنياً

| المتغير                            | الغرض                                                           | السلوك عند الغياب                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_OAUTH_ENCRYPTION_KEY`         | مفتاح AES-256-GCM لـ OAuth tokens وwebhook secrets              | `src/lib/mcp/auth/encryption.ts` يرمي خطأً صريحاً في الإنتاج بدلاً من استخدام المفتاح الاحتيالي العام.                                    |
| `ALLOWED_ORIGINS`                  | قائمة origins لـ CORS + CSRF gate                               | في الإنتاج تُرجِع قائمة فارغة فترفض كل cross-origin.                                                                                      |
| `NODE_ENV=production`              | تفعيل HSTS + رفض dev-key + Secure على الكوكي                    | بدونه تُطبَّق إعدادات أضعف ملائمة للتطوير المحلي.                                                                                         |
| `SESSION_COOKIE Secure`            | إعداد آمن عبر `setSessionCookie` (في `src/lib/auth/session.ts`) | في الإنتاج يضاف `secure: true` تلقائياً.                                                                                                  |
| `POSTGRES_URL` (أو `DATABASE_URL`) | مصدر الحقيقة للجلسات، الصلاحيات، rate-limit، وaudit logs        | المعدّل (limiter) يتراجع إلى الذاكرة لمدة 30 ثانية عند الفشل، لكنّ تدقيق الجلسات يفشل كلياً (راجع `src/lib/api/withAuthAndRateLimit.ts`). |

## ملخّص طبقات الدفاع (Defense-in-Depth)

| الطبقة           | الملف                                                                         | الحماية                                                                      |
| ---------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Edge middleware  | `src/middleware.ts`                                                           | رؤوس أمان + CORS + CSP nonce + استجابة OPTIONS فورية                         |
| Rate limit       | `src/lib/security/rateLimiter.ts` + `durableRateLimiter.ts`                   | حدود لكل IP/للمفتاح/للبريد، مستمرّ عبر Postgres                              |
| CSRF             | `src/lib/api/withAuthAndRateLimit.ts` + `src/lib/security/securityHeaders.ts` | Origin/Referer gate لكل طلب cookie-auth mutation                             |
| Authentication   | `src/lib/auth/apiAuth.ts`                                                     | مفتاح API بـ SHA-256 أو جلسة opaque                                          |
| Authorization    | `src/lib/auth/permissions.ts`                                                 | مصفوفة `role × permission` قائمة على memberships                             |
| Tenant boundary  | `src/lib/api/withAuthAndRateLimit.ts` + `hook-harness.ts` H1                  | `runWithRequestContext` + TenantGate                                         |
| SSRF             | `src/lib/mcp/net.ts`                                                          | scheme allow-list + literal deny-list + DNS pinning + redirect re-validation |
| Prompt injection | `src/lib/harness/hook-harness.ts` H6/H6b                                      | مسح المستخدم والمسترجَع معاً (indirect injection)                            |
| PII              | `src/lib/security/piiStreamRedactor.ts` + H9                                  | تحرير streaming وpost-hoc                                                    |
| Outbound secrets | `src/lib/mcp/auth/encryption.ts`                                              | AES-256-GCM مع auth tag                                                      |
| Audit            | `src/lib/storage/postgres.ts` + جدول `audit_logs`                             | تسجيل كل قرار hook وكل عملية إدارية                                          |

## انظر أيضاً

- [المصادقة](./authentication.md)
- [الحمايات](./protections.md)
- [نظرة عامة على قاعدة البيانات](../05-database/schema.md)
- [بنية الدليل](../02-architecture/directory-structure.md)
