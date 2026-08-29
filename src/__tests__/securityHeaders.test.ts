import { describe, it, expect } from 'vitest';
import {
  getAllowedOrigins,
  buildCsp,
  buildDocsCsp,
  baseSecurityHeaders,
  isSameOriginRequest,
} from '../lib/security/securityHeaders';

/**
 * Security-headers + CSRF origin-check contract.
 *
 * The middleware applies these to every response; the previous behavior only
 * hardened requests whose Origin matched the CORS allowlist, leaving ordinary
 * browser navigation with zero hardening headers. These tests pin the new
 * guarantees without booting Next (the functions are pure).
 */

describe('baseSecurityHeaders', () => {
  it('always includes the hardening set', () => {
    const h = baseSecurityHeaders(false);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Permissions-Policy']).toContain('camera=()');
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('adds HSTS only in production', () => {
    expect(baseSecurityHeaders(true)['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(baseSecurityHeaders(false)['Strict-Transport-Security']).toBeUndefined();
  });
});

describe('buildCsp — app pages', () => {
  it('is nonce-based with no unsafe-inline for scripts', () => {
    const csp = buildCsp('nonce-123');
    expect(csp).toContain("script-src 'self' 'nonce-nonce-123'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('does not whitelist any third-party origin', () => {
    const csp = buildCsp('n');
    expect(csp).not.toContain('unpkg');
    expect(csp).not.toContain('cdn');
    expect(csp).not.toContain('https://');
  });

  it('allows data:/blob: images (AI-generated diagrams) and blob workers (tesseract harness)', () => {
    const csp = buildCsp('n');
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("worker-src 'self' blob:");
  });
});

describe('buildDocsCsp — Swagger page exception', () => {
  it('scopes unpkg to this route only', () => {
    const csp = buildDocsCsp('n');
    expect(csp).toContain('https://unpkg.com');
    expect(csp).toContain("default-src 'none'");
  });

  it('still forbids framing and objects', () => {
    const csp = buildDocsCsp('n');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});

describe('isSameOriginRequest — CSRF origin gate', () => {
  const mk = (method: string, url: string, headers: Record<string, string>) =>
    ({
      method,
      url,
      headers: { get: (n: string) => headers[n] ?? null },
    }) as never;

  const host = 'https://omnirag.example';

  it('allows safe methods unconditionally', () => {
    expect(isSameOriginRequest(mk('GET', `${host}/api/v1/documents`, {}), [])).toBe(true);
    expect(isSameOriginRequest(mk('HEAD', `${host}/x`, {}), [])).toBe(true);
  });

  it('allows same-origin POST', () => {
    expect(isSameOriginRequest(mk('POST', `${host}/api/v1/collections`, { origin: host }), [])).toBe(true);
  });

  it('rejects cross-origin POST without allowlist entry', () => {
    expect(isSameOriginRequest(mk('POST', `${host}/api/v1/collections`, { origin: 'https://evil.example' }), [])).toBe(
      false,
    );
  });

  it('allows cross-origin POST only for allowlisted origins', () => {
    expect(
      isSameOriginRequest(mk('POST', `${host}/api/v1/collections`, { origin: 'https://partner.example' }), [
        'https://partner.example',
      ]),
    ).toBe(true);
  });

  it('uses Referer as fallback when Origin is absent', () => {
    expect(isSameOriginRequest(mk('POST', `${host}/api/v1/collections`, { referer: `${host}/chat` }), [])).toBe(true);
    expect(
      isSameOriginRequest(mk('POST', `${host}/api/v1/collections`, { referer: 'https://evil.example/x' }), []),
    ).toBe(false);
  });

  it('exempts Bearer API-key requests (non-cookie credentials cannot ride CSRF)', () => {
    expect(
      isSameOriginRequest(
        mk('POST', `${host}/api/v1/collections`, {
          origin: 'https://evil.example',
          authorization: 'Bearer omnirag_live_abc',
        }),
        [],
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(mk('POST', `${host}/x`, { origin: 'https://evil.example', authorization: 'basic x' }), []),
    ).toBe(false);
  });

  it('treats missing Origin+Referer as same-origin (SameSite=Lax is the real gate there)', () => {
    expect(isSameOriginRequest(mk('POST', `${host}/api/v1/collections`, {}), [])).toBe(true);
  });

  it('protocol variations of the same host match (http vs https)', () => {
    expect(isSameOriginRequest(mk('POST', `${host}/api/v1/x`, { origin: 'http://omnirag.example' }), [])).toBe(true);
  });
});

describe('getAllowedOrigins', () => {
  it('parses the env var into a trimmed list', () => {
    const prev = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = 'https://a.example , https://b.example';
    expect(getAllowedOrigins()).toEqual(['https://a.example', 'https://b.example']);
    process.env.ALLOWED_ORIGINS = prev;
  });
});
