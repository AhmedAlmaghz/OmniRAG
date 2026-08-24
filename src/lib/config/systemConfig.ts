import pkg from '../../../package.json';

/**
 * System-wide Configuration Constants for OmniRAG
 *
 * IMPORTANT: do NOT import AIModelConfig here. `aiModels.ts` pulls
 * `node:async_hooks`, which is Node-only; this file is bundled into client code
 * for `APP_VERSION`, so adding that import would push an external Node module
 * into the browser chunk and break the Turbopack build. AI model names live
 * exclusively in `DEFAULT_AI_MODELS` (read server-side) — source them there.
 */

export const APP_VERSION = pkg.version || '0.2.0';

export const SYSTEM_CONFIG = {
  DEFAULT_TENANT_ID: 'tenant-acme-01',

  // Search and RAG Configuration
  RAG: {
    // Retrieval merges ALL chunks above the similarity floor; there is no
    // fixed topK cap. ENGINE_OVERFETCH_FETCH_FACTOR controls how many
    // candidates each backend returns before fusion/reranking — 3x keeps the
    // recall high while bounding the Qdrant/Postgres round-trip cost.
    ENGINE_OVERFETCH_FACTOR: 3,
    RRF_CONSTANT_K: 60, // Reciprocal Rank Fusion constant
    HYBRID_WEIGHTS: {
      SEMANTIC: 0.7,
      LEXICAL: 0.3,
    },
    MIN_SIMILARITY_SCORE: 0.15,
    // Defensive soft cap before assembling the model context. Sized for
    // ~8k-token chunks; raise per-tenant if long documents dominate.
    CONTEXT_CHUNK_CAP: 30,
    // LLM cross-encoder reranking: how many candidates are scored per prompt,
    // and how much weight the LLM score gets when blended with the RRF score.
    RERANK: {
      LLM_BUDGET: 20,
      LLM_WEIGHT: 0.7,
    },
  },

  // Security & Rate Limiting
  SECURITY: {
    RATE_LIMIT_WINDOW_MS: 60 * 1000, // 1 minute
    DEFAULT_MAX_REQUESTS: 100,
    CHAT_MAX_REQUESTS: 30,
    PII_REDACTION_ENABLED: true,
    PROMPT_SANITIZER_ENABLED: true,
  },

  // Document Processing
  INGESTION: {
    DEFAULT_CHUNK_SIZE: 500,
    DEFAULT_CHUNK_OVERLAP: 50,
    MAX_FILE_SIZE_MB: 25,
    SUPPORTED_MIME_TYPES: ['text/plain', 'text/markdown', 'application/pdf', 'application/json', 'text/csv'],
  },
} as const;
