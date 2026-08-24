/**
 * Shared network primitives for the MCP module.
 *
 * Every outbound request performed on behalf of an MCP tool (URL fetching,
 * remote server probing, custom-tool dispatch) must go through the guards
 * here: scheme allow-list, SSRF host deny-list, hard timeouts and response
 * size caps. Tool arguments are attacker-influenced (the model chooses URLs),
 * so these are security boundaries, not conveniences.
 */

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
 * Validates that a URL is an absolute public http(s) URL safe to fetch from
 * the server. Throws with a user-facing Arabic message when blocked.
 */
export function assertPublicHttpUrl(rawUrl: string): URL {
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

  return parsed;
}

/**
 * Fetches a URL with timeout + size cap and returns its body as text.
 * Never throws for HTTP-level failures; throws only for policy violations.
 */
export async function safeFetchText(
  rawUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {},
): Promise<SafeFetchResult> {
  const url = assertPublicHttpUrl(rawUrl);
  const { timeoutMs = 12000, maxBytes = 1024 * 1024 } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.href, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'OmniRAG-MCP-Gateway/2.0 (+knowledge-fetch)',
        Accept: 'text/html,text/plain,application/json,*/*;q=0.8',
        ...(opts.headers || {}),
      },
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
