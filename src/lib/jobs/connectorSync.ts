import { db } from '../storage/db';
import { getJobQueue, CONNECTOR_SYNC_QUEUE } from './queue';
import type { Job } from 'pg-boss';
import { DEFAULT_AI_MODELS } from '../config/aiModels';
import { runWithModelConfig } from '../config/aiModelsServer';

/**
 * connector.sync job — executes a knowledge-source sync through the existing
 * db.syncSource pipeline (extraction → chunking → embedding → indexing). This
 * is the executor that `syncSchedule` cron entries were previously stored
 * without; the scheduler in reconcileConnectorSchedules() wires each source's
 * cron to this queue via pg-boss.
 *
 * MODEL-CONFIG CONSTRAINT: this worker has NO HTTP request, so the user's
 * per-request model choices (x-ai-model-config header / browser cookie) cannot
 * reach it — scheduled syncs intentionally run with DEFAULT_AI_MODELS, bound
 * explicitly below so getAiModel() inside the pipeline never resolves to an
 * accidental ambient context. Interactive syncs (the sync route) DO bind the
 * user's config. Storing model preferences per-tenant in the DB would lift
 * this limitation — out of scope, documented here for the next reader.
 */

export interface ConnectorSyncJobData {
  sourceId: string;
  tenantId: string;
}

/** Minimal 5-field cron shape check (pg-boss parses/validates the real thing). */
export function isCronSchedule(expr: string | undefined | null): boolean {
  if (!expr || expr === 'manual') return false;
  const trimmed = expr.trim();
  if (trimmed.startsWith('@')) return true; // @hourly / @daily / ...
  return trimmed.split(/\s+/).length === 5;
}

/**
 * Enqueues an immediate sync for one source. Uses a singleton key so repeated
 * triggers within the window collapse into a single queued job (no duplicate
 * sync storms). Returns false when the queue is unavailable.
 */
export async function enqueueConnectorSync(sourceId: string, tenantId: string): Promise<boolean> {
  const boss = await getJobQueue();
  if (!boss) return false;
  try {
    await boss.send(CONNECTOR_SYNC_QUEUE, { sourceId, tenantId } satisfies ConnectorSyncJobData, {
      singletonKey: `sync-${sourceId}`,
      singletonSeconds: 300,
    });
    return true;
  } catch (err) {
    console.error(`[ConnectorSync] Failed to enqueue sync for ${sourceId}:`, err);
    return false;
  }
}

let workerRegistered = false;

/**
 * Registers the worker that processes connector.sync jobs. Idempotent. On
 * Docker this runs for the process lifetime; on Vercel it processes whatever
 * is queued during the tick request.
 */
export async function startConnectorSyncWorker(): Promise<boolean> {
  const boss = await getJobQueue();
  if (!boss) return false;
  if (workerRegistered) return true;

  await boss.work<ConnectorSyncJobData>(CONNECTOR_SYNC_QUEUE, async (jobs: Job<ConnectorSyncJobData>[]) => {
    for (const job of jobs) {
      const { sourceId, tenantId } = job.data || ({} as ConnectorSyncJobData);
      if (!sourceId || !tenantId) continue;
      // No request context exists here — bind DEFAULT_AI_MODELS explicitly so
      // the pipeline's getAiModel() calls are deterministic (see header note).
      await runWithModelConfig({ ...DEFAULT_AI_MODELS }, async () => {
        try {
          const result = await db.syncSource(sourceId, tenantId);
          if (!result.success) {
            console.warn(`[ConnectorSync] Sync reported failure for source ${sourceId}.`);
          }
        } catch (err) {
          // syncSource already records failure state/logs; this guards the worker.
          console.error(`[ConnectorSync] Sync threw for source ${sourceId}:`, err);
        }
      });
    }
  });

  workerRegistered = true;
  console.log(`[ConnectorSync] Worker registered on queue "${CONNECTOR_SYNC_QUEUE}".`);
  return true;
}

/**
 * Reconciles pg-boss cron schedules with the sources table: every source whose
 * syncSchedule is a real cron gets a keyed schedule on the connector.sync
 * queue; schedules whose source was deleted or switched to manual are removed.
 * Returns the number of active schedules. No-op (0) without a queue.
 */
export async function reconcileConnectorSchedules(): Promise<number> {
  const boss = await getJobQueue();
  if (!boss) return 0;

  try {
    const scheduled = await db.getScheduledSources();
    const wanted = scheduled.filter((s) => isCronSchedule(s.syncSchedule));

    for (const source of wanted) {
      await boss.schedule(
        CONNECTOR_SYNC_QUEUE,
        source.syncSchedule,
        { sourceId: source.id, tenantId: source.tenantId } satisfies ConnectorSyncJobData,
        { key: source.id },
      );
    }

    // Drop stale schedules (deleted sources / switched to manual).
    const existing = await boss.getSchedules(CONNECTOR_SYNC_QUEUE);
    const wantedIds = new Set(wanted.map((s) => s.id));
    for (const schedule of existing) {
      if (schedule.key && !wantedIds.has(schedule.key)) {
        await boss.unschedule(CONNECTOR_SYNC_QUEUE, schedule.key);
      }
    }

    return wanted.length;
  } catch (err) {
    console.error('[ConnectorSync] Schedule reconciliation failed:', err);
    return 0;
  }
}
