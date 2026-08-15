import { GoogleGenAI, GenerateContentParameters, GenerateContentResponse } from '@google/genai';

let aiClientInstance: GoogleGenAI | null = null;
let cachedApiKey: string | null = null;

/**
 * Returns a singleton instance of GoogleGenAI client configured with recommended headers.
 */
export function getResilientAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;

  if (!aiClientInstance || cachedApiKey !== apiKey) {
    aiClientInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedApiKey = apiKey;
  }
  return aiClientInstance;
}

/**
 * Standard list of valid, active Gemini models ordered by resilience.
 */
export const VALID_FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-1.5-flash',
  'gemini-3.7-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.1-pro-preview',
  'gemini-2.5-pro',
  'gemini-1.5-pro',
];

/**
 * Sleep helper for exponential backoff.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Checks if an error is transient (e.g. 503 Unavailable, high demand spike, 429 rate limit, 500, 502, 504).
 */
function isTransientError(error: any): boolean {
  if (!error) return false;
  const str = (typeof error === 'string' ? error : (error.message || JSON.stringify(error))).toLowerCase();
  return (
    str.includes('503') ||
    str.includes('unavailable') ||
    str.includes('high demand') ||
    str.includes('spikes in demand') ||
    str.includes('429') ||
    str.includes('resource_exhausted') ||
    str.includes('quota') ||
    str.includes('500') ||
    str.includes('502') ||
    str.includes('504') ||
    str.includes('timeout') ||
    str.includes('econnreset')
  );
}

export interface ResilientGenerateOptions {
  model?: string;
  fallbackModels?: string[];
  contents: GenerateContentParameters['contents'];
  config?: GenerateContentParameters['config'];
  maxRetriesPerModel?: number;
  initialDelayMs?: number;
}

/**
 * Executes a Gemini API request with automatic exponential backoff retry on transient errors (503/429)
 * and seamless fallback across available models.
 */
export async function generateContentWithResilience(
  options: ResilientGenerateOptions
): Promise<GenerateContentResponse | null> {
  const ai = getResilientAiClient();
  if (!ai) return null;

  const primaryModel = options.model || 'gemini-3.7-flash';
  const modelsToTry: string[] = [
    primaryModel,
    ...(options.fallbackModels || VALID_FALLBACK_MODELS),
  ].filter((m, i, arr) => m && arr.indexOf(m) === i);

  const maxRetries = options.maxRetriesPerModel ?? 2;
  const initialDelay = options.initialDelayMs ?? 400;

  for (const modelName of modelsToTry) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: options.contents,
          config: options.config,
        });

        if (response) {
          return response;
        }
      } catch (err: any) {
        const transient = isTransientError(err);
        const isLastAttempt = attempt === maxRetries;

        if (transient && !isLastAttempt) {
          // Exponential backoff with small random jitter
          const backoff = initialDelay * Math.pow(2, attempt) + Math.random() * 200;
          await sleep(backoff);
          continue;
        }

        // Move on to the next fallback model in the list
        break;
      }
    }
  }

  return null;
}
