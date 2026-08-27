import { PgBoss } from 'pg-boss';

/**
 * Background job queue built on pg-boss (Postgres-backed, no Redis). This is
 * the queue side of the "queues & scheduling" phase: durable jobs survive
 * restarts, and the same module powers both deployment targets —
 *   - Docker / self-hosted: a persistent worker started at server boot
 *     (src/instrumentation.ts) processes jobs as they arrive.
 *   - Vercel / serverless: a cron-triggered route (/api/v1/jobs/tick) starts
 *     the queue, fires due schedules, and processes jobs for the request's
 *     lifetime.
 *
 * The queue is an OPTIONAL enhancement: without a Postgres connection string
 * every helper degrades honestly (returns null/false) and the app keeps
 * working exactly as before (manual + create-time sync only).
 */

export const CONNECTOR_SYNC_QUEUE = 'connector.sync';
export const DOCUMENT_REINDEX_QUEUE = 'document.reindex';

let bossPromise: Promise<PgBoss | null> | null = null;

function resolveConnectionString(): string {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
}

/** True when a Postgres connection string is present (queue can run). */
export function isJobQueueAvailable(): boolean {
  return Boolean(resolveConnectionString());
}

/**
 * Returns the shared, started PgBoss instance, or null when Postgres is
 * unavailable. Starting runs pg-boss's schema migration (creates the pgboss
 * schema) and its internal supervisor + cron worker.
 *
 * `cronWorkerIntervalSeconds` is kept low so scheduled connector syncs fire
 * promptly even inside a short-lived serverless tick request.
 */
export function getJobQueue(): Promise<PgBoss | null> {
  const connectionString = resolveConnectionString();
  if (!connectionString) return Promise.resolve(null);

  if (!bossPromise) {
    bossPromise = (async () => {
      try {
        const boss = new PgBoss({
          connectionString,
          // Fire due cron schedules frequently (matters on serverless ticks).
          cronWorkerIntervalSeconds: 15,
          clockMonitorIntervalSeconds: 15,
        });
        boss.on('error', (err: Error) => console.error('[JobQueue] pg-boss error:', err));
        await boss.start();
        console.log('[JobQueue] pg-boss started — background jobs enabled.');
        return boss;
      } catch (err) {
        console.error('[JobQueue] Failed to start pg-boss — background jobs disabled:', err);
        bossPromise = null;
        return null;
      }
    })();
  }
  return bossPromise;
}

/** Stops the shared instance (used by tests / graceful shutdown). */
export async function stopJobQueue(): Promise<void> {
  if (!bossPromise) return;
  const promise = bossPromise;
  bossPromise = null;
  const boss = await promise;
  if (boss) {
    try {
      await boss.stop();
    } catch {
      /* best effort */
    }
  }
}
