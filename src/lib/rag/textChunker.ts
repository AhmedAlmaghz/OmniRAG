// Shared text chunker for the memory-backed ingestion paths.
//
// Phase 7 consolidation: db.ts had THREE inconsistent chunkers —
//   syncSource           → size 1000, step 1000 (overlap 0)
//   createDocumentVersion → size 1000, step 800  (overlap 200)
//   revertDocumentVersion → size 1000, step 800  (overlap 200)
// so the same document produced different chunk grids depending on which
// route wrote it, and chunks produced via syncSource had no overlap at all
// (any retrieval that lands on the boundary loses the bridging context that
// overlap is meant to preserve).
//
// Phase 8 consolidation: the implementation now lives in `chunker.ts`, the
// single source of truth for all chunking in the app (documents POST, sync,
// versions, reindex). This file is kept as a thin re-export so existing
// imports and the regression test suite continue to work unchanged.

export { chunkTextIntoList, DEFAULT_CHUNK_GEOMETRY } from './chunker';
export type { ChunkGeometry } from './chunker';
