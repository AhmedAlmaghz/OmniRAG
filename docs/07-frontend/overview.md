# الواجهة الأمامية — نظرة عامة

هذا المستند يصف البنية العامة للواجهة الأمامية في OmniRAG (Next.js 16 App Router + React 19 + Tailwind CSS v4 + TypeScript). كل ما يلي مأخوذ من الكود الفعلي للمشروع في `src/app` و`src/components` و`src/hooks` و`src/lib/i18n`.

## الحزمة التقنية

| الجانب                | التقنية                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| إطار الواجهة          | Next.js 16 (App Router)                                                                  |
| مكتبة الواجهة         | React 19                                                                                 |
| التنسيق               | Tailwind CSS v4                                                                          |
| أنواع البيانات        | TypeScript                                                                               |
| تدويل                 | نظام داخلي `src/lib/i18n` (قواميس `ar.ts`/`en.ts`)                                       |
| إدارة الخادم والحالة  | `@tanstack/react-query`                                                                  |
| تدفق المحادثة         | `@ai-sdk/react` + `ai` (DefaultChatTransport)                                            |
| التخطيط متعدد اللوحات | `react-resizable-panels`                                                                 |
| تمييز الشفرة          | `shiki` (محمل كسول)                                                                      |
| رسم البيانات          | `d3` (دونات المقاطع) + `echarts` (مخططات داخل الرسائل) + `mermaid` (مخططات داخل الرسائل) |
| الرياضيات             | `katex` + `rehype-katex` + `katex4arabic` (`renderArabicToString`)                       |
| الحركات               | `motion/react` + `remotion`/`@remotion/player` (في `LandingPage`)                        |
| الأيقونات             | `lucide-react`                                                                           |
| شبكات JSON آمنة       | ماسحات SVG داخلية (`lib/security/svgSanitizer`)                                          |

## بنية المسارات (App Router)

المسار الجذري: `src/app/`.

```
src/app/
├── (workspace)/                 # مجموعة مسارات لا تظهر في الـ URL
│   ├── layout.tsx               # صدفة الجلسة وWorkspaceShell
│   ├── loading.tsx              # هيكل تحميل (ChatSkeleton + WorkspaceSkeleton)
│   ├── chat/page.tsx            # /chat
│   ├── knowledge/page.tsx       # /knowledge
│   ├── mcp/page.tsx             # /mcp
│   ├── analytics/page.tsx       # /analytics
│   └── settings/page.tsx        # /settings
├── auth/page.tsx                # /auth (تسجيل دخول / إنشاء حساب)
├── api/                         # مسارات Route Handlers (لا توثيق لها هنا)
├── error.tsx                    # معالج خطأ الجذر
├── global-error.tsx             # معالج خطأ الجذر الأعلى (يلتف بـ <html>)
├── layout.tsx                   # الجذر: <html lang/dir> + خطوط + نظام الألوان
├── not-found.tsx                # 404 (موجود دائماً)
├── page.tsx                     # / — الصفحة العامة (LandingPage)
└── globals.css
```

### نقطة الدخول

- `src/app/page.tsx` يغلّف `LandingPage` في `Suspense` ويحوّل `?tab=...` القديمة (chat|knowledge|mcp|analytics|settings) إلى المسارات الحقيقية عبر `router.replace` (توافق رجعي).
- `src/app/(workspace)/layout.tsx` يُرجع `<WorkspaceShell>` فقط (المسارات الفرعية لا تضيف صدفات).
- `src/app/(workspace)/chat/page.tsx` يستعمل `next/dynamic` لتحميل `ChatStudio` مع `ssr:false` و`loading: () => <ChatSkeleton/>`، حتى لا تُحمَّل حزمة الـ streaming وmarkdown وKaTeX إلا عند الحاجة.

### الجذر `RootLayout`

`src/app/layout.tsx` يفعّل `export const dynamic = 'force-dynamic'` ويقرأ من الـ headers كلاًّ من:

- `x-forwarded-host` / `host` لبناء `window.__APP_ORIGIN__` (يُحقن عبر `<script nonce>` يُختم بـ `x-csp-nonce` الذي يضعه الـ middleware).
- ملفات تعريف الارتباط `omnirag_lang` و`omnirag_theme` لتحديد `<html lang>` و`<html dir>` و`class="dark"` قبل أول بايت HTML، فيتفادى وميض الاتجاه/المظهر.

الخطوط العربية الـ self-hosted عبر `next/font/google`: `IBM_Plex_Sans_Arabic` و`Cairo` و`Tajawal` و`Amiri` (كلها `display: 'swap'` ومتغيرات CSS).

### ClientHome والـ bootstrap القديم

- `src/components/ClientHome.tsx` كان يستخدم `next/dynamic` لتحميل `MainApp` في وضع SPA-tabbed. هذا المسار ما يزال موجوداً لكنه لم يعد نقطة دخول فعلية بعد إعادة التنظيم إلى App Router؛ كل صفحة من `(workspace)` تعتمد الآن على `WorkspaceShell`.

## صدفة الجلسة: `WorkspaceShell`

`src/components/workspace/WorkspaceShell.tsx` هو المالك الجديد لما كان منتشراً عبر `MainApp`:

1. قراءة الجلسة عبر `getSession()` من `lib/auth/authClient`. ملفات تعريف الارتباط httpOnly هي المصدر الوحيد للهوية؛ لا يُسند هوية من `localStorage` (مجرد علم yes/no لتقليل وميض شاشة الدخول).
2. إذا `isAuthenticated === false` يحوّل إلى `/auth` عبر `router.replace`.
3. يلتف بـ `QueryClientProvider` (TanStack Query، `staleTime: 30s`) ثم `ToastProvider` ثم `WorkspaceProvider`.
4. يستضيف `Header` و`<main>{children}</main>` وذيل footer يُخفى عند المسار `/chat` (ليملأ الشات كامل ارتفاع الـ viewport).
5. يُسجّل اختصارات `Ctrl/Cmd+1..4` لتوجيه المتصفح إلى `/chat`، `/knowledge`، `/mcp`، `/analytics`.
6. يحوّل بين الـ tab IDs التقليدية و المسارات الحقيقية عبر `pathToTab(pathname)` حتى يبقى توقيع `Header` دون تغيير.

## WorkspaceContext

`src/components/workspace/WorkspaceContext.tsx` يُصدّر `WorkspaceContextValue` و خطّافين:

- `useWorkspace()` يعيد `{ tenantId, lang, userEmail?, logOut? }`.
- `useWorkspaceSession()` يعيد `{ userEmail, logOut }` فقط (لـ `SettingsView`).

كل صفحات `(workspace)` تستعمل `useWorkspace()` بدل تمرير الـ props يدوياً، وتقرأ `tenantId` و`lang` منها، وتُمرّرها إلى المكوّنات الديناميكية (مثل `<ChatStudio tenantId={tenantId} lang={lang} />`).

## إدارة الحالة والبيانات

| النمط                                       | مكان الاستخدام                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@tanstack/react-query` `useQuery`          | `KnowledgeBase` (`['kb','data',tenantId]`)، `AnalyticsCenter` (`['analytics',tenantId]`)، `PlansView` (`['plan','details']`)    |
| `useState`/`useEffect`/`useCallback` تقليدي | `ChatStudio` (تدفق المحادثة)، `McpGateway`، `SettingsView`، النماذج                                                             |
| `@ai-sdk/react` `useChat`                   | `ChatStudio` (نقل streaming عبر `DefaultChatTransport`)                                                                         |
| `useDocumentCache` (مخصص)                   | إحصاء وتخزين OCR Cache في `KnowledgeBase` و`DocumentIngestionStudio`                                                            |
| `useAsync` (مخصص)                           | تحميلات كسولة في الـ Modals (مثلاً `DocumentChunkInspectorModal`)                                                               |
| `useToast` / `ToastProvider`                | إشعارات موحدة من `src/components/ui/Toast.tsx`                                                                                  |
| `useUserPreferences`                        | تفضيلات المظهر والخطوط والرياضيات (`src/lib/preferences/userPreferences`) — تُخزن في `localStorage` وتطبَّق فورياً على `<html>` |

### TanStack Query

`WorkspaceShell` ينشئ `QueryClient` واحداً لكل جلسة عمل (عبر `useMemo`):

```ts
new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});
```

كل `useQuery` يستعمل `queryKey` متضمّن `tenantId`، حتى تنتقل البيانات بين الصفحات دون إعادة طلب، ويُحدّث المحتوى تلقائياً عند تغيير المستأجر.

## المكتبة الأساسية للمكوّنات (`ui`)

`src/components/ui/` يحتوي على بدائيات مشتركة تُستخدم في كل الواجهة:

| الملف               | الدور                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Modal.tsx`         | قشرة موحّدة لكل الحوارات: `role="dialog"`، `aria-modal`، Escape للإغلاق، focus trap، استرجاع التركيز عند الإغلاق، قفل scroll للـ body. يُصدّر `ModalCloseButton`. |
| `ConfirmDialog.tsx` | حوار تأكيد بديل لـ `confirm()` الأصلي، بثلاثة أنماط (`danger`/`warning`/`default`)، مع `loading` وfocus تلقائي على زر التأكيد.                                    |
| `Toast.tsx`         | نظام إشعارات موحّد بـ `useToast()`، يدعم `success/error/warning/info`، ينشر `aria-live="polite"`.                                                                 |
| `CodeBlock.tsx`     | كتلة شفرة مع تلوين Shiki، أرقام أسطر، طي، التفاف، نسخ. الـ highlighter مُتَشَارك كمُوحَّد lazy module مع كاش داخلي.                                               |

كل المكوّنات الأخرى (KnowledgeBase, ChatStudio, ...) تستعمل `Modal` و`ConfirmDialog` و`Toast` بدلاً من تكرار الصدفة.

## الرسوم البيانية والوسائط الغنية

| التقنية                                                     | أين                                                                                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Shiki** (تمييز شفرة)                                      | `src/components/ui/CodeBlock.tsx` — lazy singleton مع كاش نتائج                                                                    |
| **d3** (دونات توزيع المقاطع على المجموعات)                  | `src/components/analytics/ChunksDistributionChart.tsx`                                                                             |
| **ECharts** (مخططات داخل ردود المحادثة عبر fences ```chart) | `src/lib/skills/charts.ts` (`normalizeChartSpec`, `toEChartsOption`) يستهلكها `RichMessageRenderer`                                |
| **Mermaid** (مخططات داخل ردود المحادثة عبر ```mermaid)      | `RichMessageRenderer` يحمّل `mermaid` كـ dynamic import ويُطهِّر الـ SVG عبر `sanitizeSvg`                                         |
| **KaTeX** (رياضيات LaTeX)                                   | `rehype-katex` plugin لـ `react-markdown` في `RichMessageRenderer`                                                                 |
| **KaTeX-for-Arabic** (`renderArabicToString`)               | معاينة الرياضيات في `SettingsView` (`MathPreview`) — يعتمد على وضع `mathMode: 'arabic'` من تفضيلات المستخدم                        |
| **Remotion 4** (`@remotion/player`)                         | `src/components/remotion/RemotionHeroPlayer.tsx` + `RagAnimation.tsx` — عرض بطولي على `LandingPage` فقط (7 ثوانٍ، 210 إطار، 30fps) |

## التوجيه عبر الشريط الجانبي والـ Header

`src/components/Header.tsx` هو الـ navbars الأفقية والـ mobile subnav مع قائمة منسدلة للمستخدم:

- يحمل `navTabs = [{id:'chat'}, {id:'knowledge'}, {id:'mcp'}, {id:'analytics'}]` وعلامات `role="tab"`/`role="tablist"` للتنقل بلوحة المفاتيح.
- ArrowRight/ArrowLeft تتكيف مع `document.dir === 'rtl'` (تعكس المنطق في RTL).
- القائمة المنسدلة للمستخدم تحتوي على: تبديل المستأجر (متعدد المساحات Phase 5)، الإعدادات، اللغة (عربي/إنجليزي)، المظهر (light/dark)، تسجيل الدخول/الخروج.

`pathToTab` في `WorkspaceShell.tsx` يربط بين `pathname` و`activeTab` الذي يقرأه `Header` لتظليل التبويب النشط.

## تخطيط الواجهة (Layouts)

- **Desktop**: ثلاثة أعمدة قابلة لتغيير الحجم داخل `react-resizable-panels`: الشريط الجانبي للمحادثات (افتراضي 19%، قابل للطي بـ Ctrl/Cmd+B) + سطح المحادثة + اللوحة اليمنى (MCP/الاستشهادات/السجلات) عند `xl` وما فوق فقط.
- **Mobile**: شريط جانبي يتحول إلى drawer بزر عائم، وسطح محادثة يملأ العرض الكامل، لا لوحة يمنى.
- **Chat fullscreen**: وضع ملء الشاشة مع شريط أدوات عائم للطباعة/تصدير PDF/تكبير النص/الخروج (Ctrl/Cmd+Shift+F أو Escape للخروج).

## الترميز والتدويل

راجع [`i18n.md`](./i18n.md) للتفاصيل الكاملة. النظام يعتمد على قاموسَين قويّي التنميط (`src/lib/i18n/dictionaries/ar.ts` و`en.ts`) و`t(lang, 'namespace.key', params)` مع استرجاع آمن للقيمة الافتراضية، ويُحقن اختيار اللغة عبر cookie في الـ HTML الأولي.

## الميزات القابلة للوصول (a11y)

- جميع الـ tablist تستخدم `role="tablist"`/`role="tab"`/`role="tabpanel"`/`aria-selected`/`aria-controls`.
- الـ `Modal` يستخدم `aria-modal`، focus trap، استرجاع التركيز.
- الأزرار في قوائم الـ tab تستجيب لـ `ArrowRight/ArrowLeft/ArrowLeft/Home/End` وتعكس المنطق في RTL.
- `Live region` للـ Toast (`aria-live="polite"`).
- شارات/حقول تحوي `aria-label` و`title` صريحين.

## بنية المجلدات (مختصرة)

```
src/
├── app/                  # مسارات App Router
├── components/
│   ├── chat/             # ChatMain, ChatSidebar, ChatMessage, RichMessageRenderer, ...
│   ├── knowledge/        # DocumentCard + Modals (Preview/Chunk/Version/Health) + displayHelpers
│   ├── sources/          # DocumentIngestionStudio + AddSourceWizard + Modals + helpers
│   ├── analytics/        # ChunksDistributionChart, SystemHealthPanel
│   ├── diagnostics/      # DiagnosticUtility
│   ├── env/              # EnvVariablesManager, FirstLaunchEnvModal, envShared
│   ├── workspace/        # WorkspaceContext, WorkspaceShell, Skeletons
│   ├── ui/               # Modal, ConfirmDialog, Toast, CodeBlock
│   ├── remotion/         # RemotionHeroPlayer, RagAnimation
│   └── *.tsx             # ChatStudio, KnowledgeBase, McpGateway, SettingsView, AnalyticsCenter, ...
├── hooks/                # useAsync, useDocumentCache
├── lib/
│   ├── auth/             # authClient, fetchWithAuth, ...
│   ├── chat/             # uiMessageMapper, chatExport
│   ├── i18n/             # dictionaries/{ar,en}.ts, index.ts
│   ├── preferences/      # userPreferences
│   ├── skills/           # charts.ts (ECharts bridge)
│   ├── security/         # svgSanitizer
│   └── ...
```

## انظر أيضاً

- [دليل الصفحات](./pages.md)
- [مرجع المكونات](./components.md)
- [التدويل والتعريب](./i18n.md)
- [نظرة معمارية](../02-architecture/overview.md)
- [تدفق البيانات](../02-architecture/data-flow.md)
