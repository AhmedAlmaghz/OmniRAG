import { getActiveRequestContext } from '../config/requestContext';

/**
 * Zero-dependency structured logger for OmniRAG server code (v0.12.8).
 *
 * Why not console.* directly: raw console output carries no request identity,
 * is unparseable in serverless log drains, and mixes dev formatting with
 * production telemetry. Why not pino: the app runs on Vercel edge/serverless,
 * Docker and Cloud Run — a single-file implementation with no dependency and
 * no worker thread keeps every runtime identical.
 *
 * Behavior (per call, so tests and tools can flip NODE_ENV dynamically):
 * - Production (`NODE_ENV=production`): ONE-LINE JSON per record → parseable
 *   by Vercel/Datadog/CloudWatch drains. Level → stream mapping: error/warn
 *   → stderr, info/debug → stdout.
 * - Development: human-readable `[component] msg key=value` — error stacks are
 *   printed verbatim below the line for copy-paste debugging.
 *
 * Context injection: when a request is active (`runWithRequestContext`),
 * requestId/tenantId/userId/apiKeyId are attached automatically — callers never
 * thread them by hand.
 *
 * Redaction: top-level fields whose key matches the denylist are replaced with
 * '[redacted]' before serialization, so a stray `log.info('auth', { apiKey })`
 * cannot leak credentials into a log drain. This is a last-resort guard, not a
 * substitute for not logging secrets.
 *
 * Server-only: imports requestContext (node:async_hooks). Client components
 * must never import this module.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Top-level field keys that must never reach a log drain. */
const REDACTED_KEYS =
  /^(password|passwd|secret|api[-_]?key|authorization|cookie|token|session[_-]?token|client[_-]?secret)$/i;
const REDACTED = '[redacted]';

const isProduction = () => process.env.NODE_ENV === 'production';

const minLevel = (): LogLevel => {
  const configured = (process.env.LOG_LEVEL || '').toLowerCase() as LogLevel;
  if (configured && configured in LEVEL_ORDER) return configured;
  return isProduction() ? 'info' : 'debug';
};

function scrub(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (value instanceof Error) return serializeError(value);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.test(k) ? REDACTED : scrub(v);
    }
    return out;
  }
  return value;
}

function serializeError(err: Error): Record<string, unknown> {
  return { name: err.name, message: err.message, stack: err.stack };
}

/** Turn a console-style argument list into structured fields. */
function serializeRest(rest: unknown[]): Record<string, unknown> {
  if (rest.length === 0) return {};
  if (rest.length === 1) {
    const [arg] = rest;
    if (arg instanceof Error) return { err: serializeError(arg) };
    if (arg !== null && typeof arg === 'object') {
      const scrubbed = scrub(arg) as Record<string, unknown>;
      // A single plain object spreads as fields (natural migration from
      // `console.log(msg, { a, b })` call sites).
      return scrubbed && typeof scrubbed === 'object' && !Array.isArray(scrubbed) ? scrubbed : { value: scrubbed };
    }
    return { value: arg };
  }
  return { args: rest.map((a) => (a instanceof Error ? serializeError(a) : scrub(a))) };
}

function contextFields(): Record<string, unknown> {
  const ctx = getActiveRequestContext();
  if (!ctx) return {};
  const fields: Record<string, unknown> = {};
  if (ctx.requestId) fields.requestId = ctx.requestId;
  if (ctx.tenantId) fields.tenantId = ctx.tenantId;
  if (ctx.userId) fields.userId = ctx.userId;
  if (ctx.apiKeyId) fields.apiKeyId = ctx.apiKeyId;
  return fields;
}

function emit(level: LogLevel, component: string, msg: string, rest: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel()]) return;

  const fields = { ...contextFields(), ...serializeRest(rest) };

  if (isProduction()) {
    const record = JSON.stringify({ ts: new Date().toISOString(), level, component, msg, ...fields });
    if (level === 'error' || level === 'warn') console.error(record);
    else console.log(record);
    return;
  }

  const ctxParts = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  const line = `[${component}] ${msg}${ctxParts ? ` ${ctxParts}` : ''}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, ...rest: unknown[]): void;
  info(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  error(msg: string, ...rest: unknown[]): void;
}

/** Create a component-scoped logger, e.g. `const log = createLogger('PostgresStorage')`. */
export function createLogger(component: string): Logger {
  return {
    debug: (msg, ...rest) => emit('debug', component, msg, rest),
    info: (msg, ...rest) => emit('info', component, msg, rest),
    warn: (msg, ...rest) => emit('warn', component, msg, rest),
    error: (msg, ...rest) => emit('error', component, msg, rest),
  };
}
