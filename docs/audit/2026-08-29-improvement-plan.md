# خطة التحسين والتطوير التفصيلية — OmniRAG

**التاريخ:** 2026-08-29 | **المرجع:** `2026-08-29-audit-report.md` | **الفرع:** `dev-pro`

> **حالة التنفيذ (تحديث ختامي):** المراحل 1، 2، 4، 5 **منفذة بالكامل**، والمرحلة 3 منفذة جزئيًا (جوال المحادثة + a11y التبويبات + React Query للخطط؛ بقي هجرة الـ 370 نصًا المضمنة وتقسيم SettingsView وReact Query لقراءات KB/Analytics — عمل ممتد موصى به كمرحلة متابعة).
> تفاصيل ما نُفّذ: XSS/CSP/CSRF/SSRF/Rate-limiting الدائم/قفل الخطط/حصة tokens (المرحلة 1)، المسارات المتعددة + كوكي lang/dir + next/font + skeletons (المرحلة 2)، فهارس GIN + fast-path + pagination + كاش (المرحلة 4)، تحديثات التبعيات + CI على dev-pro + README (المرحلة 5). البناء الإنتاجي exit 0 وكل الاختبارات خضراء.

**القرارات المعتمدة من المالك:** تحويل تدريجي لمسارات متعددة ✅ | لا مدفوعات (قفل الترقية المجانية فقط) ✅ | الالتزام بحدود Vercel Hobby ✅

**قاعدة عامة:** كل مرحلة قابلة للشحن مستقلة. بعد كل مرحلة: `npm run lint` + `tsc --noEmit` + كامل vitest خضراء. أي تغيير أمني أو سلوكي يقابله اختبار جديد.

---

## المرحلة 1 — الأمان الحرج (Priority: P0)

> الهدف: سد الثغرات القابلة للاستغلال قبل أي عمل تجميلي. الجهد: ~3 أيام.

### 1.1 إصلاح XSS عبر mermaid

- **المشكلة:** `src/components/chat/RichMessageRenderer.tsx:176` يحقن SVG من `mermaid.render()` بلا تعقيم.
- **التنفيذ:**
  1. إضافة `dompurify` + `@types/dompurify` (إن لزم) إلى dependencies.
  2. تعقيم مخرجات mermaid بـ `DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })` قبل الحقن، مع `ADD_TAGS: ['foreignObject']` و`ADD_ATTR` محدودة، ومنع `script`/معالجات الأحداث. تعطيل mermaid `htmlLabels` حيث أمكن لتقليص السطح.
  3. مراجعة باقي مواضع `dangerouslySetInnerHTML` الأربعة (KaTeX في `SettingsView.tsx:80` — آمن افتراضيًا؛ Shiki في `CodeBlock.tsx:220` — آمن افتراضيًا؛ origin script في `layout.tsx:36` — مؤمّن بـ JSON.stringify) وتوثيقها كـ reviewed.
- **القبول:** اختبار vitest يحقن diagram بشيفرة `<script>`/`onload` ويؤكد إزالتها بعد التعقيم؛ لا `dangerouslySetInnerHTML` يستقبل مخرجات غير معقمة من مصدر خارجي.

### 1.2 رؤوس أمان شاملة + CSP

- **المشكلة:** `src/middleware.ts:32-41` يضيف nosniff/XFO فقط عند تطابق CORS؛ لا CSP/HSTS/Referrer-Policy في الكود كله.
- **التنفيذ:**
  1. نقل `getAllowedOrigins` لملف مشترك (lib) لتفادي التكرار.
  2. في middleware: تطبيق على **كل** ردود `/api/*`: `X-Content-Type-Options: nosniff`، `X-Frame-Options: DENY` للنقاط غير المضمنة، `Referrer-Policy: strict-origin-when-cross-origin`، `Permissions-Policy` مقيّدة.
  3. HSTS في الإنتاج فقط (لا على http://localhost): `max-age=31536000; includeSubDomains`.
  4. **CSP** تُبنى في middleware بـ nonce لكل مسارات الصفحات (وليس فقط API): `default-src 'self'`; `script-src 'self' 'nonce-{x}' 'strict-dynamic'`; `style-src 'self' 'unsafe-inline'` (Tailwind يولد styles inline — مرحليًا)؛ `img-src 'self' data: blob:`؛ `connect-src 'self'` + نطاقات البث (OpenAI وغيرها لو عبر client مباشرة — الحالي كله عبر API نفسه فـ 'self' يكفي)؛ `frame-ancestors 'none'`؛ `object-src 'none'`؛ `base-uri 'self'`. استثناء `/api/docs` فقط: إضافة `script-src https://unpkg.com` و`style-src https://unpkg.com` (أو استضافة Swagger محليًا كملف ثابت — الأفضل، ينظف الاعتماد على CDN).
  5. تمرير الـ nonce عبر header للصفحات واستهلاكه في layout script الوحيد (`window.__APP_ORIGIN__`).
- **القبول:** اختبار وحدة للـ middleware يؤكد وجود الرؤوس على رد بدون Origin، وجود CSP بـ nonce، ووجود HSTS عند NODE_ENV=production؛ فحص يدوي: لا console errors بخصوص CSP في المسارات الرئيسية.

### 1.3 CSRF مركزي (Origin/Referer check)

- **المشكلة:** CSRF محصور في login/register/logout (ترويسة `x-requested-with` قابلة للتزييف)؛ باقي المسارات تعتمد SameSite=Lax وحده.
- **التنفيذ:** داخل `withAuthAndRateLimit.ts` (وبمسارات auth المباشرة): للطلبات غير GET/HEAD/OPTIONS — التحقق أن `Origin` (أو `Referer` كاحتياط) يطابق السماح المسموح (ALLOWED_ORIGINS + نفس الـ host الطلبات)؛ فشل التحقق = 403 مع عدم كشف تفاصيل. تجاوز الطلب إن كان يحمل `Authorization: Bearer omnirag_live_` (API keys لا تخضع لـ CSRF — لا كوكيز).
- **القبول:** اختبارات: طلب POST بدون Origin من نفس الموقع → مرفوض؛ POST بـ Origin أجنبي → مرفوض؛ POST بـ Origin من القائمة → مقبول؛ طلب API key → يتجاوز فحص Origin.

### 1.4 قفل الترقية المجانية للخطط

- **المشكلة:** `PUT /api/v1/plan` يمنح enterprise مجانًا لأي owner.
- **التنفيذ:** إضافة علم بيئة `PLAN_SELF_SERVE` (افتراضيًا `false`): الترقية لأعلى تتطلب `true` وإلا 403 مع رسالة "اتصل بالإدارة"؛ **الخفض دائمًا مسموح** (تجربة آمنة). توثيقه في `.env.example`.
- **القبول:** اختبار: بدون العلم — ترقية مرفوضة، خفض مقبول؛ مع العلم — كلاهما مقبول.

### 1.5 Rate limiting دائم (Postgres-backed)

- **المشكلة:** مخزن بالذاكرة (`rateLimiter.ts`) عديم الفائدة على serverless متعدد النسخ.
- **التنفيذ:**
  1. جدول `rate_limit_windows` عبر migration: `(bucket_id varchar PK, window_start timestamptz, count int)`. Upsert ذري: `INSERT ... ON CONFLICT (bucket_id) DO UPDATE SET count = CASE WHEN window_start < now() - $window THEN 1 ELSE count + 1 END, window_start = CASE WHEN window_start < now() - $window THEN now() ELSE window_start END RETURNING count` — عربة واحدة ذرية.
  2. Adapter بنفس واجهة الحالي مع fallback للذاكرة عند فشل DB (لا يفشل الطلب بسبب rate limiter) + lazy جدولة تنظيف (حذف النوافذ الأقدم من ساعة في jobs tick).
  3. الإبقاء على الحدود الحالية (30/min default، 10/min IP + 5/min email للدخول، إلخ).
- **القبول:** اختبارات منطق النافذة (تجديد، تراكم، atomicity عبر Promise.all)؛ فحص أن فشل DB لا يكسر الطلب.

### 1.6 إصلاح SSRF (DNS resolution)

- **المشكلة:** `src/lib/mcp/net.ts` regex على hostname فقط — nip.io/DNS rebinding يتجاوزانه.
- **التنفيذ:** في `assertPublicHttpUrl` بعد فحص النص: `dns.promises.lookup(host, { all: true })` ورفض إن كان **أي** IP خاص/loopback/link-local/unique-local (القائمة الحالية نفسها مطبقة على النتائج). Plus: تقييد `redirect: 'manual'`-style handling في fetches الخارجية (web-fetch، MCP probe): منع الـ redirects الداخلية أو إعادة فحص كل hop. Timeout قصير للـ lookup (3s) مع fallback رفض عند الغموض.
- **القبول:** اختبارات الوحدة الحالية (mcpNetSsrf.test.ts) خضراء + حالات جديدة: hostname عام يحل إلى IP داخلي → مرفوض؛ فشل DNS → مرفوض.

---

## المرحلة 2 — البنية الأمامية: مسارات متعددة (P1)

> الهدف: مسار إقلاع خفيف + SEO لصفحة الهبوط + lang/dir صحيح من أول بايت. الجهد: ~4-5 أيام.

### 2.1 كوكي اللغة والثيم

- **التنفيذ:**
  1. عند تبديل اللغة/الثيم من الواجهة: `document.cookie = 'omnirag_lang=ar; path=/; max-age=31536000; samesite=lax'` (والثيم بالمثل) عبر preferences store، بجانب localStorage الحالي.
  2. `layout.tsx` يقرأ `headers().get('cookie')`: يشتق `lang` (ar افتراضيًا) و`theme` → `<html lang dir class={theme==='dark'?'dark':''}>`. لا وميض، لا JS مطلوب للرسم الأول.
  3. إزالة ضبط `dir` اليدوي اللاحق من الـ views تدريجيًا (تبقى مؤقتًا؛ تُنظف في 3.x).
- **القبول:** تبديل اللغة → إعادة تحميل → HTML يصل بـ `lang="en" dir="ltr"` من الخادم بلا وميض؛ الثيم الداكن بلا FOUC.

### 2.2 هيكل المسارات

- **التنفيذ:**
  ```
  src/app/
    page.tsx                    → LandingPage (SSR للـ SEO)
    auth/page.tsx               → AuthScreen
    (workspace)/
      layout.tsx                → AuthGate + Header + ToastProvider + footer
      chat/page.tsx             → ChatStudio
      knowledge/page.tsx        → KnowledgeBase
      mcp/page.tsx              → McpGateway
      analytics/page.tsx        → AnalyticsCenter
      settings/page.tsx         → SettingsView
  ```
  1. استخراج `WorkspaceShell` client component: يحتفظ بمنطق الجلسة الحالي في MainApp (getSession boot، flash-reduction flag، workspaces/role) — غير مصادق → `router.replace('/auth')`.
  2. نقل Header/ToastProvider/footer إلى `(workspace)/layout.tsx`.
  3. `usePathname()` في Header بدل prop `activeTab`؛ `onNavigateTab` → `router.push`.
  4. Landing SSR: `LandingPage` يُجعل server-compatible أو يُلف بـ dynamic للفيديو فقط (`RemotionHeroPlayer` فقط ssr:false) — النص والبطاقات تُرسم من الخادم.
  5. نقل `?tab=` القديم: `page.tsx` (landing) يقرأ `?tab=` ويعيد redirect دائم إلى `/tab-name` المقابل.
- **القبول:** كل رابط داخلي يعمل؛ reload مباشر على `/knowledge` يعمل؛ رابط `?tab=mcp` قديم يحول إلى `/mcp`؛ SSO/دعوات/`?invite=` تعمل عبر `/auth`.

### 2.3 loading.tsx skeletons

- **التنفيذ:** ملف `loading.tsx` لكل مسار workspace (skeleton يطابق شكل الصفحة: sidebar/panel لchat، grid لknowledge) بأسلوب `ClientHome.tsx` الموجود؛ إزالة شاشة "BOOTING" من MainApp القديم بعد الترحيل.
- **القبول:** تنقل بارد إلى أي مسار لا يعرض شاشة بيضاء أبدًا.

### 2.4 next/font

- **التنفيذ:** `next/font/google` لـ IBM Plex Sans Arabic، Cairo، Tajawal، Amiri بـ `display: 'swap'` و`subsets: ['arabic']`؛ تصدير متغيرات CSS وتوصيلها بـ `--font-arabic/...` في `@theme`؛ حذف `@import` من `globals.css:1`؛ الإبقاء على منطق تبديل الخط بالمفضلة عبر `data-arabic-font` (يعمل مع المتغيرات الجديدة).
- **القبول:** لا طلب Google Fonts خارجي بعد الآن (self-hosted في build)؛ لا `@import` في CSS؛ FCP المحسّن واضح في Lighthouse.

### 2.5 تقسيم الحزم

- **التنفيذ:** كل page component يعمل `next/dynamic` للـ view الثقيل داخل مجموعته (ChatStudio، KnowledgeBase، McpGateway، AnalyticsCenter، SettingsView) — التبويبات لم تعد في نفس الحزمة أصلًا؛ داخل RichMessageRenderer: نقل `react-markdown`+`remark-*`+`rehype-katex` إلى chunk مؤجل (React.lazy للمسار النصي) — البند 1.1 يجعله آمنًا.
- **القبول:** حزمة إقلاع `/chat` لا تحتوي كود `/knowledge` و`/mcp` (فحص build output)؛ markdown lib لا يُحمّل إلا عند أول رسالة.

---

## المرحلة 3 — UX و i18n و a11y (P1)

> الهدف: إحساس منتج مكتمل. الجهد: ~5-6 أيام.

### 3.1 إكمال هجرة i18n

- **التنفيذ:** ترحيل الـ 370 نصًا المضمنة إلى مفاتيح قاموس، ملفًا ملفًا بالأولوية: KnowledgeBase (148) → LandingPage (كامل) → SettingsView → McpGateway → البقية؛ حذف `KB_TABS` المكرر لصالح القاموس. كل دفعة = قاموس en + ar متطابقان مطبوعًا (typo = compile error).
- **القبول:** `grep -c "lang === 'ar' ?" src/components` → 0 تقريبًا (يسمح باستثناءات موثقة)؛ لا نصوص مستخدم مرئية خارج القواميس.

### 3.2 توحيد الإشعارات على useToast

- **التنفيذ:** استبدال banners المؤقتة في Views الرئيسية بـ `toast.success/error/info` مع ربط إضافي لا يكسر UX الحرج (banners الـ outage تبقى — حالة دائمة وليست إشعارًا).
- **القبول:** فعل/خطأ في Knowledge/Settings/MCP/Analytics يظهر toast متسقًا.

### 3.3 نماذج وسكيلتونات

- **التنفيذ:** ربط `htmlFor`/`id` لكل الحقول؛ inline per-field errors في AuthScreen (zod client-side للمخططات نفسها)؛ مؤشر قوة كلمة مرور في التسجيل؛ skeletons للقوائم (documents/sources) بدل المكان الفارغ.
- **القبول:** لا label منفصل عن حقل؛ أخطاء واضحة قبل إرسال؛ LCP أقل مع skeleton.

### 3.4 جوال واجهة المحادثة

- **التنفيذ:** تحت `lg`: sidebar → drawer قابل للسحب (button عائم + overlay)؛ inspector يفتح كـ bottom-sheet عند وجود citations/tool calls؛ منطق 1280px matchMedia يُستبدل بـ breakpoint متجاوب + toggle مرئي.
- **القبول:** على 375px عرض: كتابة رسالة، بث رد، فتح المحادثات drawer، رؤية citations ممكنة كلها.

### 3.5 a11y

- **التنفيذ:** `role="tablist"/"tab"/"tabpanel"` + `aria-selected` + أسهم لوحة المفاتيح لأشرطة التبويب (Header، SettingsView، KnowledgeBase)؛ skip-link أول الـ body؛ ترحيل الـ 34 موضعًا `ml/mr/pl/pr` + `text-left/right` إلى `ms/me/ps/pe` + `text-start/end`.
- **القبول:** axe DevTools صفر violations حرجة على المسارات الرئيسية؛ تنقل كامل بلوحة المفاتيح.

### 3.6 React Query للقراءات

- **التنفيذ:** إدخال `@tanstack/react-query` + QueryClientProvider في workspace layout؛ ترحيل قراءات KnowledgeBase (documents/collections/sources) وPlansView وAnalytics إلى `useQuery/useMutation` مع invalidation بدل refetch-storm. fetchWithAuth يبقى طبقة النقل (fetcher).
- **القبول:** لا `useState(isLoading)` مكرر للـ reads المهاجرة؛ بيانات الكاش فورية عند التبديل بين المسارات.

---

## المرحلة 4 — أداء الخلفية (P1)

> الجهد: ~3-4 أيام.

### 4.1 Pagination

- **التنفيذ:** معاملات `?limit&offset` (أو cursor) على GET documents/sources/conversations مع حدود قصوى (100) وافتراضي (20) + معاملات `documentId` و`sourceId` تُرشَّح في SQL لا JS. فصل sync-logs عن مصدر واحد: `GET /sources/[id]/logs?limit=50`. الواجهة تكيف (React Query infinite query).
- **القبول:** رد documents لأكبر مستأجر تجريبي < 100KB؛ لا `filter(all chunks in JS)`.

### 4.2 فهارس

- **التنفيذ:** migration: `CREATE INDEX CONCURRENTLY ... USING gin (to_tsvector('simple', content))` على chunks (أو expression index بالضبط مثل استدعاء الاستعلام) + `CREATE INDEX ... (tenant_id, document_id)` على chunks + `(tenant_id, created_at)` على messages. التحقق من تطابق config المستخدم في tsvector الفهرس مع الاستعلام وإلا فلن يُستخدم.
- **القبول:** EXPLAIN على lexical search يظهر Index Scan بدل Seq Scan على بيانات تجريبية.

### 4.3 Fast-path للترحيل الكسول

- **التنفيذ:** جدول `schema_meta(version)` — عند الإقلاع: استعلام واحد؛ إن وُجد الصف SKIP كل DDL. يُكتب الصف بعد أول تشغيل كامل. الحفاظ على legacy fallback.
- **القبول:** ثاني cold start بعد النشر: استعلام SELECT واحد فقط قبل أول استعلام مستخدم (قياس بالسجلات).

### 4.4 إصلاح N+1

- **التنفيذ:** مسار `addChunk` المنفرد يستخدم batch؛ حلقات seeds تُجمّع في insert واحد متعدد الصفوف؛ documents GET بـ documentId → SQL WHERE.
- **القبول:** لا استدعاء DB داخل حلقة على مسارات الـ writes (فحص مراجعة كود + عدّ استعلامات في اختبار).

### 4.5 كاش للنقاط شبه الثابتة

- **التنفيذ:** `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600` على capabilities/system-status/presets/types (كلها مدخلات isomorphic). لا كاش لأي شيء بجلسة.
- **القبول:** ردود هذه النقاط تحمل الرأس؛ reload لا يعيد الحساب (تحقق بالسجلات/التوقيت).

### 4.6 حصة tokens شهرية

- **التنفيذ:** planService يضيف `monthlyTokenBudget` لكل خطة (individual: 2M، team: 10M، business: 50M، enterprise: null)؛ عداد في جدول `usage_counters(tenant_id, period_month, tokens)` يُحدَّث ذريًا بعد كل completion بحجم tokensUsed المسجل أصلًا؛ تجاوز → 429 برسالة موجهة. إعادة التصفير مع الدورة الشهرية.
- **القبول:** اختبار: تجاوز الحد يمنع completion مع 429؛ الحصص السفلية تعمل؛ enterprise بلا حد.

---

## المرحلة 5 — التبعيات والأدوات (P2)

> الجهد: ~2 يوم.

### 5.1 تحديثات التبعيات

- **دفعة واحدة (آمنة):** next 16.3.3، zod 4.5.x، ai 7.0.84، @ai-sdk/react، @google/genai 2.19، lucide-react 1.37، motion 13.1.1، pg-boss، vitest 4.1.11، eslint 10.9، @qdrant floor يرفع لمطابقة المثبت 1.19.
- **منفصلة مع مراجعة breaking changes:** nodemailer 7→9 (فحص changelog ثم تحديث types وemailSender skill)؛ typescript يبقى 5.9.x حتى إعلان typescript-eslint دعم 7.
- **تنظيف:** نقل `@types/pdf-parse` إلى devDependencies؛ حذف سكربتات test-* الجذرية المؤقتة؛ توثيق سبب `webpackBuildWorker: false`.
- **القبول:** `npm audit --omit=dev` صفر high؛ build + tests خضراء.

### 5.2 CI وأدوات

- **التنفيذ:** `ci.yml` triggers → `push/PR` على `main` + `dev-pro` + `dev/**`؛ إضافة Playwright smoke محلي (login → chat رسالة → knowledge فتح مستند) يعمل في CI اختياريًا بمصفوفة لا تكسر الحد؛ خطوة coverage (vitest --coverage) مع عتبة تقرير بلا gate.
- **القبول:** PR على dev-pro يشغّل CI فعليًا (تأكيد من Actions).

### 5.3 توثيق

- **التنفيذ:** README: تصحيح الإصدار 0.10.0 وNext 16؛ قسم "متغيرات البيئة الإلزامية للإنتاج" (CRON_SECRET، MCP_OAUTH_ENCRYPTION_KEY، PLAN_SELF_SERVE الجديد)؛ قسم تشغيل الاختبارات؛ دليل تشغيل سريع محدث.
- **القبول:** `npm run dev` باتباع README حرفيًا يعمل من clone نظيف.

---

## الجدول الزمني والترتيب

```
الأسبوع 1: المرحلة 1 كاملة (أمان) → شحن مستقل
الأسبوع 2: المرحلة 2 (مسارات + خطوط + skeletons)
الأسبوع 3: المرحلة 3 (i18n + UX + a11y) — أثقل مرحلة، تقبل التقسيم لشحنين
الأسبوع 4: المرحلة 4 (أداء خلفية) + المرحلة 5 (تبعيات/CI) → شحن نهائي
```

**إجمالي تقديري: 15-18 يوم عمل.**

## المخاطر المُدارة

| الخطر                                                   | التخفيف                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| CSP تكسر مكونات موجودة (KaTeX، mermaid styles، Swagger) | جولة اختبار يدوي كاملة بعد 1.2 + استثناءات موثقة مؤقتة مع TODO                                                           |
| تحويل المسارات يكسر روابط `?tab=` القديمة والمشاركة     | redirect دائم من page.tsx + اختبار end-to-end للروابط القديمة                                                            |
| Rate limiting بـ DB يضيف latency لكل طلب                | upsert مفرد مُفهرس PK (~<5ms) + fallback للذاكرة عند الفشل                                                               |
| Pagination يكسر واجهات مستهلكة للـ API الحالي           | defaults متوافقة (بلا limit → سلوك قديم مع تحذير deprecation log أول إصدار)                                              |
| Hobby limits مع OCR الثقيل                              | يبقى synchronous مع 429 واضح وتوثيق الترقية للبنية (pg-boss worker خارجية) كوثيقة مستقبلية — لا تنفيذ ضمن حدود هذه الخطة |

## معايير النجاح الكلية (Definition of Done للخطة كلها)

1. كل بنود المراحل 1-5 منفذة وموثقة في commits ذرية per-phase.
2. `npm run lint` + `tsc --noEmit` + `vitest run` خضراء على dev-pro، وCI يعمل على الفرع.
3. Lighthouse على `/chat` (auth'd): LCP < 2.5s على 4G، لا شاشة بيضاء، RTL/LTR سليمان، dark mode بلا وميض.
4. `npm audit` صفر high/critical، ومراجعة أمان سريعة تؤكد سد البنود 1-6 من قسم الأمان في التقرير.
5. التقرير والخطة محدثان بحالة "منفذ" لكل بند عند الإغلاق.
