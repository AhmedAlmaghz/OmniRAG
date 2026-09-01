import { embed } from 'ai';
import { getAiModel } from '../config/aiModels';
import { resolveEmbeddingModel, isModelRefConfigured } from '../ai/registry/resolve';
import { parseModelRef, LEGACY_DEFAULT_PROVIDER } from '../ai/registry/modelRef';
import { normalizeArabicForSearch } from '../storage/postgres';

// In-Memory LRU Cache for Embeddings
const cacheMap = new Map<string, number[]>();
const MAX_CACHE_SIZE = 500;

function getCachedEmbedding(key: string): number[] | undefined {
  return cacheMap.get(key);
}

function setCachedEmbedding(key: string, vector: number[]): void {
  if (cacheMap.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry
    const firstKey = cacheMap.keys().next().value;
    if (firstKey) cacheMap.delete(firstKey);
  }
  cacheMap.set(key, vector);
}

/**
 * The platform-wide embedding dimensionality. Qdrant's `omnirag_chunks`
 * collection is fixed at 3072 dims, so every provider's native vector is
 * normalized to this width before indexing. Swapping to per-collection
 * dimensions is a Phase-2 vector-store concern; until then this constant keeps
 * all providers interoperable with the existing collection.
 */
export const PLATFORM_EMBEDDING_DIMENSIONS = 3072;

/**
 * Arabic normalization applied to EVERY text before embedding — index-side
 * (chunk ingestion) and query-side (search views, HyDE) share this EXACT
 * function, so a query written "الأسئله/مُستند" embeds identically to content
 * written "الأسئلة/مستند". Without this, diacritic/hamza variants landed in
 * DIFFERENT points of the vector space and silently missed each other even
 * at high similarity. The function is a no-op for non-Arabic text, so English
 * and mixed corpora pass through unchanged.
 */
function normalizeForEmbedding(text: string): string {
  return normalizeArabicForSearch(text).trim();
}

/**
 * EMBEDDING PIPELINE VERSION — bumped whenever anything that changes the
 * vector space of generated embeddings changes:
 *   v1: raw text as written (pre-v0.12.4),
 *   v2: Arabic-normalized text (diacritics/hamza/alef folding) — v0.12.4.
 * Vectors produced under different PIPELINE versions (or different models)
 * are incomparable; `embeddingProvenanceId` below encodes BOTH so the
 * staleness detection and the re-embed service can detect a mismatch without
 * inspecting any vector.
 */
export const EMBEDDING_PIPELINE_VERSION = 2;

/**
 * Canonical provenance identifier for a vector: model + pipeline version.
 * Stored in TenantSettings.indexedEmbeddingModel and compared against the
 * ACTIVE id on every search — a mismatch means the stored corpus lives in a
 * different vector space and must be re-embedded before semantic results are
 * meaningful (the engine degrades to lexical-only until then).
 */
export function embeddingProvenanceId(modelRef?: string): string {
  return `${modelRef || getAiModel('embeddingModel')}#v${EMBEDDING_PIPELINE_VERSION}`;
}

/**
 * Generates a vector embedding for the given text using the Vercel AI SDK v7,
 * resolving the configured embedding model through the multi-provider registry
 * (any provider with an embedding capability — Google, OpenAI, Mistral,
 * Ollama, …). LRU caching and a deterministic no-key fallback are preserved.
 *
 * IMPORTANT: the same Arabic normalization runs here for BOTH the stored
 * chunk text and the search query — any change to it requires re-embedding
 * the corpus (same contract as changing the embedding model; see
 * reembedService).
 *
 * Fallback policy: for the legacy Google provider we walk a chain of known
 * Gemini embedding models so a renamed/deprecated model doesn't break
 * ingestion. For any other provider we attempt only the configured primary —
 * we never silently substitute a different provider, since cross-provider
 * vectors live in different similarity spaces.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const normalizedText = normalizeForEmbedding(text);
  if (!normalizedText) {
    return new Array(PLATFORM_EMBEDDING_DIMENSIONS).fill(0);
  }

  const primaryRef = getAiModel('embeddingModel');
  const cacheKey = `${primaryRef}:${normalizedText}`;

  const cached = getCachedEmbedding(cacheKey);
  if (cached) {
    return cached;
  }

  if (!(await isModelRefConfigured(primaryRef))) {
    // No provider key (dev/sandbox): return the deterministic fallback WITHOUT
    // caching it — otherwise the hash vector would be pinned until LRU eviction
    // even after a real key becomes available.
    return generateFallbackVector(normalizedText);
  }

  const { providerId } = parseModelRef(primaryRef);
  const candidateRefs =
    providerId === LEGACY_DEFAULT_PROVIDER
      ? Array.from(
          new Set([primaryRef, 'google/gemini-embedding-2', 'google/text-embedding-004', 'google/embedding-001']),
        )
      : [primaryRef];

  for (const ref of candidateRefs) {
    try {
      const model = await resolveEmbeddingModel(ref);
      if (!model) continue;
      const { embedding } = await embed({ model, value: normalizedText });

      if (embedding && Array.isArray(embedding) && embedding.length > 0) {
        const normalized = normalizeToPlatformDim(embedding);
        setCachedEmbedding(cacheKey, normalized);
        return normalized;
      }
    } catch {
      // Proceed to try next candidate (Google chain) or fall through.
    }
  }

  // All candidate models failed (transient outage/quota): return the fallback
  // vector but leave it UNCACHED so the next call retries the real API instead
  // of serving a poisoned hash vector until LRU eviction.
  return generateFallbackVector(normalizedText);
}

/**
 * Maximum number of concurrent embedding API requests in a batch. Bounded so a
 * large ingestion (50+ chunks) parallelizes without overwhelming provider quotas.
 */
const EMBED_BATCH_CONCURRENCY = 5;

/**
 * Generates embeddings for many texts in parallel with a bounded concurrency.
 * Returns vectors in the SAME order as the input texts.
 */
export async function embedBatch(texts: string[], concurrency: number = EMBED_BATCH_CONCURRENCY): Promise<number[][]> {
  const results: number[][] = new Array(texts.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= texts.length) return;
      results[i] = await generateEmbedding(texts[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, texts.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Ensures vectors returned to the vector store consistently match the platform
 * dimensionality (3072). Preserves the historical cyclic-fill + L2-normalize
 * behavior so newly embedded chunks remain comparable with vectors already
 * indexed under the same scheme.
 */
function normalizeToPlatformDim(values: number[]): number[] {
  const dim = PLATFORM_EMBEDDING_DIMENSIONS;
  if (values.length === dim) return values;
  const result: number[] = new Array(dim);
  for (let i = 0; i < dim; i++) {
    result[i] = values[i % values.length];
  }
  const magnitude = Math.sqrt(result.reduce((sum, val) => sum + val * val, 0)) || 1.0;
  return result.map((v) => v / magnitude);
}

/**
 * Generates a deterministic fallback vector for development/testing when no
 * embedding provider key is configured or all calls fail.
 */
function generateFallbackVector(text: string): number[] {
  const dim = PLATFORM_EMBEDDING_DIMENSIONS;
  const vector: number[] = new Array(dim).fill(0);

  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    const index = (i * 31 + charCode) % dim;
    vector[index] = (vector[index] + charCode / 255.0) / 2.0;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1.0;
  return vector.map((v) => v / magnitude);
}
