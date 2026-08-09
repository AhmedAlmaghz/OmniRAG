# Sandbox, Secrets, Supply Chain, and Compliance

> **Section 02 of 06 — Guardrails & Security** · Previous: [Threat Model and Deterministic Hooks](./01-threat-model-and-deterministic-hooks.md)

This section defines the **execution boundaries**, **secret handling contract**, **dependency supply chain policy**, and **compliance controls (GDPR/HIPAA/PCI)** for OmniRAG. It pairs with the deterministic lifecycle hooks specified in the previous section to enforce defense-in-depth at every layer an AI agent can touch.

---

## 1. Agent Execution Sandbox — Layered Permission Boundaries

### 1.1 Sandbox Tiers

Each agent and tool invocation in OmniRAG operates inside one of four sandbox tiers. The tier is resolved **per-request** from `(tenant_id, server_id, tool_name, side_effect_flag)` and enforced both at the MCP Gateway and at the runtime hook level.

| Tier | Name | Network | Filesystem | Process | Tools Allowed | Confirmation |
|---|---|---|---|---|---|---|
| **T0** | `pure-llm` | Outbound only to LLM APIs (Google) | None | None | `generateText`, `streamText` | None |
| **T1** | `read-rag` | Read-only to Neon/Qdrant/Blob (tenant-scoped) | Read-only sandbox `/tmp/sandbox-{nonce}` | None | `knowledge_semantic_search`, `knowledge_lexical_search`, `fetch_url_content` | None |
| **T2** | `write-tenant` | Read/Write to tenant-scoped stores | Read/Write to `/{tenant_id}/*` only | Sandboxed Node/Python subprocess | `knowledge_ingest_document`, `chunk_editor`, `collection_*` | None (audit logged) |
| **T3** | `external-action` | Egress to approved MCP servers + Webhooks | Read/Write to `/{tenant_id}/*` | Same as T2 | `slack_send_message`, `email_send`, `github_create_issue`, `webhook_trigger`, `document_generate_report` | **Mandatory user confirmation** per session |

**Mapping rule** — Every tool in `MCPToolRegistry` must declare its tier at registration time. Tools missing the declaration **fail closed** (rejected by the gateway).

```typescript
// /lib/mcp/sandbox/tier.ts — tool tier declaration
export const TOOL_TIER: Record<string, SandboxTier> = {
  knowledge_semantic_search: 'T1',
  fetch_url_content:         'T1',
  web_live_search:           'T1',
  knowledge_ingest_document: 'T2',
  chunk_editor:              'T2',
  slack_send_message:        'T3', // requires confirmation
  email_send:                'T3',
  github_create_issue:       'T3',
  webhook_trigger:           'T3',
  document_generate_report:  'T3',
};
```

### 1.2 Filesystem & Network Boundaries

| Resource | Boundary | Enforcement |
|---|---|---|
| **Filesystem reads** | `/{tenant_id}/*` only; deny `~/.ssh`, `~/.aws`, `/proc`, `/sys` | `lib/sandbox/fs-guard.ts` chroot check on every `fs.open` |
| **Filesystem writes** | `/{tenant_id}/tmp/{nonce}/*`; max 500 MB; auto-cleanup after 24h | `Vercel Blob` with signed URLs + TTL |
| **Outbound network (LLM)** | `generativelanguage.googleapis.com` only | Egress allowlist in `lib/sandbox/egress.ts` |
| **Outbound network (MCP)** | Approved `server_id`s only from `mcp_server_configs.is_active = true` | Gateway-level DNS pinning + cert pinning |
| **Outbound network (Webhooks)** | Domains in `mcp_approved_webhooks` allowlist | DNS resolution + TLS verification |
| **Process spawn** | Subprocess allowlist: `node`, `python3`, `pdf-utils`; no shell | `child_process.spawn` with `shell: false` |

### 1.3 Sandbox Acceptance Criteria

- [ ] Every tool in `MCPToolRegistry` declares a tier; missing declaration → reject at gateway.
- [ ] Filesystem access outside `/{tenant_id}/*` returns `403 SandboxViolation` and triggers an audit log entry tagged `severity:high`.
- [ ] Outbound requests to domains not on the allowlist return `403 EgressDenied` and increment a per-tenant counter; 5 denials in 60s triggers an automatic tier downgrade to T0 for 15 minutes.
- [ ] Subprocesses launched with `shell: true` fail the build (ESLint rule `no-shell-spawn`).
- [ ] T3 tool calls pause the agent loop and emit a `confirmation_required` SSE event to the client; timeout after 5 minutes → cancel.

---

## 2. Secret Handling — Zero-Trust Secret Contract

### 2.1 Secret Classification

| Class | Examples | Storage | Rotation | Access Pattern |
|---|---|---|---|---|
| **S0 — Critical** | `DATABASE_URL`, `QDRANT_API_KEY`, `MCP_MASTER_KEY` | Vercel encrypted env + 1Password vault | Manual, quarterly | CI/CD only; never logged |
| **S1 — Tenant-scoped** | Per-user OAuth tokens, per-user API keys | Postgres `BYTEA` column, AES-256-GCM encrypted with `MCP_MASTER_KEY` (per-tenant DEK) | On disconnect / 90 days | `MCPOAuthManager` only |
| **S2 — Integration** | `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `UNSTRUCTURED_API_KEY` | Vercel encrypted env | Per provider policy | Server-side only |
| **S3 — Ephemeral** | PKCE verifiers, OAuth state nonces, signed URL tokens | In-memory + encrypted Postgres `oauth_state` table | Auto-expire ≤ 10 min | Single-use |

### 2.2 Encryption & Envelope Pattern

```typescript
// /lib/secrets/vault.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Per-tenant Data Encryption Key (DEK) envelope
//   Master Key  (env: MCP_MASTER_KEY, 32B)
//       │
//       └── wraps ──> Tenant DEK (per tenant_id, 32B, stored in mcp_tenant_deks)
//                          │
//                          └── wraps ──> Per-secret ciphertext (BYTEA)
export class SecretVault {
  encrypt(tenantId: string, plaintext: string): Buffer { /* ... */ }
  decrypt(tenantId: string, ciphertext: Buffer): string { /* ... */ }
}
```

**Required guarantees:**

| Rule | Verification |
|---|---|
| No plaintext secret appears in any log line | ESLint rule `no-console-for-secrets` + log scrubber middleware |
| No plaintext secret appears in any error response | Custom `safeError()` wrapper strips known patterns |
| No secret is queryable via MCP tool or API | Tools returning `auth_*` fields → gateway rejects |
| Secrets are never sent to LLMs as prompt content | Prompt injection audit scans for `BEGIN PRIVATE KEY`, `Bearer `, `sk-` patterns |
| `MCP_MASTER_KEY` rotation is zero-downtime | Double-key decryption during overlap window |

### 2.3 Secret Hygiene Checklist

- [ ] `MCP_MASTER_KEY` is 32 random bytes, base64-encoded, stored only in Vercel production env (never preview).
- [ ] `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `UNSTRUCTURED_API_KEY` rotated per provider's recommendation; rotation documented in `runbooks/secret-rotation.md`.
- [ ] `.env*` files are in `.gitignore`; pre-commit hook (`gitleaks`) blocks any commit containing 70+ known secret patterns.
- [ ] Vercel build logs have secret redaction enabled (`vercel.json → buildCommand` filters).
- [ ] Every `mcp_oauth_tokens` row has `access_token_encrypted` and `refresh_token_encrypted` non-null; plaintext columns do not exist in the schema.
- [ ] CI fails on any `console.log(env.*)` or `JSON.stringify(process.env)` pattern.

---

## 3. Supply Chain Security — Dependency & Build Policy

### 3.1 Dependency Policy

| Layer | Policy | Tool |
|---|---|---|
| **Runtime deps (npm)** | Pin to exact version (no `^` or `~`); commit `package-lock.json`; lockfile must be ≥ 0 days old | `npm ci` in CI |
| **Critical packages** | Allowlist only: `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, `next`, `react`, `@neondatabase/serverless`, `@qdrant/js-client-rest`, `@ai-sdk/google`, `zod` | Manual review + `npm audit` |
| **Transitive deps** | Must have ≥ 6 months of release history, ≥ 1 maintainer, no known CVEs | `socket.dev` + `npm audit --audit-level=high` |
| **Native modules** | No native modules (Vercel Lambda constraint); pure-JS alternatives only | Build-time check |
| **Model artifacts** | Model IDs pinned to exact Gemini versions; no `latest` tags | Config in `lib/models/registry.ts` |

### 3.2 Build & Provenance

| Stage | Control | Owner |
|---|---|---|
| **Pre-commit** | `gitleaks`, `eslint`, `tsc --noEmit`, secret-pattern scan | Developer |
| **PR open** | `npm audit`, `socket.dev` scan, dependency diff review, SBOM diff | CI bot |
| **Merge to main** | Full SBOM generation (`@cyclonedx/cyclonedx-npm`), signature on commit (Sigstore), reproducible build verification | CI |
| **Deploy to preview** | Image scan (Trivy), secret scan (Trufflehog), license check | CI |
| **Deploy to production** | Same as preview + signed artifact (`cosign sign`), deploy attestation logged | CI + human approval |

### 3.3 SBOM & Vulnerability Response

- **SBOM generation**: CycloneDX JSON attached to every release; stored in `s3://omnirag-sbom/{version}.cdx.json`.
- **Vulnerability SLA**:
  - Critical (CVSS ≥ 9.0): patch within 24h, deploy within 48h.
  - High (CVSS 7.0–8.9): patch within 7 days.
  - Medium (CVSS 4.0–6.9): patch in next sprint.
  - Low: batched monthly.
- **Source integrity**: `npm install --ignore-scripts`; all postinstall scripts reviewed before enabling.
- **Pinned model versions**: any change to `gemini-embedding-2`, `gemini-3.5-flash-lite`, `gemini-3.6-flash` triggers a `model-promotion` PR with eval suite re-run.

### 3.4 Supply Chain Acceptance Criteria

- [ ] `package-lock.json` is committed and CI runs `npm ci` (never `npm install`).
- [ ] `npm audit --omit=dev --audit-level=high` returns zero findings on `main`.
- [ ] SBOM is generated and uploaded for every release tag.
- [ ] No dependency in `package.json` uses `latest`, `*`, or non-pinned semver ranges.
- [ ] Critical CVE alerts wired to PagerDuty with auto-created GitHub issue.

---

## 4. Compliance Controls — GDPR / HIPAA / PCI

OmniRAG must satisfy three overlapping regulatory regimes. Controls are mapped to the **strictest** applicable requirement where regimes overlap.

### 4.1 Compliance Control Matrix

| Control Area | GDPR | HIPAA | PCI-DSS | OmniRAG Implementation |
|---|---|---|---|---|
| **Lawful basis for processing** | Art. 6 — explicit consent | Treatment / Payment / Healthcare ops | N/A | Consent capture at signup (`consent_log` table with timestamp + IP + UA) |
| **Right to access (Art. 15)** | ✅ within 30 days | N/A | N/A | `POST /api/v1/settings/export` → ZIP of all tenant data within 24h |
| **Right to erasure (Art. 17)** | ✅ within 30 days | Record retention rules | N/A | `DELETE /api/v1/settings/account` → hard-delete across Neon, Qdrant, Blob; tombstone in audit log |
| **Data portability (Art. 20)** | ✅ machine-readable | N/A | N/A | Export format: JSON + NDJSON for embeddings (base64) |
| **Breach notification (Art. 33)** | ✅ within 72h | ✅ required | ✅ required | PagerDuty → on-call → status page; auto-generated breach report template |
| **PHI handling** | N/A | Access controls + audit logs + minimum necessary | N/A | PHI flag in `documents.metadata.phi: bool`; encrypted at rest; access logged; never sent to non-BAA vendors |
| **Encryption at rest** | Rec. | ✅ required | ✅ required | AES-256-GCM on Postgres `BYTEA` columns; Vercel Blob server-side encryption; Qdrant TLS |
| **Encryption in transit** | ✅ TLS 1.2+ | ✅ TLS 1.2+ | ✅ TLS 1.2+ | TLS 1.3 enforced; HSTS preload; minimum cipher suite |
| **Access logging** | Art. 30 | ✅ audit controls | ✅ track access | `audit_log` table: every read/write to PHI or PII fields |
| **BAA-covered vendors only (HIPAA)** | N/A | ✅ required | N/A | Only Gemini (via BAA), Vercel Enterprise (BAA), Neon (BAA). Notion/Slack/GitHub: no PHI ingest |
| **Card data segregation (PCI)** | N/A | N/A | ✅ required | Billing via Stripe (PCI Level 1); no PAN ever stored; webhook signatures verified |
| **Data residency** | EU citizens | US HIPAA | N/A | Region selector at tenant creation: `us-east`, `eu-west`; Neon branch + Qdrant cluster pinned |
| **DPIA** | High-risk processing | N/A | N/A | DPIA template filled for AI training-on-user-data features (currently disabled) |

### 4.2 Tenant Data Lifecycle

| State | Trigger | Action | Retention |
|---|---|---|---|
| **Active** | Signup | All data tenant-scoped via `tenant_id` + RLS | Until account deletion |
| **Soft-deleted** | User initiates `DELETE /settings/account` | Account marked `deleted_at`; data suppressed from UI/queries; RLS still applies | 30 days (GDPR grace) |
| **Hard-deleted** | 30 days after soft-delete OR explicit admin purge | Neon: `DELETE` cascade; Qdrant: `delete_points` by `tenant_id` filter; Blob: lifecycle policy deletes prefix `/{tenant_id}/*`; tombstone in `audit_log` | Audit log retention: 7 years |
| **Backup purge** | After hard-delete | Encrypted backups rotate out within 35 days | — |

### 4.3 Consent & Configuration

```typescript
// /lib/compliance/consent.ts — required user-facing toggles
type ConsentRecord = {
  tenant_id: string;
  granted_at: Timestamp;
  ip: string;
  user_agent: string;
  purposes: {
    essential: true;            // always on
    analytics: boolean;         // opt-in
    model_training: boolean;    // opt-in, off by default
    third_party_integrations: boolean;  // opt-in per-integration
  };
};
```

### 4.4 Regional Isolation

| Region | Neon Branch | Qdrant Cluster | Blob Bucket | Default LLM Endpoint |
|---|---|---|---|---|
| `us-east` | `neon-us-east` | `qdrant-us-east` | `omnirag-us-east` | `generativelanguage.googleapis.com` (US) |
| `eu-west` | `neon-eu-west` | `qdrant-eu-west` | `omnirag-eu-west` | EU endpoint (if available; otherwise US with explicit disclosure) |

### 4.5 Compliance Acceptance Criteria

- [ ] Every table containing user data has RLS enabled and a `tenant_isolation` policy.
- [ ] `POST /api/v1/settings/export` returns a complete archive within 24h SLA; tested in staging monthly.
- [ ] `DELETE /api/v1/settings/account` triggers the 30-day soft-delete → hard-delete pipeline with verifiable completion receipts.
- [ ] `audit_log` captures every access to PHI-tagged documents and is immutable (append-only via DB role permissions).
- [ ] PHI ingest to non-BAA-covered MCP servers is blocked at the gateway (server's `phi_allowed = false`).
- [ ] Stripe webhook signatures verified on every event; raw card data never enters OmniRAG systems.
- [ ] Region selector is mandatory at signup; tenant cannot migrate without explicit confirmation.
- [ ] DPIA on file for any feature that uses tenant data for model improvement (currently: zero such features enabled).

---

## 5. Cross-Reference Map

| Concern | This Section | Previous Section |
|---|---|---|
| Tool tier enforcement | §1.1, §1.2 | [Threat Model §3 Hooks](./01-threat-model-and-deterministic-hooks.md) |
| Pre-tool side-effect confirmation | §1.1 (T3) | [Threat Model §4 Confirmation gate](./01-threat-model-and-deterministic-hooks.md) |
| Secret encryption keys | §2.2 | [Threat Model §6 Key management](./01-threat-model-and-deterministic-hooks.md) |
| Dependency CVE monitoring | §3.3 | [Threat Model §8 Supply chain risk](./01-threat-model-and-deterministic-hooks.md) |
| PHI access audit | §4.1, §4.2 | [Threat Model §5 Audit logging](./01-threat-model-and-deterministic-hooks.md) |

---

## 6. Verification Checklist (Section-Level Gate)

A change touching this section's domain is **not mergeable** unless every item below passes:

- [ ] Every new MCP tool declares a `SandboxTier` and is registered in `TOOL_TIER`.
- [ ] Every new secret follows the S0–S3 classification and uses `SecretVault`.
- [ ] No new dependency is added without a passing `npm audit` and `socket.dev` review.
- [ ] Any change touching user data paths is reviewed by the compliance owner (DRI on-call for compliance).
- [ ] Soft-delete and hard-delete pipelines are re-tested in staging when any user-data table schema changes.
- [ ] PHI-tagged data flow diagrams are updated in `/docs/data-flow.md` whenever a new integration can touch PHI.

---

> **Next sections:** None — this is the final section of the Guardrails & Security document bundle. Refer to the parent bundle index for the full list of guardrail sections.