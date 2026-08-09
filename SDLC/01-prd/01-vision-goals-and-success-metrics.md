# Vision, Goals, and Success Metrics

## 1. Product Intent

**OmniRAG** is a hybrid Retrieval-Augmented Generation (RAG) web application delivered as a full enterprise product, bilingual in Arabic and English. It enables users to consolidate their data from heterogeneous sources (direct file uploads, URLs, RSS, YouTube, GitHub/GitLab, Notion, Google Drive, Confluence, Slack, email, external databases, and any REST/GraphQL endpoint), process it through advanced AI pipelines, and query it in natural language with full tenant isolation and strict privacy guarantees.

The product fuses **semantic search** (vector-based via `gemini-embedding-2` stored in Qdrant) and **lexical search** (full-text via Neon Postgres `tsvector` with Arabic + English GIN indexes) into a single hybrid retrieval layer reconciled by Reciprocal Rank Fusion, then exposed through four conversational modes (Private / Hybrid Web+RAG / General / Analysis) and an agentic MCP gateway that connects to 22,000+ external tools.

The product is **not** a demo, a notebook, or a single-tenant prototype. It is positioned as a regulated, enterprise-grade platform with documented support for GDPR, HIPAA, and PCI data-handling expectations, multi-tenant isolation across five layers, and end-to-end observability.

## 2. Problem Statement

| # | Problem | Who suffers | Why current solutions fail |
|---|---|---|---|
| P1 | Organizational knowledge is fragmented across cloud drives, wikis, chat, code repos, and emails; employees waste hours hunting for the right document. | Knowledge workers, support teams, legal & compliance officers. | Standard SaaS search indexes only one silo at a time; cross-source semantic search is unavailable out-of-the-box. |
| P2 | Generic LLM chatbots hallucinate because they have no access to the organization's private corpus, and pure-RAG systems ignore live web context. | Analysts, researchers, executives. | Off-the-shelf chatbots either lack retrieval or lack freshness; building a hybrid system in-house requires months of plumbing. |
| P3 | Existing RAG platforms treat Arabic as a second-class citizen (poor normalization, broken chunking, no RTL-aware UI). | Arabic-speaking enterprises, government entities, MENA-region users. | Most Western RAG products rely on English-optimized tokenizers and FTS indexes; Arabic diacritics, normalization, and mixed-script content degrade quality. |
| P4 | Multi-tenant SaaS RAG platforms leak data across tenants through missing or misconfigured Row-Level Security. | Security & compliance teams. | Public incidents (e.g., misconfigured vector DBs exposing cross-tenant embeddings) show that ad-hoc isolation is insufficient. |
| P5 | Enterprises cannot extend their AI assistants to act in external systems (create Jira tickets, send emails, update Notion) safely. | Operations, IT, automation teams. | No standard protocol existed; every integration is bespoke. MCP 2026-07-28 now standardizes this, but most products do not yet implement it. |

## 3. Target Users

| Segment | Profile | Primary use case |
|---|---|---|
| **Knowledge Worker (General)** | Non-technical employee who needs to find information fast. | "Where is the latest Q3 forecast?" answered with a citation. |
| **Analyst / Researcher** | Power user who needs cross-source correlation and summaries. | "Compare the contract terms in these 12 vendor PDFs." |
| **Arabic-Speaking Enterprise User** | Government, education, MENA-region private sector. | Native RTL UI, accurate Arabic chunking, cross-lingual search. |
| **Developer / IT Admin** | Technical user integrating OmniRAG into workflows. | API keys, webhooks, MCP server configuration, SDK embedding. |
| **Compliance Officer** | Audits data residency, retention, and access. | Inspect audit log, run data export, enforce retention. |

## 4. Product Goals (Ordered by Priority)

| Priority | Goal | Rationale |
|---|---|---|
| **G1 — Retrieval Quality** | Beat a single-modality baseline by ≥20% nDCG@10 on an internal 500-query bilingual evaluation set covering Arabic, English, and mixed-script content. | Hybrid retrieval is the core differentiator; quality is non-negotiable. |
| **G2 — Tenant Isolation Correctness** | Pass 100% of automated cross-tenant access tests across all data stores (Neon Postgres RLS, Qdrant payload filter, Blob storage prefix, API middleware, MCP tool layer). | A single leak is a catastrophic regulatory event. |
| **G3 — Bilingual Parity** | Achieve ≥95% of English retrieval-quality scores on Arabic content with identical configuration. | Arabic is a first-class requirement, not an add-on. |
| **G4 — Agentic Extensibility** | Ship a working MCP gateway (stateless, RFC 8707 + RFC 9207 compliant) connecting to at least 10 external MCP servers in v1. | The platform must grow through ecosystem, not rewrites. |
| **G5 — Operational Readiness** | All critical user paths covered by both deterministic tests (unit/integration/E2E) and rubric-based evals (LM-judge for response quality, citation faithfulness, Arabic fluency). | Treat evals as a first-class contract per the SDLC framework. |
| **G6 — Performance & Cost** | p95 chat latency ≤4 seconds end-to-end (excluding LLM) for hybrid-mode queries against a 10k-chunk tenant corpus; smart model routing reduces blended inference cost by ≥40% vs. always-using-flash. | Enterprise SLAs and unit economics. |
| **G7 — Compliance Posture** | Document and implement GDPR data export and account deletion endpoints, retention controls, and an immutable audit log covering all read/write operations on user data. | Regulatory gate; HIPAA/PCI posture even for non-regulated customers. |

## 5. Non-Goals (Out of Scope for v1)

To prevent scope creep that AI coding agents typically absorb uncritically:

- ❌ Training or fine-tuning foundation models.
- ❌ On-premises / air-gapped deployment (v1 is Vercel-hosted only).
- ❌ Building a general-purpose web crawler (use Firecrawl MCP or similar).
- ❌ Mobile native apps (web-responsive only).
- ❌ Multi-region data residency (single primary region in v1).
- ❌ A marketplace for third-party MCP servers (catalog browsing only).

## 6. Success Metrics & Measurement Plan

Metrics are split into **product KPIs** (business-facing), **system SLOs** (engineering-facing), and **quality evals** (AI-behavior-facing). All three must be instrumented before launch.

### 6.1 Product KPIs

| KPI | Target (v1 launch → 90 days) | Measurement |
|---|---|---|
| Weekly Active Tenants (WAT) | 500 → 5,000 | Telemetry on authenticated sessions. |
| Queries per WAU per week | ≥15 | Aggregate `mcp_tool_calls` + `messages` per tenant. |
| 7-day retention | ≥40% | Cohort analysis in analytics dashboard. |
| Documents ingested per tenant (median) | ≥50 | `documents` table aggregated. |
| MCP servers connected per tenant (median) | ≥3 | `mcp_server_configs` where `is_active=true`. |
| Net Promoter Score (NPS) | ≥40 | In-app quarterly survey. |
| Free → Paid conversion | ≥4% | Billing events. |

### 6.2 System SLOs

| SLO | Target | Error budget |
|---|---|---|
| API availability (monthly) | ≥99.5% | ≤3.6 hours downtime/month. |
| Ingestion success rate | ≥98% of uploaded files reach `status='indexed'` | Failures triaged within 24h. |
| p50 chat latency (private mode) | ≤1.5s excluding LLM generation | — |
| p95 chat latency (hybrid + web mode) | ≤6s end-to-end | — |
| Cross-tenant leakage incidents | 0 | Hard stop; CI gate must pass. |
| Audit-log completeness | 100% of mutating operations recorded | Weekly reconciliation job. |

### 6.3 Quality Evals (LM-Judge Rubrics)

Evals are the contract for non-deterministic AI behavior. The following rubric suite runs nightly against a held-out bilingual eval set and gates releases:

| Eval name | What it measures | Pass threshold | Judge |
|---|---|---|---|
| `retrieval_relevance` | Are the top-K retrieved chunks actually relevant to the query? | nDCG@10 ≥ 0.80 (EN), ≥ 0.75 (AR) | Automated metric against labeled set. |
| `citation_faithfulness` | Does every claim in the answer trace to a cited chunk? | ≥95% of claims supported | LM-judge with strict rubric. |
| `arabic_fluency` | Is the Arabic output grammatically correct and idiomatic? | ≥4/5 on 100-sample panel | LM-judge + 3 human raters sample. |
| `hallucination_rate_private_mode` | Does Private mode ever fabricate outside retrieved context? | ≤2% | LM-judge on adversarial set. |
| `hybrid_web_disclosure` | Does Hybrid mode clearly separate local vs. web sources? | 100% of web-sourced claims marked | Regex + LM-judge. |
| `mcp_tool_correctness` | Does the agent pick the right MCP tool for the right sub-task? | ≥90% on a 50-scenario agent benchmark | LM-judge + trace inspection. |
| `side_effect_safety` | Does the agent request confirmation before destructive actions? | 100% | Deterministic test (must always ask). |

## 7. Acceptance Criteria for This Section

A reviewer can sign off this section only when all of the following are true:

- [ ] Every KPI has a defined measurement source (table, event, or job).
- [ ] Every SLO has an associated error-budget policy and on-call owner (named later).
- [ ] Every eval rubric has a documented judge prompt and a held-out dataset location.
- [ ] Non-goals are explicit so future AI agents cannot quietly expand scope.
- [ ] Compliance requirements (GDPR / HIPAA / PCI) are reflected in at least one KPI or SLO.
- [ ] The bilingual parity goal (G3) is verifiable by an eval, not just a claim.

## 8. Open Strategic Questions (Flagged for Human Decision)

These are decisions that AI coding agents must **not** make unilaterally. They are tracked here and resolved before the requirements are frozen.

| # | Question | Options | Decision needed by |
|---|---|---|---|
| Q1 | Pricing tiers — do we meter by tokens, documents, queries, or seats? | (a) Per-query, (b) Per-document, (c) Per-seat + usage overage | Before pricing page ships |
| Q2 | Default embedding model — `gemini-embedding-2` confirmed, but fallback if quota exceeded? | (a) Voyage AI, (b) Cohere multilingual, (c) Self-hosted `bge-m3` | Before production launch |
| Q3 | Data residency for GDPR — single EU region or per-tenant pinning? | (a) EU-only at launch, (b) US + EU choice, (c) Multi-region from day 1 | Before enterprise sales start |
| Q4 | MCP side-effect policy default — always confirm, or per-server configurable? | (a) Always confirm, (b) Per-server allow-list, (c) Per-tenant policy | Before MCP GA |
| Q5 | Free-tier quota shape — soft rate limit vs. hard cutoff? | (a) Soft throttle, (b) Hard 429, (c) Feature-gated | Before public launch |

## 9. Traceability Forward-Look

| Element in this section | Consumed by |
|---|---|
| Personas (Section 5) | → [Personas, Scope, and User Stories](./02-personas-scope-and-user-stories.md) |
| Goals G1–G7 | → Becomes test/eval references in [Requirements, Edge Cases, and Open Questions](./03-requirements-edge-cases-and-open-questions.md) |
| KPIs & SLOs | → Become observability dashboard requirements |
| Open Questions Q1–Q5 | → Become blocking decisions before freezing [Requirements, Edge Cases, and Open Questions](./03-requirements-edge-cases-and-open-questions.md) |

> **Handoff note for downstream sections:** Treat the goals (G1–G7) and quality evals as non-negotiable acceptance bars. Every user story in [Section 02](./02-personas-scope-and-user-stories.md) must trace to at least one goal, and every functional requirement in [Section 03](./03-requirements-edge-cases-and-open-questions.md) must be covered by either a deterministic test or a rubric-based eval.