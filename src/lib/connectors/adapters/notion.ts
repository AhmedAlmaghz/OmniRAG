import type { ConnectorDescriptor, ConnectorFieldDescriptor, ConnectorExtraction } from '../types';
import { buildConfigSchema } from '../schemaBuilder';

/**
 * Notion connector — real extraction via the official REST API
 * (https://developers.notion.com). Requires an internal integration token
 * with the page/database shared with it.
 *
 * Scope: pages are walked recursively (blocks → markdown); databases are
 * queried and rendered as markdown sections from their rich-text properties.
 * Failures are honest: bad token, missing share, or empty content all throw
 * readable reasons instead of indexing placeholders.
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const MAX_BLOCKS = 500; // hard cap so huge workspaces can't runaway a sync
const MAX_DEPTH = 3;

function notionHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

/** Accepts a raw 32-hex id, a dashed uuid, or a notion.so URL ending in -<id>. */
export function parseNotionId(rawIdOrUrl: string): string {
  const input = (rawIdOrUrl || '').trim();
  if (!input) return '';
  if (!input.startsWith('http')) return input.replace(/-/g, '').toLowerCase();
  try {
    const parsed = new URL(input);
    const last = parsed.pathname.split('/').filter(Boolean).pop() || '';
    const m = last.match(/([0-9a-f]{32})$/i);
    if (m) return m[1];
    return last.replace(/-/g, '').toLowerCase();
  } catch {
    return '';
  }
}

function richTextToPlain(richText: unknown): string {
  if (!Array.isArray(richText)) return '';
  return richText.map((rt: any) => (typeof rt?.plain_text === 'string' ? rt.plain_text : '')).join('');
}

/** Converts one Notion block into markdown line(s); recurses within limits. */
async function blockToMarkdown(
  block: any,
  token: string,
  depth: number,
  budget: { remaining: number },
): Promise<string[]> {
  const type = block?.type as string;
  const data = block?.[type] || {};
  const text = richTextToPlain(data.rich_text || data.title);
  const lines: string[] = [];

  switch (type) {
    case 'heading_1':
      lines.push(`## ${text}`);
      break;
    case 'heading_2':
      lines.push(`### ${text}`);
      break;
    case 'heading_3':
      lines.push(`#### ${text}`);
      break;
    case 'bulleted_list_item':
      lines.push(`- ${text}`);
      break;
    case 'numbered_list_item':
      lines.push(`1. ${text}`);
      break;
    case 'to_do':
      lines.push(`- [${data.checked ? 'x' : ' '}] ${text}`);
      break;
    case 'quote':
      lines.push(`> ${text}`);
      break;
    case 'code':
      lines.push(`\`\`\`${data.language || ''}\n${text}\n\`\`\``);
      break;
    case 'divider':
      lines.push('---');
      break;
    case 'callout':
      lines.push(`> 💡 ${text}`);
      break;
    case 'paragraph':
      if (text) lines.push(text);
      break;
    case 'child_page':
      lines.push(`## 📄 ${data.title || 'صفحة فرعية'}`);
      break;
    case 'child_database':
      lines.push(`## 🗃️ ${data.title || 'قاعدة بيانات فرعية'}`);
      break;
    default:
      if (text) lines.push(text);
      break;
  }

  // Recurse into nested children (toggle blocks, nested lists, child pages).
  if (budget.remaining > 0 && depth < MAX_DEPTH && block?.has_children && type !== 'child_database') {
    const children = await fetchBlockChildren(block.id, token, budget);
    for (const child of children) {
      lines.push(...(await blockToMarkdown(child, token, depth + 1, budget)));
    }
  }
  return lines;
}

async function fetchBlockChildren(blockId: string, token: string, budget: { remaining: number }): Promise<any[]> {
  const blocks: any[] = [];
  let cursor = '';
  while (budget.remaining > 0) {
    const url = `${NOTION_API}/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const res = await fetch(url, { headers: notionHeaders(token) });
    if (!res.ok) {
      if (res.status === 404) return blocks; // page not shared with integration
      throw new Error(`Notion API error ${res.status} while reading blocks`);
    }
    const data = await res.json();
    for (const b of data.results || []) {
      if (budget.remaining <= 0) break;
      blocks.push(b);
      budget.remaining--;
    }
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return blocks;
}

/** Renders a database query result rows into markdown sections. */
function databaseRowsToMarkdown(rows: any[]): string {
  const sections: string[] = [];
  for (const row of rows) {
    const props = row?.properties || {};
    let title = '';
    const cells: string[] = [];
    for (const [name, prop] of Object.entries<any>(props)) {
      const t = prop?.type as string;
      let value = '';
      if (t === 'title' || t === 'rich_text') value = richTextToPlain(prop?.[t]);
      else if (t === 'number' && prop?.number != null) value = String(prop.number);
      else if (t === 'select') value = prop?.select?.name || '';
      else if (t === 'multi_select') value = (prop?.multi_select || []).map((s: any) => s?.name).join(', ');
      else if (t === 'date') value = prop?.date?.start || '';
      else if (t === 'checkbox') value = prop?.checkbox ? '✓' : '✗';
      else if (t === 'url') value = prop?.url || '';
      if (t === 'title') title = value;
      if (value) cells.push(`- **${name}**: ${value}`);
    }
    sections.push(`### ${title || 'صف بدون عنوان'}\n${cells.join('\n')}`);
  }
  return sections.join('\n\n');
}

export async function extractFromNotion(config: Record<string, unknown>): Promise<ConnectorExtraction> {
  const token = typeof config?.integrationToken === 'string' ? config.integrationToken.trim() : '';
  const targetRaw = typeof config?.databaseOrPageId === 'string' ? config.databaseOrPageId.trim() : '';
  if (!token) throw new Error('لا يوجد رمز دمج Notion (integrationToken) في إعدادات الموصل.');
  const targetId = parseNotionId(targetRaw);
  if (!targetId) throw new Error('معرف صفحة أو قاعدة بيانات Notion غير صالح.');

  // Try database first, then page — Notion ids are opaque between the two.
  const dbRes = await fetch(`${NOTION_API}/databases/${targetId}`, { headers: notionHeaders(token) });
  if (dbRes.ok) {
    const dbMeta = await dbRes.json();
    const dbTitle = richTextToPlain(dbMeta?.title) || 'قاعدة بيانات Notion';
    const queryRes = await fetch(`${NOTION_API}/databases/${targetId}/query`, {
      method: 'POST',
      headers: notionHeaders(token),
      body: JSON.stringify({ page_size: 100 }),
    });
    if (!queryRes.ok) throw new Error(`فشل استعلام قاعدة بيانات Notion (HTTP ${queryRes.status}).`);
    const queryData = await queryRes.json();
    const rows = queryData.results || [];
    if (rows.length === 0) throw new Error('قاعدة بيانات Notion فارغة — لا يوجد محتوى قابل للفهرسة.');
    const content = `# ${dbTitle}\n\nالمصدر: Notion Database (${targetId})\nعدد الصفوف: ${rows.length}\n\n${databaseRowsToMarkdown(rows)}`;
    return { title: `[Notion] ${dbTitle}`, content, itemsProcessed: rows.length };
  }

  const pageRes = await fetch(`${NOTION_API}/pages/${targetId}`, { headers: notionHeaders(token) });
  if (!pageRes.ok) {
    if (pageRes.status === 404) {
      throw new Error(
        'Notion أعاد 404 — تأكد من مشاركة الصفحة/قاعدة البيانات مع التكامل (Integration) وأن المعرف صحيح.',
      );
    }
    if (pageRes.status === 401) throw new Error('رمز دمج Notion مرفوض (401) — تحقق من صلاحية الرمز.');
    throw new Error(`فشل جلب صفحة Notion (HTTP ${pageRes.status}).`);
  }
  const pageMeta = await pageRes.json();
  const pageTitle =
    richTextToPlain(pageMeta?.properties?.title?.title) ||
    richTextToPlain(pageMeta?.properties?.Name?.title) ||
    'صفحة Notion';

  const budget = { remaining: MAX_BLOCKS };
  const blocks = await fetchBlockChildren(targetId, token, budget);
  if (blocks.length === 0) throw new Error('صفحة Notion فارغة — لا يوجد محتوى قابل للفهرسة.');

  const lines: string[] = [];
  for (const block of blocks) {
    lines.push(...(await blockToMarkdown(block, token, 0, budget)));
  }
  const body = lines.join('\n').trim();
  if (!body) throw new Error('تعذر استخلاص نص من كتل صفحة Notion.');

  return {
    title: `[Notion] ${pageTitle}`,
    content: `# ${pageTitle}\n\nالمصدر: Notion Page (${targetId})\n\n${body}`,
    itemsProcessed: blocks.length,
  };
}

const notionFields: ConnectorFieldDescriptor[] = [
  {
    key: 'integrationToken',
    labelAr: 'رمز التكامل (Notion Internal Integration Token)',
    labelEn: 'Notion Integration Token',
    type: 'password',
    required: true,
    secret: true,
    helpAr: 'أنشئ تكاملاً داخلياً من notion.so/my-integrations وشارك الصفحة/القاعدة معه.',
    helpEn: 'Create an internal integration at notion.so/my-integrations and share the page/database with it.',
  },
  {
    key: 'databaseOrPageId',
    labelAr: 'معرف أو رابط الصفحة / قاعدة البيانات',
    labelEn: 'Page / Database ID or URL',
    type: 'text',
    required: true,
    placeholder: 'https://www.notion.so/workspace/Page-Title-0123456789abcdef0123456789abcdef',
  },
];

export const notionConnector: ConnectorDescriptor = {
  type: 'notion',
  nameAr: 'مساحة عمل Notion',
  nameEn: 'Notion Workspace',
  descriptionAr: 'مزامنة صفحات وقواعد بيانات Notion عبر واجهة API الرسمية.',
  descriptionEn: 'Sync Notion pages and databases via the official API.',
  category: 'workplace',
  iconName: 'BookOpen',
  defaultSchedule: '0 */4 * * *',
  supportsSchedule: true,
  fields: notionFields,
  configSchema: buildConfigSchema(notionFields),
  extract: extractFromNotion,
  testConnection: async (config) => {
    try {
      await extractFromNotion(config);
      return {
        ok: true,
        messageAr: 'الاتصال ناجح وتم استخلاص المحتوى.',
        messageEn: 'Connected and extracted content.',
      };
    } catch (e: any) {
      return { ok: false, messageAr: e?.message || 'فشل الاتصال', messageEn: e?.message || 'Connection failed' };
    }
  },
};
