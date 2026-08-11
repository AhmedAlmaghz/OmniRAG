/**
 * Universal Fallback Wrapper for Database Operations
 * Intercepts Firestore / Remote database failures and gracefully falls back to memoryDb
 */

import { memoryDb } from './db';

export async function withFallback<T>(
  operationName: string,
  primaryFn: () => Promise<T>,
  fallbackFn: () => T | Promise<T>
): Promise<T> {
  try {
    return await primaryFn();
  } catch (error) {
    console.warn(
      `[OmniRAG Storage] Primary operation '${operationName}' failed. Falling back to Memory Database.`,
      error instanceof Error ? error.message : error
    );
    return await fallbackFn();
  }
}
