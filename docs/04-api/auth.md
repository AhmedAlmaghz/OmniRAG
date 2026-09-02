# المصادقة والجلسات ومساحات العمل (Authentication, Sessions & Workspaces)

تتعامل مجموعة مسارات `/api/v1/auth/*` مع: تسجيل الحسابات، الدخول/الخروج، إدارة الجلسات، تسجيل الدخول الأحادي (SSO) عبر OIDC، والعضوية المتعددة في مساحات العمل. المصدر: `src/app/api/v1/auth/`.

## الفهرس

| المسار                      | الطريقة    | الوصف                     |
| --------------------------- | ---------- | ------------------------- |
| `/api/v1/auth/register`     | POST       | تسجيل حساب جديد           |
| `/api/v1/auth/login`        | POST       | الدخول + إصدار cookie     |
| `/api/v1/auth/logout`       | POST       | إلغاء الجلسة              |
| `/api/v1/auth/session`      | GET        | معلومات الجلسة الحالية    |
| `/api/v1/auth/workspaces`   | GET / POST | قائمة / تبديل مساحة العمل |
| `/api/v1/auth/sso/initiate` | POST       | بدء تدفق OIDC             |
| `/api/v1/auth/sso/callback` | GET        | رد موفر الهوية            |
| `/api/v1/auth/sso/config`   | GET / POST | إعدادات OIDC للمستأجر     |

---

## POST `/api/v1/auth/register`

**المسار**: `src/app/api/v1/auth/register/route.ts`

تسجيل مستخدم جديد. وضعان:

- **وضع إنشاء** (افتراضي): يُنشئ مستأجر (tenant) جديد، يزرع الإعدادات الافتراضية (`chunkSize=500`, `hybridWeights={semantic:0.7, lexical:0.3}`, `dataRetentionDays=90`, …) ويصدر جلسة owner.
- **وضع الانضمام** (`inviteToken`): ينضم المستخدم إلى مساحة عمل موجودة عبر دعوة (لا يُنشئ مستأجر جديد).

### المصادقة

- غير مصادق (open endpoint).
- حد معدل صارم: **5 طلبات / دقيقة / IP** (`REGISTER_RATE_LIMIT`).
- CSRF مطلوب (`isCsrfOk`).

### جسم الطلب

```json
{
  "email": "user@example.com",
  "password": "min8chars",
  "workspaceName": "Acme Corp", // مطلوب ما لم يكن inviteToken موجوداً
  "inviteToken": "inv-…" // للانضمام لمساحة عمل موجودة
}
```

### الاستجابة (201 Created)

```json
{
  "tenantId": "tenant-…",
  "userEmail": "user@example.com",
  "joinedExistingWorkspace": false
}
```

الترويسة `Set-Cookie: omnirag-session=…; HttpOnly; SameSite=Lax` تُصدَر دائماً.

### الأخطاء المهمة

| الحالة | الرمز                                    |
| ------ | ---------------------------------------- |
| 400    | `400_INVALID_EMAIL`                      |
| 400    | `400_WEAK_PASSWORD` (الحد الأدنى 8 أحرف) |
| 400    | `400_MISSING_WORKSPACE`                  |
| 400    | `400_BAD_INVITATION`                     |
| 400    | `400_INVITATION_EMAIL_MISMATCH`          |
| 409    | `409_EMAIL_EXISTS`                       |
| 429    | تجاوز 5 req/min                          |
| 500    | `INTERNAL_ERROR`                         |

### مثال curl

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@acme.com","password":"strongpass1","workspaceName":"Acme"}'
```

---

## POST `/api/v1/auth/login`

**المسار**: `src/app/api/v1/auth/login/route.ts`

يحقّق عبر Argon2id (مقارنة تجزئة في جدول `users`) ويُصدر جلسة. دفاعان مهمان:

1. **Rate limit مزدوج**: 10 req/min لكل IP **و** 5 req/min لكل بريد — يمنع تخمين كلمات المرور حتى مع تدوير IP.
2. **Timing-oracle defense**: في حال عدم وجود المستخدم، يُشغّل `verifyPassword` على dummy hash لضمان تساوي زمن الاستجابة مع حالة "كلمة مرور خاطئة".

### المصادقة

- غير مصادق. CSRF مطلوب.

### جسم الطلب

```json
{
  "email": "user@example.com",
  "password": "…"
}
```

### الاستجابة (200)

```json
{ "tenantId": "tenant-…", "userEmail": "user@example.com" }
```

### الأخطاء

| الحالة | الرمز                     | السبب                                       |
| ------ | ------------------------- | ------------------------------------------- |
| 401    | `401_INVALID_CREDENTIALS` | بريد أو كلمة مرور خاطئة (رسالة عامة موحّدة) |
| 429    | —                         | تجاوز حد المعدل (IP أو per-email)           |

### مثال curl

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"alice@acme.com","password":"strongpass1"}'
```

---

## POST `/api/v1/auth/logout`

**المسار**: `src/app/api/v1/auth/logout/route.ts`

يحذف صف الجلسة ويمسح الـ cookie. **Idempotent**: عدم وجود/انتهاء الجلسة يُرجع 200.

### المصادقة

- يتطلب cookie session صالح. CSRF مطلوب.

### جسم الطلب

فارغ.

### الاستجابة

```json
{ "ok": true }
```

ترويسة `Set-Cookie: omnirag-session=; …; Max-Age=0` تمسح الكوكي.

### مثال curl

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Cookie: omnirag-session=…" -b cookies.txt
```

---

## GET `/api/v1/auth/session`

**المسار**: `src/app/api/v1/auth/session/route.ts`

إعادة إhydration لحالة المصادقة عند إعادة تحميل المتصفح (الـ cookie معتم، الـ token غير شفّاف للعميل). يُرجع أيضاً قائمة مساحات العمل لتفعيل مُبدّل المستأجر بدون round-trip إضافي.

### المصادقة

- يكتشف cookie session من خلال `getSessionTokenFromRequest`.

### الاستجابة (200) عند جلسة صالحة

```json
{
  "authenticated": true,
  "tenantId": "tenant-…",
  "userId": "user-…",
  "userEmail": "alice@acme.com",
  "role": "owner",
  "workspaces": [
    { "tenantId": "tenant-A", "name": "Acme", "role": "owner", "isCurrent": true },
    { "tenantId": "tenant-B", "name": "Side", "role": "viewer", "isCurrent": false }
  ]
}
```

### الاستجابة (401) عند غياب/انتهاء الجلسة

```json
{
  "authenticated": false,
  "error": "Invalid or expired session",
  "code": "401_INVALID_SESSION"
}
```

رموز 401 المحتملة: `401_NO_SESSION`, `401_SESSION_LOOKUP_FAILED`, `401_INVALID_SESSION`, `401_EXPIRED_SESSION`.

### مثال curl

```bash
curl http://localhost:3000/api/v1/auth/session -b cookies.txt
```

---

## GET / POST `/api/v1/auth/workspaces`

**المسار**: `src/app/api/v1/auth/workspaces/route.ts`

### GET — قائمة مساحات العمل

يحتاج مصادقة (cookie session **أو** API key). يُرجع كل المساحات التي للمستخدم عضوية active فيها، مع وسم المساحة الحالية.

#### الاستجابة

```json
{
  "workspaces": [
    { "tenantId": "tenant-…", "name": "Acme", "role": "owner", "joinedAt": "2026-01-01T…", "isCurrent": true }
  ]
}
```

### POST — تبديل المساحة الحالية

يُنشئ جلسة جديدة مرتبطة بالمستأجر الهدف ويلغي القديمة. **مدعوم للجلسات فقط** — مفاتيح API مقيدة بمستأجر واحد وتُرجع 400.

#### جسم الطلب

```json
{ "tenantId": "tenant-target-…" }
```

#### الاستجابة (200)

```json
{ "success": true, "tenantId": "tenant-target-…", "role": "editor" }
```

ترويسة `Set-Cookie` جديدة تُصدَر دائماً.

#### الأخطاء

| الحالة | الرمز                       |
| ------ | --------------------------- |
| 400    | (مفتاح API حاول التبديل)    |
| 403    | `403_FORBIDDEN` (ليس عضواً) |
| 404    | مساحة العمل غير موجودة      |

---

## POST `/api/v1/auth/sso/initiate`

**المسار**: `src/app/api/v1/auth/sso/initiate/route.ts`

يبدأ تدفق OIDC SSO. يدعم طريقتين للحل:

- `tenantId` مباشر.
- `email` — يحل المستأجر عبر `db.findTenantIdBySsoEmailDomain(domain)`.

### المصادقة

- غير مصادق (open endpoint). حد 10 req/min.

### جسم الطلب

```json
{
  "tenantId": "tenant-…",
  "email": "alice@acme.com"
}
```

أحد الحقلين مطلوب.

### الاستجابة (200)

```json
{
  "authorizationUrl": "https://idp.example.com/authorize?…",
  "state": "opaque-state-…"
}
```

### الأخطاء

| الحالة | السبب                                                  |
| ------ | ------------------------------------------------------ |
| 400    | `400_INVALID_EMAIL`, `400_MISSING_INPUT`               |
| 403    | `403_SSO_DISABLED` (المستأجر لم يفعّل SSO)             |
| 404    | `404_NO_SSO_TENANT` (لا يوجد مستأجر مربوط بهذا النطاق) |

### مثال curl

```bash
curl -X POST http://localhost:3000/api/v1/auth/sso/initiate \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@acme.com"}'
```

---

## GET `/api/v1/auth/sso/callback`

**المسار**: `src/app/api/v1/auth/sso/callback/route.ts`

رد موفر الهوية. يستخدم **PKCE S256** و **single-use state row** (يُستهلك عبر `consumeSsoFlow`). JIT provisioning:

- ينشئ حساباً إذا لم يكن موجوداً (يحمل `SSO_NO_PASSWORD_HASH` كحارس).
- يربط عضوية جديدة إن لم تكن موجودة (الافتراضي `sso.defaultRole`).
- يصدر session cookie ويعيد التوجيه إلى `/`.

### المصادقة

- غير مصادق. حد 10 req/min.
- يستخدم ترويسة `state` مرة واحدة (replay محمي).

### معاملات الاستعلام

| الاسم   | الإلزامي                 |
| ------- | ------------------------ |
| `code`  | نعم (من موفر الهوية)     |
| `state` | نعم (من initiate)        |
| `error` | اختياري (إلغاء المستخدم) |
| `iss`   | اختياري (RFC 9207)       |

### الاستجابة

- `302 → /?sso=success` عند النجاح.
- `302 → /?sso=error&reason=…` عند أي فشل (الأسباب: `provider_denied`, `missing_params`, `invalid_state`, `sso_disabled`, `no_id_token`, `no_email`, `domain_mismatch`, `callback_failed`).

### تفاصيل الأمان

- `sso.emailDomain` (اختياري) يفرض أن نطاق البريد يطابق النطاق المسجل في إعدادات المستأجر.
- سر العميل (`clientSecret`) مُشفّر بـ AES-256-GCM في `tenant_config`.

---

## GET / POST `/api/v1/auth/sso/config`

**المسار**: `src/app/api/v1/auth/sso/config/route.ts`

### GET — قراءة الإعدادات

- يتطلب `settings:read`.
- يُرجع `{ sso: publicView(config.ssoOidc) }` حيث `publicView` يستبدل السر بـ `••••••••`.

```json
{
  "success": true,
  "sso": {
    "enabled": true,
    "issuer": "https://idp.example.com",
    "clientId": "…",
    "emailDomain": "acme.com",
    "defaultRole": "viewer",
    "hasClientSecret": true,
    "clientSecret": "••••••••"
  }
}
```

### POST — حفظ الإعدادات

- يتطلب `settings:write`.
- يُشفر السر الجديد بـ `encryptToken`، مع منطق:
  - إرسال القناع `••••••••` → يحافظ على السر القديم.
  - إرسال نص فارغ → يمسح السر.
  - إرسال قيمة جديدة → يُشفر ويُستبدل.

#### جسم الطلب

```json
{
  "enabled": true,
  "issuer": "https://idp.example.com",
  "clientId": "…",
  "clientSecret": "…",
  "emailDomain": "acme.com",
  "defaultRole": "viewer"
}
```

#### التحقق

- `issuer` يجب أن يبدأ بـ `https://`.
- تفعيل SSO يتطلب `issuer` و `clientId` غير فارغين.
- `defaultRole` إما `viewer`, `editor`, أو `admin`.

#### الأخطاء

| الحالة | الرمز                              |
| ------ | ---------------------------------- |
| 400    | `400_INCOMPLETE`, `400_BAD_ISSUER` |
| 500    | `500_SERVER_ERROR` (فشل الكتابة)   |

---

## ملاحظات مشتركة

- **البريد**: يُطبَّع (lowercase + trim) قبل التخزين والمقارنة.
- **UUIDs**: المستخدم والمستأجر يستخدمان `user-${randomUUID()}` و `tenant-${randomUUID()}` (RFC 4122 v4).
- **CSRF**: جميع الـ POST في `auth/*` تفحص `isCsrfOk`، لذا من المتصفح يجب إرسال الكوكي same-origin.
- **تطهير الجلسات**: `db.deleteExpiredSessions()` يُستدعى بعد كل login/register.

## انظر أيضاً

- [الجلسات والـ cookie](../06-security/sessions-cookies.md) (إن وُجد)
- [الأمان](../06-security/overview.md)
- [نظرة عامة على API](./overview.md)
