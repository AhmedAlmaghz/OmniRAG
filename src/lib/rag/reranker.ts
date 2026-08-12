import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { DocumentChunk } from '../types/omnirag';
import { getAiModel } from '../config/aiModels';

/**
 * Re-ranks a list of document chunks based on their semantic relevance to the query 
 * using Gemini as a Cross-Encoder (Zero-shot LLM Ranker).
 */
export async function rerankChunks(
  query: string,
  chunks: DocumentChunk[],
  topK: number = 5
): Promise<DocumentChunk[]> {
  if (!chunks || chunks.length <= 1) return chunks;

  // Truncate to limit tokens
  const maxChunksToRerank = Math.min(chunks.length, 15);
  const chunksToRerank = chunks.slice(0, maxChunksToRerank);
  
  const chunksText = chunksToRerank.map((c, i) => {
    // Take a snippet to save tokens
    const snippet = c.content.substring(0, 400).replace(/\n/g, ' ');
    return `[ID: ${i}] Document Title: ${c.documentTitle || 'N/A'}\nSnippet: ${snippet}`;
  }).join('\n\n');

  try {
    const analysisModel = getAiModel('analysisModel'); // gemini-3.5-pro or similar
    
    // We ask Gemini to output an array of scores.
    const { object } = await generateObject({
      model: google(analysisModel),
      schema: z.object({
        rankings: z.array(z.object({
          id: z.number().describe('The ID of the chunk from 0 to N'),
          score: z.number().min(0).max(10).describe('Relevance score from 0 (completely irrelevant) to 10 (perfectly answers the query)'),
          reasoning: z.string().optional().describe('Brief reason for the score')
        }))
      }),
      prompt: `
You are an expert search quality evaluator. Your task is to evaluate the relevance of several document chunks to a user's search query.

User Query: "${query}"

Here are the document chunks:
${chunksText}

Evaluate each chunk and assign it a relevance score from 0.0 to 10.0. 
- 10.0 means it perfectly and directly answers the query.
- 5.0 means it is partially relevant or contains related context.
- 0.0 means it is completely irrelevant.
      `,
    });

    const scoresMap = new Map<number, number>();
    for (const r of object.rankings) {
      scoresMap.set(r.id, r.score);
    }

    // Apply the new scores and sort
    const scoredChunks = chunksToRerank.map((chunk, index) => {
      const llmScore = scoresMap.get(index) ?? 0;
      // Normalize LLM score to 0-1 range and blend with original RRF score
      const normalizedLlmScore = llmScore / 10.0;
      // Weight: 70% LLM Reranker, 30% original RRF score
      const finalScore = (normalizedLlmScore * 0.7) + ((chunk.score || 0) * 0.3);
      
      return {
        ...chunk,
        score: Number(finalScore.toFixed(4)),
        originalScore: chunk.score // preserve original for debugging
      };
    });

    // Sort descending
    scoredChunks.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Return the topK
    return scoredChunks.slice(0, topK);

  } catch (err) {
    console.error('LLM Reranking failed, falling back to original sort:', err);
    return chunks.slice(0, topK);
  }
}
