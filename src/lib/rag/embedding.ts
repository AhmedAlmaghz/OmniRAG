import { embed } from 'ai';
import { getAiModel } from '../config/aiModels';
import { getGoogleProvider, resolveGeminiApiKey } from './googleProvider';

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
 * Generates a vector embedding for the given text using the Vercel AI SDK v7
 * (`embed` + the shared @ai-sdk/google provider) with LRU caching and a
 * deterministic fallback. The API key resolves through the shared provider
 * (runtime-env aware), and the model chain walks configured primary → known
 * Gemini embedding models so one deprecated/renamed model doesn't break
 * ingestion.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return new Array(3072).fill(0);
  }

  const primaryModel = getAiModel('embeddingModel');
  const cacheKey = `${primaryModel}:${normalizedText}`;

  const cached = getCachedEmbedding(cacheKey);
  if (cached) {
    return cached;
  }

  if (!resolveGeminiApiKey()) {
    // No API key (dev/sandbox): return the deterministic fallback WITHOUT
    // caching it — otherwise the hash vector would be pinned until LRU
    // eviction even after a real key becomes available.
    return generateFallbackVector(normalizedText);
  }

  const candidateModels = Array.from(
    new Set([primaryModel, 'gemini-embedding-2', 'text-embedding-004', 'embedding-001']),
  );

  const provider = getGoogleProvider();
  for (const modelName of candidateModels) {
    try {
      const { embedding } = await embed({
        model: (provider as any).embeddingModel(modelName),
        value: normalizedText,
      });

      if (embedding && Array.isArray(embedding) && embedding.length > 0) {
        const normalized = normalizeTo3072(embedding);
        setCachedEmbedding(cacheKey, normalized);
        return normalized;
      }
    } catch {
      // Proceed to try next candidate model or fallback
    }
  }

  // All candidate models failed (transient outage/quota): return the fallback
  // vector but leave it UNCACHEd so the next call retries the real API instead
  // of serving a poisoned hash vector until LRU eviction.
  return generateFallbackVector(normalizedText);
}

/**
 * Maximum number of concurrent embedding API requests in a batch. Bounded so a
 * large ingestion (50+ chunks) parallelizes without overwhelming Gemini quotas.
 */
const EMBED_BATCH_CONCURRENCY = 5;

/**
 * Generates embeddings for many texts in parallel with a bounded concurrency.
 *
 * Designed for the ingestion hot path: previously each chunk issued a serial
 * `generateEmbedding` round-trip, so 50 chunks cost 50 sequential API calls.
 * This runs them in waves of `EMBED_BATCH_CONCURRENCY`, reusing the same LRU
 * cache and fallback logic as the single-text path — so cached/mocked texts
 * resolve instantly and only misses hit the network in parallel.
 *
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
 * Ensures vectors returned to Qdrant or internal stores consistently match 3072 dimensions.
 */
function normalizeTo3072(values: number[]): number[] {
  if (values.length === 3072) return values;
  const result: number[] = new Array(3072);
  for (let i = 0; i < 3072; i++) {
    result[i] = values[i % values.length];
  }
  const magnitude = Math.sqrt(result.reduce((sum, val) => sum + val * val, 0)) || 1.0;
  return result.map((v) => v / magnitude);
}

/**
 * Generates a deterministic fallback vector of 3072 elements for development/testing
 * when Gemini API key is missing or calls fail.
 */
function generateFallbackVector(text: string): number[] {
  const vector: number[] = new Array(3072).fill(0);

  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    const index = (i * 31 + charCode) % 3072;
    vector[index] = (vector[index] + charCode / 255.0) / 2.0;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1.0;
  return vector.map((v) => v / magnitude);
}
