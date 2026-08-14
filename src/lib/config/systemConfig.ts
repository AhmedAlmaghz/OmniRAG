import pkg from '../../../package.json';

/**
 * System-wide Configuration Constants for OmniRAG
 */

export const APP_VERSION = pkg.version || '0.2.0';

export const SYSTEM_CONFIG = {
  DEFAULT_TENANT_ID: 'tenant-acme-01',
  DEFAULT_MODEL: 'gemini-3.7-flash',
  
  // Search and RAG Configuration
  RAG: {
    DEFAULT_TOP_K: 5,
    RRF_CONSTANT_K: 60, // Reciprocal Rank Fusion constant
    HYBRID_WEIGHTS: {
      SEMANTIC: 0.7,
      LEXICAL: 0.3,
    },
    MIN_SIMILARITY_SCORE: 0.15,
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
    SUPPORTED_MIME_TYPES: [
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/json',
      'text/csv',
    ],
  },
} as const;
