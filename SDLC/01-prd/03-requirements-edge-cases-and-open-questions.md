# Requirements, Edge Cases, and Open Questions

This section translates the OmniRAG product vision and user stories into a verifiable contract: **functional requirements (FR)**, **non-functional requirements (NFR)**, the **edge cases** AI agents commonly miss (the "80% problem"), and **open questions** that demand human judgment. Every requirement is testable; every edge case is mapped to the system component that must handle it; every open question is flagged for a named decision-maker.

Reference: [Vision, Goals, and Success Metrics](./01-vision-goals-and-success-metrics.md) and [Personas, Scope, and User Stories](./02-personas-scope-and-user-stories.md).

---

## 1. Functional Requirements (FR)

### 1.1 Authentication & Tenant Isolation

| ID | Requirement | Acceptance Criteria | Priority |
|---|---|---|---|
| FR-AUTH-01 | New users receive a unique `tenant_id` (UUID v4) on registration, scoped 1:1 to their account. | Schema test: `users.tenant_id` is `UNIQUE NOT NULL`; integration test confirms one user gets exactly one tenant. | P0 |
| FR-AUTH-02 | Row-Level Security (RLS) is enabled on **every** tenant-scoped table in Neon Postgres. | Static check + integration test that attempts to read another tenant's row via raw SQL returns zero rows. | P0 |
| FR-AUTH-03 | Every API request passes through an Edge Middleware that derives `tenant_id` from the verified JWT and rejects requests missing/invalid claims with HTTP 401. | Contract test: requests without `Authorization` → 401; requests with forged tenant claim → 403; valid JWT → 200. | P0 |
| FR-AUTH-04 | Qdrant searches always include `must: [{ key: "tenant_id", match: { value: <caller_tenant> } }]`. | Integration test: seeded two tenants, search by tenant A returns only tenant A points, never tenant B's. | P0 |
| FR-AUTH-05 | Optional TOTP-based MFA can be enabled per user. | Unit + E2E test: enabling MFA requires scanning a valid QR, future logins require the 6-digit code. | P1 |
| FR-AUTH-06 | OAuth login (Google, GitHub) issues a session consistent with the email-based identity model. | Integration test: OAuth sign-in with a pre-existing email merges into the same `tenant_id`; new email creates a fresh tenant. | P1 |

### 1.2 Document Ingestion Pipeline

| ID | Requirement | Acceptance Criteria | Priority |
|---|---|---|---|
| FR-ING-01 | Accepted file types: PDF, DOCX, DOC, TXT, RTF, ODT, XLSX, CSV, TSV, PPTX, PPT, PNG, JPG, WEBP, MP3, WAV, M4A, MP4, MOV, MD, HTML, JSON, XML, YAML, EPUB. | Validation rejects unsupported MIME types with HTTP 415 and a typed error code. | P0 |
| FR-ING-02 | Max upload size: **100 MB per file**, **1 GB per single ingestion job** (split across chunks). | Boundary tests: 100 MB exactly accepted; 100 MB + 1 byte rejected with `FILE_TOO_LARGE`. | P0 |
| FR-ING-03 | Original file is stored in Vercel Blob under path `/{tenant_id}/sources/{source_id}/{document_id}/{filename}` with server-side encryption at rest. | Storage test: blob listing scoped to a tenant returns only that tenant's files; signed URL expires ≤ 15 min. | P0 |
| FR-ING-04 | Processing engine selection supports `mistral`, `unstructured`, `internal`, and `auto`. In `auto`, PDFs > 50 pages or scanned PDFs (no extractable text layer) route to Mistral; mixed Office types route to Unstructured; plain text/Markdown routes to internal. | Fixture-driven test corpus with at least 10 representative files; routing decisions are logged and assertable. | P0 |
| FR-ING-05 | Chunking honors configurable `chunkSize` (256–2048 tokens), `chunkOverlap` (0–30%), and strategy (`paragraph`, `sentence`, `heading`, `semantic`, `hybrid`). Arabic text is never split mid-sentence. | Unit test on Arabic and English corpora: zero mid-word splits; overlap window is correct; token counts within ±5%. | P0 |
| FR-ING-06 | Each chunk carries metadata: `document_id`, `chunk_index`, `page_number`, `section_title`, `language` (ar/en/mixed), `token_count`, `tenant_id`, `source_type`. | Schema test: every chunk row has all metadata columns non-null where applicable. | P0 |
| FR-ING-07 | Embedding is produced via `gemini-embedding-2` using the task prefix `retrieval_document:` for documents and `retrieval_query:` for queries, with output dimension 3072. | Smoke test: query with no prefix returns lower MRR than the same query with the correct prefix on a labeled eval set. | P0 |
| FR-ING-08 | Ingestion runs asynchronously via Inngest/Trigger.dev; the UI shows real-time status (`pending`, `processing`, `indexed`, `failed`) via SSE or polling. | E2E test: uploading a file shows status transitions and a final indexed state within SLA. | P0 |
| FR-ING-09 | Failed ingestion persists a structured error (`code`, `message`, `stage`, `retryable`) and allows up to 3 automatic retries with exponential backoff for `retryable=true` errors. | Unit test: simulated 502/503 from external API triggers retry; permanent failure surfaces to UI with retry button. | P1 |

### 1.3 Sources & Integrations

| ID | Requirement | Acceptance Criteria | Priority |
|---|---|---|---|
| FR-SRC-01 | Supported sources include: file upload, URL/Sitemap crawl, RSS/Atom, YouTube transcript, GitHub/GitLab, Notion, Google Drive, Confluence, Slack/Discord, IMAP/Gmail, external PostgreSQL/MySQL/MongoDB, custom REST/GraphQL API. | Catalog endpoint `/api/v1/sources/types` lists all supported types with their schema. | P0 |
| FR-SRC-02 | Sync schedules accept cron expressions with hourly/daily/weekly presets. A scheduler worker triggers syncs and records `last_synced_at` and `next_sync_at`. | Unit test: invalid cron rejected; valid cron scheduled correctly; manual "sync now" overrides the schedule. | P1 |
| FR-SRC-03 | Source Health Monitor pings each source at most once per 5 minutes and surfaces status (`healthy`, `degraded`, `down`). | Background job test: simulated 5xx triggers `down` within 10 min; UI badge updates via SSE. | P1 |
| FR-SRC-04 | Bulk import supports ≥ 100 files per job with a queue-backed worker. | Load test: 100-file job completes within SLA; UI shows per-file progress. | P2 |

### 1.4 Hybrid RAG Query Engine

| ID | Requirement | Acceptance Criteria | Priority |
|---|---|---|---|
| FR-RAG-01 | Every query runs semantic search (Qdrant ANN) and lexical search (Neon Postgres `tsvector` + GIN) **in parallel**, then merges via Reciprocal Rank Fusion (RRF) by default. Configurable fusion: `rrf`, `weighted_sum`, `convex_combination`. | Eval: hybrid retrieval Recall@10 ≥ semantic-only and ≥ lexical-only on a labeled bilingual eval set. | P0 |
| FR-RAG-02 | Query expansion applies HyDE for abstract queries and cross-lingual translation when query language ≠ document language for ≥ 20% of top retrieved results. | Eval: bilingual test set; expansion improves Recall@10 by ≥ 5%. | P1 |
| FR-RAG-03 | Cross-encoder re-ranking is opt-in per query and adds ≤ 500 ms p95. | Benchmark test: reranking latency budget enforced. | P2 |
| FR-RAG-04 | `topK` is clamped to [1, 20]; `scoreThreshold` ∈ [0, 1]; `mmrDiversity` ∈ [0, 1]. Below-threshold results are dropped before generation. | Unit + boundary tests for all input ranges. | P0 |
| FR-RAG-05 | Context assembly truncates to fit the chosen model's context window (`gemini-3.6-flash`: 1M tokens; `gemini-3.5-flash-lite`: 1M tokens) with explicit budget allocation: 70% retrieved, 20% chat history, 10% system prompt. | Unit test: assembled context never exceeds budget; truncation order is documented. | P0 |
| FR-RAG-06 | Citations are emitted with `chunk_id`, `document_id`, `page_number`, `score`, and a snippet; rendered as clickable links opening the source preview. | Integration test: every generated claim that references retrieved chunks has a matching citation; UI displays them. | P0 |
| FR-RAG-07 | Confidence score is computed and exposed per message (0.0–1.0); threshold for low-confidence warnings is user-configurable. | Eval: confidence calibration correlates with retrieval overlap (Spearman ≥ 0.4 on labeled set). | P1 |

### 1.5 Chat Modes

| Mode | Description | Required Behavior | Priority |
|---|---|---|---|
| **Private RAG** | Answer strictly from user's data. | If retrieved context is empty, response states "لا توجد معلومات في بياناتك" / "No information found in your data" — **no web fallback, no model invention**. | P0 |
| **Hybrid (Private + Web)** | Local retrieval + live web. | Web results clearly tagged 🌐; private results tagged 📁; `privateDataPriority` toggle reorders by user preference. | P0 |
| **General Chat** | Pure model conversation. | No retrieval executed; no citations; tokens counted but not stored against documents. | P0 |
| **Analysis Mode** | Deep dive on selected collections. | Loads all chunks from selected `collection_ids`, applies a multi-pass reasoning template, returns structured findings + sources. | P1 |
| **Agentic Mode** | Model invokes tools (RAG + MCP). | Enforces `agentMaxIterations` (1–10); refuses tool calls that fail capability check. | P0 |

### 1.6 MCP Layer

| ID | Requirement | Acceptance Criteria | Priority |
|---|---|---|---|
| FR-MCP-01 | The MCP Gateway implements the **MCP 2026-07-28 stateless protocol** over Streamable HTTP, using `@modelcontextprotocol/server` v2. | Contract test against the official reference client; no session ID round-trip required. | P0 |
| FR-MCP-02 | Every MCP tool input schema includes `tenant_id: z.string().uuid()` as the **first** parameter; the gateway injects it from the verified JWT before forwarding. | Static lint + runtime test: any tool invocation missing `tenant_id` is rejected with HTTP 400. | P0 |
| FR-MCP-03 | OAuth 2.0 flows for external MCP servers implement **RFC 8707 Resource Indicators** and **RFC 9207 `iss` validation**; PKCE is mandatory. | Integration test: token replay across resources is rejected; missing `iss` is rejected. | P0 |
| FR-MCP-04 | Tools with declared side effects (`⚠️ [SIDE EFFECT]`) require an explicit user confirmation step; the agent may batch confirmation requests in a single UI modal but must not execute before approval. | E2E test: agent proposes `slack_send_message`; UI shows confirmation; cancel → no call to Slack API. | P0 |
| FR-MCP-05 | Every tool call is logged to `mcp_tool_calls` with `tenant_id`, `server_config_id`, `tool_name`, `scoped_tool_name`, `input_params`, `output_result`, `latency_ms`, `status`, `has_side_effect`, `user_confirmed`. | Audit log query returns ≥ 1 row per executed call. | P0 |
| FR-MCP-06 | The MCP Client Pool maintains a per-`(server_id, tenant_id)` cache with TTL ≤ 60 s; stale entries are evicted lazily. | Load test: 1000 concurrent calls use ≤ 50 distinct client objects per tenant. | P1 |
| FR-MCP-07 | Rate limits per server config: `max_calls_per_minute` (default 60) and `max_calls_per_day` (default 10,000) are enforced at the gateway; over-limit calls return HTTP 429 with `Retry-After`. | Unit test against a stubbed counter. | P0 |

### 1.7 Analytics, API, Settings

| ID | Requirement | Acceptance Criteria | Priority |
|---|---|---|---|
| FR-OBS-01 | Latency is measured per pipeline stage (parse, embed, retrieve, rerank, generate) and exposed in `/analytics/latency`. | Dashboard renders p50/p95/p99 per stage for the last 24 h / 7 d / 30 d windows. | P1 |
| FR-OBS-02 | Cost tracker records token usage per model and per call, priced against an internal rate table. | Dashboard totals reconcile with raw `messages.tokens_used` sums. | P1 |
| FR-OBS-03 | API Keys are scoped (`read`, `write`, `admin`); each request is authenticated against the key's scopes. | Integration test: a `read`-only key cannot `POST /api/v1/chat/completions`. | P0 |
| FR-OBS-04 | Webhooks are signed with HMAC-SHA256; receivers verify `X-OmniRAG-Signature` header. | External test endpoint returns 200 only on valid signature. | P1 |
| FR-OBS-05 | Embed widget exposes `/embed.js` that can be included in third-party sites with a tenant-specific public key. | Sandbox page loads widget, sends a chat, receives streaming response. | P2 |
| FR-SET-01 | User data export (GDPR Art. 20) packages all `tenant_id`-owned rows + blobs into a downloadable ZIP ≤ 24 h. | Integration test: export contains all expected tables and files. | P0 |
| FR-SET-02 | Account deletion (GDPR Art. 17) soft-deletes immediately and hard-deletes within 30 days; backed up data purged within 90 days. | Background job test: rows are gone after the 30-day mark; blobs gone after 90 days. | P0 |

---

## 2. Non-Functional Requirements (NFR)

| ID | Category | Requirement | Acceptance Criteria |
|---|---|---|---|
| NFR-PERF-01 | Latency | Streaming first-token p95 ≤ 1.5 s for `gemini-3.5-flash-lite`, ≤ 2.5 s for `gemini-3.6-flash`, end-to-end p95 ≤ 8 s for typical 5-doc retrieval. | Load test with 100 concurrent users. |
| NFR-PERF-02 | Throughput | Support ≥ 500 concurrent chat sessions per region with autoscaling on Vercel. | Synthetic load test passes without 5xx errors. |
| NFR-PERF-03 | Scalability | Document corpus per tenant must scale to ≥ 1M chunks without query degradation. | Benchmark: Recall@10 within 2% of baseline at 1M chunks. |
| NFR-AVAIL-01 | Uptime | 99.9% monthly availability for chat and ingestion APIs (≤ 43 min downtime/month). | Monitored via uptime checks. |
| NFR-SEC-01 | Transport | All traffic over HTTPS/TLS 1.3; HSTS enabled with `max-age=63072000`. | Header inspection test. |
| NFR-SEC-02 | Encryption at rest | AES-256 for blobs; column-level encryption for `credentials_encrypted` and `access_token_encrypted`. | Encryption verified via DB inspection. |
| NFR-SEC-03 | Secrets management | All third-party keys stored in a vault (Vercel KV + AES-256 envelope) — never in env vars exposed to the browser. | Codebase scan + runtime check. |
| NFR-SEC-04 | Prompt injection | A defensive system prompt + output validation layer rejects any assistant output containing untrusted tool payloads rendered back as instructions. | Red-team test corpus of 50 injection attempts. |
| NFR-SEC-05 | PII redaction | Logs strip emails, phones, and access tokens before persistence. | Log audit test. |
| NFR-COMP-01 | GDPR | Right to access (FR-SET-01), right to erasure (FR-SET-02), right to portability, and data processing agreements with all sub-processors documented. | Compliance checklist + DPA list in `/legal/dpa`. |
| NFR-COMP-02 | HIPAA-eligible design | For tenants who opt in, enforce BAA-covered sub-processors, audit log retention ≥ 6 years, no use of training data opt-in from sub-processors. | Configuration flag + vendor list. |
| NFR-COMP-03 | PCI scope minimization | Card data never touches OmniRAG servers; subscriptions handled by Stripe Checkout (hosted). | PCI scope review confirms SAQ-A. |
| NFR-I18N-01 | RTL | Full RTL support: layout flips, icons mirror where appropriate, bidi text in mixed content renders correctly. | Visual regression suite for AR and EN. |
| NFR-I18N-02 | Arabic normalization | Optional diacritic stripping, alef/yaa normalization, and digit unification applied per user setting; original text preserved alongside normalized form. | Unit test corpus of Arabic strings. |
| NFR-OBS-01 | Observability | Structured JSON logs, OpenTelemetry traces, and metrics (Prometheus-compatible) emitted from every service. | OTel collector receives traces end-to-end. |
| NFR-OBS-02 | Eval harness | Offline evals (Recall@K, MRR, NDCG, answer faithfulness via LM judge) run nightly against a frozen labeled set; regression alert fires on > 3% drop. | CI pipeline green; alert tested with synthetic regression. |
| NFR-A11Y-01 | Accessibility | WCAG 2.2 AA conformance across all pages; keyboard navigation, screen-reader labels, contrast ratios ≥ 4.5:1. | Automated Lighthouse + manual NVDA test. |

---

## 3. Edge Cases — The 80% Problem

These are the cases AI coding agents routinely miss. Each is mapped to a concrete component and verification step.

### 3.1 Ingestion Edge Cases

| ID | Edge Case | Why Agents Miss It | Required Handling | Verification |
|---|---|---|---|---|
| EC-ING-01 | Empty or zero-byte file upload | Looks like a valid request | Reject with `EMPTY_FILE`; do not enqueue ingestion. | API test with 0-byte file. |
| EC-ING-02 | PDF with mixed orientations / RTL pages | OCR pipelines assume LTR | Pass orientation hint to Mistral; chunking respects page boundaries. | Fixture with mixed-orientation PDF. |
| EC-ING-03 | Scanned PDF with no embedded text | Treated as empty text | Detect zero-extractable-text fallback to Mistral OCR; verify chunks produced. | Fixture of scanned PDF. |
| EC-ING-04 | Password-protected PDF | Crashes the parser | Detect password requirement → return `PASSWORD_REQUIRED` with recovery UI; do not crash worker. | Unit test with `pypdf` rejected + UI surface. |
| EC-ING-05 | Excel with merged cells / hidden sheets | Loses structure | Flatten with sheet/cell metadata; preserve merged-cell context in chunk metadata. | Fixture + chunk inspection. |
| EC-ING-06 | CSV with mixed encodings (UTF-8, CP1256, Shift-JIS) | Mojibake | Auto-detect with chardet; normalize to UTF-8. | Fixture set of 3 encodings. |
| EC-ING-07 | Audio/video with no transcript available | Whisper fallback needed | Pipeline routes through `gemini-3.5-flash-lite` for ASR; if unavailable, mark `failed` with `TRANSCRIPTION_UNAVAILABLE`. | Integration test. |
| EC-ING-08 | Duplicate upload (same SHA-256) | Stored twice | Detect via hash → return existing `document_id` with 200 (not 201). | Unit test. |
| EC-ING-09 | File replaced with different content but same name | Versioning ambiguity | Each upload creates a new `document_id`; the source's `current_document_id` is updated atomically. | Integration test. |
| EC-ING-10 | Chunk whose `token_count` exceeds the embedding model's input limit | Truncation loses meaning | Split recursively; never silently truncate. | Boundary test at 8192-token input. |
| EC-ING-11 | Arabic text containing Quranic verses / diacritics | Stripping destroys meaning | Default to preserving diacritics; opt-in user setting to strip. | Fixture with diacritized text. |
| EC-ING-12 | Source URL returns 200 but with paywall / JS-rendered content | Garbage in retrieval | Detect via content heuristic; fall back to Firecrawl MCP if available; otherwise flag `LOW_QUALITY_INGEST`. | Fixture set. |
| EC-ING-13 | GitHub repo exceeds rate limit (60/hr unauthenticated) | Job fails silently | Use GitHub App token; respect `Retry-After`; circuit-break per repo. | Unit test with mocked 403. |
| EC-ING-14 | Notion page deleted between sync runs | Dangling foreign keys | Soft-delete document; mark `source_id` stale. | Integration test. |
| EC-ING-15 | Email with huge inline images (10 MB each) | Memory exhaustion | Stream-parse with size cap; extract and re-host large images. | Load test. |

### 3.2 Retrieval & RAG Edge Cases

| ID | Edge Case | Why Agents Miss It | Required Handling | Verification |
|---|---|---|---|---|
| EC-RAG-01 | Query in language absent from corpus | Forces the model to hallucinate | Detect language mismatch → warn user; refuse to fabricate. | Eval: zero-hallucination assertion. |
| EC-RAG-02 | Query referencing a deleted document | Citation points nowhere | Citations are validated at generation time; invalid citations dropped with audit log. | Unit test. |
| EC-RAG-03 | User asks for code but retrieval returns only prose | Wrong chunk type | Chunk `metadata.kind` (`code`, `table`, `prose`) boosts ranking via cross-encoder. | Eval on code corpus. |
| EC-RAG-04 | Two semantically similar documents with contradicting facts | Model picks arbitrarily | Surface both, label conflict, ask clarifying question. | Eval set with contradictions. |
| EC-RAG-05 | Retrieval returns 0 chunks above threshold | Empty context injected | In Private RAG mode, return explicit "no info" — never invent. | Integration test. |
| EC-RAG-06 | Query is a PII string (email, IBAN) | Logged to observability | Detect + redact before logging; never embed in trace. | Log audit test. |
| EC-RAG-07 | Long conversation history pushes context over budget | Truncation loses user intent | Use rolling summary after 20 messages; preserve last 6 verbatim. | Unit test with 50-message history. |
| EC-RAG-08 | Streaming client disconnects mid-response | Wasted tokens + worker leak | Detect via heartbeat; cancel upstream call within 2 s. | Load test. |
| EC-RAG-09 | Same query issued 100× in 1 s (abuse or retry storm) | Cost spike | Edge-level rate limit per `tenant_id` per route (e.g., 60 chat/min). | Load test. |
| EC-RAG-10 | Vector dimension mismatch after model upgrade | Silent retrieval failure | Migration check on deploy; alert if Qdrant points have wrong dim. | Deploy test. |

### 3.3 MCP Edge Cases

| ID | Edge Case | Why Agents Miss It | Required Handling | Verification |
|---|---|---|---|---|
| EC-MCP-01 | MCP server returns 1MB response | Buffer exhaustion | Stream + cap response size at 1 MB; truncate with warning otherwise. | Unit test with mocked oversized payload. |
| EC-MCP-02 | MCP server hangs indefinitely | Worker starvation | Hard timeout (configurable, default 30 s); mark call `timeout`. | Integration test with slow stub. |
| EC-MCP-03 | Tool returns `isError: true` mid-agent-loop | Agent loops forever | Step budget enforced (≤ `agentMaxIterations`); record failure reason. | E2E test with stub that always errors. |
| EC-MCP-04 | OAuth refresh token revoked | All subsequent calls 401 | Mark token invalid, trigger re-auth flow, notify user. | Integration test. |
| EC-MCP-05 | Two MCP servers expose tools with identical names | Collision | Auto-prefix with `serverId__toolName`; preserve original in tool metadata. | Unit test. |
| EC-MCP-06 | Side-effect tool called twice with same args | Duplicate Slack messages, double emails | Idempotency key (`{conversation_id}:{tool_call_index}`) checked before execution. | Unit test. |
| EC-MCP-07 | User denies confirmation but agent retries next turn | Annoying UX | Track "denied in this session" set per tool; refuse within session. | E2E test. |
| EC-MCP-08 | Tool output contains prompt-injection | Tool hijacks the model | Output scanned against injection patterns; high-risk content wrapped in `<untrusted_tool_output>` tags. | Red-team test corpus. |
| EC-MCP-09 | MCP server upgrade changes tool schema | Old tool calls fail | Schema version captured at registration time; mismatches surfaced in UI. | Integration test. |
| EC-MCP-10 | Cache poisoning across tenants in client pool | Cross-tenant data leak | Cache key is `(server_id, tenant_id)`; verified by integration test. | Already covered by FR-AUTH-04 + pool tests. |

### 3.4 Auth, Multi-tenancy, and Compliance Edge Cases

| ID | Edge Case | Why Agents Miss It | Required Handling | Verification |
|---|---|---|---|---|
| EC-AUTH-01 | User logs in on second device, first session still active | Stale tokens | Token rotation on new login; configurable max concurrent sessions. | Integration test. |
| EC-AUTH-02 | JWT expires mid-stream (SSE) | Half-rendered response | Client refreshes before expiry; server emits a final SSE `reauth_required` event. | E2E test with clock skew. |
| EC-AUTH-03 | Tenant deletion request during active ingestion | Orphaned chunks | Soft-delete tenant; worker checks `is_deleted` flag before each step. | Integration test. |
| EC-AUTH-04 | A tenant's data is subpoenaed | Need cryptographic isolation | Per-tenant data encryption keys (KMS-backed); key destruction on hard delete. | Compliance audit. |
| EC-AUTH-05 | Cross-region replication of Postgres | Tenant A's data appears in region B | Encryption keys are region-bound; replicated rows are doubly encrypted. | Infra test. |

---

## 4. Data Contracts & Invariants

| ID | Invariant | Verification |
|---|---|---|
| DC-01 | Every row in every tenant-scoped table has a non-null `tenant_id`. | SQL constraint + nightly audit query. |
| DC-02 | `chunks.embedding_id` always points to a live Qdrant point with matching `tenant_id` in payload. | Nightly reconciliation script. |
| DC-03 | `messages.citations[*].chunk_id` resolves to a chunk owned by the same `tenant_id` as the message. | Invariant check on insert. |
| DC-04 | `mcp_tool_calls.tenant_id = mcp_server_configs.tenant_id` for every call. | DB-level FK + trigger. |
| DC-05 | `users.email` is unique across the entire system (one human = one tenant). | Unique constraint. |
| DC-06 | `documents.content_hash` (SHA-256) is unique per `tenant_id` to enable deduplication. | Unique index. |

---

## 5. Test & Eval Matrix

| Layer | Test Type | Tooling | Cadence |
|---|---|---|---|
| Unit | Pure functions (chunkers, normalizers, fusion math) | Vitest | Every commit |
| Contract | API schema validation against OpenAPI | Zod + Schemathesis | Every commit |
| Integration | DB + Qdrant + blob interactions | Vitest + testcontainers | Every commit |
| E2E (Playwright) | User flows: register → upload → chat → cite | Playwright | Every PR |
| MCP Conformance | Reference MCP 2026-07-28 client connects successfully | `@modelcontextprotocol/client` | Nightly |
| Retrieval Eval | Recall@K, MRR, NDCG on labeled bilingual set | Custom harness + LM judge | Nightly |
| Faithfulness Eval | LM judge rates groundedness of generated answers | GPT-class judge + rubric | Nightly |
| Red-team Eval | Prompt injection, jailbreak, PII leakage | Internal corpus + external vendor (e.g., Garak) | Weekly |
| Load Test | 500 concurrent chat, 1000 concurrent MCP calls | k6 | Pre-release |
| Security | SAST (Semgrep), DAST (OWASP ZAP), dependency scan | CI pipeline | Every PR |
| Accessibility | axe-core + NVDA manual sweep | Playwright + manual | Pre-release |

**Evals-as-contract:** a > 3% regression on any retrieval or faithfulness metric blocks the release pipeline. Thresholds are codified in `/evals/thresholds.yaml`.

---

## 6. Open Questions — Decisions Awaiting Humans

The following decisions cannot be made by the AI agent alone. Each is flagged with a recommended decision-maker.

| ID | Question | Recommended Decision-Maker | Trade-offs | Default if No Answer |
|---|---|---|---|---|
| OQ-01 | **Pricing model**: per-seat, per-document, per-token, or hybrid? Affects quota UI and Stripe wiring. | Product + Finance | Per-seat simpler; per-token fairer; hybrid maximizes revenue but complicates UX. | Per-seat at $20/mo with 100k-token overage. |
| OQ-02 | **HIPAA enablement**: do we sign BAAs with sub-processors (Neon, Vercel, Mistral, Unstructured, Google) to support HIPAA-eligible tenants? | Legal + Security | Increases vendor cost; excludes some vendors; opens healthcare market. | Disabled by default; documentation states "not HIPAA-eligible". |
| OQ-03 | **Data residency**: single region (US-East) or multi-region (EU, US, MENA)? Affects Neon cluster topology and Qdrant deployment. | Engineering + Compliance | EU residency simplifies GDPR for EU customers; multi-region adds cost. | US-East only at launch; EU added in phase 2. |
| OQ-04 | **Web search provider**: Google CSE, Bing, SearXNG self-hosted, or Tavily? Affects cost, quality, latency. | Engineering | Google: best quality, highest cost. SearXNG: free, lower quality. Tavily: LLM-tuned, mid cost. | Tavily for MVP, pluggable. |
| OQ-05 | **Audio/video transcription**: rely on Gemini multimodal or integrate Deepgram/Whisper? | Engineering | Gemini: simpler pipeline, no extra vendor. Deepgram: better accuracy, lower cost at scale. | Gemini for MVP; benchmark vs. Deepgram at 10k hours. |
| OQ-06 | **OAuth resource server**: implement MCP OAuth ourselves or delegate to a managed IdP (Auth0, Clerk)? | Engineering | Clerk fastest; self-hosted offers more control and lower per-user cost. | Clerk for MVP. |
| OQ-07 | **MCP server marketplace**: ship curated 12 or open registration to the full 22k+ registry? | Product + Security | Curated safer; open registry broader. | Curated list of 12 at launch; opt-in registry later. |
| OQ-08 | **Embedding model fallback**: if `gemini-embedding-2` is deprecated, fallback to `text-embedding-3-large` (OpenAI) or `voyage-3`? | Engineering + Vendor mgmt | OpenAI: mature, paid. Voyage: domain-tuned, paid. Cohere: multilingual, paid. | OpenAI `text-embedding-3-large` with same 3072 dims (truncate). |
| OQ-09 | **Default chunking for Arabic**: preserve diacritics by default? | Linguistics reviewer | Preserving = better for Quranic/literary text; stripping = better for general web data. | Preserve diacritics, user can opt out. |
| OQ-10 | **Right-to-be-forgotten propagation to backups**: hard-delete within 30 days, 90 days, or 180 days? | Legal + Compliance | Shorter = better privacy; longer = cheaper backup retention. | 90 days. |
| OQ-11 | **Agent loop confirmation UX**: confirm each side effect individually, batch in one modal, or auto-approve a user-curated allow-list? | UX + Product | Per-call safest; batch least friction; allow-list balances both. | Batched modal with per-server allow-list toggle. |
| OQ-12 | **Telemetry scope**: full prompt/response capture for debugging, or metadata-only? | Security + Privacy | Full capture accelerates debugging; metadata-only safer. | Metadata-only by default; full capture only when user opts in via support session. |
| OQ-13 | **Localization beyond AR/EN**: which languages next (FR, ES, UR, FA, TR)? | Product + Localization | Larger market vs. support cost. | Defer; infrastructure is i18n-ready. |
| OQ-14 | **Multi-tenant team workspaces**: support sharing documents across users within one tenant? | Product | Adds RBAC complexity; unlocks B2B use cases. | Single-user tenant only at MVP; team workspaces phase 2. |
| OQ-15 | **Self-hosting / on-prem**: ship a Docker Compose bundle for enterprises? | Engineering + Sales | Unlocks regulated markets; doubles support burden. | Not at MVP. |

---

## 7. Out-of-Scope (Explicit Non-Goals for MVP)

To prevent scope creep and clarify what agents should **not** build:

- ❌ Multi-tenant team collaboration (workspaces, member roles).
- ❌ On-premise / self-hosted distribution.
- ❌ Mobile native apps (responsive web only).
- ❌ Voice input/output beyond file transcription.
- ❌ Custom embedding model fine-tuning per tenant.
- ❌ Direct database connections beyond PostgreSQL/MySQL/MongoDB.
- ❌ Native video editing/transcoding (we extract, we don't edit).
- ❌ Federated search across multiple OmniRAG instances.
- ❌ AI-generated dashboards (only retrieval-driven analytics).

---

## 8. Verification Checklist (for AI Agents)

Before declaring any section "done," an agent must confirm:

- [ ] Every FR in this document maps to at least one automated test.
- [ ] Every edge case (EC-*) has a corresponding test fixture or unit test.
- [ ] Every NFR has a measurable threshold and a load/benchmark test.
- [ ] Every open question (OQ-*) is either resolved, defaulted with rationale, or escalated.
- [ ] Every invariant (DC-*) is enforced via DB constraints or scheduled audits.
- [ ] The eval matrix in §5 runs successfully in CI.
- [ ] No requirement references a TODO, placeholder, or "TBD" string.
- [ ] All requirement IDs (`FR-…`, `NFR-…`, `EC-…`, `DC-…`) are stable and referenced from test files.
- [ ] Changes to this document trigger a re-review by the named decision-makers for any affected OQ.
- [ ] This file is linked from `AGENTS.md` and loaded as part of the context bundle for any agent working on the corresponding code area.
- [ ] Every requirement traces back to a user story in [Personas, Scope, and User Stories](./02-personas-scope-and-user-stories.md) or a metric in [Vision, Goals, and Success Metrics](./01-vision-goals-and-success-metrics.md).
- [ ] Every requirement traces forward to at least one task in `04-tasks.md` (next section to be generated).