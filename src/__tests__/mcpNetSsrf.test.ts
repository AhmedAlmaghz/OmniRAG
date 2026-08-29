import { describe, it, expect } from 'vitest';

/**
 * SSRF guard + HTML extraction contract for MCP outbound fetches.
 * Tool arguments are model-chosen, so private/metadata targets must be
 * rejected before any socket is opened.
 */
import { assertPublicHttpUrl, htmlToText, isDummyEndpoint, probeEndpoint } from '../lib/mcp/net';

describe('assertPublicHttpUrl — SSRF guard', () => {
  const blocked = [
    'http://localhost/admin',
    'http://127.0.0.1:8080/',
    'http://10.0.0.5/internal',
    'http://192.168.1.10/router',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://169.254.169.254/latest/meta-data/', // cloud metadata endpoint
    'http://0.0.0.0/',
    'file:///etc/passwd',
    'ftp://example.com/file',
    'https://mcp.slack.internal/v2', // seeded dummy host
  ];

  it.each(blocked)('blocks %s (literal patterns, no DNS needed)', async (url) => {
    await expect(assertPublicHttpUrl(url)).rejects.toThrow();
  });

  it('allows public https URLs (resolvable public hosts)', async () => {
    // example.org is the IANA-reserved public documentation host with stable
    // public A records; a live DNS query here also proves the happy path.
    const url = await assertPublicHttpUrl('https://example.org/page?q=1');
    expect(url.hostname).toBe('example.org');
  });

  it('rejects garbage input', async () => {
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow();
    await expect(assertPublicHttpUrl('')).rejects.toThrow();
  });

  it('rejects hostnames that do not resolve (unverifiable = unfetchable)', async () => {
    await expect(assertPublicHttpUrl('https://this-host-does-not-exist-anywhere.invalid/x')).rejects.toThrow();
  });

  it('blocks DNS-rebinding style hostnames that resolve to private IPs (nip.io)', async () => {
    // nip.io maps *.10.0.0.5.nip.io → 10.0.0.5 — passes the literal regex,
    // must be caught by the DNS resolution check.
    await expect(assertPublicHttpUrl('http://10.0.0.5.nip.io/admin')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://192-168-1-10.nip.io/')).rejects.toThrow();
  });

  it('blocks localtest.me (always resolves to 127.0.0.1)', async () => {
    await expect(assertPublicHttpUrl('http://localtest.me/api')).rejects.toThrow();
  });
});

describe('isDummyEndpoint', () => {
  it('flags seeded/demo endpoints', () => {
    expect(isDummyEndpoint('https://mcp.websearch.internal/v2')).toBe(true);
    expect(isDummyEndpoint('https://example.com/api')).toBe(true);
  });

  it('does not flag real endpoints', () => {
    expect(isDummyEndpoint('https://remote.mcp.example.dev/tools')).toBe(false);
  });
});

describe('htmlToText', () => {
  it('strips scripts, styles and tags, and decodes entities', () => {
    const html = `<html><head><style>body{color:red}</style><script>alert(1)</script></head>
      <body><h1>Title&nbsp;Here</h1><p>Line &amp; more</p><div>Second<br/>line</div></body></html>`;
    const text = htmlToText(html);
    expect(text).not.toContain('<');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
    expect(text).toContain('Title Here');
    expect(text).toContain('Line & more');
    expect(text).toContain('Second\nline');
  });
});

describe('probeEndpoint', () => {
  it('treats dummy/seeded endpoints as healthy without a network call', async () => {
    const outcome = await probeEndpoint('https://mcp.github.internal/v2');
    expect(outcome.status).toBe('healthy');
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(1);
  });

  it('marks non-http schemes as healthy registered-only endpoints (no dial)', async () => {
    const outcome = await probeEndpoint('stdio://local-process');
    expect(outcome.status).toBe('healthy');
  });
});
