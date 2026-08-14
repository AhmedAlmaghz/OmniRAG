'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  OcrCacheEntry,
  generateFileHash,
  getOcrCacheEntry,
  saveOcrCacheEntry,
  deleteOcrCacheEntry,
  clearAllOcrCache,
  getAllOcrCacheEntries,
  getOcrCacheStats,
  getIndexedDBEntry,
  saveIndexedDBEntry,
  deleteIndexedDBEntry,
  clearIndexedDB,
} from '@/lib/cache/mistralOcrCache';

export interface UseDocumentCacheReturn {
  cacheEntries: OcrCacheEntry[];
  cacheStats: {
    count: number;
    totalHits: number;
    savedBytes: number;
    savedTokens: number;
    totalPages: number;
    sizeKb: number;
  };
  isLoading: boolean;
  isStorageSupported: boolean;
  getCache: (
    fileOrHash: File | Blob | ArrayBuffer | string,
    fileName?: string,
    fileSize?: number
  ) => Promise<{ entry: OcrCacheEntry | null; cacheKey: string }>;
  saveCache: (entry: OcrCacheEntry) => Promise<void>;
  deleteCache: (cacheKey: string) => Promise<void>;
  clearCache: () => Promise<void>;
  refreshCache: () => void;
}

/**
 * React Hook for managing document OCR cache with localStorage & IndexedDB fallback.
 * Prevents redundant Mistral OCR API calls for previously processed files.
 */
export function useDocumentCache(): UseDocumentCacheReturn {
  const [cacheEntries, setCacheEntries] = useState<OcrCacheEntry[]>([]);
  const [cacheStats, setCacheStats] = useState(getOcrCacheStats());
  const [isLoading, setIsLoading] = useState(true);
  const [isStorageSupported, setIsStorageSupported] = useState(true);

  const refreshCache = useCallback(() => {
    setIsLoading(true);
    try {
      const entries = getAllOcrCacheEntries();
      setCacheEntries(entries);
      setCacheStats(getOcrCacheStats());
    } catch (e) {
      console.warn('[useDocumentCache] Error loading cache:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsStorageSupported(Boolean(window.localStorage || window.indexedDB));
    }
    refreshCache();

    const handleCacheUpdated = () => {
      refreshCache();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('omnirag-ocr-cache-updated', handleCacheUpdated);
      window.addEventListener('storage', handleCacheUpdated);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('omnirag-ocr-cache-updated', handleCacheUpdated);
        window.removeEventListener('storage', handleCacheUpdated);
      }
    };
  }, [refreshCache]);

  const getCache = useCallback(
    async (
      fileOrHash: File | Blob | ArrayBuffer | string,
      fileName: string = '',
      fileSize: number = 0
    ): Promise<{ entry: OcrCacheEntry | null; cacheKey: string }> => {
      let cacheKey =
        typeof fileOrHash === 'string' && fileOrHash.length >= 32 && !fileOrHash.includes(' ')
          ? fileOrHash
          : await generateFileHash(fileOrHash, fileName, fileSize);

      // 1. Check synchronous Memory / LocalStorage cache first
      let entry = getOcrCacheEntry(cacheKey);

      // 2. Check IndexedDB if sync cache missed
      if (!entry && typeof window !== 'undefined' && 'indexedDB' in window) {
        entry = await getIndexedDBEntry(cacheKey);
        if (entry) {
          saveOcrCacheEntry(entry);
        }
      }

      return { entry, cacheKey };
    },
    []
  );

  const saveCache = useCallback(
    async (entry: OcrCacheEntry): Promise<void> => {
      saveOcrCacheEntry(entry);
      if (typeof window !== 'undefined' && 'indexedDB' in window) {
        await saveIndexedDBEntry(entry);
      }
      refreshCache();
    },
    [refreshCache]
  );

  const deleteCache = useCallback(
    async (cacheKey: string): Promise<void> => {
      deleteOcrCacheEntry(cacheKey);
      if (typeof window !== 'undefined' && 'indexedDB' in window) {
        await deleteIndexedDBEntry(cacheKey);
      }
      refreshCache();
    },
    [refreshCache]
  );

  const clearCache = useCallback(async (): Promise<void> => {
    clearAllOcrCache();
    if (typeof window !== 'undefined' && 'indexedDB' in window) {
      await clearIndexedDB();
    }
    refreshCache();
  }, [refreshCache]);

  return {
    cacheEntries,
    cacheStats,
    isLoading,
    isStorageSupported,
    getCache,
    saveCache,
    deleteCache,
    clearCache,
    refreshCache,
  };
}
