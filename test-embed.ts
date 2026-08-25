/**
 * Dev utility: smoke-test the embedding pipeline through the same AI SDK v7
 * path production uses (lib/rag/embedding.ts → ai.embed + @ai-sdk/google).
 *
 * Usage: npx tsx test-embed.ts   (loads .env from the project root)
 */
import * as dotenv from 'dotenv';
dotenv.config();
import { embed } from 'ai';
import { getGoogleProvider, resolveGeminiApiKey } from './src/lib/rag/googleProvider';

async function run() {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not configured.');
    process.exit(1);
  }

  // Mirror the production candidate chain from lib/rag/embedding.ts.
  const candidates = ['gemini-embedding-2', 'text-embedding-004', 'embedding-001'];
  for (const modelId of candidates) {
    try {
      const { embedding } = await embed({
        model: (getGoogleProvider() as any).embeddingModel(modelId),
        value: 'hello world',
      });
      console.log(`OK via ${modelId}: ${embedding.length} dims`);
      console.log(JSON.stringify({ model: modelId, dims: embedding.length, head: embedding.slice(0, 8) }, null, 2));
      return;
    } catch (err: any) {
      console.warn(`${modelId} failed: ${err?.message || err}`);
    }
  }
  console.error('All embedding models failed.');
  process.exit(1);
}

run();
