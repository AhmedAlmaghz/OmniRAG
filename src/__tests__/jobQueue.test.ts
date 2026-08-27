import { describe, it, expect, afterEach, vi } from 'vitest';
import { isCronSchedule } from '../lib/jobs/connectorSync';
import { isJobQueueAvailable, CONNECTOR_SYNC_QUEUE, DOCUMENT_REINDEX_QUEUE } from '../lib/jobs/queue';

/**
 * Job-queue unit tests. Only the pure helpers are exercised here — the pg-boss
 * queue itself requires a live Postgres and is covered by the honest-degradation
 * contract (returns null/false without one).
 */

describe('isCronSchedule', () => {
  it('accepts standard 5-field cron expressions', () => {
    expect(isCronSchedule('*/30 * * * *')).toBe(true);
    expect(isCronSchedule('0 */6 * * *')).toBe(true);
    expect(isCronSchedule('0 0 * * *')).toBe(true);
  });

  it('accepts @-shorthand schedules', () => {
    expect(isCronSchedule('@hourly')).toBe(true);
    expect(isCronSchedule('@daily')).toBe(true);
  });

  it('rejects manual, empty, and malformed schedules', () => {
    expect(isCronSchedule('manual')).toBe(false);
    expect(isCronSchedule('')).toBe(false);
    expect(isCronSchedule(null)).toBe(false);
    expect(isCronSchedule(undefined)).toBe(false);
    expect(isCronSchedule('not a cron')).toBe(false);
    expect(isCronSchedule('* * *')).toBe(false); // too few fields
  });
});

describe('queue availability', () => {
  const ORIGINAL_DB = process.env.DATABASE_URL;
  const ORIGINAL_PG = process.env.POSTGRES_URL;

  afterEach(() => {
    if (ORIGINAL_DB === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DB;
    if (ORIGINAL_PG === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = ORIGINAL_PG;
    vi.unstubAllEnvs();
  });

  it('reports unavailable without a Postgres connection string', () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    expect(isJobQueueAvailable()).toBe(false);
  });

  it('reports available when DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
    expect(isJobQueueAvailable()).toBe(true);
  });

  it('reports available when only POSTGRES_URL is set', () => {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_URL = 'postgres://user:pass@localhost:5432/db';
    expect(isJobQueueAvailable()).toBe(true);
  });

  it('exposes stable queue name constants', () => {
    expect(CONNECTOR_SYNC_QUEUE).toBe('connector.sync');
    expect(DOCUMENT_REINDEX_QUEUE).toBe('document.reindex');
  });
});
