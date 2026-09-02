# Admin, Operations & Diagnostics API

مجموعة المسارات الإدارية: التحليلات، التشخيص، إعدادات البيئة، الخطة، المزودون، إعدادات النماذج (مع إعادة التضمين)، التخزين، قوالب خطوط الاستخراج، تفريغ YouTube، وخدمة الملفات المؤمّنة.

```mermaid
flowchart LR
  ui[UI] -->|metrics| analytics[/analytics]
  ui -->|health| diag[/diagnostics]
  ui -->|env| envcfg[/env-config]
  ui -->|plan| plan[/plan]
  ui -->|providers| providers[/providers]
  ui -->|models| models[/settings/models]
  models -->|on change| reembed[/settings/models/reembed]
  ui -->|storage| storage[/storage]
  ui -->|pipeline tpl| pipeline[/pipeline-templates]
  ui -->|yt transcript| yt[/youtube/transcript]
  ui -->|download file| files[/files/...key]
```

## المصادقة والصلاحيات

| المسار                          | الصلاحية                         | ملاحظات                                         |
| ------------------------------- | -------------------------------- | ----------------------------------------------- |
| `/analytics`                    | `audit:read`                     | مالكون/مدراء فقط.                               |
| `/diagnostics`                  | (session)                        | يكشف قناع الاتصال DB/Vector/Mistral.            |
| `GET /env-config`               | (session)                        | قناع لقيم `process.env`.                        |
| `POST /env-config`              | (settings:write)                 | تعديل آمن مع حجب أسرار المنصة في الإنتاج.       |
| `GET /plan`                     | `settings:read`                  | quota المستأجر.                                 |
| `PUT /plan`                     | `billing:manage`                 | تبديل/تخفيض خطة (الترقية تتطلب موافقة المشغّل). |
| `GET/POST/DELETE /providers`    | `providers:manage`               | credentials مشفّرة.                             |
| `GET/POST /settings/models`     | `settings:read`/`settings:write` | reembed تلقائي عند تغيير embeddingModel.        |
| `POST /settings/models/reembed` | `settings:write`                 | إعادة تضمين يدوية (maxDuration=300).            |
| `/storage`                      | `settings:read`/`settings:write` | اختيار vector + object store.                   |
| `/pipeline-templates`           | `settings:read`/`settings:write` | fast/balanced/accurate.                         |
| `/youtube/transcript`           | `sources:write`                  | maxDuration=300.                                |
| `/files/[...key]`               | `documents:read`                 | 120 طلب/دقيقة.                                  |

---

## `GET /api/v1/analytics`

يجمع الإحصائيات عبر `computeAnalyticsStats` ويعيد آخر 100 سجل تدقيق:

```json
{
  "stats": { "documents": { "total": 12, "indexed": 11, "failed": 1 }, "chunks": 240, "tools": {...}, "queries": {...} },
  "auditLogs": [...],
  "auditLogsTotal": 320,
  "conversationsCount": 7,
  "generatedAt": "..."
}
```

## `GET/POST /api/v1/diagnostics`

### `GET`

يعيد تشخيصاً كاملاً:

- PostgreSQL (latency, version, tables, masked URL).
- Qdrant (latency, hasApiKey, collectionsCount, omniCollectionExists).
- Mistral (latency, maskedKey, modelsCount, hasOcrSupport).
- EnvAudit (DB/Vector/AI/Ingress مع قناع).
- readinessScore + overallStatus (`healthy` ≥85, `degraded` ≥50, `critical` <50).

### `POST`

```json
{ "target": "postgres" | "qdrant" | "mistral" | "all" }
```

يُعيد تشخيصاً انتقائياً.

## `GET/POST /api/v1/env-config`

### `GET`

```json
{
  "success": true,
  "readinessPercentage": 86,
  "configuredCount": 6,
  "requiredCount": 7,
  "requiredConfiguredCount": 6,
  "isFullyConfigured": false,
  "envList": [
    {
      "key": "GEMINI_API_KEY",
      "category": "ai",
      "isConfigured": true,
      "isInjectedBySystem": true,
      "maskedPreview": "AIza••••••••xxxx"
    }
  ]
}
```

### `POST` (actions)

| `action`        | الحقول                                        | الوصف                                                                              |
| --------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `save` / `sync` | `envs?: Record<string,string>` أو `key+value` | يحقن المفاتيح غير الحساسة في runtime store، يعيد بناء تجمعات DB/Qdrant عند الحاجة. |
| `test`          | `key`, `value?`                               | يفحص فعلياً (DATABASE_URL, QDRANT_*, MISTRAL_API_KEY, GEMINI_API_KEY).             |

- **قاعدة الإنتاج**: `DATABASE_URL`, `POSTGRES_URL`, `QDRANT_URL`, `QDRANT_API_KEY`, `MISTRAL_API_KEY`, `GEMINI_API_KEY`, `UNSTRUCTURED_API_KEY` **مرفوضة** من POST (يجب توفيرها من المنصّة المُضيفة). الرد 403 `write_blocked_in_production`.

## `GET/PUT /api/v1/plan`

### `GET`

```json
{
  "success": true,
  "plan": { "id": "pro", "quotas": { "maxDocuments": 1000, ... }, ... },
  "usage": { "documents": 5, "collections": 2, "members": 3, "apiKeys": 1, "connectors": 2, "teams": 1 },
  "canManage": true,
  "availablePlans": [...]
}
```

### `PUT`

```json
{ "plan": "starter" }
```

- الترقية تتطلب `PLAN_SELF_SERVE=true` على المشغّل (`canSwitchPlan`).
- يُسجَّل `PLAN_CHANGED` في audit.

## `GET/POST/DELETE /api/v1/providers`

### `GET`

يكشف الكتالوج + الحالة لكل مزود (`configured`, `stored`, `enabled`, `baseUrl`) — لا أسرار.

### `POST action='save'`

```json
{
  "providerId": "openai",
  "credentials": { "apiKey": "sk-..." },
  "baseUrl": "https://api.openai.com/v1",
  "enabled": true
}
```

- الحقول `secret` تُشفّر (`encryptToken`).
- Placeholders (تحوي `•`) → "احتفظ بالقيمة".

### `POST action='discover'`

```json
{ "providerId": "openai" }
```

يُرجع قائمة النماذج المباشرة.

### `DELETE`

يحذف اعتماداً.

## `GET/POST /api/v1/settings/models`

### `GET`

```json
{ "success": true, "config": { "chatModel": "...", "embeddingModel": "...", ... }, "defaults": {...}, "serverTime": "..." }
```

### `POST action='save'`

```json
{
  "chatModel": "...",
  "embeddingModel": "...",
  "analysisModel": "...",
  "hydeModel": "...",
  "whisperModel": "...",
  "ocrModel": "...",
  "documentParseModel": "..."
}
```

- عند تغيّر `embeddingModel`:
  - مستأجر < 50 مقطع → reembed inline (نتيجة فورية).
  - مستأجر أكبر → reembed في الخلفية (fire-and-forget)، النتيجة تُسجَّل في `sync_logs`.
- يخزّن التكوين في `MODEL_CONFIG_COOKIE` (سنة، `sameSite=lax`).

### `POST action='reset'`

يعيد للقيم الافتراضية ويطلق reembed بنفس القاعدة.

## `POST /api/v1/settings/models/reembed`

إعادة تضمين يدوية لكامل corpus المستأجر.

- `?check=1` → فحص staleness فقط (`{ success, stale, activeModel }`).
- بدون المعامل → يعيد `{ success, reembed: { total, reembedded, failed, modelUsed, durationMs, errors } }`.
- يرفض 409 `EMBEDDING_MODEL_NOT_CONFIGURED` إذا لم يكن المزود مهيأً.

## `GET/POST /api/v1/storage`

### `GET`

```json
{
  "vectorStores": [{ "id": "qdrant", "configured": true, ... }],
  "objectStores": [{ "id": "vercel-blob", "configured": false, ... }],
  "selection": { "vectorStoreId": "qdrant", "objectStoreId": "local", "vectorStoreExplicit": true, "objectStoreExplicit": false }
}
```

### `POST`

```json
{ "vectorStoreId": "qdrant", "objectStoreId": "s3" }
```

- معرّفات غير معروفة → 400.
- يُمسح الكاش (`clearVectorStoreSelectionCache`, `clearObjectStoreSelectionCache`).

## `GET/POST /api/v1/pipeline-templates`

### `GET`

```json
{
  "templates": [
    {
      "id": "fast",
      "nameAr": "سريع",
      "nameEn": "Fast",
      "preferredEngine": "mistral",
      "chunkSize": 800,
      "chunkOverlap": 40
    },
    { "id": "balanced", "preferredEngine": "auto", "chunkSize": 500, "chunkOverlap": 50 },
    { "id": "accurate", "preferredEngine": "unstructured", "chunkSize": 300, "chunkOverlap": 60 }
  ],
  "defaultTemplateId": "balanced",
  "selection": { "templateId": "balanced", "preferredEngine": "auto", "chunkSize": 500, "chunkOverlap": 50 }
}
```

### `POST`

```json
{ "pipelineTemplateId": "accurate" }
```

## `POST /api/v1/youtube/transcript`

```json
{ "url": "https://www.youtube.com/watch?v=...", "lang": "ar" }
```

- يستدعي `processYoutubeTranscript(url, lang)` — سُلَّم ثلاثي: captions → audio download + Gemini Files → graceful error.
- 400 `INVALID_URL`، 422 لأخطاء الاستخراج.
- `maxDuration = 300`.

## `GET /api/v1/files/[...key]`

يخدم كائنات `uploads/<tenantId>/...` و `generated/<tenantId>/...` مع تحقق صارم من البادئة. MIME و inline/attachment يُشتقّان من الامتداد.

- 404 `404_NOT_FOUND` لمفاتيح خارج النطاق.
- 503 `503_UNAVAILABLE` لمخزن غير مهيأ.
- 120 طلب/دقيقة.

## رموز الأخطاء الشائعة

| الكود                            | الوصف                                 |
| -------------------------------- | ------------------------------------- |
| `400_BAD_PLAN`                   | معرّف خطة غير معروف.                  |
| `403_PLAN_UPGRADE_LOCKED`        | ترقية تتطلب موافقة المشغّل.           |
| `400_BAD_RATE_LIMIT`             | `rateLimitPerMinute` خارج النطاق.     |
| `400_BAD_MCP_TOOLS`              | `mcpTools` ليس مصفوفة نصوص.           |
| `write_blocked_in_production`    | محاولة تعديل أسرار المنصة في الإنتاج. |
| `EMBEDDING_MODEL_NOT_CONFIGURED` | نموذج التضمين بلا مزود مهيأ.          |

## انظر أيضاً

- [documents](documents.md) — تدفق الرفع والـ parse.
- [sources](sources.md) — اتصال الموصلات + capabilities.
- [connectors](../08-integrations/connectors.md) — قائمة الموصلات وحالاتها.
- [extraction-engines](../08-integrations/extraction-engines.md) — محركات الاستخلاص وقوالبها.
