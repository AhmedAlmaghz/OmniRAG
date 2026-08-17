import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { DocumentChunk } from '../types/omnirag';
import { getAiModel } from '../config/aiModels';
import { SYSTEM_CONFIG } from '../config/systemConfig';

/**
 * Re-ranks a list of document chunks based on their semantic relevance to the query
 * using Gemini as a Cross-Encoder (Zero-shot LLM Ranker).
 *
 * `topK` here is only an over-fetch hint inherited from the caller (see engine.ts);
 * `resultChunks` already passed the similarity floor, and the engine applies the
 * defensive CONTEXT_CHUNK_CAP once after reranking. To keep this function's
 * interface honest, it returns the reranked list in thesame order it came in
 * — sorted by blended score — without a fixed-count slice. We still cap how
 * many chunks we send to the LLM at once so we don't blow the model's context
 * window on the rerank prompt itself (a rerank-time token budget, distinct
 * from the retrieval answer pool cap).
 */
const RERANK_LLM_BUDGET = 20;

export async function rerankChunks(
  query: string,
  chunks: DocumentChunk[],
  topK: number = 10,
): Promise<DocumentChunk[]> {
  if (!chunks || chunks.length <= 1) return chunks;

  // Bound how many chunks are passed to the rerank LLM prompt in a single call.
  // This is a *prompt token budget*, not a retrieval cap — chunks beyond it are
  // kept in their incoming (pre-rerank RRF) order, so recall is never lost.
  const chunksToRerank = chunks.length > RERANK_LLM_BUDGET ? chunks.slice(0, RERANK_LLM_BUDGET) : chunks;

  const chunksText = chunksToRerank
    .map((c, i) => {
      // Take a snippet to save tokens
      const snippet = c.content.substring(0, 400).replace(/\n/g, ' ');
      return `[ID: ${i}] Document Title: ${c.documentTitle || 'N/A'}\nSnippet: ${snippet}`;
    })
    .join('\n\n');

  try {
    const analysisModel = getAiModel('analysisModel'); // gemini-3.5-pro or similar

    // We ask Gemini to output an array of scores.
    const { object } = await generateObject({
      model: google(analysisModel),
      schema: z.object({
        rankings: z.array(
          z.object({
            id: z.number().describe('The ID of the chunk from 0 to N'),
            score: z
              .number()
              .min(0)
              .max(10)
              .describe('Relevance score from 0 (completely irrelevant) to 10 (perfectly answers the query)'),
            reasoning: z.string().optional().describe('Brief reason for the score'),
          }),
        ),
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
      const finalScore = normalizedLlmScore * 0.7 + (chunk.score || 0) * 0.3;

      return {
        ...chunk,
        score: Number(finalScore.toFixed(4)),
        originalScore: chunk.score, // preserve original for debugging
      };
    });

    // Re-sort the reranked subset by blended score so the most relevant chunk
    // leads the returned list. Only the reranked subset has updated scores;
    // chunks beyond RERANK_LLM_BUDGET are appended in their incoming RRF
    // order so recall is preserved. The final CONTEXT_CHUNK_CAP is applied
    // once by the engine after this returns — we deliberately do NOT slice to
    // `topK` here.
    scoredChunks.sort((a, b) => (b.score || 0) - (a.score || 0));
    const tail = chunks.slice(scoredChunks.length);
    return [...scoredChunks, ...tail];
  } catch (err) {
    console.error('LLM Reranking failed, falling back to original sort:', err);
    // Preserve the full pool on failure — the engine applies the soft cap.
    return chunks;
  }
}
