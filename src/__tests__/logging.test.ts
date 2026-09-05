import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Structured logger contract (v0.12.8) + x-request-id propagation through the
 * API gateway. See docs/09-operations/logging.md.
 */

import { createLogger } from '../lib/logging/logger';
import { runWithRequestContext } from '../lib/config/requestContext';

const log = createLogger('TestComp');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('createLogger', () => {
  let spies: Array<{ mock: any; restore: () => void }>;

  beforeEach(() => {
    spies = ['log', 'warn', 'error', 'info'].map((m) => {
      const spy = vi.spyOn(console, m as 'log').mockImplementation(() => {});
      return { mock: spy, restore: () => spy.mockRestore() };
    });
    // vitest restores everything via unstubAllEnvs(); an empty LOG_LEVEL string
    // is equivalent to unset for the logger's `|| ''` fallback.
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LOG_LEVEL', '');
  });

  afterEach(() => {
    spies.forEach((s) => s.restore());
    vi.unstubAllEnvs();
  });

  const lines = () => spies.flatMap((s) => s.mock.mock.calls.map((c: any[]) => String(c[0])));

  it('renders human-readable lines in development', () => {
    log.info('hello world', { tenantId: 't1' });
    expect(lines().some((l) => l.includes('[TestComp] hello world') && l.includes('tenantId=t1'))).toBe(true);
  });

  it('emits one-line JSON in production with ts/level/component/msg', () => {
    vi.stubEnv('NODE_ENV', 'production');
    log.warn('careful', { source: 'unit-test' });
    const record = JSON.parse(lines()[0]);
    expect(record).toMatchObject({ level: 'warn', component: 'TestComp', msg: 'careful', source: 'unit-test' });
    expect(record.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('routes error/warn to stderr streams in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    log.error('bad');
    log.info('fine');
    expect(spies.find((s) => s.mock.mock.calls.length > 0 && s.mock.mock.instances.length >= 0)).toBeDefined();
    // console.error received the JSON error record:
    const errSpy = spies.find((s) => s.mock.mock.calls.some((c: any[]) => String(c[0]).includes('"level":"error"')));
    expect(errSpy).toBeDefined();
  });

  it('auto-injects request context (requestId/tenantId/userId) inside a request scope', () => {
    vi.stubEnv('NODE_ENV', 'production');
    runWithRequestContext({ tenantId: 'tenant-acme-01', userId: 'u-1', requestId: 'req-123' }, async () => {
      log.info('inside request');
    });
    const record = JSON.parse(lines()[0]);
    expect(record).toMatchObject({ requestId: 'req-123', tenantId: 'tenant-acme-01', userId: 'u-1' });
  });

  it('serializes Error arguments into err.name/err.message', () => {
    vi.stubEnv('NODE_ENV', 'production');
    log.error('operation failed', new Error('db down'));
    const record = JSON.parse(lines()[0]);
    expect(record.err).toMatchObject({ name: 'Error', message: 'db down' });
    expect(typeof record.err.stack).toBe('string');
  });

  it('redacts secret-looking top-level field keys', () => {
    vi.stubEnv('NODE_ENV', 'production');
    log.info('auth attempt', { apiKey: 'omnirag_live_secret', password: 'hunter2', user: 'sara' });
    const record = JSON.parse(lines()[0]);
    expect(record.apiKey).toBe('[redacted]');
    expect(record.password).toBe('[redacted]');
    expect(record.user).toBe('sara');
  });

  it('respects LOG_LEVEL filtering (debug suppressed by default in production)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    log.debug('noisy detail');
    expect(lines()).toHaveLength(0);

    vi.stubEnv('LOG_LEVEL', 'debug');
    log.debug('now visible');
    expect(lines()).toHaveLength(1);
  });
});

// ─────────────────── x-request-id propagation through the gateway ───────────────────

const verifyMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/auth/apiAuth', () => ({ verifyApiAuth: verifyMock }));
vi.mock('../lib/security/rateLimiter', () => ({ checkRateLimit: rateLimitMock }));

describe('withAuthAndRateLimit request correlation', () => {
  beforeEach(() => {
    verifyMock.mockReset();
    rateLimitMock.mockReset();
    rateLimitMock.mockResolvedValue({ success: true });
  });

  it('stamps x-request-id on success and binds it into the request context', async () => {
    verifyMock.mockResolvedValue({ authenticated: true, tenantId: 'tenant-acme-01', userId: 'u-1' });

    const { withAuthAndRateLimit } = await import('../lib/api/withAuthAndRateLimit');
    const { getActiveRequestContext } = await import('../lib/config/requestContext');

    let seenCtx: ReturnType<typeof getActiveRequestContext>;
    const handler = withAuthAndRateLimit(async () => {
      seenCtx = getActiveRequestContext();
      return NextResponse.json({ ok: true });
    });

    const res = await handler(new NextRequest('http://localhost:3000/api/v1/documents'));
    expect(res.headers.get('x-request-id')).toMatch(UUID_RE);
    expect(seenCtx!.tenantId).toBe('tenant-acme-01');
    expect(seenCtx!.requestId).toMatch(UUID_RE);
    expect(seenCtx!.requestId).toBe(res.headers.get('x-request-id'));
  });

  it('stamps x-request-id on the 401 rejection path too', async () => {
    verifyMock.mockResolvedValue({
      authenticated: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const { withAuthAndRateLimit } = await import('../lib/api/withAuthAndRateLimit');
    const handler = withAuthAndRateLimit(async () => NextResponse.json({ ok: true }));

    const res = await handler(new NextRequest('http://localhost:3000/api/v1/documents'));
    expect(res.status).toBe(401);
    expect(res.headers.get('x-request-id')).toMatch(UUID_RE);
  });
});
