/**
 * Document ingestion configuration store.
 *
 * Every field here has a REAL consumer — this is enforced by review:
 *   - maxFileSizeMb → upload validation (documentIngestionHelpers) and the
 *     parse payload's x-max-file-size-mb ceiling
 *   - pagesPerChunk → PDF slicing batches sent to /v1/documents/parse
 *   - chunkStrategy/chunkSize/chunkOverlap → DEFAULTS for the Ingestion
 *     Studio's per-document chunking config, forwarded as `chunkingConfig`
 *     to POST /v1/documents and resolved/clamped by lib/rag/chunker.ts
 *
 * Fields without a consumer were REMOVED rather than kept decorative:
 * defaultEngine, concurrencyWorkers and geminiFallback had zero readers
 * anywhere in src/ (the engine waterfall in pdfChunker owns its own fallback
 * order, and embedding concurrency is server-side EMBED_BATCH_CONCURRENCY).
 */

/** Must mirror ChunkingStrategy in lib/rag/chunker.ts — the ONLY strategies
 *  the backend chunker actually understands. */
export type IngestionChunkStrategy = 'semantic' | 'markdown' | 'recursive';

export interface IngestionSettings {
  /** Max upload size in MB. */
  maxFileSizeMb: number;
  /** PDF page-batch size sent to the parsing pipeline. */
  pagesPerChunk: number;
  /** Default splitting strategy for newly ingested documents. */
  chunkStrategy: IngestionChunkStrategy;
  /** Target chunk size in TOKENS (the chunker converts/clamps to chars). */
  chunkSize: number;
  /** Overlap between adjacent chunks as percent of size. */
  chunkOverlap: number;
}

export const DEFAULT_INGESTION_SETTINGS: IngestionSettings = {
  maxFileSizeMb: 50,
  pagesPerChunk: 25,
  chunkStrategy: 'semantic',
  chunkSize: 512,
  chunkOverlap: 20,
};

const STRATEGY_VALUES: IngestionChunkStrategy[] = ['semantic', 'markdown', 'recursive'];

const STORAGE_KEY = 'omnirag_ingestion_infrastructure_settings_v1';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Reads persisted settings, clamping every numeric field into its legal range
 * so a corrupted/hand-edited localStorage blob can never produce degenerate
 * chunk geometry downstream (the server clamps again authoritatively).
 */
export function getIngestionSettings(): IngestionSettings {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_INGESTION_SETTINGS };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_INGESTION_SETTINGS };
    const parsed = JSON.parse(raw);

    // Legacy blobs may carry removed fields (defaultEngine, workers…) or the
    // old strategy enum ('code' | 'sliding') — both are ignored/mapped here.
    const legacyStrategy = typeof parsed.chunkStrategy === 'string' ? parsed.chunkStrategy : '';
    const strategy =
      legacyStrategy === 'markdown'
        ? 'markdown'
        : legacyStrategy === 'code' || legacyStrategy === 'sliding' || legacyStrategy === 'recursive'
          ? 'recursive'
          : 'semantic';

    return {
      maxFileSizeMb: clamp(
        typeof parsed.maxFileSizeMb === 'number' ? parsed.maxFileSizeMb : DEFAULT_INGESTION_SETTINGS.maxFileSizeMb,
        5,
        150,
      ),
      pagesPerChunk: clamp(
        typeof parsed.pagesPerChunk === 'number' ? parsed.pagesPerChunk : DEFAULT_INGESTION_SETTINGS.pagesPerChunk,
        5,
        100,
      ),
      chunkStrategy: STRATEGY_VALUES.includes(strategy) ? strategy : 'semantic',
      chunkSize: clamp(
        typeof parsed.chunkSize === 'number' ? parsed.chunkSize : DEFAULT_INGESTION_SETTINGS.chunkSize,
        128,
        4096,
      ),
      chunkOverlap: clamp(
        typeof parsed.chunkOverlap === 'number' ? parsed.chunkOverlap : DEFAULT_INGESTION_SETTINGS.chunkOverlap,
        0,
        50,
      ),
    };
  } catch (e) {
    console.warn('[IngestionSettings] Failed to parse local settings, returning defaults:', e);
    return { ...DEFAULT_INGESTION_SETTINGS };
  }
}

export function saveIngestionSettings(settings: Partial<IngestionSettings>): IngestionSettings {
  const current = getIngestionSettings();
  const updated: IngestionSettings = {
    ...current,
    ...settings,
  };

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('omnirag-ingestion-settings-changed', { detail: updated }));
    } catch (e) {
      console.error('[IngestionSettings] Failed to save settings to localStorage:', e);
    }
  }

  return updated;
}
