# مرجع توثيق OmniRAG

مرجع المستخدم والمطور الكامل لمنصة **OmniRAG** — منصة **RAG مؤسسية متعددة المستأجرين** مع تكامل MCP، وبحث هجين (متجهي + معجمي) بدمج RRF، وحماية شاملة متعدد الطبقات. الإصدار الحالي **v0.12.x**.

> يلتزم هذا التوثيق بالكود الفعلي في المستودع. كل صفحة تذكر مسارات الملفات (`src/...`) التي استُقيت منها المعلومات.

---

## 🚀 بداية سريعة

| أنت...                            | ابدأ من هنا                                           |
| --------------------------------- | ----------------------------------------------------- |
| مطور يريد تشغيل المنصة محلياً     | [التثبيت](01-getting-started/installation.md)         |
| مسؤول نشر يحتاج إلى Docker/Vercel | [النشر](01-getting-started/deployment.md)             |
| مهندس DevOps يضبط المتغيرات       | [إعدادات البيئة](01-getting-started/configuration.md) |
| مهندس AI يبني تدفقات RAG          | [محرك RAG](03-rag-engine/pipeline.md)                 |
| مطور يدمج الـ API الخارجي         | [مرجع الـ API](04-api/overview.md)                    |
| مهندس قواعد بيانات/تخزين          | [قاعدة البيانات](05-database/schema.md)               |
| مسؤول أمن يقيّم المنصة            | [الأمان](06-security/overview.md)                     |
| مصمم/مطور واجهة                   | [الواجهة الأمامية](07-frontend/overview.md)           |
| مهندس تكاملات (موصلات/MCP)        | [التكاملات](08-integrations/connectors.md)            |
| مشغّل/مدير عمليات                 | [العمليات](09-operations/background-jobs.md)          |

---

## 📚 فهرس التوثيق الكامل

### [01 — البداية](01-getting-started/)

- [التثبيت والتشغيل محلياً](01-getting-started/installation.md)
- [إعدادات البيئة الكاملة](01-getting-started/configuration.md)
- [النشر (Docker / Vercel / المزودون)](01-getting-started/deployment.md)

### [02 — البنية](02-architecture/)

- [نظرة عامة على البنية](02-architecture/overview.md)
- [شجرة المجلدات الكاملة](02-architecture/directory-structure.md)
- [تدفق البيانات (الاستيعاب والاستعلام)](02-architecture/data-flow.md)

### [03 — محرك RAG](03-rag-engine/)

- [خط أنابيب RAG الكامل](03-rag-engine/pipeline.md)
- [استراتيجيات التجزئة (Chunking)](03-rag-engine/chunking.md)
- [التضمينات (Embeddings)](03-rag-engine/embeddings.md)
- [الاسترجاع الهجين (Retrieval + RRF)](03-rag-engine/retrieval.md)

### [04 — مرجع الـ API](04-api/)

- [نظرة عامة واتفاقيات](04-api/overview.md)
- [المصادقة (Auth + SSO)](04-api/auth.md)
- [المحادثة](04-api/chat.md)
- [المستندات](04-api/documents.md)
- [البحث والمجموعات](04-api/search-collections.md)
- [المصادر والموصلات](04-api/sources.md)
- [الفرق والمشاركة](04-api/teams-sharing.md)
- [مفاتيح API وWebhooks](04-api/api-keys-webhooks.md)
- [MCP](04-api/mcp.md)
- [العمليات والإدارة](04-api/admin-operations.md)

### [05 — قاعدة البيانات والتخزين](05-database/)

- [مخطط قاعدة البيانات الكامل](05-database/schema.md)
- [التهجيرات](05-database/migrations.md)
- [محولات التخزين (كائنات + متجهات + OCR)](05-database/storage-adapters.md)

### [06 — الأمان](06-security/)

- [نظرة عامة على الأمان](06-security/overview.md)
- [المصادقة (Sessions + SSO + API Keys)](06-security/authentication.md)
- [الحمايات (Rate Limit + SSRF + Injection + PII)](06-security/protections.md)

### [07 — الواجهة الأمامية](07-frontend/)

- [نظرة عامة على الواجهة](07-frontend/overview.md)
- [دليل الصفحات للمستخدم](07-frontend/pages.md)
- [مرجع المكونات](07-frontend/components.md)
- [التدويل والتعريب (i18n)](07-frontend/i18n.md)

### [08 — التكاملات](08-integrations/)

- [الموصلات الحية](08-integrations/connectors.md)
- [MCP (سيرفرات/أدوات/OAuth/بحث حي)](08-integrations/mcp.md)
- [مهارات توليد المحتوى](08-integrations/skills.md)
- [محركات استخلاص المستندات](08-integrations/extraction-engines.md)

### [09 — العمليات](09-operations/)

- [المهام الخلفية (pg-boss + Cron)](09-operations/background-jobs.md)
- [التسجيل المنظّم والمراقبة](09-operations/logging.md)
- [الاختبارات](09-operations/testing.md)
- [السكربتات والأدوات](09-operations/scripts-tools.md)
- [استكشاف الأخطاء](09-operations/troubleshooting.md)

### [audit — تقارير المراجعة](audit/)

- [تقرير المراجعة 2026-08-29](audit/2026-08-29-audit-report.md)
- [خطة التحسينات](audit/2026-08-29-improvement-plan.md)

---

## 🧭 خريطة القراءة حسب الدور

### مسار المطور الجديد (3 ساعات)

1. [التثبيت](01-getting-started/installation.md) — شغّل المنصة محلياً.
2. [نظرة عامة على البنية](02-architecture/overview.md) — افهم الطبقات.
3. [تدفق البيانات](02-architecture/data-flow.md) — تتبّع الاستيعاب والاستعلام.
4. [محرك RAG](03-rag-engine/pipeline.md) — ادخل إلى جوهر النظام.
5. [مرجع الـ API](04-api/overview.md) — تعرّف على الواجهات.

### مسار مهندس AI (تعمّق في RAG)

1. [خط أنابيب RAG](03-rag-engine/pipeline.md)
2. [التجزئة](03-rag-engine/chunking.md)
3. [التضمينات](03-rag-engine/embeddings.md)
4. [الاسترجاع](03-rag-engine/retrieval.md)
5. [محركات الاستخلاص](08-integrations/extraction-engines.md)

### مسار مهندس الـ Backend / DevOps

1. [قاعدة البيانات](05-database/schema.md)
2. [التهجيرات](05-database/migrations.md)
3. [محولات التخزين](05-database/storage-adapters.md)
4. [الأمان](06-security/overview.md) و [الحمايات](06-security/protections.md)
5. [المهام الخلفية](09-operations/background-jobs.md)
6. [النشر](01-getting-started/deployment.md)
7. [استكشاف الأخطاء](09-operations/troubleshooting.md)

### مسار مدمج الواجهة / Frontend

1. [نظرة عامة على الواجهة](07-frontend/overview.md)
2. [دليل الصفحات](07-frontend/pages.md)
3. [مرجع المكونات](07-frontend/components.md)
4. [i18n والتعريب](07-frontend/i18n.md)

---

## 🛠️ التقنيات الأساسية (Tech Stack)

- **الإطار:** Next.js 16 App Router + React 19 + TypeScript
- **التصميم:** Tailwind CSS v4 + Lucide Icons
- **قواعد البيانات:** PostgreSQL (Drizzle ORM) + Qdrant (بحث متجهي)
- **الذكاء الاصطناعي:** Google Gemini (`@google/genai`) كنموذج افتراضي، مع مزودين متعددين عبر `src/lib/ai/registry/*`
- **التضمينات:** Gemini Embeddings مع تطبيع عربي موحد
- **OCR:** Mistral Document AI + Tesseract.js محلي + Unstructured
- **البحث الحي:** Tavily / Serper / Brave (مفاتيح اختيارية)
- **MCP:** `@modelcontextprotocol/sdk` + خادم/عميل داخلي
- **المهام الخلفية:** `pg-boss` + Vercel Cron
- **i18n:** نظام داخلي مع قاموس `ar.ts`/`en.ts`

---

## 📌 مبادئ التوثيق

- **مبنيّ على الكود:** كل صفحة تستشهد بمسارات ملفات (`src/...`) داخل backticks — يمكنك `grep` للتعمّق.
- **عربية فصحى مع مصطلحات إنجليزية:** التقنيات وأسماء الدوال/API بالإنجليزية، والشرح بالعربية.
- **روابط نسبية:** قسم "انظر أيضاً" في كل صفحة يربط بالأقسام ذات الصلة.
- **لا مسارات ثابتة للأسرار:** جميع الأمثلة تستخدم قيم `your_*` فقط.

---

## 🤝 المساهمة في التوثيق

عند تعديل الكود، حدّث الملف المعني في `docs/` ضمن نفس الـ PR. اتبع القالب:

1. H1 عنوان، فقرة تمهيدية من سطر-سطرين.
2. جداول Markdown للتعدادات.
3. مسارات الملفات بصيغة `src/...` داخل backticks.
4. مخططات Mermaid للتدفقات المعمارية.
5. قسم "## انظر أيضاً" في النهاية بروابط نسبية.
