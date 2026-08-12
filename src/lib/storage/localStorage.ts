/**
 * LocalStorage Persistence Layer for Demo/Offline Mode
 *
 * Provides a durable client-side fallback so that MCP servers, sources,
 * and other tenant data survive page refreshes when Firestore is unavailable
 * or in demo mode. This complements the server-side memory database by
 * persisting data in the browser.
 */

const STORAGE_PREFIX = 'omnirag-';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface StoredItem<T> {
    data: T;
    timestamp: number;
    expiresAt: number;
}

/**
 * Save data to localStorage with a TTL wrapper.
 */
export function persistLocal<T>(key: string, data: T, ttlMs: number = TTL_MS): boolean {
    if (typeof window === 'undefined') return false;
    try {
        const item: StoredItem<T> = {
            data,
            timestamp: Date.now(),
            expiresAt: Date.now() + ttlMs,
        };
        const fullKey = `${STORAGE_PREFIX}${key}`;
        localStorage.setItem(fullKey, JSON.stringify(item));
        return true;
    } catch (e) {
        console.warn('LocalStorage persist failed:', e);
        return false;
    }
}

/**
 * Load data from localStorage if it exists and hasn't expired.
 */
export function loadLocal<T>(key: string): T | null {
    if (typeof window === 'undefined') return null;
    try {
        const fullKey = `${STORAGE_PREFIX}${key}`;
        const raw = localStorage.getItem(fullKey);
        if (!raw) return null;

        const item: StoredItem<T> = JSON.parse(raw);
        if (Date.now() > item.expiresAt) {
            localStorage.removeItem(fullKey);
            return null;
        }
        return item.data;
    } catch (e) {
        console.warn('LocalStorage load failed:', e);
        return null;
    }
}

/**
 * Remove a specific key from localStorage.
 */
export function clearLocal(key: string): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
    } catch (e) {
        console.warn('LocalStorage clear failed:', e);
    }
}

/**
 * Clear all OmniRAG-prefixed keys from localStorage.
 */
export function clearAllLocal(): void {
    if (typeof window === 'undefined') return;
    try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(STORAGE_PREFIX)) {
                keysToRemove.push(k);
            }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch (e) {
        console.warn('LocalStorage clearAll failed:', e);
    }
}

/**
 * Check if localStorage is available in the current environment.
 */
export function isLocalStorageAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        const testKey = `${STORAGE_PREFIX}__test__`;
        localStorage.setItem(testKey, '1');
        localStorage.removeItem(testKey);
        return true;
    } catch {
        return false;
    }
}

// ===== Tenant-specific helpers =====

/**
 * Build a tenant-scoped storage key.
 */
export function tenantKey(tenantId: string, entity: string): string {
    return `${tenantId}:${entity}`;
}

/**
 * Persist MCP servers for a specific tenant.
 */
export function persistMcpServers(tenantId: string, servers: any[]): boolean {
    return persistLocal(tenantKey(tenantId, 'mcp-servers'), servers);
}

/**
 * Load MCP servers for a specific tenant.
 */
export function loadMcpServers(tenantId: string): any[] | null {
    return loadLocal<any[]>(tenantKey(tenantId, 'mcp-servers'));
}

/**
 * Persist source connectors for a specific tenant.
 */
export function persistSources(tenantId: string, sources: any[]): boolean {
    return persistLocal(tenantKey(tenantId, 'sources'), sources);
}

/**
 * Load source connectors for a specific tenant.
 */
export function loadSources(tenantId: string): any[] | null {
    return loadLocal<any[]>(tenantKey(tenantId, 'sources'));
}

/**
 * Persist sync logs for a specific tenant.
 */
export function persistSyncLogs(tenantId: string, logs: any[]): boolean {
    return persistLocal(tenantKey(tenantId, 'sync-logs'), logs);
}

/**
 * Load sync logs for a specific tenant.
 */
export function loadSyncLogs(tenantId: string): any[] | null {
    return loadLocal<any[]>(tenantKey(tenantId, 'sync-logs'));
}

/**
 * Persist collections for a specific tenant.
 */
export function persistCollections(tenantId: string, collections: any[]): boolean {
    return persistLocal(tenantKey(tenantId, 'collections'), collections);
}

/**
 * Load collections for a specific tenant.
 */
export function loadCollections(tenantId: string): any[] | null {
    return loadLocal<any[]>(tenantKey(tenantId, 'collections'));
}
