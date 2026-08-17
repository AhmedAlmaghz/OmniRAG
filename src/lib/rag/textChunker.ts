// Shared text chunker for the memory-backed ingestion paths.
//
// Phase 7 consolidation: db.ts had THREE inconsistent chunkers —
//   syncSource           → size 1000, step 1000 (overlap 0)
//   createDocumentVersion → size 1000, step 800  (overlap 200)
//   revertDocumentVersion → size 1000, step 800  (overlap 200)
// so the same document produced different chunk grids depending on which
// route wrote it, and chunks produced via syncSource had no overlap at all
// (any retrieval that lands on the boundary loses the bridging context that
// overlap is meant to preserve). Centralize the logic here so all three
// paths agree on a single shape, and so a future change to chunk geometry is
// one edit instead of three.

export interface ChunkGeometry {
  /** Maximum characters per chunk. */
  size: number;
  /** Stride between successive chunk windows; must be ≤ size or overlap is 0. */
  step: number;
}

export const DEFAULT_CHUNK_GEOMETRY: ChunkGeometry = {
  size: 1000,
  step: 800, // 200-char (~20%) overlap between adjacent chunks
};

/**
 * Split `text` into an array of non-empty chunk snippets using a fixed-size
 * sliding window with overlap. Trims each snippet and drops empties. If the
 * trimmed text is empty an empty array is returned; if the text is short enough
 * to fit one window the result is a single-element array (trimmed).
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
