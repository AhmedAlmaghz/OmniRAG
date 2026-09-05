# التسجيل المنظّم والمراقبة (Structured Logging & Observability)

اعتباراً من v0.12.8 تعتمد OmniRAG مسجّلاً منظّماً داخلياً بلا تبعيات خارجية: `src/lib/logging/logger.ts`. توثّق هذه الوثيقة العقد، وسلوك التطوير مقابل الإنتاج، وانتشار `requestId`.

## الوحدة: `createLogger(component)`

```ts
import { createLogger } from '../logging/logger';

const log = createLogger('PostgresStorage');

log.info('Database connection URL changed.');
log.error('RLS cleanup skipped:', rlsError); // Error يُسلسَل إلى err.name/err.message/err.stack
log.warn('slow query', { ms: 412, table: 'chunks' }); // كائن يُنشر كحقول
```

- **المستويات:** `debug` / `info` / `warn` / `error` — مع ترشيح عبر `LOG_LEVEL` (الافتراضي: `info` في الإنتاج، `debug` في التطوير).
- **حقن السياق تلقائياً:** داخل نطاق `runWithRequestContext` تُلحق `requestId` و`tenantId` و`userId` و`apiKeyId` بكل سجل دون تمرير يدوي.
- **تنقيح دفاعي:** الحقول ذات المفاتيح الحساسة (`password`, `apiKey`, `token`, `authorization`, `secret`, `cookie`, `clientSecret`…) تُستبدل بـ `[redacted]` قبل التسلسل — حاجز أخير لا يعفي من عدم تسجيل الأسرار أساساً.
- **اختبار العقد:** `src/__tests__/logging.test.ts`.

## التطوير مقابل الإنتاج

| السلوك            | التطوير (`NODE_ENV≠production`)        | الإنتاج (`NODE_ENV=production`)                      |
| ----------------- | -------------------------------------- | ---------------------------------------------------- |
| الشكل             | سطر مقروء: `[Component] msg key=value` | سطر JSON واحد: `{ts, level, component, msg, …}`      |
| وجهة error/warn   | stderr عبر console.error/warn          | stderr عبر console.error (سجلات JSON قابلة للتحليل)  |
| وجهة info/debug   | stdout                                 | stdout                                               |
| ترشيح الافتراضي   | كل المستويات                           | `info` فأعلى (فعّل `LOG_LEVEL=debug` للتشخيص المؤقت) |
| أثر التسجيل الفني | رسائل مباشرة مع stack كامل             | حقل `err.stack` داخل السجل                           |

> النشر على Vercel/Docker يجمع stdout/stderr كما هي — سجلات الإنتاج جاهزة لأي مصفّي سجلات (Datadog/CloudWatch/Logflare) دون محوّلات.

## انتشار `x-request-id`

- تُنشئ بوابة `withAuthAndRateLimit` معرفاً لكل طلب (`crypto.randomUUID()`) وتُصدّه في ترويسة الاستجابة **`x-request-id`** على كل المسارات: النجاح و401/403/429 و500.
- المعرف نفسه يُربط في سياق الطلب (`RequestContext.requestId`) فيظهر تلقائياً في كل سجل منظّم يصدر داخل معالجة الطلب — ربط سجل الطلب بالاستجابة وسجلات الخادم يصبح بلا جهد.
- لفحص طلب فاشل: خذ `x-request-id` من الاستجابة وابحث به في سجلات الخادم.

## فروق السلوك بين التطوير والإنتاج (بيانات الجرد v0.12.8)

| الموضع                              | فرع السلوك                                                                |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `src/middleware.ts`                 | HSTS وقائمة CORS الافتراضية للإنتاج فقط                                   |
| `src/lib/auth/session.ts`           | `Secure` على كوكي الجلسة في الإنتاج                                       |
| `src/lib/env/runtimeEnv.ts`         | رؤوس `x-env-*` من العميل مرفوضة في الإنتاج إلا بـ `ALLOW_CLIENT_ENV=true` |
| `src/lib/mcp/auth/encryption.ts`    | الإنتاج يرفض مفتاح التشفير الاحتياطي ويطالب بـ `MCP_OAUTH_ENCRYPTION_KEY` |
| `src/lib/storage/db.ts`             | زرع بيانات تجريبية وقاطع الدائرة نحو الذاكرة في غير الإنتاج فقط           |
| `src/app/api/v1/jobs/tick/route.ts` | تحايل الـ Cron secret مسموح خارج الإنتاج فقط                              |
| `src/instrumentation.ts`            | عامل pg-boss الدائم يُقلع على Docker/self-hosted؛ Vercel يستخدم Cron      |

## ما لم يُرحَّل (عمل لاحق موثّق)

بقيت `console.*` مباشرة في وحدات منخفضة القيمة التشغيلية (`pdfChunker`, `unstructuredService`, `transcriptParser`, محرّكات الاستخراج…) — ترحيلها ميكانيكي متطابق مع النمط أعلاه متى دعت الحاجة. الوحدات عالية الإشارة (البوابة، التخزين، محرك RAG، الطابور، الإقلاع، الهجرات) مُرحَّلة بالكامل.
