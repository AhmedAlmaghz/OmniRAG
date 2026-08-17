import { AsyncLocalStorage } from 'node:async_hooks';
import { AIModelConfig, registerServerModelConfigGetter } from './aiModels';

/**
 * Server-only companion module to `aiModels.ts`.
 *
 * `aiModels.ts` is imported by client components (for the config presets and
 * the types), so it must NOT import `node:async_hooks` — Turbopack refuses to
 * bundle a Node-only external module into a browser endpoint. The
 * AsyncLocalStorage instance that backs `runWithModelConfig` therefore lives
 * HERE: server routes pull `runWithModelConfig` from this module, and on
 * first import this module registers an active-config getter with
 * `aiModels.ts` so `getAiModel(...)` (which can be called from either side)
 * can reach the per-request config without itself touching AsyncLocalStorage.
 *
 * Import contract: only server code (route handlers, server-side libs) may
 * import from this file. Client components continue to import from
 * `@/lib/config/aiModels`.
 */
const modelConfigAls: AsyncLocalStorage<AIModelConfig> = new AsyncLocalStorage();

/**
 * Runs `fn` with `config` as the active per-request model configuration.
 * Must be called once at the top of each server route handler.
 */
export function runWithModelConfig<T>(config: AIModelConfig, fn: () => Promise<T>): Promise<T> {
  return modelConfigAls.run(config, fn);
}

/**
 * Synchronous variant for code paths that are not async (e.g. a route that
 * builds a response synchronously). Prefer `runWithModelConfig` for handlers.
 */
export function runWithModelConfigSync<T>(config: AIModelConfig, fn: () => T): T {
  return modelConfigAls.run(config, fn);
}

/**
 * Returns the model configuration bound to the current async context, if any.
 * Undefined when called outside a `runWithModelConfig(...)` block.
 */
export function getActiveModelConfig(): AIModelConfig | undefined {
  return modelConfigAls.getStore();
}

// One-time registration: wire `aiModels.ts`'s `getActiveModelConfig` to the
// AsyncLocalStorage store on this server module. Runs at import. Idempotent
// per process — registering a second time simply replaces the getter (the
// server module is a singleton, so in practice this only runs once).
registerServerModelConfigGetter(getActiveModelConfig);
