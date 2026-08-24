import { describe, it, expect } from 'vitest';
import {
  parseRssOrAtomFeed,
  parseGithubRepoUrl,
  extractHtmlTitle,
  supportsLiveSync,
} from '../lib/connectors/liveConnectors';

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title><![CDATA[مدونة التقنية العربية]]></title>
<!-- <item><title>عنصر معلق لا يجب فهرسته</title></item> -->
<item>
  <title><![CDATA[مقدمة في قواعد البيانات المتجهية]]></title>
  <link>https://example.com/posts/1</link>
  <pubDate>Sun, 23 Aug 2026 10:00:00 GMT</pubDate>
  <description><![CDATA[<p>شرح مفاهيم <b>Qdrant</b> والبحث الدلالي.</p>]]></description>
</item>
<item>
  <title>Second post</title>
  <link>https://example.com/posts/2</link>
  <description>Plain text summary with &amp; entities</description>
</item>
</channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Research Updates</title>
  <entry>
    <title>New embedding paper</title>
    <link href="https://research.example.org/papers/42" rel="alternate"/>
    <updated>2026-08-20T09:30:00Z</updated>
    <summary>Retrieval quality improvements for Arabic corpora</summary>
  </entry>
</feed>`;

describe('parseRssOrAtomFeed', () => {
  it('parses RSS items with CDATA titles and strips HTML from summaries', () => {
    const entries = parseRssOrAtomFeed(RSS_FIXTURE);
    expect(entries).toHaveLength(2);
    expect(entries[0].title).toBe('مقدمة في قواعد البيانات المتجهية');
    expect(entries[0].link).toBe('https://example.com/posts/1');
    expect(entries[0].summary).toContain('Qdrant');
    expect(entries[0].summary).not.toContain('<p>');
    // Commented-out item must NOT be ingested
    expect(entries.map((e) => e.title)).not.toContain('عنصر معلق لا يجب فهرسته');
  });

  it('decodes XML entities in summaries', () => {
    const entries = parseRssOrAtomFeed(RSS_FIXTURE);
    expect(entries[1].summary).toContain('& entities');
    expect(entries[1].summary).not.toContain('&amp;');
  });

  it('parses Atom entries with href-style links', () => {
    const entries = parseRssOrAtomFeed(ATOM_FIXTURE);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('New embedding paper');
    expect(entries[0].link).toBe('https://research.example.org/papers/42');
    expect(entries[0].publishedAt).toBe('2026-08-20T09:30:00Z');
    expect(entries[0].summary).toContain('Arabic corpora');
  });

  it('returns an empty array for bodies without items', () => {
    expect(parseRssOrAtomFeed('<html><body>not a feed</body></html>')).toEqual([]);
    expect(parseRssOrAtomFeed('')).toEqual([]);
  });

  it('respects the maxEntries cap', () => {
    const many = Array.from({ length: 50 }, (_, i) => `<item><title>t${i}</title></item>`).join('');
    expect(parseRssOrAtomFeed(`<rss>${many}</rss>`, 10)).toHaveLength(10);
  });
});

describe('parseGithubRepoUrl', () => {
  it('accepts canonical repo URLs', () => {
    expect(parseGithubRepoUrl('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
    expect(parseGithubRepoUrl('https://github.com/owner/repo/tree/main/docs')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parseGithubRepoUrl('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('rejects non-GitHub hosts and malformed paths', () => {
    expect(parseGithubRepoUrl('https://evil.com/owner/repo')).toBeNull();
    expect(parseGithubRepoUrl('https://github.com/only-one-segment')).toBeNull();
    expect(parseGithubRepoUrl('not a url')).toBeNull();
    expect(parseGithubRepoUrl('')).toBeNull();
  });
});

describe('extractHtmlTitle', () => {
  it('prefers og:title over <title>', () => {
    const html = `<html><head>
      <meta property="og:title" content="OG Headline"/>
      <title>Fallback Title</title>
    </head></html>`;
    expect(extractHtmlTitle(html)).toBe('OG Headline');
  });

  it('falls back to <title> and decodes entities', () => {
    expect(extractHtmlTitle('<title>Articles &amp; Guides</title>')).toBe('Articles & Guides');
  });

  it('returns empty string when no title exists', () => {
    expect(extractHtmlTitle('<div>no title</div>')).toBe('');
  });
});

describe('supportsLiveSync', () => {
  it('marks only connector types with real pipelines as live', () => {
    for (const t of ['youtube', 'file', 'url', 'rss', 'github']) {
      expect(supportsLiveSync(t)).toBe(true);
    }
    for (const t of ['gdrive', 'notion', 'confluence', 'slack', 'email', 'database', 'api']) {
      expect(supportsLiveSync(t)).toBe(false);
    }
  });
});
