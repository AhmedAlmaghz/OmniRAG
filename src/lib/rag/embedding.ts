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
    const fallback = generateFallbackVector(normalizedText);
    setCachedEmbedding(cacheKey, fallback);
    return fallback;
  }

  const candidateModels = Array.from(new Set([primaryModel, 'text-embedding-004', 'embedding-001']));

  for (const modelName of candidateModels) {
    try {
      const response = await ai.models.embedContent({
        model: modelName,
        contents: normalizedText,
      });

      const res = response as any;
      if (res.embedding?.values && Array.isArray(res.embedding.values) && res.embedding.values.length > 0) {
        const normalized = normalizeTo3072(res.embedding.values);
        setCachedEmbedding(cacheKey, normalized);
        return normalized;
      }
    } catch {
      // Proceed to try next candidate model or fallback
    }
  }

  const fallback = generateFallbackVector(normalizedText);
  setCachedEmbedding(cacheKey, fallback);
  return fallback;
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
