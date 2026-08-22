import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getS3Config,
  getUploadProvider,
  buildTenantObjectKey,
  isTenantObjectKey,
  presignS3Url,
} from '../lib/uploads/directUpload';

const S3_ENV = {
  S3_ENDPOINT: 'https://t3.storage.dev',
  S3_REGION: 'auto',
  S3_BUCKET: 'omnirag-test-bucket',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
};

describe('directUpload provider resolution', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns null when nothing is configured', () => {
    delete process.env.S3_ENDPOINT;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL;
    expect(getUploadProvider()).toBeNull();
  });

  it('prefers the portable s3 provider when S3_* is configured', () => {
    Object.assign(process.env, S3_ENV, { BLOB_READ_WRITE_TOKEN: 'x', VERCEL: '1' });
    expect(getUploadProvider()).toBe('s3');
  });

  it('selects vercel-blob only on Vercel with a token', () => {
    delete process.env.S3_ENDPOINT;
    process.env.BLOB_READ_WRITE_TOKEN = 'x';
    process.env.VERCEL = '1';
    expect(getUploadProvider()).toBe('vercel-blob');

    // Same token, but NOT hosted on Vercel → must not activate.
    delete process.env.VERCEL;
    expect(getUploadProvider()).toBeNull();
  });

  it('rejects partial S3 configuration', () => {
    Object.assign(process.env, S3_ENV);
    delete process.env.S3_SECRET_ACCESS_KEY;
    expect(getS3Config()).toBeNull();
    expect(getUploadProvider()).toBeNull();
  });

  it('normalizes a trailing slash in the endpoint', () => {
    process.env = { ...originalEnv, ...S3_ENV, S3_ENDPOINT: 'https://t3.storage.dev/' };
    expect(getS3Config()?.endpoint).toBe('https://t3.storage.dev');
  });
});

describe('buildTenantObjectKey / isTenantObjectKey', () => {
  it('builds a tenant-scoped key with a random uuid', () => {
    const a = buildTenantObjectKey('tenant-abc', 'تقرير سري.pdf');
    const b = buildTenantObjectKey('tenant-abc', 'تقرير سري.pdf');
    expect(a.startsWith('uploads/tenant-abc/')).toBe(true);
    expect(a).not.toBe(b); // uuid component
    expect(a.endsWith('.pdf')).toBe(true); // extension preserved
  });

  it('accepts only the owning tenant prefix', () => {
    const key = buildTenantObjectKey('tenant-abc', 'doc.pdf');
    expect(isTenantObjectKey(key, 'tenant-abc')).toBe(true);
    expect(isTenantObjectKey(key, 'tenant-other')).toBe(false);
  });

  it('rejects traversal, absolute paths and empty keys', () => {
    expect(isTenantObjectKey('uploads/tenant-abc/../../etc/passwd', 'tenant-abc')).toBe(false);
    expect(isTenantObjectKey('/uploads/tenant-abc/doc.pdf', 'tenant-abc')).toBe(false);
    expect(isTenantObjectKey('', 'tenant-abc')).toBe(false);
    expect(isTenantObjectKey('uploads/tenant-abc/', 'tenant-abc')).toBe(false); // no object name
  });
});

describe('presignS3Url (SigV4)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...S3_ENV };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const fixedNow = new Date('2026-08-22T12:00:00Z');

  it('produces a well-formed presigned PUT URL', () => {
    const url = presignS3Url({
      method: 'PUT',
      key: 'uploads/tenant-abc/report.pdf',
      expiresInSeconds: 900,
      contentType: 'application/pdf',
      now: fixedNow,
    });

    expect(url.startsWith('https://t3.storage.dev/omnirag-test-bucket/uploads/tenant-abc/report.pdf?')).toBe(true);

    const parsed = new URL(url);
    expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(parsed.searchParams.get('X-Amz-Date')).toBe('20260822T120000Z');
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('900');
    // Content-Type bound on PUT → both headers signed.
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    // Credential contains the scope with '/' percent-encoded in the query.
    expect(parsed.searchParams.get('X-Amz-Credential')).toBe('test-access-key/20260822/auto/s3/aws4_request');
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical inputs and clock', () => {
    const opts = {
      method: 'PUT' as const,
      key: 'uploads/tenant-abc/report.pdf',
      expiresInSeconds: 900,
      contentType: 'application/pdf',
      now: fixedNow,
    };
    expect(presignS3Url(opts)).toBe(presignS3Url(opts));
  });

  it('signs only the host for GET (no content-type binding)', () => {
    const url = presignS3Url({
      method: 'GET',
      key: 'uploads/tenant-abc/report.pdf',
      expiresInSeconds: 300,
      now: fixedNow,
    });
    expect(new URL(url).searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('varies the signature with the method and key', () => {
    const put = presignS3Url({
      method: 'PUT',
      key: 'uploads/a/x.pdf',
      expiresInSeconds: 900,
      contentType: 'application/pdf',
      now: fixedNow,
    });
    const del = presignS3Url({ method: 'DELETE', key: 'uploads/a/x.pdf', expiresInSeconds: 900, now: fixedNow });
    const otherKey = presignS3Url({
      method: 'PUT',
      key: 'uploads/a/y.pdf',
      expiresInSeconds: 900,
      contentType: 'application/pdf',
      now: fixedNow,
    });
    const sig = (u: string) => new URL(u).searchParams.get('X-Amz-Signature');
    expect(sig(put)).not.toBe(sig(del));
    expect(sig(put)).not.toBe(sig(otherKey));
  });

  it('percent-encodes unicode object keys correctly', () => {
    const url = presignS3Url({
      method: 'GET',
      key: 'uploads/tenant-abc/تقرير.pdf',
      expiresInSeconds: 300,
      now: fixedNow,
    });
    const path = new URL(url).pathname;
    expect(path).toBe(encodeURI('/omnirag-test-bucket/uploads/tenant-abc/تقرير.pdf'));
    expect(path).not.toContain(' '); // spaces/unicode must be encoded, never raw
  });

  it('supports virtual-host style when path style is disabled', () => {
    process.env.S3_FORCE_PATH_STYLE = 'false';
    const url = presignS3Url({
      method: 'GET',
      key: 'uploads/a/x.pdf',
      expiresInSeconds: 300,
      now: fixedNow,
    });
    expect(url.startsWith('https://omnirag-test-bucket.t3.storage.dev/uploads/a/x.pdf?')).toBe(true);
  });
});
