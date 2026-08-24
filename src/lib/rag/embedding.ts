import { GoogleGenAI } from '@google/genai';
import { getAiModel } from '../config/aiModels';

// Singleton AI Client instance
let aiClientInstance: GoogleGenAI | null = null;
let currentApiKey: string | null = null;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;

  if (!aiClientInstance || currentApiKey !== apiKey) {
    aiClientInstance = new GoogleGenAI({ apiKey });
    currentApiKey = apiKey;
  }
  return aiClientInstance;
}

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
 * Generates a vector embedding for the given text
 * using @google/genai SDK embedding models with LRU Caching & deterministic fallback.
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

  const ai = getAiClient();
  if (!ai) {
    // No API key (dev/sandbox): return the deterministic fallback WITHOUT
    // caching it — otherwise the hash vector would be pinned until LRU
    // eviction even after a real key becomes available.
    return generateFallbackVector(normalizedText);
  }

  const candidateModels = Array.from(
    new Set([primaryModel, 'gemini-embedding-2', 'text-embedding-004', 'embedding-001']),
  );

  for (const modelName of candidateModels) {
    try {
      const response = await ai.models.embedContent({
        model: modelName,
        contents: normalizedText,
      });

      const res = response as any;
      const embeddingValues = res.embeddings?.[0]?.values || res.embedding?.values;
      if (embeddingValues && Array.isArray(embeddingValues) && embeddingValues.length > 0) {
        const normalized = normalizeTo3072(embeddingValues);
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
