import { getEnv } from '@/lib/env/runtimeEnv';
import { safeFetchText } from '../net';

/**
 * Live Slack / GitHub integrations for the built-in MCP tools.
 *
 * Pattern (honest degradation): each helper returns a structured outcome; the
 * tool checks token availability FIRST — with a token it performs the real API
 * call and stamps `simulated: false`, without one it keeps the clearly-marked
 * sandbox result. Nothing here ever fabricates a live outcome.
 *
 * All HTTP goes through safeFetchText (SSRF guard + timeout + size caps).
 */

export interface LiveCallResult {
  ok: boolean;
  data?: any;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Slack                                                               */
/* ------------------------------------------------------------------ */

export function getSlackToken(): string | null {
  return getEnv('SLACK_BOT_TOKEN') || null;
}

async function slackApi(method: string, payload?: Record<string, unknown>): Promise<LiveCallResult> {
  const token = getSlackToken();
  if (!token) return { ok: false, error: 'SLACK_BOT_TOKEN غير مهيأ' };

  const fetched = await safeFetchText(`https://slack.com/api/${method}`, {
    method: 'POST',
    timeoutMs: 15000,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload || {}),
  });
  if (!fetched.ok) {
    return { ok: false, error: `Slack API ${method} فشلت (HTTP ${fetched.status}): ${fetched.error || ''}` };
  }
  let data: any;
  try {
    data = JSON.parse(fetched.text);
  } catch {
    return { ok: false, error: `استجابة غير صالحة من Slack API ${method}` };
  }
  if (!data?.ok) {
    return { ok: false, error: `Slack API ${method}: ${data?.error || 'خطأ غير معروف'}` };
  }
  return { ok: true, data };
}

/**
 * Resolves a channel reference to a channel id. Accepts raw ids (C…/D…/G…)
 * directly; names (with or without leading #) are looked up via
 * conversations.list (first 1000 channels).
 */
export async function resolveSlackChannel(nameOrId: string): Promise<{ id: string | null; error?: string }> {
  const ref = String(nameOrId || '').trim();
  if (!ref) return { id: null, error: 'اسم القناة مطلوب' };
  if (/^[CDG][A-Z0-9]{6,}$/i.test(ref)) return { id: ref.toUpperCase() };

  const wanted = ref.replace(/^#/, '').toLowerCase();
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const res = await slackApi('conversations.list', {
      limit: 200,
      types: 'public_channel,private_channel',
      ...(cursor ? { cursor } : {}),
    });
    if (!res.ok) return { id: null, error: res.error };
    const channels: any[] = res.data?.channels || [];
    const match = channels.find((c) => String(c?.name || '').toLowerCase() === wanted);
    if (match) return { id: match.id };
    cursor = res.data?.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return { id: null, error: `لم يتم العثور على قناة Slack باسم (${ref})` };
}

export async function slackSendMessageLive(channelRef: string, text: string): Promise<LiveCallResult> {
  const resolved = await resolveSlackChannel(channelRef);
  if (!resolved.id) return { ok: false, error: resolved.error };
  return slackApi('chat.postMessage', { channel: resolved.id, text });
}

export async function slackReadChannelLive(channelRef: string, limit: number): Promise<LiveCallResult> {
  const resolved = await resolveSlackChannel(channelRef);
  if (!resolved.id) return { ok: false, error: resolved.error };

  const history = await slackApi('conversations.history', {
    channel: resolved.id,
    limit: Math.min(Math.max(limit, 1), 50),
  });
  if (!history.ok) return history;

  // Best-effort user name resolution (single call, capped).
  const usersRes = await slackApi('users.list', { limit: 200 });
  const userNames: Record<string, string> = {};
  if (usersRes.ok) {
    for (const u of usersRes.data?.members || []) {
      userNames[u.id] = u?.profile?.real_name || u?.profile?.display_name || u?.name || u.id;
    }
  }

  const messages = (history.data?.messages || []).map((m: any) => ({
    user: userNames[m.user] || m.user || 'unknown',
    text: String(m.text || ''),
    timestamp: m.ts ? new Date(Number(m.ts) * 1000).toISOString() : '',
  }));
  return { ok: true, data: { channelId: resolved.id, messages } };
}

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */

export function getGitHubToken(): string | null {
  return getEnv('GITHUB_TOKEN') || getEnv('GH_TOKEN') || null;
}

async function githubApi(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<LiveCallResult> {
  const token = getGitHubToken();
  if (!token) return { ok: false, error: 'GITHUB_TOKEN غير مهيأ' };

  const fetched = await safeFetchText(`https://api.github.com${path}`, {
    method: init?.method || 'GET',
    timeoutMs: 15000,
    maxBytes: 4 * 1024 * 1024,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!fetched.ok) {
    return { ok: false, error: `GitHub API ${path} فشلت (HTTP ${fetched.status}): ${fetched.error || ''}` };
  }
  try {
    return { ok: true, data: JSON.parse(fetched.text) };
  } catch {
    return { ok: false, error: `استجابة غير صالحة من GitHub API ${path}` };
  }
}

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

export async function githubSearchCodeLive(query: string, repo?: string, language?: string): Promise<LiveCallResult> {
  const qualifiers: string[] = [String(query || '').trim()];
  if (repo) {
    if (!REPO_PATTERN.test(repo)) return { ok: false, error: `اسم المستودع غير صالح: ${repo} (الصيغة: org/repo)` };
    qualifiers.push(`repo:${repo}`);
  }
  if (language) qualifiers.push(`language:${language}`);

  const q = encodeURIComponent(qualifiers.join(' '));
  const res = await githubApi(`/search/code?q=${q}&per_page=10`);
  if (!res.ok) return res;

  const items = (res.data?.items || []).map((item: any) => ({
    path: item.path,
    repo: item?.repository?.full_name,
    url: item.html_url,
    match: '',
  }));
  return { ok: true, data: { totalMatches: res.data?.total_count ?? items.length, codeSnippets: items } };
}

export async function githubCreateIssueLive(
  repo: string,
  title: string,
  body: string,
  labels: string[],
): Promise<LiveCallResult> {
  if (!REPO_PATTERN.test(repo)) return { ok: false, error: `اسم المستودع غير صالح: ${repo} (الصيغة: org/repo)` };
  const res = await githubApi(`/repos/${repo}/issues`, {
    method: 'POST',
    body: { title, body, labels },
  });
  if (!res.ok) return res;
  return {
    ok: true,
    data: { issueNumber: res.data?.number, issueUrl: res.data?.html_url, status: res.data?.state || 'open' },
  };
}

export async function githubReadRepoLive(repo: string, branch?: string): Promise<LiveCallResult> {
  if (!REPO_PATTERN.test(repo)) return { ok: false, error: `اسم المستودع غير صالح: ${repo} (الصيغة: org/repo)` };
  const info = await githubApi(`/repos/${repo}`);
  if (!info.ok) return info;

  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const contents = await githubApi(`/repos/${repo}/contents/${ref}`);

  const structure = Array.isArray(contents.data) ? contents.data.slice(0, 50).map((c: any) => String(c.path)) : [];
  return {
    ok: true,
    data: {
      repo,
      branch: branch || info.data?.default_branch || 'main',
      openIssuesCount: info.data?.open_issues_count ?? 0,
      starsCount: info.data?.stargazers_count ?? 0,
      structure,
    },
  };
}
