import { GoogleGenAI } from '@google/genai';

/**
 * Generates a vector embedding for the given text
 * using @google/genai SDK text-embedding-004 model.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return generateFallbackVector(text);
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: text,
    });

    const res = response as any;
    if (res.embedding?.values && Array.isArray(res.embedding.values) && res.embedding.values.length > 0) {
      return res.embedding.values;
    }

    throw new Error('Invalid embedding response format.');
  } catch (error) {
    console.error('Error calling Gemini embedding API, falling back to deterministic pseudo-vector:', error);
    return generateFallbackVector(text);
  }
}

/**
 * Generates a deterministic fallback vector of 3072 elements for development/testing
 * when Gemini API key is missing or calls fail.
 */
function generateFallbackVector(text: string): number[] {
  const vector: number[] = new Array(3072).fill(0);
  
  // Create a pseudo-random but deterministic vector based on text characters
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    const index = (i * 31 + charCode) % 3072;
    vector[index] = (vector[index] + charCode / 255.0) / 2.0;
  }

  // Normalize the fallback vector to have unit length
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1.0;
  return vector.map((v) => v / magnitude);
}

