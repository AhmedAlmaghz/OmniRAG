/**
 * Mistral OCR Cache Manager
 * Provides client-side (localStorage/In-Memory) & server-side caching layer for processed OCR results
 * to prevent redundant API calls and save tokens on large documents.
 */

export interface OcrCacheEntry {
  cacheKey: string; // Unique SHA-256 or content key
  fileName: string;
  fileSize: number;
  mimeType: string;
  engineUsed: string;
  extractedText: string;
  totalPages: number;
  chunksProcessed: number;
  cachedAt: number;
  hits: number;
  pages?: { pageNumber: number; text: string }[];
  savedTokensEstimate?: number;
}

const STORAGE_KEY = 'omnirag_mistral_ocr_cache_v1';
const MEMORY_CACHE = new Map<string, OcrCacheEntry>();

/**
 * Generate a deterministic SHA-256 hash or composite key for a file/buffer
 */
export async function generateFileHash(
  fileOrBuffer: File | Blob | ArrayBuffer | Buffer | string,
  fileName: string = '',
  fileSize: number = 0
): Promise<string> {
  try {
    let buffer: ArrayBuffer;

    if (typeof fileOrBuffer === 'string') {
      const encoder = new TextEncoder();
      const u8 = encoder.encode(fileOrBuffer);
      buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    } else if (fileOrBuffer instanceof ArrayBuffer) {
      buffer = fileOrBuffer;
    } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(fileOrBuffer)) {
      const u8 = new Uint8Array(fileOrBuffer);
      buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    } else if (fileOrBuffer instanceof Blob || (typeof File !== 'undefined' && fileOrBuffer instanceof File)) {
      buffer = await fileOrBuffer.arrayBuffer();
    } else {
      // Fallback string hash
      return `hash_${fileName}_${fileSize}_${Date.now()}`;
    }

    // Use Web Crypto API if available
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      return hashHex;
    }

    // Node.js crypto fallback
    if (typeof require !== 'undefined') {
      try {
        const cryptoModule = require('crypto');
        return cryptoModule.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
      } catch (e) {}
    }

    // Fast FNV-1a non-crypto hash fallback if crypto is unavailable
    const bytes = new Uint8Array(buffer);
    let h1 = 0x811c9dc5;
    for (let i = 0; i < Math.min(bytes.length, 100000); i++) {
      h1 ^= bytes[i];
      h1 = Math.imul(h1, 0x01000193);
    }
    return `fnv_${(h1 >>> 0).toString(16)}_${fileName}_${fileSize}`;
  } catch (err) {
    console.warn('[Mistral OCR Cache] Failed to generate hash, using fallback composite key:', err);
    return `key_${fileName.replace(/[^a-zA-Z0-9]/g, '_')}_${fileSize}`;
  }
}

/**
 * Get cached OCR entry by hash key
 */
export function getOcrCacheEntry(cacheKey: string): OcrCacheEntry | null {
  if (!cacheKey) return null;

  // 1. Check in-memory cache first
  if (MEMORY_CACHE.has(cacheKey)) {
    const entry = MEMORY_CACHE.get(cacheKey)!;
    entry.hits += 1; // Increment hit counter
    MEMORY_CACHE.set(cacheKey, entry);
    persistMemoryCacheToLocalStorage();
    return entry;
  }

  // 2. Check localStorage in browser
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const cacheObj: Record<string, OcrCacheEntry> = JSON.parse(raw);
        if (cacheObj[cacheKey]) {
          const entry = cacheObj[cacheKey];
          entry.hits = (entry.hits || 0) + 1;
          cacheObj[cacheKey] = entry;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheObj));
          MEMORY_CACHE.set(cacheKey, entry);
          return entry;
        }
      }
    } catch (e) {
      console.warn('[Mistral OCR Cache] Error reading from localStorage:', e);
    }
  }

  return null;
}

/**
 * Save OCR result into cache
 */
export function saveOcrCacheEntry(entry: OcrCacheEntry): void {
  if (!entry.cacheKey) return;

  const savedTokens = Math.round(entry.extractedText.length / 4);
  const fullEntry: OcrCacheEntry = {
    ...entry,
    savedTokensEstimate: savedTokens,
    cachedAt: entry.cachedAt || Date.now(),
    hits: entry.hits || 0,
  };

  // 1. Save to in-memory map
  MEMORY_CACHE.set(entry.cacheKey, fullEntry);

  // 2. Save to localStorage
  if (typeof window !== 'undefined') {
    try {
      let cacheObj: Record<string, OcrCacheEntry> = {};
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          cacheObj = JSON.parse(raw);
        } catch (e) {}
      }

      // Limit localStorage entries to prevent storage quota overflow (max 50 cached docs)
      const keys = Object.keys(cacheObj);
      if (keys.length >= 50) {
        const oldestKey = keys.sort((a, b) => cacheObj[a].cachedAt - cacheObj[b].cachedAt)[0];
        delete cacheObj[oldestKey];
      }

      cacheObj[entry.cacheKey] = fullEntry;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheObj));
      
      // Dispatch custom browser event so KnowledgeBase UI updates live
      window.dispatchEvent(new CustomEvent('omnirag-ocr-cache-updated', { detail: fullEntry }));
    } catch (e) {
      console.warn('[Mistral OCR Cache] Failed to write to localStorage:', e);
    }
  }
}

/**
 * Delete specific OCR entry
 */
export function deleteOcrCacheEntry(cacheKey: string): void {
  MEMORY_CACHE.delete(cacheKey);

  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const cacheObj: Record<string, OcrCacheEntry> = JSON.parse(raw);
        delete cacheObj[cacheKey];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheObj));
        window.dispatchEvent(new CustomEvent('omnirag-ocr-cache-updated'));
      }
    } catch (e) {}
  }
}

/**
 * Clear all cached OCR entries
 */
export function clearAllOcrCache(): void {
  MEMORY_CACHE.clear();

  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new CustomEvent('omnirag-ocr-cache-updated'));
    } catch (e) {}
  }
}

/**
 * Retrieve all cached OCR entries
 */
export function getAllOcrCacheEntries(): OcrCacheEntry[] {
  const result: OcrCacheEntry[] = [];

  // Populate from localStorage
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const cacheObj: Record<string, OcrCacheEntry> = JSON.parse(raw);
        Object.values(cacheObj).forEach((entry) => {
          MEMORY_CACHE.set(entry.cacheKey, entry);
          result.push(entry);
        });
        return result.sort((a, b) => b.cachedAt - a.cachedAt);
      }
    } catch (e) {}
  }

  return Array.from(MEMORY_CACHE.values()).sort((a, b) => b.cachedAt - a.cachedAt);
}

/**
 * Get aggregate cache statistics
 */
export function getOcrCacheStats(): {
  count: number;
  totalHits: number;
  savedBytes: number;
  savedTokens: number;
  totalPages: number;
  sizeKb: number;
} {
  const entries = getAllOcrCacheEntries();
  let totalHits = 0;
  let savedBytes = 0;
  let savedTokens = 0;
  let totalPages = 0;
  let totalChars = 0;

  entries.forEach((e) => {
    totalHits += e.hits || 0;
    savedBytes += e.fileSize || 0;
    savedTokens += e.savedTokensEstimate || Math.round(e.extractedText.length / 4);
    totalPages += e.totalPages || 1;
    totalChars += e.extractedText.length;
  });

  return {
    count: entries.length,
    totalHits,
    savedBytes,
    savedTokens: savedTokens * (totalHits + 1), // Estimated tokens saved across calls
    totalPages,
    sizeKb: Math.round(totalChars / 1024),
  };
}

// IndexedDB persistence for large document OCR cache
const IDB_NAME = 'omnirag_ocr_db_v1';
const IDB_STORE = 'ocr_entries';

function openOcrIndexedDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'cacheKey' });
        }
      };
      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };
      request.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

export async function getIndexedDBEntry(cacheKey: string): Promise<OcrCacheEntry | null> {
  const db = await openOcrIndexedDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(cacheKey);
      req.onsuccess = () => resolve((req.result as OcrCacheEntry) || null);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

export async function saveIndexedDBEntry(entry: OcrCacheEntry): Promise<void> {
  const db = await openOcrIndexedDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
}

export async function deleteIndexedDBEntry(cacheKey: string): Promise<void> {
  const db = await openOcrIndexedDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.delete(cacheKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
}

export async function clearIndexedDB(): Promise<void> {
  const db = await openOcrIndexedDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
}

function persistMemoryCacheToLocalStorage(): void {
  if (typeof window !== 'undefined') {
    try {
      const cacheObj: Record<string, OcrCacheEntry> = {};
      MEMORY_CACHE.forEach((val, key) => {
        cacheObj[key] = val;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheObj));
    } catch (e) {}
  }
}
