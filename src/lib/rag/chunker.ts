// Unified document chunker for OmniRAG.
//
// Before this module existed the codebase had THREE divergent chunkers:
//   1. documents POST route  → inline sliding window (512 tokens ≈ 1280 chars,
//      20% overlap) with a naive `substring` stride.
//   2. lib/rag/textChunker.ts → fixed 1000-char / 800-step window used by the
//      memory-backed sync/version paths.
//   3. PDF page slicing       → page-level batches concatenated into one blob.
//
// The same document therefore produced a different chunk grid depending on
// which route wrote it, which silently degraded retrieval recall and made
// chunk counts non-reproducible. This module is the single source of truth for
// chunk geometry and strategy. Every ingestion path (documents POST, syncSource,
// createDocumentVersion, revertDocumentVersion, reindex) must go through
// `chunkDocument` so a future change to chunking is one edit, not three.
//
// Design goals:
//   • Deterministic: same input + same config ⇒ same chunks, every time.
//   • Boundary-aware: prefer splitting on paragraph/sentence boundaries instead
//     of cutting words mid-token, which materially improves embedding quality
//     for Arabic (no spaces inside many tokens) and English alike.
//   • Configurable but bounded: callers may tune size/overlap/strategy, but all
//     values are clamped to sane ranges so a bad client config can't produce
//     degenerate (0-char or unbounded) chunks.

import { SYSTEM_CONFIG } from '../config/systemConfig';

export type ChunkingStrategy = 'semantic' | 'markdown' | 'recursive';

export interface ChunkingConfig {
  /** Splitting strategy. Defaults to 'semantic'. */
  strategy?: ChunkingStrategy;
  /** Target chunk size in *tokens*. Clamped to [128, 4096]. Default 512. */
  size?: number;
  /** Overlap between adjacent chunks as a percent of size. Clamped to [0, 50]. Default 20. */
  overlap?: number;
}

export interface ResolvedChunkGeometry {
  strategy: ChunkingStrategy;
  /** Target chunk size in characters. */
  charSize: number;
  /** Overlap in characters between adjacent chunks. */
  overlapChars: number;
  /** Stride between successive windows (charSize - overlapChars). */
  step: number;
  /** The token size this geometry was derived from. */
  tokenSize: number;
  /** The overlap percent used. */
  overlapPercent: number;
}

/**
 * Approximate characters-per-token ratio. Arabic and English average roughly
 * 2.5 characters per token with the Gemini tokenizer, so we convert a token
 * budget into a character budget with this factor. Kept as a named constant so
 * the assumption is explicit and easy to revisit.
 */
export const CHARS_PER_TOKEN = 2.5;

const MIN_TOKEN_SIZE = 128;
const MAX_TOKEN_SIZE = 4096;
const MIN_OVERLAP_PERCENT = 0;
const MAX_OVERLAP_PERCENT = 50;

/**
 * Resolve a (possibly partial/invalid) ChunkingConfig into a concrete, bounded
 * character geometry. This is the ONLY place token→char conversion and clamping
 * happen, so every strategy below works from the same validated numbers.
 */
export function resolveChunkGeometry(config?: ChunkingConfig): ResolvedChunkGeometry {
  const strategy: ChunkingStrategy =
    config?.strategy === 'markdown' || config?.strategy === 'recursive' ? config.strategy : 'semantic';

  const rawSize = typeof config?.size === 'number' && Number.isFinite(config.size) ? config.size : 512;
  const tokenSize = Math.min(MAX_TOKEN_SIZE, Math.max(MIN_TOKEN_SIZE, Math.round(rawSize)));

  const rawOverlap = typeof config?.overlap === 'number' && Number.isFinite(config.overlap) ? config.overlap : 20;
  const overlapPercent = Math.min(MAX_OVERLAP_PERCENT, Math.max(MIN_OVERLAP_PERCENT, Math.round(rawOverlap)));

  const charSize = Math.max(1, Math.floor(tokenSize * CHARS_PER_TOKEN));
  const overlapChars = Math.floor(charSize * (overlapPercent / 100));
  // Guarantee forward progress: step must be at least 1 and strictly less than
  // charSize when there is overlap, so the sliding window always advances.
  const step = Math.max(1, charSize - overlapChars);

  return { strategy, charSize, overlapChars, step, tokenSize, overlapPercent };
}

/**
 * Ordered list of split boundaries, from strongest (paragraph) to weakest
 * (single character). The recursive strategy walks this list, splitting on the
 * strongest separator that keeps pieces under the size budget, then recursing
 * into oversized pieces with the next separator. This mirrors the well-known
 * RecursiveCharacterTextSplitter approach and preserves semantic units far
 * better than a blind fixed stride.
 */
const RECURSIVE_SEPARATORS = ['\n\n', '\n', '. ', '، ', '؛ ', '؟ ', '! ', ' ', ''];

/**
 * Split `text` on markdown heading boundaries (`# …`, `## …`, etc.), returning
 * non-empty sections with their heading line retained at the top of each
 * section so each chunk keeps its local context. Sections that exceed
 * `charSize` are recursively sub-chunked so no chunk blows the budget.
 */
function splitMarkdownSections(text: string, geo: ResolvedChunkGeometry): string[] {
  // Split just before each heading line so the heading stays with its section.
  const sections = text.split(/(?=^#{1,6}\s)/m).filter((s) => s.trim().length > 0);
  const out: string[] = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    if (trimmed.length <= geo.charSize) {
      out.push(trimmed);
    } else {
      // Oversized section: fall back to recursive splitting so we still honor
      // the size budget while keeping paragraph/sentence boundaries.
      out.push(...splitRecursive(trimmed, geo.charSize, geo.overlapChars));
    }
  }
  return out;
}

/**
 * Recursive character splitter. Splits `text` into pieces of at most `size`
 * chars, preferring stronger separators, then merges small adjacent pieces back
 * together up to the budget to avoid a long tail of tiny chunks. `overlap`
 * chars of trailing context are carried into the start of the next piece.
 */
function splitRecursive(text: string, size: number, overlap: number): string[] {
  if (!text || text.trim().length === 0) return [];
  if (text.length <= size) return [text.trim()];

  const splitOn = (input: string, sep: string): string[] => {
    if (sep === '') {
      // Hard character split as the last resort.
      const parts: string[] = [];
      for (let i = 0; i < input.length; i += size) parts.push(input.slice(i, i + size));
      return parts;
    }
    return input.split(sep);
  };

  // Choose the strongest separator that actually appears in the text.
  let separator = RECURSIVE_SEPARATORS[RECURSIVE_SEPARATORS.length - 1];
  for (const candidate of RECURSIVE_SEPARATORS) {
    if (candidate === '' || text.includes(candidate)) {
      separator = candidate;
      break;
    }
  }

  const pieces = splitOn(text, separator);
  const results: string[] = [];
  let current = '';

  const flush = () => {
    const t = current.trim();
    if (t) results.push(t);
    current = '';
  };

  for (const piece of pieces) {
    const candidate = current ? `${current}${separator}${piece}` : piece;
    if (candidate.length <= size) {
      current = candidate;
    } else {
      flush();
      if (piece.length > size) {
        // Piece itself is too big: recurse with the next weaker separator.
        const idx = RECURSIVE_SEPARATORS.indexOf(separator);
        const nextSep = RECURSIVE_SEPARATORS[Math.min(idx + 1, RECURSIVE_SEPARATORS.length - 1)];
        results.push(...splitRecursive(piece, size, overlap));
        // Carry overlap context forward if requested.
        if (overlap > 0 && results.length > 0) {
          const tail = results[results.length - 1];
          current = tail.slice(Math.max(0, tail.length - overlap));
        }
        separator = nextSep;
      } else {
        // Start a new chunk, optionally seeded with overlap from the previous.
        current =
          overlap > 0 && results.length > 0
            ? `${results[results.length - 1].slice(-overlap)}${separator}${piece}`
            : piece;
        if (current.length > size) {
          // Overlap pushed us over budget; drop the overlap seed.
          current = piece;
        }
      }
    }
  }
  flush();

  return results.filter((r) => r.trim().length > 0);
}

/**
 * Boundary-aware sliding window ("semantic" strategy). Instead of cutting at a
 * fixed character offset, each window extends up to `charSize` and then backs
 * off to the nearest sentence/paragraph boundary within a lookback window, so
 * chunks end on natural breaks. Overlap is applied by starting the next window
 * `step` characters after the previous window's start.
 */
function splitSemantic(text: string, geo: ResolvedChunkGeometry): string[] {
  const { charSize, step } = geo;
  const out: string[] = [];
  if (!text || text.trim().length === 0) return out;
  if (text.length <= charSize) return [text.trim()];

  // How far back we're willing to walk from the hard limit to find a boundary.
  const lookback = Math.floor(charSize * 0.35);
  const boundaryRe = /(?:\n\n|\n|\.|!|؟|\?|؛|;|،|,)\s*$/;

  let start = 0;
  const len = text.length;
  let guard = 0;
  const maxIterations = Math.ceil(len / Math.max(1, step)) + 8;

  while (start < len && guard < maxIterations) {
    guard++;
    let end = Math.min(len, start + charSize);

    if (end < len) {
      // Try to find a natural boundary within the lookback region [end-lookback, end].
      const windowText = text.slice(start, end);
      const searchFrom = Math.max(0, windowText.length - lookback);
      const tail = windowText.slice(searchFrom);
      const match = tail.match(boundaryRe);
      let boundaryOffset = -1;
      if (match && match.index !== undefined) {
        boundaryOffset = searchFrom + match.index + match[0].length;
      } else {
        // No punctuation boundary found; fall back to the last whitespace break.
        const lastSpace = windowText.lastIndexOf(' ', windowText.length - 1);
        if (lastSpace > searchFrom) boundaryOffset = lastSpace + 1;
      }
      if (boundaryOffset > 0 && boundaryOffset < windowText.length) {
        end = start + boundaryOffset;
      }
    }

    const snippet = text.slice(start, end).trim();
    if (snippet) out.push(snippet);

    if (end >= len) break;
    // Advance by step, but never backwards and never by zero.
    const next = start + Math.max(1, step);
    start = Math.max(next, end > start + step ? end - Math.max(0, geo.overlapChars) : next);
    if (start <= 0) start = next;
  }

  return out;
}

/**
 * The single public entry point for chunking. Returns an ordered list of
 * non-empty chunk strings. All ingestion paths MUST use this function.
 *
 * @param text    The full document text to chunk.
 * @param config  Optional chunking config (strategy/size/overlap); clamped.
 * @returns       Ordered chunk texts. Empty array for empty/whitespace input.
 */
export function chunkDocument(text: string, config?: ChunkingConfig): string[] {
  if (!text || !text.trim()) return [];
  const geo = resolveChunkGeometry(config);

  let chunks: string[];
  switch (geo.strategy) {
    case 'markdown':
      chunks = splitMarkdownSections(text, geo);
      break;
    case 'recursive':
      chunks = splitRecursive(text, geo.charSize, geo.overlapChars);
      break;
    case 'semantic':
    default:
      chunks = splitSemantic(text, geo);
      break;
  }

  // Final safety net: drop empties and de-dupe exact-adjacent duplicates that
  // can arise from heavy overlap on very short texts.
  const cleaned: string[] = [];
  for (const c of chunks) {
    const t = c.trim();
    if (!t) continue;
    if (cleaned[cleaned.length - 1] === t) continue;
    cleaned.push(t);
  }
  if (cleaned.length === 0 && text.trim()) cleaned.push(text.trim());
  return cleaned;
}

/**
 * Estimate the token count for a chunk of text. Uses the same chars-per-token
 * heuristic as the geometry resolver so estimates stay consistent with the
 * budgets we actually enforce.
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / (CHARS_PER_TOKEN + 0.3)));
}

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------
// The legacy memory-backed paths imported `chunkTextIntoList` from
// `textChunker.ts`. We re-export a compatible shim here AND keep textChunker.ts
// delegating to this module, so there is exactly one implementation. New code
// should import `chunkDocument` directly.

export interface ChunkGeometry {
  size: number;
  step: number;
}

export const DEFAULT_CHUNK_GEOMETRY: ChunkGeometry = {
  size: 1000,
  step: 800,
};

/**
 * Legacy shim preserved for the existing `textChunker.ts` contract and its
 * regression tests. Splits with a fixed-size sliding window + overlap. New code
 * should prefer `chunkDocument`.
 */
export function chunkTextIntoList(text: string, geometry: ChunkGeometry = DEFAULT_CHUNK_GEOMETRY): string[] {
  const list: string[] = [];
  if (!text || !text.trim()) return list;
  const stride = geometry.step > 0 ? geometry.step : geometry.size;
  for (let i = 0; i < text.length; i += stride) {
    const snippet = text.substring(i, i + geometry.size).trim();
    if (snippet) list.push(snippet);
    if (i + geometry.size >= text.length) break;
  }
  if (list.length === 0 && text.trim()) list.push(text.trim());
  return list;
}

// Re-export the ingestion default so callers can reference a single constant.
export const INGESTION_DEFAULTS = {
  chunkSize: SYSTEM_CONFIG.INGESTION.DEFAULT_CHUNK_SIZE,
  chunkOverlap: SYSTEM_CONFIG.INGESTION.DEFAULT_CHUNK_OVERLAP,
};
