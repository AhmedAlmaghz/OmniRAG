/**
 * Document Ingestion & Infrastructure Configuration Store
 * Provides default values and LocalStorage persistence for document parsing & chunking settings.
 */

export interface IngestionSettings {
  maxFileSizeMb: number; // Max file size limit in MB (Default: 50MB)
  pagesPerChunk: number; // PDF slicing batch size (Default: 25 pages)
  defaultEngine: 'mistral_ocr' | 'unstructured_mcp' | 'pdf_layout' | 'gemini_vision';
  chunkStrategy: 'semantic' | 'markdown' | 'code' | 'sliding';
  chunkSize: number; // Token window (128 - 4096)
  chunkOverlap: number; // Overlap percentage (0 - 50)
  concurrencyWorkers: number; // Worker threads (1 - 8)
  geminiFallback: boolean; // Auto fallback to Gemini Vision OCR
}

export const DEFAULT_INGESTION_SETTINGS: IngestionSettings = {
  maxFileSizeMb: 50,
  pagesPerChunk: 25,
  defaultEngine: 'mistral_ocr',
  chunkStrategy: 'semantic',
  chunkSize: 512,
  chunkOverlap: 20,
  concurrencyWorkers: 3,
  geminiFallback: true,
};

const STORAGE_KEY = 'omnirag_ingestion_infrastructure_settings_v1';

export function getIngestionSettings(): IngestionSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_INGESTION_SETTINGS;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_INGESTION_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      maxFileSizeMb: typeof parsed.maxFileSizeMb === 'number' ? parsed.maxFileSizeMb : DEFAULT_INGESTION_SETTINGS.maxFileSizeMb,
      pagesPerChunk: typeof parsed.pagesPerChunk === 'number' ? parsed.pagesPerChunk : DEFAULT_INGESTION_SETTINGS.pagesPerChunk,
      defaultEngine: parsed.defaultEngine || DEFAULT_INGESTION_SETTINGS.defaultEngine,
      chunkStrategy: parsed.chunkStrategy || DEFAULT_INGESTION_SETTINGS.chunkStrategy,
      chunkSize: typeof parsed.chunkSize === 'number' ? parsed.chunkSize : DEFAULT_INGESTION_SETTINGS.chunkSize,
      chunkOverlap: typeof parsed.chunkOverlap === 'number' ? parsed.chunkOverlap : DEFAULT_INGESTION_SETTINGS.chunkOverlap,
      concurrencyWorkers: typeof parsed.concurrencyWorkers === 'number' ? parsed.concurrencyWorkers : DEFAULT_INGESTION_SETTINGS.concurrencyWorkers,
      geminiFallback: typeof parsed.geminiFallback === 'boolean' ? parsed.geminiFallback : DEFAULT_INGESTION_SETTINGS.geminiFallback,
    };
  } catch (e) {
    console.warn('[IngestionSettings] Failed to parse local settings, returning defaults:', e);
    return DEFAULT_INGESTION_SETTINGS;
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
