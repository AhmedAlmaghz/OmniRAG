import type { FileTypeClassification, DispatchOptions, DispatchResult } from '../unstructuredService';

/**
 * Extraction-engine registry — the "adapters + registries" pattern applied to
 * document understanding. Every engine that can turn a file buffer into text
 * (local PPTX/DOCX parsers, Mistral OCR, Unstructured partition, Gemini
 * multimodal, Tesseract, audio transcription) is an {@link IExtractionEngine}.
 *
 * `dispatchFile` no longer hard-codes an if/else waterfall: it builds an
 * {@link ExtractionContext} and walks the registry in priority order, asking
 * each engine `canHandle(ctx)` then `extract(ctx)`. An engine returns `null`
 * to decline and let the chain continue, or a {@link DispatchResult} to claim
 * the file. Adding an engine = one entry in the registry; the waterfall,
 * the extraction-engine catalog, and pipeline templates all read from it.
 *
 * Behavior is preserved exactly from the legacy waterfall: same ordering, same
 * gating on API keys / file category / preferred engine, same `engineUsed`
 * labels, and the same honest fall-through (never fabricate text).
 */

export type EnginePreference = 'auto' | 'mistral' | 'unstructured' | 'gemini' | 'groq_whisper' | 'local';

export type FileCategory = 'pdf' | 'image' | 'word' | 'powerpoint' | 'spreadsheet' | 'audio' | 'video' | 'text';

/** Everything an engine needs to decide and to extract. Built once by dispatchFile. */
export interface ExtractionContext {
  fileBuffer: Buffer;
  fileName: string;
  /** Normalized MIME type (from normalizeMimeType) — what OCR/partition/Gemini use. */
  mimeType: string;
  /** The raw MIME type passed into dispatchFile — audio transcription uses it verbatim. */
  rawMimeType: string;
  classification: FileTypeClassification;
  enginePref: EnginePreference;
  options: DispatchOptions;
  /** Resolved API keys (options override → process.env), '' when absent. */
  mistralKey: string;
  unstructuredKey: string;
}

export interface IExtractionEngine {
  /** Stable id used by pipeline templates and the catalog. */
  id: string;
  nameAr: string;
  nameEn: string;
  /** Higher runs earlier in the chain. */
  priority: number;
  /** File categories this engine can handle (drives catalog + templates). */
  supportedCategories: FileCategory[];
  /** True when the engine calls an external/cloud API (vs. local-only). */
  requiresCloud: boolean;
  /** Whether this engine applies to the context (category + preference + keys). */
  canHandle(ctx: ExtractionContext): boolean;
  /**
   * Extracts text. Return `null` to decline and continue the chain; return a
   * DispatchResult to claim the file (terminal). Engines must never fabricate
   * content — an empty/failed extraction declines or reports success:false.
   */
  extract(ctx: ExtractionContext): Promise<DispatchResult | null>;
}
