/**
 * Live connector extractions for knowledge-source synchronization.
 *
 * Historically ONLY `youtube` and `file` sources had real pipelines; every
 * other advertised connector indexed fabricated placeholder text. This module
 * adds REAL server-side extraction for the no-auth connector types:
 *
 *   - `url`      : SSRF-guarded page fetch → readable plain text
 *   - `rss`      : RSS/Atom feed fetch → recent entries as structured sections
 *   - `github`   : repository metadata + README (raw markdown) via api.github.com
 *   - `web_file` : SSRF-guarded file download → shared ingestion pipeline
 *                  (Mistral Document AI / Unstructured Transform / auto)
 *
 * All outbound requests go through lib/mcp/net.ts guards (scheme allow-list,
 * private-host SSRF deny-list, timeouts, response size caps). Types that still
 * need OAuth/credentials (gdrive/notion/confluence/slack/email/database/api)
 * intentionally have NO implementation here — they fail honestly upstream
 * instead of inventing data.
 */

import { safeFetchText, safeFetchBinary, htmlToText } from '../mcp/net';
import { processFileBuffer } from '../services/unstructuredService';

export interface ConnectorExtraction {
  /** Document title derived from the source payload (feed title, repo name…). */
  title: string;
  /** Full extracted plain-text/markdown content ready for chunking. */
  content: string;
  /** Canonical public URL the content came from (stored in metadata). */
  sourceUrl?: string;
  /** Number of logical records merged into the content (feed entries etc.). */
  itemsProcessed: number;
}

// ---------------------------------------------------------------------------
// Pure parsing helpers (unit-testable, no I/O)
// ---------------------------------------------------------------------------

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripCdata(input: string): string {
  const m = input.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : input;
}

/** Extracts the inner text of the first matching tag, CDATA/entity aware. */
function tagText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return decodeXmlEntities(stripCdata(m[1])).trim();
}

/** Extracts an Atom-style href from <link … href="…"> when inner text absent. */
function tagLink(block: string): string {
  const inner = tagText(block, 'link');
  if (inner) return inner;
  const m = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  return m ? decodeXmlEntities(m[1]).trim() : '';
}

export interface FeedEntry {
  title: string;
  link: string;
  publishedAt: string;
  summary: string;
}

/**
 * Parses an RSS 2.0 or Atom feed body into normalized entries. Accepts either
 * format because real-world feeds mix both shapes; returns [] for bodies with
 * no recognizable items so callers can raise an honest error.
 */
export function parseRssOrAtomFeed(xmlBody: string, maxEntries: number = 30): FeedEntry[] {
  if (!xmlBody) return [];
  // Strip XML comments so commented-out items are not ingested.
  const cleaned = xmlBody.replace(/<!--[\s\S]*?-->/g, '');

  const blocks = [
    ...(cleaned.match(/<item\b[\s\S]*?<\/item\s*>/gi) || []),
    ...(cleaned.match(/<entry\b[\s\S]*?<\/entry\s*>/gi) || []),
  ];

  const entries: FeedEntry[] = [];
  for (const block of blocks.slice(0, maxEntries)) {
    const title = tagText(block, 'title');
    const link = tagLink(block) || tagText(block, 'guid') || '';
    const publishedAt = tagText(block, 'pubDate') || tagText(block, 'published') || tagText(block, 'updated') || '';
    const summaryRaw =
      tagText(block, 'content:encoded') ||
      tagText(block, 'description') ||
      tagText(block, 'summary') ||
      tagText(block, 'content');

    // Summaries carry HTML — fold them to plain text like the rest of the app.
    const summary = summaryRaw ? htmlToText(summaryRaw) : '';

    if (!title && !summary) continue;
    entries.push({
      title: title || link || 'عنصر بدون عنوان',
      link,
      publishedAt,
      summary,
    });
  }
  return entries;
}

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

/** Parses https://github.com/:owner/:repo (+ optional .git / tree suffixes). */
export function parseGithubRepoUrl(rawUrl: string): GithubRepoRef | null {
  try {
    const parsed = new URL((rawUrl || '').trim());
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) return null;
    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/i, '');
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

/** Pulls <title>/og:title out of an HTML document. */
export function extractHtmlTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (og?.[1]) return decodeXmlEntities(og[1]).trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t?.[1]) return decodeXmlEntities(t[1]).trim();
  return '';
}

// ---------------------------------------------------------------------------
// Network-backed extractors
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 20_000;
const PAGE_MAX_BYTES = 2 * 1024 * 1024;

/** `url` connector: single-page readable-text extraction (SSRF-guarded). */
export async function extractFromWebPage(config: Record<string, any>): Promise<ConnectorExtraction> {
  const url = typeof config?.url === 'string' ? config.url.trim() : '';
  if (!url) throw new Error('لا يوجد رابط صفحة ويب في إعدادات هذا الموصل.');

  const res = await safeFetchText(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: PAGE_MAX_BYTES,
    headers: { Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5' },
  });
  if (!res.ok) {
    throw new Error(`فشل جلب الصفحة: ${res.error || `HTTP ${res.status}`}`);
  }

  let title = '';
  let text = '';

  if (res.contentType.includes('application/json')) {
    // JSON endpoints (docs/specs) are ingested verbatim — reformatting risks
    // corrupting machine-readable structure the model can exploit.
    try {
      text = JSON.stringify(JSON.parse(res.text), null, 2);
      title = url;
    } catch {
      text = res.text;
      title = url;
    }
  } else {
    title = extractHtmlTitle(res.text) || url;
    text = htmlToText(res.text);
  }

  if (text.trim().length < 80) {
    throw new Error(
      'تم جلب الصفحة لكن تعذر استخلاص محتوى نصي كافٍ منها (قد تكون محمية أو تعتمد على جافاسكربت بالكامل).',
    );
  }

  return {
    title: text.length > PAGE_MAX_BYTES / 2 ? `${title} (مقتطع)` : title,
    content: `# ${title}\n\nالمصدر: ${url}\n\n${text}`,
    sourceUrl: url,
    itemsProcessed: 1,
  };
}

/** `rss` connector: recent feed entries aggregated into one document. */
export async function extractFromRssFeed(config: Record<string, any>): Promise<ConnectorExtraction> {
  const feedUrl = typeof config?.feedUrl === 'string' ? config.feedUrl.trim() : '';
  if (!feedUrl) throw new Error('لا يوجد رابط تغذية RSS في إعدادات هذا الموصل.');

  const res = await safeFetchText(feedUrl, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: 4 * 1024 * 1024,
    headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
  });
  if (!res.ok) {
    throw new Error(`فشل جلب التغذية: ${res.error || `HTTP ${res.status}`}`);
  }

  const feedTitle = extractHtmlTitle(res.text) || tagText(res.text.split(/<item\b/i)[0], 'title');
  const entries = parseRssOrAtomFeed(res.text);
  if (entries.length === 0) {
    throw new Error('المحتوى المجلوب ليس تغذية RSS/Atom صالحة أو لا يحتوي عناصر.');
  }

  const sections = entries.map((e, i) => {
    const meta = [e.link ? `الرابط: ${e.link}` : '', e.publishedAt ? `التاريخ: ${e.publishedAt}` : '']
      .filter(Boolean)
      .join(' | ');
    return `## ${i + 1}. ${e.title}${meta ? `\n${meta}` : ''}\n\n${e.summary}`;
  });

  return {
    title: feedTitle ? `[تغذية RSS] ${feedTitle}` : `[تغذية RSS] ${feedUrl}`,
    content: `# ${feedTitle || feedUrl}\n\nالمصدر: ${feedUrl}\nآخر تحديث: ${new Date().toISOString()}\nعدد العناصر: ${entries.length}\n\n${sections.join('\n\n---\n\n')}`,
    sourceUrl: feedUrl,
    itemsProcessed: entries.length,
  };
}

/** `github` connector: repository metadata + README via the public REST API. */
export async function extractFromGithubRepo(config: Record<string, any>): Promise<ConnectorExtraction> {
  const repoUrl = typeof config?.repoUrl === 'string' ? config.repoUrl.trim() : '';
  const ref = parseGithubRepoUrl(repoUrl);
  if (!ref) {
    throw new Error('رابط مستودع GitHub غير صالح. النسق المطلوب: https://github.com/owner/repo');
  }

  const patToken = typeof config?.patToken === 'string' && config.patToken.trim() ? config.patToken.trim() : '';
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(patToken ? { Authorization: `Bearer ${patToken}` } : {}),
  };

  // Repo metadata (description / default branch / stars) — fixed host
  // api.github.com, so no user-controlled redirect target here.
  const metaRes = await safeFetchText(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: 512 * 1024,
    headers,
  });
  let description = '';
  let branch = typeof config?.branch === 'string' && config.branch.trim() ? config.branch.trim() : '';
  if (metaRes.ok) {
    try {
      const meta = JSON.parse(metaRes.text);
      description = typeof meta.description === 'string' ? meta.description : '';
      if (!branch && typeof meta.default_branch === 'string') branch = meta.default_branch;
    } catch {
      /* metadata is best-effort; README is the critical payload */
    }
  }

  const readmeTarget = branch || 'main';
  const readmeRes = await safeFetchText(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/readme?ref=${encodeURIComponent(readmeTarget)}`,
    {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: 2 * 1024 * 1024,
      headers: { ...headers, Accept: 'application/vnd.github.raw+json' },
    },
  );

  if (!readmeRes.ok) {
    if (readmeRes.status === 404 && !patToken && readmeTarget !== 'master') {
      throw new Error('تعذر العثور على README على الفرع main — جرّب ضبط حقل الفرع (Branch) بشكل صحيح.');
    }
    if (readmeRes.status === 403) {
      throw new Error('رفض GitHub الطلب (معدل طلبات مجهول الهوية). أضف رمز وصول شخصي PAT في إعدادات الموصل.');
    }
    throw new Error(`فشل جلب المستودع: ${readmeRes.error || `HTTP ${readmeRes.status}`}`);
  }

  const readme = readmeRes.truncated ? `${readmeRes.text}\n\n[تم اقتطاع المحتوى بسبب الحجم]` : readmeRes.text;
  const canonicalUrl = `https://github.com/${ref.owner}/${ref.repo}`;

  const headerLines = [
    `# ${ref.owner}/${ref.repo}`,
    description ? `\n${description}` : '',
    `\nالمصدر: ${canonicalUrl}`,
    `الفرع: ${readmeTarget}`,
  ].filter(Boolean);

  return {
    title: `[GitHub] ${ref.owner}/${ref.repo}`,
    content: `${headerLines.join('\n')}\n\n${readme}`,
    sourceUrl: canonicalUrl,
    itemsProcessed: 1,
  };
}

// ---------------------------------------------------------------------------
// Web-file connector (file URL → shared ingestion pipeline)
// ---------------------------------------------------------------------------

/** Same size cap as the upload studio parse route (MAX_ALLOWED_FILE_SIZE_MB_CAP). */
const WEB_FILE_MAX_BYTES = 50 * 1024 * 1024;
const WEB_FILE_TIMEOUT_MS = 60_000;

/** Derives a clean file name from a URL's last path segment. */
export function fileNameFromUrl(rawUrl: string, fallback: string = 'downloaded-file'): string {
  try {
    const parsed = new URL((rawUrl || '').trim());
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return fallback;
    let last = '';
    try {
      last = decodeURIComponent(segments[segments.length - 1]);
    } catch {
      last = segments[segments.length - 1];
    }
    // Accept only values that look like a real file name with an extension.
    if (last && /^[\w.\-() ]{1,200}\.[a-z0-9]{1,10}$/i.test(last)) return last.trim();
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * RFC 6266/RFC 5987 Content-Disposition filename extraction:
 *   attachment; filename="report.pdf"
 *   attachment; filename*=UTF-8''%D8%AA%D9%82%D8%B1%D9%8A%D8%B1.pdf
 * The extended (filename*) form wins when present because it is the only one
 * that can carry non-ASCII names such as Arabic titles.
 */
export function fileNameFromContentDisposition(header: string | null): string {
  if (!header) return '';
  try {
    const ext = header.match(/filename\*=(?:UTF-8|utf-8)''([^;]+)/);
    if (ext?.[1]) {
      const decoded = decodeURIComponent(ext[1].trim().replace(/^["']|["']$/g, ''));
      if (decoded) return decoded;
    }
    const plain = header.match(/filename\s*=\s*"([^"]+)"/i) || header.match(/filename\s*=\s*([^;]+)/i);
    if (plain?.[1]) return plain[1].trim();
  } catch {
    /* malformed header — caller falls back to URL-derived name */
  }
  return '';
}

/** Normalizes a Content-Type header ("text/html; charset=utf-8" → "text/html"). */
function bareContentType(contentType: string): string {
  return (contentType || '').split(';')[0].trim().toLowerCase();
}

/**
 * `web_file` connector: downloads a file from a public URL (SSRF-guarded) and
 * runs it through the SAME processing pipeline as the upload studio —
 * Mistral Document AI, Unstructured Transform, or automatic routing — then
 * returns the extracted text ready for chunking and vector indexing.
 */
export async function extractFromWebFile(config: Record<string, any>): Promise<ConnectorExtraction> {
  const fileUrl = typeof config?.fileUrl === 'string' ? config.fileUrl.trim() : '';
  if (!fileUrl) throw new Error('لا يوجد رابط ملف (fileUrl) في إعدادات هذا الموصل.');

  const engine: 'auto' | 'mistral' | 'unstructured' =
    config?.engine === 'mistral' || config?.engine === 'unstructured' ? config.engine : 'auto';

  const res = await safeFetchBinary(fileUrl, { timeoutMs: WEB_FILE_TIMEOUT_MS, maxBytes: WEB_FILE_MAX_BYTES });
  if (!res.ok) {
    throw new Error(`فشل جلب الملف من الرابط: ${res.error || `HTTP ${res.status}`}`);
  }
  if (!res.bytes || res.bytes.length === 0) {
    throw new Error('الملف المجلوب فارغ — لا يوجد محتوى قابل للمعالجة.');
  }

  const fileName = (typeof config?.fileName === 'string' && config.fileName.trim()) || fileNameFromUrl(fileUrl);
  const mimeType = bareContentType(res.contentType) || 'application/octet-stream';

  console.log(
    `[Web File Connector] Processing ${fileName} (${(res.bytes.length / 1024 / 1024).toFixed(2)} MB, ${mimeType}) with engine: ${engine}...`,
  );
  const processed = await processFileBuffer(res.bytes, fileName, mimeType, { preferredEngine: engine });

  if (!processed.text || processed.text.trim().length === 0) {
    throw new Error(
      `تم جلب الملف بنجاح لكن تعذر استخراج أي نص منه عبر محرك المعالجة (${processed.engineUsed}). قد يكون الملف تالفاً أو محمياً أو غير مدعوم.`,
    );
  }

  const title = `[ملف من رابط] ${fileName}`;
  return {
    title,
    content: `# ${title}\n\nالمصدر: ${fileUrl}\nمحرك المعالجة: ${processed.engineUsed}\n\n${processed.text.trim()}`,
    sourceUrl: fileUrl,
    itemsProcessed: 1,
  };
}

/**
 * Dispatches extraction for a connector type. Returns undefined for types
 * WITHOUT a live pipeline so the caller applies its honest-failure policy.
 */
export function supportsLiveSync(type: string): boolean {
  return ['youtube', 'file', 'url', 'rss', 'github', 'web_file'].includes(type);
}

export async function extractConnectorContent(
  type: string,
  config: Record<string, any>,
): Promise<ConnectorExtraction | undefined> {
  switch (type) {
    case 'url':
      return extractFromWebPage(config);
    case 'rss':
      return extractFromRssFeed(config);
    case 'github':
      return extractFromGithubRepo(config);
    case 'web_file':
      return extractFromWebFile(config);
    default:
      // youtube/file keep their dedicated pipelines inside the storage layer.
      return undefined;
  }
}
