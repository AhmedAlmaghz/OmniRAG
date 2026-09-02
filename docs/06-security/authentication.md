# المصادقة (Authentication)

يصف هذا المستند نظام المصادقة الموحَّد في OmniRAG: التسجيل وتسجيل الدخول (Argon2id)، إدارة الجلسات (ملفات تعريف الارتباط httpOnly)، حماية CSRF، تسجيل الدخول الموحَّد عبر OIDC، ومفاتيح API للمستأجرين. جميع مسارات `/api/v1/*` تشترك في بوابة مصادقة واحدة (`verifyApiAuth`) ترفض أي طلب يفتقر إلى بيانات اعتماد صالحة — لا توجد مسارات تجاوز (bypass) ولا رموز JWT موقَّعة.

تستند هذه الوثيقة إلى الكود الموجود في `src/lib/auth/`.

## نظرة عامة

| الميزة               | الموقع                                                        | الخوارزمية / الآلية                                            | مدة الصلاحية                 |
| -------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------- |
| تجزئة كلمة المرور    | `src/lib/auth/password.ts`                                    | Argon2id (`@node-rs/argon2`)                                   | غير قابلة للاشتقاق (one-way) |
| الجلسات (المتصفح)    | `src/lib/auth/session.ts`, `src/lib/auth/sessionInfo.ts`      | رمز عشوائي 32 بايت (hex 64) + بحث في جدول `sessions`           | 7 أيام                       |
| CSRF                 | `src/lib/auth/csrf.ts`, `src/lib/security/securityHeaders.ts` | ترويسة `X-Requested-With: XMLHttpRequest` + فحص Origin/Referer | لكل طلب                      |
| SSO / OIDC           | `src/lib/auth/sso/oidc.ts`                                    | Authorization Code + PKCE (S256)، RS256 JWKS                   | يحكمها المُصدر (issuer)      |
| مفاتيح API           | `src/lib/auth/apiKeys.ts`                                     | `omnirag_live_<96 hex>` + تخزين SHA-256 hash فقط               | اختيارية (المستأجر يحدد)     |
| بوابة التحقق الموحدة | `src/lib/auth/apiAuth.ts`                                     | يتحقق من Bearer أولاً ثم من ملف تعريف الارتباط                 | لكل طلب                      |

## بوابة المصادقة الموحدة (`verifyApiAuth`)

`verifyApiAuth` في `src/lib/auth/apiAuth.ts` هي نقطة الدخول الوحيدة لكل المسارات المحمية. ترتيب التحقق ثابت:

1. **مفتاح API (Bearer):** إذا احتوى الترويسة `Authorization: Bearer omnirag_live_…` شكلاً معروفاً، يُحسب تجزئة SHA-256 ويُبحث عنها في `api_keys`. التحقق يُرفض في الحالات:
   - مفتاح غير موجود أو مُلغى (`401_INVALID_API_KEY`)
   - مفتاح منتهي الصلاحية أو مُلغى (`401_API_KEY_INACTIVE`)
   - فشل بحث DB (`401_API_KEY_LOOKUP_FAILED`)
   - تجاوز حد معدّل المفتاح (`429_API_KEY_RATE_LIMITED`)
   - تعذّر قراءة المفتاح (`401_BAD_API_KEY`)
     عند النجاح، يُحدَّث `last_used_at` بشكل غير متزامن (لا يفشل الطلب عند فشل التحديث).

2. **ملف تعريف الارتباط للجلسة (المتصفح):** إن لم يكن الطلب حاملاً Bearer، يُقرأ `omnirag-session` ويبحث عنه في `sessions`. الرموز المنتهية تُحذف best-effort. الرموز غير الصالحة ترجع `401_NO_SESSION` / `401_INVALID_SESSION` / `401_EXPIRED_SESSION`.

لا توجد طبقة JWT موقَّعة ولا مسار "demo/bypass".

## التسجيل وتسجيل الدخول (Argon2id)

### تجزئة كلمة المرور (`src/lib/auth/password.ts`)

- الخوارزمية: **Argon2id** (OWASP) عبر `@node-rs/argon2` (بايناتريز napi مُسبقة البناء — تعمل بدون خطوة بناء محلياً على Vercel).
- المعاملات: `memoryCost = 19456` (19 MiB)، `timeCost = 2`، `parallelism = 1` — تم ضبطها لتقاوم القوة العمياء دون تجاوز حدود CPU/الوقت للـ serverless.
- التحقق يُرجع `false` للمدخلات الخاطئة ولا يرمي للأخطاء (لا توجد قناة خطأ جانبية).

### الحراسة ضد تعداد الحسابات (Timing Oracle)

`getDummyPasswordHash()` يُرجع تجزئة Argon2 حقيقية مُسبقة الحساب لسلسلة معروفة، ويُخزَّن مؤقتاً. عندما يطلب المهاجم تسجيل دخول ببريد غير موجود في `users`، يستدعي الكود `verifyPassword` على هذا الـ dummy (مع تجاهل النتيجة) لجعل زمن الاستجابة مساوياً للحالة "كلمة مرور خاطئة لمستخدم موجود". بدون هذا، يصبح "المستخدم غير موجود" أسرع بشكل ملحوظ — هجوم تعداد قابل للقياس.

### حسابات SSO بدون كلمة مرور

`SSO_NO_PASSWORD_HASH = 'sso:no-password-login'` يُخزَّن في `users.passwordHash` للحسابات المُنشأة عبر OIDC. هذه السلسلة **ليست** ترميز Argon2 صالح، لذا `verifyPassword` يرفضها دائماً. الحساب الذي يدخل فقط عبر SSO لا يمكنه أبداً تسجيل الدخول عبر نموذج كلمة المرور.

### مسار التسجيل (`src/app/api/v1/auth/register/route.ts`)

1. **Rate limit قبل أي عمل:** 5 طلبات/دقيقة لكل IP — يمنع DoS عبر إغراق Argon2.
2. **فحص CSRF:** الترويسة `X-Requested-With: XMLHttpRequest` يجب أن تكون حاضرة.
3. **التحقق من المدخلات:** البريد يخضع لـ `^[^\s@]+@[^\s@]+\.[^\s@]+$`. الحد الأدنى لكلمة المرور 8 أحرف (`400_WEAK_PASSWORD`).
4. **وضع الانضمام:** في حال وجود `inviteToken`، يُتحقَّق من الدعوة قبل إنشاء أي شيء (`400_BAD_INVITATION` / `400_INVITATION_EMAIL_MISMATCH`).
5. **تفرّد البريد:** إن وُجد مستخدم بنفس البريد، يُرجع `409_EMAIL_EXISTS`.
6. **إنشاء المستخدم/المستأجر:** معرّفات `user-<uuid>` و`tenant-<uuid>` عبر `randomUUID()` (RFC 4122 v4، 122 بت من CSPRNG) بدلاً من `Date.now()+Math.random` السابقة.
7. **Bcrypt:** `passwordHash` يُحسب بـ Argon2id.
8. **إنشاء الجلسة:** `createSessionToken()` ثم `setSessionCookie()`.

### مسار تسجيل الدخول (`src/app/api/v1/auth/login/route.ts`)

1. **Rate limit لكل IP:** 10 طلبات/دقيقة.
2. **CSRF:** مطلوب.
3. **Rate limit لكل بريد (ثانوي):** 5 طلبات/دقيقة — يحبط تدوير IP عبر credential stuffing. يُطبَّق بعد التحقق من البريد لتجنّب تسميم المجموعات بإدخالات خاطئة.
4. **استجابة موحَّدة للأخطاء:** `البريد الإلكتروني أو كلمة المرور غير صحيحة` ورمز `401_INVALID_CREDENTIALS` لكل من (بريد غير موجود / كلمة مرور خاطئة / بريد مشوّه / كلمة مرور فارغة) — يحجب القناة الجانبية التي تكشف أيهما خاطئ.
5. **الدفاع بالتوقيت:** فرع "المستخدم غير موجود" يستدعي `verifyPassword` على dummy hash ويُتجاهل النتيجة.
6. عند النجاح: جلسة جديدة + تنظيف best-effort للجلسات المنتهية (`deleteExpiredSessions`).

## الجلسات

### بنية الرمز (`src/lib/auth/sessionInfo.ts`)

- `createSessionToken()`: 32 بايت من `crypto.randomBytes`، hex-encoded (64 محرفاً).
- `SESSION_LIFETIME_MS`: 7 أيام (مُتضمَّن أيضاً في `maxAge` للملف).
- `sessionExpiryIso()`: يحسب ISO timestamp للـ DB.

### ملف تعريف الارتباط (`src/lib/auth/session.ts`)

- الاسم: `omnirag-session`.
- السمات: `httpOnly` (لا يصل JS)، `secure` في الإنتاج فقط، `sameSite: 'lax'`، `path: '/'`.
- **لا يوجد JWT ولا توقيع:** الإلغاء فوري عبر حذف الصف من `sessions`.
- `clearSessionCookie()` يُستعمل عند تسجيل الخروج.
- `getSessionTokenFromRequest()` للجهة المتزامنة (Route Handler)، `getSessionTokenFromCookies()` للجهة غير المتزامنة (`cookies()` من Next 16).

## حماية CSRF

### آليتان متكاملتان

1. **الترويسة المخصصة (`src/lib/auth/csrf.ts`):**
   - `CSRF_HEADER = 'x-requested-with'` و `CSRF_HEADER_VALUE = 'XMLHttpRequest'`.
   - `isCsrfOk(req)` يتحقق من المطابقة. `csrfDenied()` يُرجع 403 برمز `403_CSRF`.
   - المتصفحات لا ترسل هذه الترويسة تلقائياً عبر الطلبات cross-site؛ إنها حكر على الـ fetch من نفس الـ SPA.

2. **فحص Origin/Referer (`src/lib/security/securityHeaders.ts`):**
   - `isSameOriginRequest()` يتحقق من `Origin` (مع `Referer` كاحتياط) ويقارنه بمضيف الطلب أو قائمة `ALLOWED_ORIGINS`.
   - استثناءات ضمنية:
     - طلبات `GET`/`HEAD`/`OPTIONS` تُعتبر دائماً same-origin.
     - الطلبات الحاملة لـ `Authorization: Bearer …` (مفاتيح API) لا تحتاج فحص Origin — ليست بيانات اعتماد cookie بيئية.
     - غياب Origin/Referer تماماً: `SameSite=Lax` يمنع إرسال الكوكي أصلاً عبر المواقع.

### سلوك العميل (`src/lib/auth/fetchWithAuth.ts`)

- `buildAuthHeaders()` يضع الترويسة `X-Requested-With: XMLHttpRequest` تلقائياً، ويضيف `x-env-*` و `x-ai-model-config` المرسلة من localStorage.
- `fetchWithAuth()` يُمرّر هذه الرؤوس ويضمن `credentials: 'same-origin'`.
- آلية احتياطية عند فشل الشبكة: إعادة المحاولة على URL مطلق، ثم استجابة 503 وهمية مع حقول آمنة (`sources: []`، `conversations: []`، إلخ) حتى لا تتعطّل الواجهة.

## SSO / OIDC (`src/lib/auth/sso/oidc.ts`)

تطبيق معياري خالص لـ **Authorization Code + PKCE (S256)** بدون SDKs لمُحدِّد خدمة. يعمل مع أي مُصدر ينشر `/.well-known/openid-configuration` (Azure AD، Okta، Google Workspace، Keycloak، Auth0، إلخ).

### الاكتشاف (Discovery) وتخزين JWKS

- `discoverOidc(issuer)`: يجلب ويحفظ (TTL = 10 دقائق) مستند الاكتشاف.
- `fetchJwks(jwksUri)`: يجلب ويحفظ (TTL = 10 دقائق) مفاتيح JWKS.
- تطبيع الـ issuer (إزالة اللواحق `/` النهائية) يُستخدم في كل المقارنات.

### PKCE

- `generatePkce()`: مُحقِّق عشوائي عالي الإنتروبيا (48 بايت base64url) + تحدّي S256.
- يُستخدم دائماً — حتى مع العملاء السريّين (confidential clients) — حتى لا يُصبح اعتراض كود التفويض قابلاً للاستخدام بدون verifier.

### رمز `state`

- `generateState()`: base64url لـ 32 بايت عشوائية.
- يُربط من جانب الخادم بسجل `sso_flows` أحادي الاستخدام يربط callback بالمستأجر البادئ.

### تبادل الرموز (Token Exchange)

- `exchangeCodeForTokens()`: يُرسل `code` + `code_verifier` + `redirect_uri` + `client_id`، ويضيف `client_secret` (مفكوك التشفير فقط في هذه اللحظة) للعملاء السريّين.
- الأخطاء تُحوَّل إلى `Error` وصفية (200 محرف من جسم الاستجابة) ليتم التعامل معها كرسالة فشل من قِبل المتصل.

### التحقق من `id_token`

`verifyIdToken()` يُطبّق الفحوصات بالترتيب:

1. البنية: ثلاث قطع مفصولة بنقطة.
2. الخوارزمية: **`RS256` فقط** (يُرفض أي `alg` آخر).
3. البحث في JWKS عن مفتاح `RSA` يطابق `kid` (أو الأول إن لم يُحدد).
4. **التحقق من التوقيع** عبر `crypto.verify('RSA-SHA256', …)`.
5. مطابقة `iss` للـ issuer المُهيَّأ (مُطبَّع).
6. `aud` يجب أن يحوي `clientId`.
7. `exp` في المستقبل (مع تسامح ±60 ثانية لتفاوت الساعة).
8. مطابقة `nonce` الاختيارية.

### استخراج البريد

`emailFromClaims()` يقرأ `email` أو `preferred_username`، يُطبّعها بحروف صغيرة، ويُطبّق regex البريد. يُرجع `null` عند الغياب أو فشل التحقق.

## مفاتيح API للمستأجرين

### الشكل (`src/lib/auth/apiKeys.ts`)

- **البادئة العامة:** `omnirag_live_`.
- **الجزء السري:** 48 بايت عشوائية hex-encoded (96 محرفاً بعد البادئة).
- **ما يُخزَّن:** تجزئة SHA-256 فقط (`keyHash`) + بادئة عرض قصيرة غير سرية (`prefix` = أول 8 محارف بعد `omnirag_live_`).
- **ما يُعرَض مرة واحدة:** `plainKey` عند إنشائه — لا يمكن استرجاعه لاحقاً.

### إنشاء المفتاح (`POST /api/v1/api-keys`)

- يتطلب صلاحية `apiKeys:manage`.
- يخضع لـ `guardQuota(tenantId, 'maxApiKeys')` (سقف خطة).
- يقبل اختيارياً: `expiresAt` (ISO أو `expiresInDays`)، `rateLimitPerMinute` (عدد صحيح 1–100000)، `scopes[]`، `mcpTools[]` (قائمة بيضاء للأدوات الصادرة).
- الاستجابة: `{ id, name, prefix, scopes, rateLimitPerMinute, mcpTools, expiresAt, lastUsedAt, revokedAt, createdAt, active, plainKey }` — `plainKey` يظهر مرة واحدة فقط.

### التحقق

- `extractBearerApiKey(req)` يقرأ ترويسة `Authorization`، يقبل فقط `Bearer <value>` ثم يتحقق من `looksLikeApiKey` (البادئة + الطول). عند عدم مطابقة الشكل، يُرجع `undefined` ليسمح لمسار الكوكي بالعمل.
- `isApiKeyActive(key, now)` يفحص `revokedAt` و `expiresAt`.

### حدود معدّل المفتاح

- عند تعيين `rateLimitPerMinute > 0`، يُطبَّق `checkKeyedRateLimit(`apikey:${record.id}`, …)` بسلة مستقلة عن IP — الحد متطابق عبر جميع المسارات والخوادم.
- التجاوز يُرجع `429_API_KEY_RATE_LIMITED` مع `Retry-After`.

### الإدارة

- `GET /api/v1/api-keys` — قائمة مفاتيح المستأجر (العرض العام عبر `toApiKeyPublicView`، لا يحوي `keyHash`).
- `DELETE /api/v1/api-keys` — إلغاء فوري بحذف الصف.

## فصل المسارات بين الجلسات والمفاتيح

| الخاصية       | `authMethod: 'session'`         | `authMethod: 'apiKey'`                   |
| ------------- | ------------------------------- | ---------------------------------------- |
| ناقل الاعتماد | كوكي httpOnly                   | ترويسة `Authorization: Bearer`           |
| الإلغاء       | حذف صف `sessions` فورياً        | حذف صف `api_keys` فورياً                 |
| فحص CSRF      | نعم (الترويسة + Origin)         | معفى (ليس cookie بيئياً)                 |
| تحديد المعدّل | `checkRateLimit(req, …)` على IP | `checkKeyedRateLimit(`apikey:${id}`, …)` |
| الصلاحيات     | قائمة memberships للمستخدم      | `apiKeyScopes` + `apiKeyMcpTools`        |

## انظر أيضاً

- [نظرة عامة على الأمان](./overview.md)
- [طبقات الحماية المتقدمة (SSRF، تعقيم، AES)](./protections.md)
- [مرجع API — المصادقة](../04-api/overview.md)
- [مرجع واجهات API](../04-api/overview.md)
- [بنية النظام — الجلسات والمصادقة](../02-architecture/overview.md)
