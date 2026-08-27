/**
 * Next.js instrumentation hook — runs once at server startup (Node.js runtime).
 *
 * On Docker / self-hosted deployments this boots the persistent background job
 * worker: a pg-boss instance that fires each connector's syncSchedule cron and
 * processes the resulting connector.sync jobs for the life of the process.
 *
 * On Vercel there is no persistent process, so this bootstrap is skipped and
 * the /api/v1/jobs/tick route (driven by Vercel Cron) provides the worker via
 * polling instead. See SDLC ADR-013.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Serverless hosts get their worker from the tick route, not a boot loop.
  if (process.env.VERCEL) return;
  if (process.env.ENABLE_JOB_WORKER === 'false') return;

  const { isJobQueueAvailable } = await import('./lib/jobs/queue');
  if (!isJobQueueAvailable()) return;

  const { startConnectorSyncWorker, reconcileConnectorSchedules } = await import('./lib/jobs/connectorSync');
  try {
    const started = await startConnectorSyncWorker();
    if (!started) return;
    const scheduled = await reconcileConnectorSchedules();
    console.log(`[instrumentation] Background connector-sync worker active (${scheduled} scheduled sources).`);

    // Re-reconcile periodically so newly created/updated/deleted sources are
    // reflected in the cron schedules without a restart.
    const interval = setInterval(
      () => {
        reconcileConnectorSchedules().catch(() => {});
      },
      5 * 60 * 1000,
    );
    interval.unref?.();
  } catch (err) {
    console.error('[instrumentation] Failed to start background job worker:', err);
  }
}
