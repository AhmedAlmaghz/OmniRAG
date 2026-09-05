# السكريبتات والأدوات

## مجلد `scripts/`

| الملف                             | الوصف                                                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/manual-migration.sql`    | مخطط Postgres موحَّد شامل (v0.12.5) — كل البيانات idempotent (IF NOT EXISTS، DO blocks). يُستخدم للقواعد الجديدة أو لتحديث قاعدة قديمة. لا يلمس مخطط `pgboss` أو seed. |
| `scripts/run-manual-migration.ts` | مُشغّل SQL بدون psql: يقرأ الملف، يتصل بـ Postgres عبر `pg.Client`، ينفّذ النص، ثم يتحقق من 25 جدول متوقّع. يعمل على Windows بدون psql.                                |

```bash
npm run db:migrate:manual
# أو
DATABASE_URL=postgres://... npm run db:migrate:manual
```

## أدوات الجذر (root tooling)

| الملف            | الدور                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server.ts`      | مشغّل Node (`npm start`) — يغلّف Next.js في `createServer` لـ `0.0.0.0:${PORT}`. مناسب لـ Docker و self-hosted.                                                                                       |
| `dev-server.js`  | غلاف تطوير — يقتل أي `next-server` سابق، يحلّل `--host/--port`، يشغّل `next dev` كعملية فرعية مع تمرير SIGTERM/SIGINT/SIGHUP.                                                                         |
| `seed_patch.cjs` | ترقيع CJS يُعدِّل `src/lib/db/migrateAndSeedDrizzle.ts` لإضافة كتلة Drizzle seeding (collections/documents/chunks/mcp_servers/sources/audit_logs). يُستخدم عند ترحيل أدوات seeding قديمة إلى Drizzle. |

## سكريبتات npm المعرَّفة في `package.json`

```bash
npm run dev                  # node dev-server.js
npm run build                # rimraf dist + NODE_OPTIONS=--max-old-space-size=1536 next build
npm start                    # node server.ts
npm run clean                # rimraf .next dist
npm test                     # vitest run
npm run typecheck            # tsc --noEmit
npm run db:generate          # drizzle-kit generate --config=src/db/drizzle.config.ts
npm run db:push              # drizzle-kit push   --config=src/db/drizzle.config.ts
npm run db:check             # drizzle-kit check  --config=src/db/drizzle.config.ts
npm run db:migrate:manual    # tsx scripts/run-manual-migration.ts
npm run db:verify-rls        # tsx scripts/verify-rls.ts — إثبات حي لعقد سياسات RLS
npm run lint                 # eslint . --ext .ts,.tsx,.js,.jsx,.mjs,.cjs
npm run lint:fix             # eslint --fix
npm run format               # prettier --write "src/**/*.{ts,tsx,js,jsx,css,md}" "*.{ts,js,mjs,cjs,md}"
npm run format:check         # prettier --check
```

## أدوات Drizzle

`src/db/drizzle.config.ts` يحوي إعدادات Drizzle. `src/lib/db/migrateAndSeedDrizzle.ts` ينفّذ:

1. DDL idempotent لكل الجداول.
2. Seed أولي (`INITIAL_COLLECTIONS`, `INITIAL_DOCUMENTS`, …).
3. تسجيل طوابير pg-boss.

## Git hooks

`husky` يفعّل `lint-staged` على Commit (`.husky/pre-commit`):

```jsonc
"lint-staged": {
  "*.{ts,tsx,js,jsx,mjs,cjs}": ["eslint --fix", "prettier --write"],
  "*.{css,md,json}":           ["prettier --write"]
}
```

## Dockerfile

`Dockerfile` يثبّت تبعيات الإنتاج، ينسخ المصدر، يبني بـ `npm run build`، ثم يُشغّل `npm start`. `docker-compose.yml` يضمّ خدمة Postgres اختيارية. `.dockerignore` يستثني `.next`، `node_modules`، `tests`.

## تخصيصات شائعة

| الموقف                   | الأمر                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| تشغيل بـ hostname مخصصة  | `node dev-server.js --host 0.0.0.0 --port 4000`                                             |
| تشغيل على Vercel-like    | `PORT=3000 node server.ts`                                                                  |
| تهيئة قاعدة من الصفر     | `psql $DATABASE_URL -f scripts/manual-migration.sql` ثم إقلاع التطبيق (يُنشئ pgboss + seed) |
| إعادة ضبط DB على Drizzle | `npm run db:push` ثم `npm run db:migrate:manual`                                            |

## انظر أيضاً

- [المهام الخلفية](background-jobs.md) — لاستخدام `pg-boss` وسرّ CRON.
- [التشخيص وحل المشاكل](troubleshooting.md) — فشل الإقلاع وفحص DB.
- [قاعدة البيانات](../05-database/schema.md) — للمخطط نفسه.
