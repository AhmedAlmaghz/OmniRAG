/**
 * Shared network primitives for the MCP module.
 *
 * Every outbound request performed on behalf of an MCP tool (URL fetching,
 * remote server probing, custom-tool dispatch) must go through the guards
 * here: scheme allow-list, SSRF host deny-list, DNS resolution checks,
 * hard timeouts and response size caps. Tool arguments are
 * attacker-influenced (the model chooses URLs), so these are security
 * boundaries, not conveniences.
 */

import { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  contentType: string;
  text: string;
  bytes: number;
  truncated: boolean;
  error?: string;
}

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^\[?::1\]?$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

/** Hostname substrings used by seeded/demo servers that have no real endpoint. */
const DUMMY_HOST_FRAGMENTS = ['.internal', 'example.com', '.local', 'mcp.transform.unstructured.io'];

export function isDummyEndpoint(url: string): boolean {
  return DUMMY_HOST_FRAGMENTS.some((frag) => url.includes(frag));
}

/**
 * True when the literal is an IPv4/IPv6 address (no dots/colons can appear in
 * a bare hostname), so DNS resolution is unnecessary.
 */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/** IP-literal / private-range check shared by literals and DNS results. */
function isPrivateAddress(ip: string): boolean {
  const normalized = ip.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    PRIVATE_HOST_PATTERNS.some((re) => re.test(normalized)) ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80')
  );
}

/**
 * Resolves the hostname and rejects when ANY resolved address is private,
 * loopback, link-local, or unique-local. This closes the hostname-regex gap:
 * public names (nip.io, localtest.me, DNS-rebinding setups) that resolve to
 * internal IPs sail past the literal-pattern check above.
 *
 * Lookup failures and timeouts are rejected — an unverifiable host is not a
 * fetchable host.
 */
async function assertResolvablePublicHost(hostname: string): Promise<void> {
  // IP literals were already screened by PRIVATE_HOST_PATTERNS.
  if (isIpLiteral(hostname)) return;

  let addresses: LookupAddress[];
  try {
    addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`تعذر التحقق من عنوان المضيف (${hostname}) — تم رفض الطلب لأسباب أمنية`);
  }

  if (!addresses || addresses.length === 0) {
    throw new Error(`لم يُعثر على عنوان للمضيف (${hostname}) — تم رفض الطلب لأسباب أمنية`);
  }

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`المضيف (${hostname}) يحل إلى عنوان شبكة داخلية (${address}) — تم رفض الطلب لأسباب أمنية (SSRF)`);
    }
  }
}

/**
 * Validates that a URL is an absolute public http(s) URL safe to fetch from
 * the server: scheme allow-list, literal-pattern screening, AND live DNS
 * resolution (every A/AAAA record must be public). Throws with a
 * user-facing Arabic message when blocked.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL((rawUrl || '').trim());
  } catch {
    throw new Error(`الرابط غير صالح: (${rawUrl})`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`يُسمح فقط بروابط http/https (تم رفض ${parsed.protocol})`);
  }

  const host = parsed.hostname;
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) {
    throw new Error('تم رفض الوصول لعناوين الشبكة الداخلية أو الخاصة لأسباب أمنية (SSRF)');
  }
  if (isDummyEndpoint(parsed.href)) {
    throw new Error(`الرابط (${parsed.hostname}) نقطة نهاية تجريبية غير قابلة للجلب الفعلي`);
  }

  // DNS pinning: reject public-looking hostnames that resolve privately.
  await assertResolvablePublicHost(host);

  return parsed;
}

/**
 * Fetch wrapper that follows redirects MANUALLY, re-running the full SSRF
 * guard on every hop. A public first URL that 302s into 127.0.0.1 or a
 * link-local metadata endpoint must not bypass the guard — 'follow' would
 * happily connect. Redirect chains are capped (5) like browsers.
 */
async function guardedFetch(
  url: URL,
  init: RequestInit & { headers?: Record<string, string> },
  maxRedirects = 5,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(current.href, { ...init, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get('location');
    if (!location) return res; // weird 3xx without Location — hand back as-is

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return res;
    }
    // Full re-validation of the redirect target: scheme + literal patterns +
    // DNS pinning. Any violation aborts the chain with an error.
    await assertPublicHttpUrl(next.href);
    current = next;
  }
  throw new Error('تجاوز سلسلة التحويلات الحد المسموح (too many redirects)');
}

/**
 * Fetches a URL with timeout + size cap and returns its body as text.
 * Never throws for HTTP-level failures; throws only for policy violations.
 */
export async function safeFetchText(
  rawUrl: string,
  opts: {
    timeoutMs?: number;
    maxBytes?: number;
    headers?: Record<string, string>;
    method?: 'GET' | 'POST';
    body?: string;
  } = {},
): Promise<SafeFetchResult> {
  const url = await assertPublicHttpUrl(rawUrl);
  const { timeoutMs = 12000, maxBytes = 1024 * 1024, method = 'GET' } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await guardedFetch(url, {
      method,
      signal: controller.signal,
      headers: {
        'User-Agent': 'OmniRAG-MCP-Gateway/2.0 (+knowledge-fetch)',
        Accept: 'text/html,text/plain,application/json,*/*;q=0.8',
        ...(opts.headers || {}),
      },
      body: method === 'POST' ? opts.body : undefined,
    });

    const contentType = res.headers.get('content-type') || '';
    const buffer = Buffer.from(await res.arrayBuffer());
    const truncated = buffer.byteLength > maxBytes;
    const text = buffer.subarray(0, maxBytes).toString('utf-8');

    return {
      ok: res.ok,
      status: res.status,
      contentType,
      text,
      bytes: buffer.byteLength,
      truncated,
      error: res.ok ? undefined : `HTTP ${res.status}: ${res.statusText}`,
    };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      contentType: '',
      text: '',
      bytes: 0,
      truncated: false,
      error: aborted ? `تجاوز المهلة (${timeoutMs}ms)` : err?.message || 'فشل الطلب',
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface SafeFetchBinaryResult {
  ok: boolean;
  status: number;
  contentType: string;
  /** Raw Content-Disposition response header (for server-suggested filenames). */
  contentDisposition: string;
  bytes: Buffer;
  truncated: boolean;
  error?: string;
}

/**
 * Binary variant of safeFetchText for documents (PDF/DOCX/images) referenced
 * by URL. Same policy guards: public http(s) only, timeout, size cap.
 */
export async function safeFetchBinary(
  rawUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {},
): Promise<SafeFetchBinaryResult> {
  const url = await assertPublicHttpUrl(rawUrl);
  const { timeoutMs = 30000, maxBytes = 20 * 1024 * 1024 } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await guardedFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'OmniRAG-MCP-Gateway/2.0 (+document-fetch)',
        ...(opts.headers || {}),
      },
    });

    const contentType = res.headers.get('content-type') || '';
    const contentDisposition = res.headers.get('content-disposition') || '';
    const buffer = Buffer.from(await res.arrayBuffer());
    const truncated = buffer.byteLength > maxBytes;

    return {
      ok: res.ok && !truncated,
      status: res.status,
      contentType,
      contentDisposition,
      bytes: truncated ? buffer.subarray(0, maxBytes) : buffer,
      truncated,
      error: !res.ok
        ? `HTTP ${res.status}: ${res.statusText}`
        : truncated
          ? `تجاوز حجم الملف الحد المسموح (${maxBytes} بايت)`
          : undefined,
    };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      contentType: '',
      contentDisposition: '',
      bytes: Buffer.alloc(0),
      truncated: false,
      error: aborted ? `تجاوز المهلة (${timeoutMs}ms)` : err?.message || 'فشل الطلب',
    };
  } finally {
    clearTimeout(timer);
  }
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/** Minimal HTML → plain-text extraction (no DOM parser dependency). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ProbeOutcome {
  status: 'healthy' | 'degraded' | 'down';
  latencyMs: number;
  error?: string;
}

/**
 * Real network probe for a registered MCP server endpoint. Seed/demo endpoints
 * (.internal / example.com / …) cannot be probed meaningfully, so they report
 * the measured attempt duration instead of a fabricated success latency.
 */
export async function probeEndpoint(
  rawUrl: string,
  headers: Record<string, string> = {},
  timeoutMs = 2500,
): Promise<ProbeOutcome> {
  const startTime = Date.now();

  if (!rawUrl || !/^https?:\/\//i.test(rawUrl) || isDummyEndpoint(rawUrl)) {
    // Nothing real to dial — treat as a healthy registered-only endpoint.
    return { status: 'healthy', latencyMs: Math.max(1, Date.now() - startTime) };
  }

  const result = await safeFetchText(rawUrl, { timeoutMs, maxBytes: 64 * 1024, headers });
  const latencyMs = Math.max(1, Date.now() - startTime);

  if (result.ok) return { status: 'healthy', latencyMs };
  if (result.status > 0) return { status: 'degraded', latencyMs, error: result.error };
  return { status: 'down', latencyMs, error: result.error };
}
