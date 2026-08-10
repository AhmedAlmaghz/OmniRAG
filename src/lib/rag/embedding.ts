import { GoogleGenAI } from '@google/genai';
import { getAiModel } from '../config/aiModels';

/**
 * Generates a vector embedding for the given text
 * using @google/genai SDK embedding models with deterministic fallback.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return generateFallbackVector(text);
  }

  const primaryModel = getAiModel('embeddingModel');
  const candidateModels = Array.from(new Set([primaryModel, 'text-embedding-004', 'embedding-001']));

  for (const modelName of candidateModels) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.embedContent({
        model: modelName,
        contents: text,
      });

      const res = response as any;
      if (res.embedding?.values && Array.isArray(res.embedding.values) && res.embedding.values.length > 0) {
        return normalizeTo3072(res.embedding.values);
      }
    } catch {
      // Proceed to try next model or graceful fallback
    }
  }

  return generateFallbackVector(text);
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

