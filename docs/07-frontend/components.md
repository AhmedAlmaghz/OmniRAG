# مرجع المكونات

دليل مرجعي للمكونات الرئيسية في `src/components/`. كل قسم يذكر: المسار، الدور، أهم الـ props، أبرز التفاعلات. مرتّبة حسب المجلد.

---

## `src/components/` (المكونات الجذرية للصفحات)

### `ChatStudio.tsx`

|                  |                                                                   |
| ---------------- | ----------------------------------------------------------------- |
| المسار           | `src/components/ChatStudio.tsx`                                   |
| الدور            | سطح المحادثة الكامل + الشريط الجانبي + اللوحة اليمنى + ملء الشاشة |
| المسارات الفرعية | `/chat`                                                           |

**Props**:

```ts
interface ChatStudioProps {
  tenantId: string;
  lang: 'ar' | 'en';
  onNavigateTab?: (tab: any) => void;
}
```

**الحالة الداخلية الرئيسية**:

- `conversations: Conversation[]`, `activeConversationId: string`.
- `availableCollections: Collection[]`, `selectedCollectionIds: string[]`.
- `mcpServers`, `sessionToolCalls`, `activeCitation`, `pendingToolApproval`, `securityNotice`.
- `isFullscreen` (Ctrl/Cmd+Shift+F)، `isSidebarOpen` (Ctrl/Cmd+B).
- `welcomeMessage` محفوظ محلياً (لا يُرسَل للنموذج ولا يُحفَّظ).

**أبرز التفاعلات**:

- `useChat({ transport: chatTransport })` — نقل streaming عبر `/api/v1/chat/stream`.
- `handleCitationClick` (مُستقر بـ `useCallback` لمنع re-render لـ `ChatMessage`).
- `handleSendMessage(prompt?, approvedToolCall?)` — يرسل إما نصاً أو ردّ موافقة على استدعاء أداة.
- `handleStopGeneration` (abort via `stop()` من `@ai-sdk/react`).
- `handleRegenerate` (إعادة توليد آخر رد).
- `handleApproveTool` / `handleRejectTool`.
- `handleExportChat` / `handleExportPdf` / `handlePrintChat` / `handleSaveToSources`.
- اختصارات لوحة المفاتيح: `Ctrl/Cmd+1..4`, `Ctrl/Cmd+B`, `Ctrl/Cmd+Shift+F`, `Escape`.

---

### `KnowledgeBase.tsx`

|                  |                                                  |
| ---------------- | ------------------------------------------------ |
| المسار           | `src/components/KnowledgeBase.tsx`               |
| الدور            | لوحة معلومات قاعدة المعرفة (9 تبويبات + مودالات) |
| المسارات الفرعية | `/knowledge`                                     |

**Props**:

```ts
interface KnowledgeBaseProps {
  tenantId?: string;
  lang?: 'ar' | 'en';
}
```

**الحالة الداخلية**:

- `activeTab: 'dashboard' | 'documents' | 'collections' | 'upload' | 'ocr_cache' | 'connectors' | 'youtube' | 'keys' | 'mcp'` (محفوظ في `localStorage[KB_TAB_STORAGE_KEY]`).
- `documents`, `collections`, `sources`, `syncLogs`, `mcpResources`, `keysStatus` من `useQuery({ queryKey: ['kb','data',tenantId] })`.
- فلاتر: `searchQuery`, `filterCollection`, `filterType`, `filterHealth`, `sortBy`, `docViewMode`.
- مودالات: `inspectingDoc`, `previewingDoc`, `versionHistoryDoc`, `editingSource`, `viewingLogsSource`, `isCreateColModalOpen`, `isHealthModalOpen`, `isAddSourceOpen`.
- حالات تأكيد: `pendingDeleteDoc`, `pendingDeleteSource`, `isClearCacheConfirmOpen`.

**أبرز التفاعلات**:

- استعلام TanStack: `fetchKnowledgeData({ silent?: true })` (silently keep current data vs reset skeleton).
- استطلاع دوري كل 4 ثوان عند وجود مستندات بحالة `processing/pending` (نقطة نهاية `/api/v1/documents/status`).
- استطلاع خفيف بنفس الفترة لموصلات بحالة `syncing` (`/api/v1/sources/sync-status`).
- `handleSyncSource(id)`, `handleSyncAllSources()`, `confirmDeleteSource()`, `confirmDeleteDocument()`, `handleReindexDocument(doc)`.
- فتح المودالات: معاينة، فحص المقاطع، سجل الإصدارات، تشخيص الصحة، تحرير المصدر، إنشاء مجموعة، معالج إضافة مصدر.

---

### `DocumentIngestionStudio.tsx`

|        |                                                                            |
| ------ | -------------------------------------------------------------------------- |
| المسار | `src/components/sources/DocumentIngestionStudio.tsx`                       |
| الدور  | معالج استيعاب المستندات (5 أوضاع إدخال، 5 مراحل معالجة، 4 محرّكات استخراج) |

**Props**:

```ts
interface DocumentIngestionStudioProps {
  tenantId: string;
  collections: Collection[];
  lang: 'ar' | 'en';
  onIngestionCompleted: (createdSourceId?: string) => void;
  onNavigateTab?: (tab: string) => void;
  initialTab?: 'upload' | 'youtube' | 'web' | 'text' | 'sample';
}
```

**أبرز التفاعلات**:

- تبويبات إدخال: `upload` (سحب وإفلات)، `youtube` (رابط)، `web` (رابط URL مع حماية SSRF)، `text` (نص خام)، `sample` (مستندات تجريبية).
- محرّكات الاستخراج: `auto | mistral_ocr | unstructured_mcp | local` (مع شارة `SMART` أو `FREE`).
- مراحل الاستيعاب الخمس `INITIAL_STEPS` (read, parse, chunk, embed, index) مع `durationMs` و`progress`.
- يستخدم `useDocumentCache()` لمنع تكرار OCR لنفس الملف.
- `validateUploadedFile`, `validateYoutubeUrl`, `validateWebFileUrl` من `documentIngestionHelpers.ts`.

---

### `McpGateway.tsx`

|                  |                                                                |
| ---------------- | -------------------------------------------------------------- |
| المسار           | `src/components/McpGateway.tsx`                                |
| الدور            | إدارة كاملة لخوادم MCP (CRUD، OAuth، presets، AI tool builder) |
| المسارات الفرعية | `/mcp`                                                         |

**Props**:

```ts
interface McpGatewayProps {
  tenantId: string;
  lang: 'ar' | 'en';
}
```

**الحالة الداخلية**: قائمة الخوادم + presets، مودال الإضافة، مودال التحرير، مودال مولّد الأدوات (`showToolBuilderModal`)، فلاتر البحث والحالة.

**أبرز التفاعلات**:

- `fetchServers()` + `fetchPresets()`.
- `handleOAuthConnect(server)` — يبدأ تدفق OAuth 2.0 + PKCE (`/api/v1/mcp/oauth/initiate` → popup → `postMessage` من callback).
- `handlePingServer`, `toggleServerActiveStatus`, `installPreset`, `handleToggleTool`.

---

### `AnalyticsCenter.tsx`

|                  |                                        |
| ---------------- | -------------------------------------- |
| المسار           | `src/components/AnalyticsCenter.tsx`   |
| الدور            | KPIs + تدقيق + أمن + ملعب استرجاع هجين |
| المسارات الفرعية | `/analytics`                           |

**Props**: `{ tenantId: string; lang: 'ar' \| 'en' }`.

**الحالة**: `activeSubTab`, `stats`, `auditLogs`, `filteredAuditLogs`, `visibleRows` (pagination)، حقول `searchQuery`, `semanticWeight`, `lexicalWeight`, `topK`, `useHyde`, نتائج البحث.

**أبرز التفاعلات**:

- استعلام `['analytics', tenantId]` + استدعاء `/api/v1/diagnostics` داخل `SystemHealthPanel`.
- `runTestHarness()` عبر `runHookHarness` (server action).
- `handleSearch()` يستدعي `/api/v1/search` بـ `POST`.
- latencySparkline يُحسب بـ `useMemo` من `stats.toolLatencySamples`.

---

### `SettingsView.tsx`

|        |                                                      |
| ------ | ---------------------------------------------------- |
| المسار | `src/components/SettingsView.tsx`                    |
| الدور  | 12 تبويب إعدادات + تنقل جانبي + إدارة التحميل الكسول |

**Props**: `{ tenantId: string; lang: 'ar' \| 'en'; userEmail?: string \| null; onLogOut?: () => void; }`.

**الحالة**:

- `activeTab: TabType` و`visitedSections: Set<TabType>` (أول زيارة فقط، يبقى mounted عبر CSS hidden).
- حقول الحساب، تفضيلات `useUserPreferences()` (theme, fontSize, density, arabicFont, mathMode, mathArabicNumerals).
- `MathPreview` يستخدم `renderArabicToString` أو `katex.renderToString` حسب الوضع.

**أبرز التفاعلات**:

- كل تبويب يُحمَّل عبر `next/dynamic(() => import(...))`.
- `handleSave()` يكتب في localStorage ويُطلِق `omnirag_profile_changed` لتحديث الـ Header.
- معالج `FirstLaunchEnvModal` يظهر تلقائياً مرة واحدة لكل متصفح.

---

### `LandingPage.tsx`

|                  |                                                             |
| ---------------- | ----------------------------------------------------------- |
| المسار           | `src/components/LandingPage.tsx`                            |
| الدور            | شاشة هبوط + Hero + تبويبات معمارية + قطاعات + لاعب Remotion |
| المسارات الفرعية | `/`                                                         |

**Props**: `{ onEnterApp, lang, setLang, onNavigateTab }`.

**الحالة**: `activeTab` (4 خيارات)، `showOnboarding`، `onboardingStep` (لم تُستخدم في الإصدار الحالي).

**أبرز التفاعلات**: تبديل اللغة، الانتقال إلى `/chat`، تنقل بين التبويبات، عرض مشغل Remotion (dynamic import).

---

### `AuthScreen.tsx`

|                  |                                                |
| ---------------- | ---------------------------------------------- |
| المسار           | `src/components/AuthScreen.tsx`                |
| الدور            | تسجيل دخول / إنشاء حساب + دخول سريع كضيف + SSO |
| المسارات الفرعية | `/auth`                                        |

**Props**: `{ onAuthSuccess, lang, onLangChange, onBackToLanding? }`.

**الحالة**: `activeTab ('login'|'register')`, `email`, `password`, `workspaceName`, `loading`, `error`, `success`, `inviteToken` (من `?invite=`).

**أبرز التفاعلات**:

- `handleSubmit` يفرق بين تسجيل الدخول (`signInUser`) والتسجيل (`signUpUser`).
- `handleGuestSignUp` ينشئ حساباً حقيقياً ببيانات آمنة عشوائية (`randomHex`/`randomPassword`).
- `handleSsoLogin` يستدعي `startSsoLogin({ email })`.
- ترجمة رموز الخطأ (`409_EMAIL_EXISTS`, `400_WEAK_PASSWORD`, `401`, `403_CSRF`).

---

### `Header.tsx`

|        |                                                  |
| ------ | ------------------------------------------------ |
| المسار | `src/components/Header.tsx`                      |
| الدور  | شريط علوي + تبويبات تنقل + قائمة منسدلة للمستخدم |

**Props**:

```ts
interface HeaderProps {
  currentTenantId: string;
  onTenantChange: (id: string) => void;
  lang: 'ar' | 'en';
  onLangChange: (lang: 'ar' | 'en') => void;
  onNavigateTab: (tab: any) => void;
  userEmail?: string | null;
  onLogOut?: () => void;
  currentTenantName?: string;
  activeTab?: string;
  theme?: 'light' | 'dark';
  onThemeChange?: (theme: 'light' | 'dark') => void;
  workspaces?: WorkspaceRef[];
}
```

**أبرز التفاعلات**: tablist بـ `role="tab"`, تنقل بـ `ArrowLeft/ArrowRight` معكوس في RTL، قائمة منسدلة (workspace switcher, language, theme, profile, logout).

---

### `MainApp.tsx`

|        |                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| المسار | `src/components/MainApp.tsx`                                                                                                               |
| الدور  | نقطة الدخول القديمة (single-page tabbed shell). ما يزال محفوظاً لاستدعاءات `ClientHome` لكنه لم يعد الجذر الفعلي بعد انتقال إلى App Router |

**Props**: لا يقبل props (يعتمد على `localStorage` و`getSession`).

---

### `ClientHome.tsx`

|        |                                               |
| ------ | --------------------------------------------- |
| المسار | `src/components/ClientHome.tsx`               |
| الدور  | wrapper تحميل كسول لـ `MainApp` مع شاشة بداية |

---

### `ClientNotFound.tsx`

|        |                                     |
| ------ | ----------------------------------- |
| المسار | `src/components/ClientNotFound.tsx` |
| الدور  | واجهة خطأ 404 من جانب العميل        |

---

## `src/components/chat/`

### `ChatMain.tsx`

|       |                                                                         |
| ----- | ----------------------------------------------------------------------- |
| الدور | شريط الأدوات + تدفق الرسائل + شريط الإدخال + متصفح الأسئلة + الاقتراحات |

**Props**:

```ts
{
  lang, messages, isLoading, inputPrompt, setInputPrompt,
  selectedMode, setSelectedMode, selectedCollectionIds,
  suggestions, securityNotice, mcpApprovalSuccess, pendingToolApproval,
  onSendMessage, onStopGeneration, onRegenerate,
  onApproveTool, onRejectTool, onCitationClick, onViewInKnowledge?,
  onExportChat, onExportPdf, isExportingPdf, onPrintChat,
  onSaveToSources?, isSavingToSources?, onOpenSourcesModal,
  activeTitle?, sidebarOpen?, onToggleSidebar?, isFullscreen?, onToggleFullscreen?
}
```

**الحالة**: `showModeMenu`, `showJumpToTop`, `showJumpToBottom`, `zoomLevel` (في fullscreen فقط)، `isNearBottomRef`.

**أبرز التفاعلات**: تمرير الرسائل إلى `ChatMessage` (مع `memo`)، scroll-to-top/bottom، فتح Sources Modal، تحويل PDF، طباعة، حفظ كمصدر.

---

### `ChatMessage.tsx`

|       |                                       |
| ----- | ------------------------------------- |
| الدور | فقاعة رسالة واحدة (مستخدم/مساعد/نظام) |

**Props**: `{ message, lang, onCitationClick, onViewInKnowledge? }`.

**أبرز التفاعلات**: يستخدم `pickBubbleWidth(content)` لتحديد عرض الفقاعة (`min(percent, cap)`)، يلف المحتوى بـ `RichMessageRenderer`، ويعرض `CitationsPanel` أسفل الرسالة. مُغلَّف بـ `React.memo` مع دالة مقارنة مخصّصة لتقليل re-renders أثناء الكتابة.

---

### `ChatSidebar.tsx`

|       |                                                |
| ----- | ---------------------------------------------- |
| الدور | قائمة الجلسات (شريط جانبي يسار/يمين حسب اللغة) |

**Props**:

```ts
{
  (conversations,
    activeConversationId,
    isLoading,
    lang,
    isOpen,
    onToggle,
    onSelectConversation,
    onCreateNew,
    onDeleteConversation,
    onRenameConversation);
}
```

**الحالة**: `searchQuery`, `editingConvId`, `editingTitle`, `preview` (hover tooltip بـ `getBoundingClientRect`).

**أبرز التفاعلات**: بحث، إعادة تسمية inline، حذف (يستدعي ConfirmDialog من الأب)، hover preview للمحادثات.

---

### `RichMessageRenderer.tsx`

|       |                                                                               |
| ----- | ----------------------------------------------------------------------------- |
| الدور | تقديم Markdown + GFM + Math (KaTeX) + Mermaid + ECharts + استشهادات + تنبيهات |

**Props**: `{ content, role, lang?, onCitationClick?, citations?, onViewInKnowledge? }`.

**أبرز التفاعلات**:

- `react-markdown` مع `remark-gfm`, `remark-math`, `rehype-katex`, `rehypeKatexArabic` (plugin داخلي).
- يكتشف fences `mermaid و `chart ويحمّل كل مكتبة كـ dynamic import.
- ينقّح SVG المُنتَج عبر `sanitizeSvg` قبل `dangerouslySetInnerHTML`.
- ينسخ إلى الحافظة مع `useToast()`.
- ينطق نص الرسالة (Web Speech API) مع زر mute.

---

### `CitationInline.tsx`

|       |                                          |
| ----- | ---------------------------------------- |
| الدور | شارة superscript [n] داخل النص + popover |

**Props**: `{ index, citation?, lang?, onViewInKnowledge?, onCitationClick? }`.

**أبرز التفاعلات**: popover بتفاصيل المصدر، يفتح `sourceUrl` خارجياً (في تبويب جديد) أو يستدعي `onViewInKnowledge()` للروابط الداخلية.

---

### `CitationsPanel.tsx`

|       |                                           |
| ----- | ----------------------------------------- |
| الدور | شريط شرائح الاستشهادات أسفل رسالة المساعد |

**Props**: `{ citations, lang?, onCitationClick?, onViewInKnowledge? }`.

**أبرز التفاعلات**: أول 3 شرائح ظاهرة، الباقي في قائمة منسدلة (`.hidden expanded`).

---

### `FollowUpSuggestions.tsx`

|       |                                  |
| ----- | -------------------------------- |
| الدور | أزرار الأسئلة المقترحة بعد كل رد |

**Props**: `{ suggestions, lang, onSuggestionClick, isLoading? }`.

---

### `QuestionNavigator.tsx`

|       |                                                      |
| ----- | ---------------------------------------------------- |
| الدور | عمود جانبي بأزرار قفز للأسئلة + scroll-to-top/bottom |

**Props**: `{ messages, lang, onJumpToMessage, showScrollTop?, showScrollBottom?, onScrollToTop?, onScrollToBottom? }`.

**أبرز التفاعلات**: `buildExchanges(messages)` يقرن كل سؤال بأول جواب يليه. يستخدم `insetInlineEnd` ليظهر في الحافة الصحيحة في RTL/LTR.

---

## `src/components/knowledge/`

### `DocumentCard.tsx`

|       |                                          |
| ----- | ---------------------------------------- |
| الدور | بطاقة مستند واحدة في قائمة قاعدة المعرفة |

**Props**:

```ts
{
  document, collectionName?, lang, isSelected?, onSelect?,
  onPreview?, onInspectChunks?, onViewHistory?,
  onReindex?, onDelete?, isReindexing?
}
```

**أبرز التفاعلات**: يستعمل `getSourceTypeIcon` و`ConnectorStatusPill` من `displayHelpers.tsx`.

---

### `DocumentPreviewModal.tsx`

|       |                             |
| ----- | --------------------------- |
| الدور | معاينة كاملة لمحتوى المستند |

**Props**: `{ document, collectionName?, lang, onClose, onInspectChunks? }`.

**أبرز التفاعلات**: يستخدم `<Modal>`، ينسخ `document.content` للحافظة، يعرض Markdown عبر `react-markdown` + `remark-gfm`.

---

### `DocumentChunkInspectorModal.tsx`

|       |                                      |
| ----- | ------------------------------------ |
| الدور | فحص المتجهات (Qdrant) لمقاطع المستند |

**Props**: `{ document, tenantId, lang, onClose }`.

**أبرز التفاعلات**: يستخدم `useAsync` لتحميل المقاطع، تبديل عرض `chunks | raw`، نسخ قطعة منفردة.

---

### `DocumentVersionHistoryModal.tsx`

|       |                                                         |
| ----- | ------------------------------------------------------- |
| الدور | سجل إصدارات المستند + diff + استعادة + إنشاء إصدار جديد |

**Props**: `{ document, tenantId, lang, onClose, onReverted }`.

**الحالة**: `versions`, `selectedVersionNum`, `viewMode`، حقل جديد (`newTitle`, `newContent`, `changeSummary`, `authorName`).

**أبرز التفاعلات**: جلب الإصدارات، diff بين الإصدار المختار والحالي، استعادة إصدار قديم عبر `POST /api/v1/documents/versions action='revert'`.

---

### `HealthDiagnosticsModal.tsx`

|       |                                          |
| ----- | ---------------------------------------- |
| الدور | فحص حقيقي لـ PostgreSQL وQdrant وMistral |

**Props**: `{ tenantId, totalDocs, totalChunks, lang, onClose }`.

**أبرز التفاعلات**: يستدعي `/api/v1/diagnostics` ويعرض القيم المقاسة (latencyMs، messages، version، collectionInfo، modelsCount).

---

### `displayHelpers.tsx`

|       |                                                     |
| ----- | --------------------------------------------------- |
| الدور | مصدر الحقيقة الموحّد لأيقونات/ألوان/تسميات الموصلات |

**الصادرات**: `getSourceTypeIcon(type)`, `ConnectorStatusPill({ status, isRtl })`, `UnknownSourceIcon`.

---

## `src/components/sources/`

### `AddSourceWizard.tsx`

|       |                                      |
| ----- | ------------------------------------ |
| الدور | معالج ثلاثي الخطوات لإضافة مصدر جديد |

**Props**: `{ tenantId, collections, lang, onCompleted, onCancel }`.

**الحالة**: `step (1|2|3)`, `sourceTypes` (من `/api/v1/sources/capabilities`)، `selectedType`, `fieldsState`, `isTesting`, `testDiagnostics`.

**أبرز التفاعلات**: اختيار النوع من كتالوج الخادم، تعبئة حقول ديناميكية، اختبار الاتصال، حفظ في `/api/v1/sources`.

---

### `CreateCollectionModal.tsx`

|       |                           |
| ----- | ------------------------- |
| الدور | إنشاء مجموعة معرفية جديدة |

**Props**: `{ tenantId, lang, onClose, onCreated }`.

---

### `EditSourceModal.tsx`

|       |                          |
| ----- | ------------------------ |
| الدور | تحرير إعدادات موصل موجود |

**Props**: `{ source, lang, onClose, onSave, availableCollections }`.

**أبرز التفاعلات**: تحرير `name`, `syncSchedule`, `status`, `config` (JSON)، `selectedCollectionIds`، التحقق من صحة JSON قبل الحفظ.

---

### `SyncLogModal.tsx`

|       |                     |
| ----- | ------------------- |
| الدور | عرض سجل مزامنة موصل |

**Props**: `{ source, logs, lang, onClose, onSyncNow }`.

---

### `documentIngestionHelpers.ts`

|       |                                  |
| ----- | -------------------------------- |
| الدور | دوال التحقق من الإدخال للاستوديو |

**الصادرات**: `SUPPORTED_EXTENSIONS`، `validateUploadedFile`, `validateYoutubeUrl`, `validateWebFileUrl`. تتضمن قائمة SSRF (`PRIVATE_HOST_PATTERNS`).

---

## `src/components/ui/`

### `Modal.tsx`

|       |                      |
| ----- | -------------------- |
| الدور | قشرة موحّدة للحوارات |

**Props**: `{ open, onClose, ariaLabel?, ariaLabelledBy?, maxWidthClass?, dismissible?, children }`.

**التصديرات الإضافية**: `ModalCloseButton({ onClose, label })`.

**أبرز التفاعلات**: focus trap، استرجاع التركيز، Escape للإغلاق، قفل scroll، backdrop click للإغلاق.

---

### `ConfirmDialog.tsx`

|       |                                       |
| ----- | ------------------------------------- |
| الدور | حوار تأكيد بديل لـ `window.confirm()` |

**Props**: `{ open, title, message, confirmLabel?, cancelLabel?, variant?: 'danger'|'warning'|'default', loading?, onConfirm, onCancel }`.

---

### `Toast.tsx`

|       |                    |
| ----- | ------------------ |
| الدور | نظام إشعارات موحّد |

**التصديرات**: `ToastProvider`, `useToast()`, `ToastOptions`.

**أبرز التفاعلات**: aria-live region، auto-dismiss (افتراضي 4.2s)، 4 variants (success/error/warning/info)، حد أقصى 4 إشعارات ظاهرة.

---

### `CodeBlock.tsx`

|       |                                                     |
| ----- | --------------------------------------------------- |
| الدور | كتلة شفرة مع Shiki + نسخ + طي + أرقام أسطر + التفاف |

**Props**: `{ code, language?, title?, lang? }`.

**أبرز التفاعلات**: Shiki lazy singleton مع كاش نتائج، استخراج inline style من `<pre>` المعالَج، نسخ للحافظة.

---

## `src/components/workspace/`

### `WorkspaceContext.tsx`

|       |                                                            |
| ----- | ---------------------------------------------------------- |
| الدور | React Context لـ `{ tenantId, lang, userEmail?, logOut? }` |

**التصديرات**: `WorkspaceProvider`, `useWorkspace()`, `useWorkspaceSession()`.

---

### `WorkspaceShell.tsx`

|       |                                               |
| ----- | --------------------------------------------- |
| الدور | صدفة الجلسة الموحّدة لكل مسارات `(workspace)` |

**Props**: `{ children }`.

**الحالة**: `tenantId`, `isAuthenticated`, `userEmail`, `workspaces`, `currentTenantName`, `pathname` من `usePathname()`, `tenantId` من `usePathname()` عبر `pathToTab()`.

**أبرز التفاعلات**: `getSession()` للجلسة، `QueryClientProvider`، `ToastProvider`، `Header`، اختصارات `Ctrl/Cmd+1..4`.

---

### `Skeletons.tsx`

|       |                                     |
| ----- | ----------------------------------- |
| الدور | هياكل تحميل مشتركة لـ `loading.tsx` |

**التصديرات**: `WorkspaceSkeleton({ lang? })`, `ChatSkeleton()`.

---

## `src/components/analytics/`

### `ChunksDistributionChart.tsx`

|       |                                            |
| ----- | ------------------------------------------ |
| الدور | مخطط دونات d3 لتوزيع المقاطع على المجموعات |

**Props**: `{ data: { name, count }[], lang }`.

**أبرز التفاعلات**: يلوّن الشرائح عبر `d3.scaleOrdinal().range(d3.schemeSet3)`، يضيف polylines للتسميات، hover يكبر القوس.

---

### `SystemHealthPanel.tsx`

|       |                                                         |
| ----- | ------------------------------------------------------- |
| الدور | حالة البنية التحتية الحية (Postgres / Qdrant / Mistral) |

**Props**: `{ lang }`.

**أبرز التفاعلات**: يستدعي `/api/v1/diagnostics`، يعرض readinessScore/100، شريط تقدم ملوّن، latencyMs لكل خدمة.

---

## `src/components/diagnostics/`

### `DiagnosticUtility.tsx`

|       |                               |
| ----- | ----------------------------- |
| الدور | أداة تشخيص شاملة مع سجل مباشر |

**Props**: `{ lang?, autoRunOnMount? }`.

**الحالة**: `report`, `logs[]`, `activeTab ('connections'|'environment'|'logs')`, `testingTarget`.

**أبرز التفاعلات**: `addLog`، `runFullDiagnostics` يستدعي `/api/v1/diagnostics` ويسجل النتائج، نسخ JSON كامل للحافظة.

---

## `src/components/env/`

### `EnvVariablesManager.tsx`

|       |                             |
| ----- | --------------------------- |
| الدور | إدارة متغيرات البيئة والربط |

**Props**: `{ lang, onOpenWizard? }`.

**الحالة**: `envList`, `formValues`, `visibleKeys`, `testingKeys`, `testResults`, `readinessScore`, `selectedCategory`, `searchQuery`.

**أبرز التفاعلات**: `loadEnvStatus` يستدعي الـ API، اختبار كل مفتاح فردياً، نسخ قالب `.env`، حفظ دفعي.

---

### `FirstLaunchEnvModal.tsx`

|       |                            |
| ----- | -------------------------- |
| الدور | معالج تشغيل أول لمرة واحدة |

**Props**: `{ lang, isOpen, onClose, onComplete? }`.

**الحالة**: `step (1|2|3)`، حقول البيئة، نتائج الاختبار.

---

### `envShared.ts`

|       |                                                              |
| ----- | ------------------------------------------------------------ |
| الدور | دوال مشتركة بين `EnvVariablesManager` و`FirstLaunchEnvModal` |

**الصادرات**: `loadEnvStatus`, `persistFormValue`, `testEnvKey`, `saveEnvsToServer`, `copyDotEnvTemplate`, `EnvVarItem`.

---

## `src/components/remotion/`

### `RemotionHeroPlayer.tsx`

|       |                                 |
| ----- | ------------------------------- |
| الدور | مشغل Remotion 4 لمشهد RAG متحرك |

**Props**: `{ lang? }`.

**التصدير الإضافي**: `RagAnimation`.

**الحالة**: `mounted` (لتجنب SSR hydration mismatch).

**أبرز التفاعلات**: `Player` بمدة 210 إطار @ 30fps، حلقات تلقائية، controls ظاهر.

---

### `RagAnimation.tsx`

|       |                                                                                    |
| ----- | ---------------------------------------------------------------------------------- |
| الدور | مشهد Remotion المكوّن من 4 خطوات (Ingestion → Embeddings → Retrieval → Guardrails) |

**Props**: `{ lang? }`.

**أبرز التفاعلات**: `interpolate`, `spring`، يبني عينة إجابة تدريجياً عبر `t(lang, 'ragAnim.sampleAnswer').slice(0, progress)`.

---

## المكوّنات الإدارية للإعدادات

### `ApiKeysView.tsx`

|                |                                                           |
| -------------- | --------------------------------------------------------- |
| الدور          | إدارة مفاتيح API الخاصة بالمستأجر (Authorization: Bearer) |
| الموقع         | `src/components/ApiKeysView.tsx`                          |
| Props          | `{ lang }`                                                |
| أبرز التفاعلات | إنشاء مفتاح، عرض plaintext مرة واحدة، نسخ، إلغاء تفعيل    |

### `IngestionSettingsView.tsx`

|                |                                                                          |
| -------------- | ------------------------------------------------------------------------ |
| الدور          | إعدادات استيعاب المستندات (maxFileSizeMb, pagesPerChunk, chunkingConfig) |
| الموقع         | `src/components/IngestionSettingsView.tsx`                               |
| Props          | `{ lang }`                                                               |
| أبرز التفاعلات | حفظ في `lib/config/ingestionSettings`، إعادة للافتراضي عبر ConfirmDialog |

### `MembersView.tsx`

|                |                                                                 |
| -------------- | --------------------------------------------------------------- |
| الدور          | إدارة الأعضاء والدعوات والفرق (Phase 5)                         |
| الموقع         | `src/components/MembersView.tsx`                                |
| Props          | `{ lang }`                                                      |
| أبرز التفاعلات | دعوة عبر البريد، تغيير دور، حذف عضو، إنشاء فريق، نسخ token دعوة |

### `ModelSettingsView.tsx`

|                |                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| الدور          | سجل ثمانية مفاتيح عمليات AI                                                                            |
| الموقع         | `src/components/ModelSettingsView.tsx`                                                                 |
| Props          | `{ lang }`                                                                                             |
| أبرز التفاعلات | اختيار نماذج من كتالوج `/api/v1/providers`، اختبار مباشر (chat-testable)، حفظ في localStorage + cookie |

### `PlansView.tsx`

|                |                                                                   |
| -------------- | ----------------------------------------------------------------- |
| الدور          | عرض الخطة الحالية والـ quotas وتبديل الخطة                        |
| الموقع         | `src/components/PlansView.tsx`                                    |
| Props          | `{ lang }`                                                        |
| أبرز التفاعلات | TanStack Query، `useMutation` لتبديل الخطة، التحقق من `canManage` |

### `ProvidersView.tsx`

|                |                                                                       |
| -------------- | --------------------------------------------------------------------- |
| الدور          | إعدادات مزودي الذكاء الاصطناعي (مفاتيح + نماذج)                       |
| الموقع         | `src/components/ProvidersView.tsx`                                    |
| Props          | `{ lang }`                                                            |
| أبرز التفاعلات | كتالوج ديناميكي من الخادم، اختبار، اكتشاف نماذج (`supportsDiscovery`) |

### `SsoSettingsView.tsx`

|                |                                                          |
| -------------- | -------------------------------------------------------- |
| الدور          | تكوين OIDC SSO لكل مستأجر                                |
| الموقع         | `src/components/SsoSettingsView.tsx`                     |
| Props          | `{ lang }`                                               |
| أبرز التفاعلات | حفظ issuer/clientId/clientSecret/emailDomain/defaultRole |

### `StorageView.tsx`

|                |                                                              |
| -------------- | ------------------------------------------------------------ |
| الدور          | اختيار خلفية تخزين المتجهات والـ object store                |
| الموقع         | `src/components/StorageView.tsx`                             |
| Props          | `{ lang }`                                                   |
| أبرز التفاعلات | كتالوج ديناميكي، اختيار `vectorStoreId`/`objectStoreId`، حفظ |

### `ApiTester.tsx`

|        |                                |
| ------ | ------------------------------ |
| الدور  | اختبار تفاعلي لواجهات REST     |
| الموقع | `src/components/ApiTester.tsx` |

---

## `src/hooks/`

### `useAsync.ts`

|       |                                            |
| ----- | ------------------------------------------ |
| الدور | غلاف لـ async lifecycle مع AbortController |

**التوقيع**: `useAsync<T>(asyncFn: (signal: AbortSignal) => Promise<T>, deps: DependencyList): { data, isLoading, error, refetch }`.

**أبرز التفاعلات**: ينشئ `AbortController` جديد لكل تغيير في `deps`، يُلغي الطلب السابق عند unmount، يرمي إذا تم abort.

---

### `useDocumentCache.ts`

|       |                                            |
| ----- | ------------------------------------------ |
| الدور | إدارة ذاكرة OCR (localStorage + IndexedDB) |

**التوقيع**: يُرجع `{ cacheEntries, cacheStats, isLoading, isStorageSupported, getCache, saveCache, deleteCache, clearCache, refreshCache }`.

**أبرز التفاعلات**: يستمع لـ `omnirag-ocr-cache-updated` و`storage` events، يحسب `cacheStats` (count, totalHits, savedBytes, savedTokens, totalPages, sizeKb).

---

## انظر أيضاً

- [نظرة عامة على الواجهة](./overview.md)
- [دليل الصفحات](./pages.md)
- [التدويل والتعريب](./i18n.md)
