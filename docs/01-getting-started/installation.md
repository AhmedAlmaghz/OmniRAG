# دليل التثبيت والتشغيل المحلي

يشرح هذا الدليل كيفية تجهيز بيئة تطوير كاملة لمنصة OmniRAG على جهازك المحلي: المتطلبات الأساسية، تثبيت الاعتمادات، إعداد متغيرات البيئة وتهيئة قاعدة البيانات، ثم تشغيل خادم التطوير. جميع الخطوات مستمدة مباشرة من ملفات المشروع الفعلية (`package.json`، `dev-server.js`، `server.ts`، `.env.example`).

---

## المتطلبات الأساسية

| المكوّن            | الحد الأدنى                               | ملاحظات                                                                                          |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Node.js            | 18 أو أحدث (وفق `README.md`)              | صورة Docker الرسمية تعتمد Node 24 (`node:24-alpine`) لدعم تحويل TypeScript مباشرة في `server.ts` |
| مدير الحزم         | `npm` (أو `bun`)                          | المشروع يستخدم `package-lock.json` مع `npm ci` في بناء Docker                                    |
| قاعدة بيانات       | PostgreSQL (Neon، Supabase، أو مثيل محلي) | مصدر الحقيقة للمخطط هو `src/db/schema.ts`                                                        |
| محرك بحث متجهي     | Qdrant (`QDRANT_URL`)                     | تُنشأ المجموعة `omnirag_chunks` تلقائياً ببُعد 3072 ومسافة Cosine                                |
| مفتاح ذكاء اصطناعي | `GEMINI_API_KEY` على الأقل                | بقية المزودين (Mistral، Groq، OpenAI...) اختياريون                                               |

> **ملاحظة:** التطبيق يعمل بدون قاعدة بيانات في وضع تجريبي (In-Memory) عبر الطبقة المزدوجة في `src/lib/storage/db.ts`، لكن الإنتاج يتطلب `DATABASE_URL` و`QDRANT_URL` و`MCP_OAUTH_ENCRYPTION_KEY` و`CRON_SECRET` (انظر [دليل النشر](deployment.md)).

---

## خطوات التثبيت

### 1. استنساخ المشروع وتثبيت الاعتمادات

```bash
git clone https://github.com/AhmedAlmaghz/omnirah.git
cd omnirah
npm install
```

تنفيذ `npm install` يشغّل تلقائياً سكربت `prepare` (husky) لتثبيت Git hooks التي تمرر الملفات المتغيرة عبر `lint-staged` (ESLint + Prettier) قبل كل commit.

### 2. إعداد متغيرات البيئة

انسخ ملف النموذج ثم عدّل القيم:

```bash
cp .env.example .env.local
```

الحد الأدنى للتشغيل المحلي:

```env
GEMINI_API_KEY=your_gemini_api_key_here
DATABASE_URL=postgresql://username:password@localhost:5432/omnirag
QDRANT_URL=https://your-qdrant-cluster.qdrant.tech
```

القائمة الكاملة للمتغيرات وسلوك كل منها موثقة في [دليل متغيرات البيئة](configuration.md). في التطوير يمكن أيضاً تمرير المفاتيح من الواجهة عبر ترويسات `x-env-*` (تُقبل تلقائياً خارج الإنتاج — انظر `src/lib/env/runtimeEnv.ts`).

### 3. تهيئة قاعدة البيانات

يمكنك اختيار إحدى طريقتين (كلاهما يقرأ `DATABASE_URL` أو `POSTGRES_URL`):

**الطريقة 1 — الدفع المباشر من المخطط (الأبسط للتطوير):**

```bash
DATABASE_URL=postgresql://omnirag:omnirag@localhost:5432/omnirag npm run db:push
```

**الطريقة 2 — التهجير اليدوي عبر سكربت SQL موحد:**

```bash
DATABASE_URL=postgresql://omnirag:omnirag@localhost:5432/omnirag npm run db:migrate:manual
```

السكربت `scripts/run-manual-migration.ts` ينفذ `scripts/manual-migration.sql` — سكربت idempotent آمن الإعادة يغطي جداول التطبيق كاملة (بما فيها فهارس GIN للبحث النصي العربي/الإنجليزي وجداول التشغيل `rate_limit_windows` و`usage_counters`)، ولا يمس مخطط `pgboss` ولا جداول pgvector الديناميكية (`vector_chunks*`).

> في الواقع التطبيق ينشئ المخطط ويزرع البيانات الأولية تلقائياً عند الإقلاع عبر الدالة `migrateAndSeedWithDrizzle` في `src/lib/db/migrateAndSeedDrizzle.ts` — السكربتات اليدوية للنشر المسبق أو إصلاح قاعدة قائمة.

### 4. تشغيل خادم التطوير

```bash
npm run dev
```

ثم افتح `http://localhost:3000` في المتصفح.

---

## كيف يعمل خادم التطوير (`dev-server.js`)

سكربت `npm run dev` لا يستدعي `next dev` مباشرة، بل يشغّل غلاف `dev-server.js` في جذر المشروع الذي يقوم بما يلي:

1. يقتل أي عملية `next-server` قائمة (`pkill -9 -f "next-server"`) لتفادي تعارض المنافذ من جلسة سابقة.
2. يفكّر وسيطات سطر الأوامر بنفسه: `--host` / `-H` / `--hostname` (الافتراضي `0.0.0.0`) و`--port` / `-p` (الافتراضي `3000`)، ويمرر أي وسيطات أخرى إلى Next.js كما هي.
3. يستدعي `next dev` عبر المسار المُستخرَج بـ `require.resolve('next/dist/bin/next')` مع `stdio: 'inherit'` لترث المخرجات مباشرة.
4. يعالج إشارات `SIGTERM` / `SIGINT` / `SIGHUP` بإنهاء العملية الفرعية بنظافة، ويعيد رمز خروجها.

أمثلة:

```bash
npm run dev -- --port 4000        # تشغيل على منفذ مختلف
npm run dev -- --host 127.0.0.1   # ربط على مضيف محدد
```

---

## خادم الإنتاج (`server.ts`)

للمقارنة، وضع الإنتاج (`npm run start` أو صورة Docker) يشغّل `server.ts` — خادم Node.js مخصص مبني على `node:http` يستضيف تطبيق Next.js برمجياً:

- يحدد وضع التطوير/الإنتاج من `NODE_ENV` (`const dev = process.env.NODE_ENV !== 'production'`).
- يربط دائماً على `0.0.0.0` (بقصد تجاوز `HOSTNAME` الذي يضبطه Docker إلى معرّف الحاوية)، ويقرأ المنفذ من `PORT` (الافتراضي 3000) — ما يجعل الصورة نفسها تعمل على أي مزود PaaS.
- يعالج الطلبات عبر `app.getRequestHandler()` مع التقاط الأخطاء وإعادة 500، وينهي العملية عند فشل الاستماع.

---

## مرجع سكربتات `package.json`

| السكربت             | الأمر                                                    | الوظيفة                                                                                                                          |
| ------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `dev`               | `node dev-server.js`                                     | تشغيل خادم التطوير عبر الغلاف الموصوف أعلاه (يقتل الخادم القديم، يدعم `--port`/`--host`)                                         |
| `build`             | `rimraf dist && cross-env NODE_OPTIONS=... next build`   | بناء حزمة الإنتاج: يمسح مجلد `dist`، يرفع ذاكرة Node إلى 1536MB عبر `NODE_OPTIONS`، ويثبت `NODE_ENV=production` قبل `next build` |
| `start`             | `node server.ts`                                         | تشغيل خادم الإنتاج المخصص (Node 24 يفهم TypeScript مباشرة عبر type-stripping)                                                    |
| `clean`             | `rimraf .next dist`                                      | مسح مخلفات البناء (`.next` و`dist`)                                                                                              |
| `test`              | `vitest run`                                             | تنفيذ مجموعة الاختبارات مرة واحدة عبر Vitest (الإعداد في `vitest.config.ts`)                                                     |
| `typecheck`         | `tsc --noEmit`                                           | فحص الأنواع دون إصدار مخرجات                                                                                                     |
| `db:generate`       | `drizzle-kit generate --config=src/db/drizzle.config.ts` | توليد ملفات تهجير SQL من تغييرات `src/db/schema.ts` إلى مجلد `drizzle/`                                                          |
| `db:push`           | `drizzle-kit push --config=src/db/drizzle.config.ts`     | دفع المخطط مباشرة إلى قاعدة البيانات (يتجاهل عمداً `vector_chunks*` و`pgboss` عبر `tablesFilter`)                                |
| `db:check`          | `drizzle-kit check --config=src/db/drizzle.config.ts`    | التحقق من صحة/اتساق ملفات التهجير المولدة                                                                                        |
| `db:migrate:manual` | `tsx scripts/run-manual-migration.ts`                    | تنفيذ `scripts/manual-migration.sql` عبر `pg` مباشرة دون `psql` (مفيد على Windows)، مع تحقق بعد التنفيذ من وجود الجداول المتوقعة |
| `lint`              | `eslint . --ext .ts,.tsx,.js,.jsx,.mjs,.cjs`             | فحص جودة الكود دون تعديل                                                                                                         |
| `lint:fix`          | `eslint . ... --fix`                                     | فحص مع الإصلاح التلقائي حيثما أمكن                                                                                               |
| `format`            | `prettier --write ...`                                   | تنسيق ملفات `src/` والملفات الجذرية (ts/js/css/md) بكتابة التنسيق مباشرة                                                         |
| `format:check`      | `prettier --check ...`                                   | التحقق من التنسيق دون تعديل (مفيد في CI)                                                                                         |
| `prepare`           | `husky`                                                  | تهيئة Git hooks (يُنفذ تلقائياً بعد `npm install`) — يربط `lint-staged` بالمرحلة pre-commit                                      |

---

## الفحوصات بعد التثبيت

```bash
npm run typecheck    # التأكد من سلامة الأنواع
npm run lint         # فحص جودة الكود
npm run test         # تشغيل الاختبارات
npm run build        # التحقق من نجاح بناء الإنتاج
```

## التحقق من جاهزية الخادم

بعد التشغيل (تطويراً أو إنتاجاً) يمكن الاطمئنان عبر مسار الفحص الخفيف `/api/health` (لا يجري round-trip إلى قاعدة البيانات، وهو نفسه المستخدم في `HEALTHCHECK` داخل `Dockerfile`).

---

## انظر أيضاً

- [دليل متغيرات البيئة](configuration.md) — شرح تفصيلي لكل متغير وتحذيراته الأمنية
- [دليل النشر](deployment.md) — Docker وVercel ومتطلبات الإنتاج
- [نظرة عامة على البنية](../02-architecture/overview.md) — طبقات النظام والتقنيات
- [بنية المجلدات](../02-architecture/directory-structure.md) — خريطة شجرة المشروع
- [تدفقات البيانات](../02-architecture/data-flow.md) — مسار الاستيعاب والاستعلام خطوة بخطوة
