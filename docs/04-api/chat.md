# الدردشة الذكية والمحادثات (Chat & Conversations)

مجموعة مسارات `/api/v1/chat/*` و `/api/v1/conversations/*` تقدّم:

- **chat/completions**: استجابة موحّدة (OpenAI-compatible JSON) مع حلقة أدوات.
- **chat/stream**: تدفق AI-SDK UI-message-stream (SSE) لاستهلاك `useChat` على الواجهة.
- **conversations**: CRUD للمحادثات + حفظ الرسائل.

## الفهرس

| المسار                     | الطريقة             | الوصف                    |
| -------------------------- | ------------------- | ------------------------ |
| `/api/v1/chat/completions` | POST                | إجابة موحّدة (JSON)      |
| `/api/v1/chat/stream`      | POST                | تدفق أجزاء الرسالة (SSE) |
| `/api/v1/conversations`    | GET / POST / DELETE | CRUD للمحادثات           |

---

## POST `/api/v1/chat/completions`

**المسار**: `src/app/api/v1/chat/completions/route.ts`

إجابة RAG وكيل (agentic) موحّدة لمرة واحدة. الأنبوب:

1. `guardPermission('chat:use')` — RBAC.
2. Hook `pre_auth` — فحص السياق.
3. Hook `pre_inference` — فحص حقن الموجه (Prompt Injection Defense) ووضع المحادثة.
4. `performHybridSearch` — استرجاع قطع دلالية (auto-rerank في وضع `analysis`).
5. Hook `pre_generation` — فحص حقن غير مباشر في القطع المسترجعة.
6. `generateRagCompletion` — توليد مع ذاكرة المحادثة + تنفيذ أدوات MCP.
7. Hook `post_inference` — PII redaction + citation verification.

### المصادقة

- cookie session أو Bearer API key.
- يتطلب صلاحية `chat:use`.

### جسم الطلب

```json
{
  "prompt": "ما هي أهم نقاط الفهرسة الدلالية؟",
  "mode": "hybrid", // hybrid | analysis | …
  "collectionIds": ["col-…"], // اختياري
  "modelOverride": "gemini-2.5-flash", // اختياري
  "approvedToolCall": {
    // استدعاء أداة بانتظار موافقة بشرية
    "scopedToolName": "send_email",
    "inputParams": { "to": "…", "subject": "…" },
    "conversationId": "conv-…"
  },
  "conversationId": "conv-…",
  "conversationHistory": [
    // اختياري؛ إن غاب يُجلب من DB
    { "role": "user", "content": "…" },
    { "role": "assistant", "content": "…" }
  ],
  "rerank": true, // افتراضياً true في analysis mode
  "generateSuggestions": true // 3 أسئلة متابعة سياقية
}
```

### الاستجابة (200)

```json
{
  "text": "إجابة النموذج (مع تطبيق PII redaction)",
  "citations": [
    { "id": "doc-…:chunk-3", "documentTitle": "…", "pageNumber": 12 }
  ],
  "modelUsed": "gemini-2.5-flash",
  "tokensUsed": { "input": 1240, "output": 380 },
  "chunksRetrieved": 6,
  "latencyMs": 1420,
  "pendingToolCall": null,
  "toolCalls": [
    {
      "id": "tc-…",
      "scopedToolName": "send_email",
      "inputParams": { … },
      "outputResult": { "ok": true },
      "status": "completed",
      "hasSideEffect": true,
      "latencyMs": 320,
      "timestamp": "2026-…"
    }
  ],
  "suggestions": ["…", "…", "…"]
}
```

### الأخطاء

| الحالة | الرمز                | السبب                         |
| ------ | -------------------- | ----------------------------- |
| 400    | `400_MISSING_PROMPT` | prompt مفقود                  |
| 400    | (hook code)          | prompt injection / mode guard |
| 500    | `500_INTERNAL_ERROR` | خطأ معالجة                    |

### مثال curl

```bash
curl -X POST http://localhost:3000/api/v1/chat/completions \
  -H "Authorization: Bearer omnirag_live_…" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "لخص نقاط الأمان في OAuth",
    "mode": "hybrid",
    "collectionIds": ["col-security"]
  }'
```

---

## POST `/api/v1/chat/stream`

**المسار**: `src/app/api/v1/chat/stream/route.ts`

تدفق أجزاء الرسالة (SSE) عبر بروتوكول **AI SDK UI-message-stream** (المستهلك في الواجهة عبر `useChat` من `@ai-sdk/react`). يدعم:

- `text-start` / `text-delta` / `text-end` — تدفق النص.
- `data-citations` — الاستشهادات.
- `data-tool-calls` — الأدوات المُنفّذة آلياً.
- `data-pending-tool` — أداة تنتظر موافقة بشرية (side-effect).
- `data-suggestions` — 3 أسئلة متابعة.
- `data-blocked` — حظر من درع الأمان.
- `data-meta` — البيانات الوصفية (modelUsed, tokensUsed).
- `error` — خطأ في التدفق (يُرسَل داخل البروتوكول).

### المصادقة

- cookie session أو Bearer API key. صلاحية `chat:use`.

### جسم الطلب

```json
{
  "prompt": "اشرح K-means clustering",
  "mode": "hybrid",
  "collectionIds": ["col-ml"],
  "model": "gemini-2.5-flash",          // اختياري (يتفوق على x-ai-model-config)
  "approvedToolCall": { … },            // لاستئناف بعد موافقة بشرية
  "conversationId": "conv-…",
  "messages": [                         // AI SDK UseChatRequest body
    { "id": "…", "role": "user", "parts": [{ "type": "text", "text": "…" }] }
  ]
}
```

### ترويسة إضافية

| الترويسة            | الغرض                              |
| ------------------- | ---------------------------------- |
| `x-ai-model-config` | JSON يحتوي `chatStreamModel` كبديل |

### نموذج استجابة (SSE)

```
data: {"type":"data-citations","data":[{"id":"doc-…","pageNumber":4}]}

data: {"type":"text-start","id":"txt"}

data: {"type":"text-delta","id":"txt","delta":"K-means هي خوارزمية تجميع …"}

data: {"type":"text-end","id":"txt"}

data: {"type":"data-suggestions","data":["…","…","…"]}

data: {"type":"data-meta","data":{"modelUsed":"gemini-2.5-flash","tokensUsed":{"input":220,"output":140},"configured":true}}
```

### سمات متقدمة

- **سلسلة fallback**: `buildFallbackChain` تكرر على `[modelAlias, ...getFallbackModels()]`، تتخطى النماذج غير المهيأة عبر `isModelRefConfigured`. عند فشل أول نموذج قبل بث أي حرف، ينتقل للبديل (يحل مشكلة "high demand" على Gemini free-tier).
- **PII Stream Redactor**: كل text-delta يمر عبر `createPIIStreamRedactor()` قبل الإرسال.
- **حصة الرموز الشهرية**: عند تجاوزها تُرجع `429` بدلاً من التدفق مع `{ code: '429_TOKEN_BUDGET_EXHAUSTED', budget: { used, limit } }`.
- **حد المهلة**: `GENERATION_TIMEOUT_MS` = 55000 على Vercel (تحت سقف Hobby 60s)، 300000 على self-hosted. قابل للتجاوز عبر env `CHAT_GENERATION_TIMEOUT_MS`.
- **hooks pre_auth / pre_inference / pre_generation**: إذا منعت الطلب، يُبث `data-blocked` + `text-delta` يحتوي رسالة الحظر بدلاً من رفض HTTP.

### مثال curl (مع `curl --no-buffer`)

```bash
curl -N -X POST http://localhost:3000/api/v1/chat/stream \
  -H "Authorization: Bearer omnirag_live_…" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "ما هي خوارزمية RAG الهجين؟",
    "mode": "hybrid",
    "messages": []
  }'
```

---

## GET / POST / DELETE `/api/v1/conversations`

**المسار**: `src/app/api/v1/conversations/route.ts`

### GET

بدون معاملات: قائمة محادثات المستأجر.
مع `?conversationId=…`: تفاصيل محادثة + رسائلها.

```json
// بدون معاملات
{ "conversations": [ { "id": "conv-…", "title": "…", "mode": "hybrid", … } ] }

// مع ?conversationId=…
{
  "conversation": { "id": "conv-…", "title": "…", "mode": "analysis", … },
  "messages": [ { "id": "msg-…", "role": "assistant", "content": "…", "createdAt": "…" } ]
}
```

### POST — نموذج action-based

```json
{
  "action": "create | save_message | rename | delete",
  // create
  "id": "conv-optional-id",
  "title": "محادثة جديدة",
  "mode": "hybrid",
  "model": "gemini-2.5-flash",
  "collectionIds": ["col-…"],
  "enabledMcpServers": ["mcp-slack"],
  "welcomeText": "مرحباً…",
  // save_message
  "message": {
    "role": "user",
    "content": "…",
    "conversationId": "conv-…"
    // tenantId, id, createdAt تُكتب/تُستبدل من الخادم
  },
  // rename
  "conversationId": "conv-…",
  "title": "عنوان جديد",
  // delete
  "conversationId": "conv-…"
}
```

#### الأذونات حسب الإجراء

| الإجراء                  | الصلاحية               |
| ------------------------ | ---------------------- |
| `create`, `save_message` | `chat:use`             |
| `rename`                 | `conversations:write`  |
| `delete`                 | `conversations:delete` |

#### استجابات POST

| الإجراء             | الحالة | جسم الاستجابة                                                           |
| ------------------- | ------ | ----------------------------------------------------------------------- |
| `create`            | 201    | `{ success, conversation, conversations: [...] }`                       |
| `save_message`      | 200    | `{ success, messageId }` (المعرف يُعاد توليده كـ `msg-${randomUUID()}`) |
| `rename` / `delete` | 200    | `{ success, conversations }`                                            |
| غير معروف           | 400    | `{ error: "Invalid action" }`                                           |

#### ملاحظة أمنية (C2)

> `tenantId` و `id` في `save_message` يُكتبان من الخادم (لا يؤخذان من العميل) — هذا يحرس من انتحال tenant عبر الإرسال اليدوي.

### DELETE

يحذف محادثة واحدة (مع رسائلها).

```http
DELETE /api/v1/conversations?id=conv-…
```

يتطلب صلاحية `conversations:delete`.

### مثال curl

```bash
# إنشاء محادثة
curl -X POST http://localhost:3000/api/v1/conversations \
  -H "Authorization: Bearer omnirag_live_…" \
  -H "Content-Type: application/json" \
  -d '{ "action":"create","title":"تجربة","mode":"hybrid" }'

# حفظ رسالة
curl -X POST http://localhost:3000/api/v1/conversations \
  -H "Authorization: Bearer omnirag_live_…" \
  -H "Content-Type: application/json" \
  -d '{ "action":"save_message","message":{ "role":"user","content":"مرحبا","conversationId":"conv-…" } }'
```

## انظر أيضاً

- [محرك RAG](../03-rag-engine/overview.md)
- [الإعدادات والبحث](./search-collections.md)
- [نظرة عامة على API](./overview.md)
