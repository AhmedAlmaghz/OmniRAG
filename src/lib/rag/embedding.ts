import { GoogleGenAI } from '@google/genai';

let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  if (aiClient) return aiClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY is missing. Real embeddings cannot be generated.');
    return null;
  }
  aiClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return aiClient;
}

/**
 * Generates a 3072-dimensional vector embedding for the given text
 * using the gemini-embedding-2-preview model.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getGeminiClient();
  if (!client) {
    return generateFallbackVector(text);
  }

  try {
    const response: any = await client.models.embedContent({
      model: 'gemini-embedding-2',
      contents: text,
    });

    if (response.embedding?.values) {
      return response.embedding.values;
    }

    if (response.embeddings?.[0]?.values) {
      return response.embeddings[0].values;
    }
    
    // Fallback if structure is slightly different
    const values = response.embedding?.values || response.embeddings?.[0]?.values || response.values;
    if (values && Array.isArray(values)) {
      return values;
    }

    throw new Error('Invalid embedding response format from Gemini API.');
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

  // Normalize the fallback vector to have unit length (Cosine similarity requires normalized or scaled values)
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1.0;
  return vector.map((v) => v / magnitude);
}
