# Sources API

مجموعة `/api/v1/sources/*`: CRUD للموصلات، مزامنة فورية، استعلام حالة، قدرات، فحوصات بيئية. جميع المسارات محمية بـ `withAuthAndRateLimit` وتفرض صلاحيات `sources:*`.

```mermaid
flowchart LR
  UI -->|catalog| types[/sources/types]
  UI -->|list| srcList[/sources]
  UI -->|probe key| ks[/sources/api-keys-status]
  UI -->|probe system| ss[/sources/system-status]
  UI -->|capabilities| cap[/sources/capabilities]
  UI -->|create| create[POST /sources]
  create -->|encrypt| DB[(sources table)]
  create -->|background sync| Sync[db.syncSource]
  UI -->|sync| sync[POST /sources/:id/sync]
  UI -->|status tick| syncstatus[/sources/sync-status]
  UI -->|delete| del[DELETE /sources/:id]
```

## المصادقة والحدود

| المسار                         | الصلاحية                | المعدل                |
| ------------------------------ | ----------------------- | --------------------- |
| `GET /sources`                 | `sources:read`          | افتراضي               |
| `POST /sources`                | `sources:write` + quota | افتراضي               |
| `PUT /sources`                 | `sources:write`         | افتراضي               |
| `DELETE /sources?id=...`       | `sources:delete`        | افتراضي               |
| `GET /sources/:id`             | `sources:read`          | افتراضي               |
| `PUT /sources/:id`             | `sources:write`         | افتراضي               |
| `DELETE /sources/:id`          | `sources:delete`        | افتراضي               |
| `POST /sources/:id/sync`       | `sources:write`         | افتراضي               |
| `GET /sources/sync-status`     | `sources:read`          | **60/دقيقة**          |
| `GET /sources/capabilities`    | (session)               | افتراضي               |
| `GET /sources/types`           | (session)               | افتراضي (كاش خاص 60s) |
| `GET /sources/api-keys-status` | (session)               | افتراضي               |
| `GET /sources/system-status`   | (session)               | افتراضي               |

---

## `GET /api/v1/sources`

قائمة موصلات المستأجر + سجلات المزامنة + موارد MCP (مُبسّط). يدعم `?type=` و`?status=` للتصفية. يُطبَّق `redactSourceConfig` على كل عنصر قبل الإرسال (لا تُسرّب الأسرار أبداً).

## `POST /api/v1/sources`

ينشئ موصلاً، يُشغّل التحقق ضد `validateConnectorConfig`، يُشفّر الحقول السرية، ثم يبدأ المزامنة الأولية **بعد الاستجابة** عبر `after(() => db.syncSource(...))`.

الجسم (Zod):

| الحقل           | النوع    | القيود                               |
| --------------- | -------- | ------------------------------------ |
| `name`          | string   | 1..300                               |
| `type`          | enum     | `SourceType` من `SOURCE_TYPE_VALUES` |
| `config`        | object   | مُطابق لمخطط الموصل                  |
| `syncSchedule`  | string   | ≤100 (مثل `0 */3 * * *`)             |
| `collectionIds` | string[] | ≤50                                  |

الاستجابة (201): `{ message, syncStarted: true, source: {...redacted} }`.

- 400 `VALIDATION_ERROR` أو `CONNECTOR_CONFIG_INVALID`، 403 quota.
- الحالة: `syncing` بعد البدء، تتحول إلى `healthy`/`degraded`/`error`.

## `PUT /api/v1/sources`

يحدّث موصلاً (يحتاج `id`). الحقول السرية التي تُرسل كـ placeholder (تحوي `••`) تُحفظ كما هي (`mergeAndEncryptSourceConfig`).

## `DELETE /api/v1/sources?id=...&purgeDocs=...`

حذف الموصل + الوثائق المرتبطة (`purgeDocs=false` يبقي الوثائق).

## `GET /api/v1/sources/:id`

تفاصيل موصل + السجلات + المستندات المرتبطة.

## `PUT /api/v1/sources/:id`

مكافئ لـ `PUT /sources` لكن بمعرّف في الـ URL.

## `DELETE /api/v1/sources/:id`

حذف الموصل + purge للوثائق (`true` افتراضياً).

## `POST /api/v1/sources/:id/sync`

يبدأ مزامنة فورية بعد الاستجابة. يحمل حالة الموصل إلى `syncing` ثم يستدعي `db.syncSource(id, tenantId)`. عند النجاح يطلق webhook `sync.completed`.

- 404 إذا لم يوجد الموصل.
- `maxDuration = 300` لاستيعاب OCR + التضمين بعد الاستجابة.

## `GET /api/v1/sources/sync-status`

استجابة خفيفة للـ KB sync poller (60/دقيقة):

```json
{
  "tenantId": "...",
  "syncing": 1,
  "statuses": [{ "id": "src-...", "status": "syncing", "lastSyncAt": "...", "documentCount": 5, "lastError": null }]
}
```

## `GET /api/v1/sources/capabilities`

يُعيد نفس الكتالوج المُستخدم في wizard الإضافة (`toConnectorCatalog()`). يستخدم في بناء واجهة الإضافة؛ مفاتيح الـ `secret` لا تُسرّب.

## `GET /api/v1/sources/types`

الكتالوج الموحّد لكل موصل (`url, web_file, github, youtube, database, gdrive, rss, notion, …`) بحقول الواجهة والـ presetDemo. كاش `private, max-age=60, stale-while-revalidate=300`.

## `GET /api/v1/sources/api-keys-status`

يكشف عن تهيئة API keys للقراءة فقط (لا يُعيد القيم):

```json
{
  "mistralActive": true,
  "unstructuredActive": false,
  "geminiActive": true,
  "qdrantActive": true
}
```

## `GET /api/v1/sources/system-status`

نسخة ديناميكية (تقرأ `process.env` عبر `getEnv`) فتتعكس تحديثات `env-config`. تفحص `DATABASE_URL/POSTGRES_URL`، `QDRANT_*`، `MISTRAL_API_KEY`، `UNSTRUCTURED_API_KEY`، `GEMINI_API_KEY`.

---

## أمثلة

### إنشاء موصل RSS

```bash
curl -X POST https://app/api/v1/sources \
  -H 'Content-Type: application/json' \
  -d '{"name":"Tech News","type":"rss","config":{"feedUrl":"https://news.ycombinator.com/rss"},"syncSchedule":"0 */1 * * *","collectionIds":[]}'
```

### مزامنة فورية

```bash
curl -X POST https://app/api/v1/sources/src-rss-1234/sync
```

## رموز الأخطاء الشائعة

| الكود                      | المعنى                                |
| -------------------------- | ------------------------------------- |
| `VALIDATION_ERROR`         | فشل مخطط Zod.                         |
| `CONNECTOR_CONFIG_INVALID` | حقول مطلوبة ناقصة (مثل URL).          |
| `NOT_FOUND`                | معرّف غير موجود أو خارج المستأجر.     |
| Quota 403                  | تجاوز خطة الاشتراك (`maxConnectors`). |

## انظر أيضاً

- [connectors](../08-integrations/connectors.md) — قائمة الموصلات الفعلية وحالاتها.
- [extraction-engines](../08-integrations/extraction-engines.md) — المحركات وراء مزامنة الملفات.
- [background-jobs](../09-operations/background-jobs.md) — آلية pg-boss للمزامنات المجدولة.
