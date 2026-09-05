import { createLogger } from '@/lib/logging/logger';

const log = createLogger('LibHttpLongHttpTimeouts');

import { Agent, setGlobalDispatcher } from 'undici';

/**
 * Extends the HTTP timeouts of Node's global fetch.
 *
 * Node's built-in fetch (undici) enforces a ~300 s `headersTimeout` that
 * AbortSignal.timeout does NOT override. Uploading a 15 MB base64 document
 * on a slow uplink (~220 s) plus server-side OCR of dozens of pages blows
 * straight past it, and the caller only sees an opaque "fetch failed".
 *
 * The document-ingestion flow legitimately needs long-running requests, so
 * the global dispatcher is reconfigured once per process. Idempotent.
 */

const LONG_TIMEOUT_MS = 15 * 60 * 1000;

let configured = false;

export function ensureLongHttpTimeouts(): void {
  if (configured) return;
  configured = true;
  try {
    setGlobalDispatcher(
      new Agent({
        headersTimeout: LONG_TIMEOUT_MS,
        bodyTimeout: LONG_TIMEOUT_MS,
      }),
    );
  } catch (err: any) {
    // Non-fatal: callers fall back through the engine chain either way.
    log.warn('[longHttpTimeouts] Could not configure undici dispatcher:', err?.message);
  }
}
