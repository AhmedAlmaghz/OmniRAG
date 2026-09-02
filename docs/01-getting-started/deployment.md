# دليل النشر

يغطي هذا الدليل خيارات نشر OmniRAG: صورة Docker جاهزة لأي مزوّد، مجموعة `docker compose` كاملة (تطبيق + PostgreSQL + Qdrant)، النشر على Vercel، ملاحظات نماذج OCR، وإدارة التهجيرات — مع قائمة المتطلبات الإلزامية للإنتاج.

---

## Docker (أي مزوّد استضافة)

### بنية الصورة (`Dockerfile`)

الصورة متعددة المراحل (multi-stage) مبنية على `node:24-alpine`، وتشغّل خادم Next.js المخصص `server.ts` (Node 24 يحوّل TypeScript مباشرة عبر type-stripping دون خطوة تجميع سابقة):

| المرحلة     | الوظيفة                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deps`      | `npm ci --no-audit --no-fund` لشجرة الاعتمادات الكاملة (dev + prod)                                                                                                                      |
| `builder`   | `npm run build` لتجميع حزمة الإنتاج، ثم تجهيز نماذج Tesseract في `/tessdata` (نسخ `*.traineddata` من جذر المشروع إن وُجدت، وإلا تنزيل نماذج fast العامة من `tessdata.projectnaptha.com`) |
| `prod-deps` | تقليم الاعتمادات بـ `npm prune --omit=dev` بدل `npm ci` ثانية — لأن سكربت `prepare: husky` يفشل بغياب husky في تثبيت dev-only (exit 127)                                                 |
| `runner`    | الصورة النهائية: `NODE_ENV=production`، `PORT=3000`، نسخ `node_modules` و`.next` و`public` و`/tessdata` و`package.json` و`next.config.ts` و`server.ts`                                   |

نقاط تشغيلية مهمة في `Dockerfile`:

- الربط دائماً على `0.0.0.0` والمنفذ من `PORT` (الافتراضي 3000) — فالصورة نفسها تعمل على Cloud Run وFly.io وRailway وRender وECS وKubernetes وخادم خاص بلا تعديل.
- تعمل المستخدم غير المميز `node`؛ تُمنح الملكية فقط للمجلدات التي يكتب فيها التطبيق (`.next/cache` و`/app`).
- `HEALTHCHECK` كل 30 ثانية يفحص `/api/health` — مسار liveness خفيف بلا round-trip لقاعدة البيانات (فترة سماح 20 ثانية، 3 محاولات).
- أمر التشغيل: `CMD ["node", "server.ts"]`.
- **لا تُدمج قيم `.env` داخل الصورة أبداً** — تُمرر وقت التشغيل فقط عبر `--env-file` أو `-e`. المتغير الوحيد الذي يُقرأ وقت البناء هو `APP_URL` إن احتجت قيمة افتراضية.

### تشغيل الحاوية يدوياً

```bash
# البناء
docker build -t omnirag .

# التشغيل — مرّر متغيرات البيئة عبر --env-file أو -e
docker run -d --name omnirag \
  -p 3000:3000 \
  --env-file .env \
  omnirag
```

### المجموعة الكاملة (`docker-compose.yml`)

```bash
cp .env.example .env   # ثم عدّل المفاتيح (GEMINI_API_KEY مطلوب)
docker compose up -d --build
```

الخدمات الثلاث مع أحجام دائمة:

| الخدمة     | الصورة                   | ملاحظات                                                                                                             |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `app`      | `omnirag` (مبنية محلياً) | منفذ خارجي من `APP_PORT` (افتراضي 3000)، يقرأ `env_file: .env` (اختياري)، يعتمد على صحة PostgreSQL أولاً            |
| `postgres` | `postgres:17-alpine`     | اعتمادات `omnirag/omnirag`، حجم `pgdata`، healthcheck بـ `pg_isready`، منفذ خارجي من `POSTGRES_PORT` (افتراضي 5432) |
| `qdrant`   | `qdrant/qdrant:latest`   | حجم `qdrant_data` على `/qdrant/storage`                                                                             |

> **تجاوز مقصود:** داخل شبكة compose تُضبط `DATABASE_URL=postgresql://omnirag:omnirag@postgres:5432/omnirag` و`QDRANT_URL=http://qdrant:6333` — فهاتان القيمتان تتجاوزان أي شيء وارد في `.env` كي لا "تتسرب" قيم سحابية إلى الشبكة الداخلية.
>
> **تنبيه أمني:** منفذ PostgreSQL معرّض عمداً لتشغيل `npx drizzle-kit push` من جهاز المضيف — **أزِل هذا الربط على خوادم مواجهة للإنترنت**.

---

## النشر على Vercel (`vercel.json`)

```json
{
  "crons": [
    {
      "path": "/api/v1/jobs/tick",
      "schedule": "0 0 * * *"
    }
  ]
}
```

- مهمة Cron يومية (`0 0 * * *`) تستدعي مسار `/api/v1/jobs/tick` — حماية المسار تتم عبر `CRON_SECRET` أو `JOBS_TICK_SECRET` (بدونهما يرد 401).
- حدود المنصة تُؤخذ بالحسبان في الكود: `export const maxDuration = 300` في مسارات API (مثل `src/app/api/v1/chat/stream/route.ts`)، بينما مهلة التوليد الداخلية `CHAT_GENERATION_TIMEOUT_MS` تنخفض تلقائياً إلى 55 ثانية على Vercel (`process.env.VERCEL`) لتبقى تحت سقف Hobby البالغ 60 ثانية، فتظهر الأعطال كخطأ نظيف داخل بث SSE بدلاً من قطع المنصة للاتصال.
- مسار الاستخراج `/api/v1/documents/parse` يعلن `maxDuration = 60` (يعمل على كل الخطط)؛ على Pro Fluid يمكن رفعه حتى 800 لاستيعاب OCR الكتب الكاملة (~7.4 دقيقة) وPPTX عبر Unstructured Jobs (~6.5 دقيقة).
- الرفع المباشر للملفات الكبيرة على Vercel يتم عبر **Vercel Blob** (`BLOB_READ_WRITE_TOKEN` متجر Blob مربوط) أو أي مخزن S3 متوافق — انظر [دليل متغيرات البيئة](configuration.md).

---

## نماذج OCR (`ara/eng.traineddata`)

- ملفا `ara.traineddata` و`eng.traineddata` في جذر المشروع (git-ignored) هما نماذج Tesseract للعربية والإنجليزية المستخدمة في OCR المحلي (`src/lib/services/localOcr.ts` وخط tesseract ضمن `src/lib/services/extraction/engines.ts`).
- في مرحلة `builder` تُنسخ إلى `/tessdata` داخل الصورة، **وإن غابت** (نسخة مستنسخة جديدة) تُنزّل تلقائياً نماذج `4.0.0_fast` العامة من `tessdata.projectnaptha.com` — فلا يحتاج OCR وقت التشغيل أي اتصال بالإنترنت وبناء الصورة يظل ذاتياً (self-contained).
- نتائج OCR الخادمية تخزن في ذاكرة LRU محدودة (`BoundedOcrCache` في مسار parse) بحد أدنى للعدد وحد لحجم المحارف لمنع نمو الذاكرة بلا سقف.

---

## التهجيرات (`db:push` و`db:migrate:manual`)

مصدر الحقيقة الوحيد للمخطط هو `src/db/schema.ts`، وكل التهجيرات دُمجت في ملف baseline واحد (`drizzle/0000_baseline_unified.sql` مع مجلد `drizzle/meta/`).

| الطريقة             | الأمر                                        | متى تستخدمها                                                                                                                    |
| ------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `db:push`           | `DATABASE_URL=... npm run db:push`           | التطوير — دفع مباشر من `schema.ts`. إعداد `src/db/drizzle.config.ts` يستبعد عمداً `vector_chunks*` و`pgboss` عبر `tablesFilter` |
| `db:migrate:manual` | `DATABASE_URL=... npm run db:migrate:manual` | النشر المسبق أو إصلاح قاعدة قائمة — ينفذ `scripts/manual-migration.sql` عبر `pg` مباشرة (بلا psql، مناسب لـ Windows)            |

خصائص `scripts/manual-migration.sql`:

- **Idempotent** — آمن الإعادة، ولا يحذف أياً من البيانات؛ يعمل على قاعدة جديدة أو موجودة من نسخة سابقة.
- يغطي جداول التطبيق كاملة (25 جدولاً) بما فيها فهارس GIN للبحث النصي العربي/الإنجليزي وجداول التشغيل `rate_limit_windows` و`usage_counters`.
- يستثني عمداً مخطط `pgboss` (ينشئه pg-boss عند الإقلاع) والجداول الديناميكية `vector_chunks*` (ينشئها محوّل pgvector حسب بُعد التضمين).
- عند تعديل `schema.ts`: ولّد تهجيراً جديداً بـ `npm run db:generate` وأبقِ السكربت اليدوي متزامناً معه.
- سكربت التشغيل `scripts/run-manual-migration.ts` يتحقق بعد التنفيذ من وجود الجداول المتوقعة (`documents`، `chunks`، `sources`، `sync_logs`…).

> **ملاحظة:** التطبيق ينشئ المخطط ويزرع البيانات الأولية تلقائياً عند الإقلاع عبر `migrateAndSeedWithDrizzle` (`src/lib/db/migrateAndSeedDrizzle.ts`) — فالسكربت اليدوي للنشر المسبق أو الإصلاح، وليس شرطاً للتشغيل الأول.

---

## متطلبات الإنتاج الإلزامية

قائمة تحقق قبل النشر (يفرضها التطبيق على `NODE_ENV=production`):

1. **`DATABASE_URL` أو `POSTGRES_URL`** — PostgreSQL (Neon/Supabase أو أي مزوّد).
2. **`MCP_OAUTH_ENCRYPTION_KEY`** — مفتاح AES-256-GCM (`openssl rand -base64 32`); بدونه يرفض التطبيق تشفير اعتمادات الموصلات وقت التشغيل ولا يسقط لمفتاح تطوير.
3. **`CRON_SECRET` أو `JOBS_TICK_SECRET`** — لحماية `/api/v1/jobs/tick`.
4. **`GEMINI_API_KEY` و`QDRANT_URL`** — للنموذج التوليدي والبحث المتجهي (بقية المفاتيح اختيارية وتفعّل قدرات إضافية).
5. **`ALLOWED_ORIGINS`** — نطاقات CORS الفعلية (وسيط `src/middleware.ts` لا ينعكس أصولاً غير مُدرجة).
6. **تأكد أن `ALLOW_CLIENT_ENV` غير مضبوط إلى `true`** — القبول الافتراضي في الإنتاج هو الرفض.
7. **اترك `PLAN_SELF_SERVE="false"`** إلا في النشرات الداخلية/التجريبية.

ملاحظات تشغيلية إضافية:

- **المنفذ:** أي مزوّد يمرر `PORT` ستستخدمه الحاوية تلقائياً.
- **الحالة:** الحاوية عديمة الحالة (stateless) ويمكن توسيعها أفقياً — الرفع الكبير يذهب مباشرة إلى S3/Blob من المتصفح.
- **أحجام بيانات:** في compose، بيانات PostgreSQL وQdrant دائمة في أحجام Docker (`pgdata`، `qdrant_data`).

---

## انظر أيضاً

- [دليل التثبيت](installation.md) — التشغيل المحلي وسكربتات package.json
- [دليل متغيرات البيئة](configuration.md) — شرح كل متغير وتحذيراته
- [نظرة عامة على البنية](../02-architecture/overview.md)
- [تدفقات البيانات](../02-architecture/data-flow.md)
