# نشر Docker الآلي (Automated Docker Deployment)

اعتباراً من v0.12.21، النشر الذاتي الاستضافة **أمر واحد** ويهيئ كل شيء ذاتياً:

```bash
npm run docker:deploy        # أو: bash scripts/docker-deploy.sh
```

## ما يحدث آلياً (بلا أي خطوة يدوية)

| المرحلة                                                                                          | المسؤول                                                                                         | التوقيت                                                |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| دور التطبيق `omnirag_app` (LOGIN + كلمة سر)                                                      | `docker/postgres-init/01-app-role.sh` عبر `docker-entrypoint-initdb.d`                          | أول إقلاع لحجم postgres الفارغ فقط                     |
| الجداول الـ 25 + فهارس GIN + سياسات RLS الـ 19 + منح الدور + دوال SECURITY DEFINER العشر + البذر | هجرة إقلاع التطبيق (`migrateAndSeedDrizzle`) — تعمل كمالك وتعيد التأكيد idempotent عند كل إقلاع | أول إقلاع للتطبيق (وقتل التكرار عبر `SCHEMA_REVISION`) |
| تفعيل RLS للتشغيل                                                                                | `DATABASE_APP_URL` المربوط في compose إلى `omnirag_app`                                         | دائم (احذف السطر للتراجع)                              |
| ترتيب الإقلاع                                                                                    | healthchecks + `depends_on: service_healthy` — التطبيق لا يقلع قبل جاهزية postgres وqdrant      | كل إقلاع                                               |
| التعافي                                                                                          | `restart: unless-stopped` + HEALTHCHECK داخل الصورة (`/api/health`، non-root)                   | دائم                                                   |
| المزامنة الخلفية                                                                                 | عامل pg-boss داخل التطبيق (Docker/self-hosted)                                                  | دائم                                                   |

## مكوّنات الطابق

| الخدمة     | الصورة                                                      | الصحة                | المجلد الدائم                       |
| ---------- | ----------------------------------------------------------- | -------------------- | ----------------------------------- |
| `app`      | `omnirag` (نمط prebuilt: حزم فقط، non-root `node`، Node 24) | `/api/health` كل 30s | `.next/cache` (chown للكتابة)       |
| `postgres` | `postgres:17-alpine`                                        | `pg_isready` كل 5s   | `pgdata` + init scripts للقراءة فقط |
| `qdrant`   | `qdrant/qdrant:latest`                                      | `/readyz` كل 10s     | `qdrant_data`                       |

## المتغيرات

| المتغير           | الافتراضي           | الدور                                                                                            |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `APP_PORT`        | 3000                | منفذ التطبيق على المضيف                                                                          |
| `POSTGRES_PORT`   | 5432                | منفذ postgres على المضيف (لأدوات التطوير — احذفه على خوادم مواجهة للإنترنت)                      |
| `APP_DB_PASSWORD` | `omnirag_app_local` | كلمة سر دور التشغيل — **غيّرها في الإنتاج** (تُستخدم في init script وفي `DATABASE_APP_URL` معاً) |
| `.env`            | —                   | مفاتيح مزودي AI و`ALLOWED_ORIGINS` إلخ (لا يدخل الصورة أبداً — `.dockerignore` يحجبه)            |

## لماذا البناء على المضيف؟ (نمط prebuilt)

بناء حزمة Next **داخل** Docker VM على أجهزة محدودة الذاكرة أسقط محرك buildkit مرتين (tsc ثم تصدير Turbopack — موثق v0.12.21). النمط المعتمد:

1. `npm run build` على المضيف — ذاكرة كاملة + الفحص النمطي الصارم يعمل (بلا أي تعطيل).
2. صورة Docker **تجميع فقط**: node_modules الإنتاجية + `.next` المبنية + إعدادات التشغيل — تتجمع في 1-3 دقائق حتى على أقراص بطيئة.
3. سلامة الأنماط تبقى بمالكها: typecheck محلي + husky + CI.

## السكربت `docker-deploy.sh` خطوة بخطوة (6 خطوات)

1. فحص الـ daemon ووجود `.env` (تحذير لطيف إن غاب — الطابق يعمل بلا مفاتيح استدلال).
2. `docker compose build` — بناء multi-stage مع كاش.
3. `docker compose up -d` — الإقلاع المُدار بالصحة.
4. حلقة انتظار `/api/health` (حتى `DEPLOY_WAIT_SECONDS=180`) مع فشل صريح يقترح `docker compose logs app`.
5. ملخص: حالة الحاويات، الروابط، وأمر إثبات عقد RLS (`npm run db:verify-rls` ضد المنفذ المكشوف).

## ما بعد النشر — تحقق 60 ثانية

```bash
curl -s http://localhost:3000/api/health                       # 200
DATABASE_URL=postgresql://omnirag:omnirag@localhost:5432/omnirag \
  npm run db:verify-rls                                        # 7/7 PASS
# سجّل حساباً من الواجهة وأنشئ مستنداً — كل الكتابة تمر بدور omnirag_app تحت RLS
```

## استكشاف الأخطاء

| العرض                                                   | السبب المرجح                            | الإجراء                                                                         |
| ------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| التطبيق يعيد التشغيل دورياً                             | فشل الهجرة (DATABASE_URL خاطئ)          | `docker compose logs app` — الهجرة تفشل بصوت عالٍ                               |
| `password authentication failed for user "omnirag_app"` | حجم postgres قديم أُنشئ قبل init script | `docker compose down -v` ثم إعادة النشر (يحذف البيانات!) أو `ALTER ROLE` يدوياً |
| شارة LIVE/SOON غابت في المعالج                          | كتالوج قديم مخبأ                        | الحد `Cache-Control: 60s` ينتهي وحده                                            |
| qdrant لا يصل healthy                                   | الصورة بلا wget في إصدارات قديمة        | راجع `docker compose logs qdrant` — التطبيق يتحمل غيابه (بحث دلالي متوقف فقط)   |

## ملاحظة أمنية للإنتاج المواجه للإنترنت

- غيّر `POSTGRES_PASSWORD`/`APP_DB_PASSWORD` واحذف منفذ postgres المكشوف.
- اضبط `ALLOWED_ORIGINS` على نطاقك و`APP_URL` على الرابط العام.
- راجع [دليل تدوير المفاتيح](./key-rotation.md) دورياً.
