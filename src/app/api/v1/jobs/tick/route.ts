import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue, isJobQueueAvailable } from '@/lib/jobs/queue';
import { startConnectorSyncWorker, reconcileConnectorSchedules } from '@/lib/jobs/connectorSync';

export const dynamic = 'force-dynamic';
// Keep the function alive long enough for pg-boss to fire due schedules and for
// the worker to process the resulting jobs. Literal required by Next's analyzer.
export const maxDuration = 60;

/**
 * Serverless job-worker tick (Vercel Cron target).
 *
 * Vercel has no persistent process, so this route IS the worker: each cron hit
 * starts the pg-boss queue, reconciles connector cron schedules, registers the
 * connector.sync worker, and holds the request open while pg-boss fires due
 * schedules and the worker processes them. Docker/self-hosted deployments use
 * the persistent worker from src/instrumentation.ts instead and do not need
 * this route (it still works harmlessly if called).
 *
 * Auth: machine-to-machine. Vercel Cron sends `Authorization: Bearer <secret>`
 * when CRON_SECRET is configured; we accept CRON_SECRET or JOBS_TICK_SECRET.
 * With no secret configured the endpoint is refused in production.
 */

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.JOBS_TICK_SECRET;
  if (!secret) {
    // Open ticks are only acceptable outside production (local dev).
    return process.env.NODE_ENV !== 'production';
  }
  const header = req.headers.get('authorization') || '';
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isJobQueueAvailable()) {
    return NextResponse.json({
      ok: false,
      reason: 'job queue unavailable — set DATABASE_URL/POSTGRES_URL to enable background sync',
    });
  }

  const boss = await getJobQueue();
  if (!boss) {
    return NextResponse.json({ ok: false, reason: 'job queue failed to start' }, { status: 503 });
  }

  const scheduledSources = await reconcileConnectorSchedules();
  const workerStarted = await startConnectorSyncWorker();

  // Hold the request open so the cron worker can fire due schedules and the
  // sync worker can process them before the function is torn down.
  const holdMs = Math.min(Number(process.env.JOBS_TICK_HOLD_MS) || 45_000, 55_000);
  await new Promise((resolve) => setTimeout(resolve, holdMs));

  return NextResponse.json({
    ok: true,
    workerStarted,
    scheduledSources,
    heldMs: holdMs,
  });
}
