import type { ConnectorDescriptor, ConnectorFieldDescriptor, ConnectorExtraction } from '../types';
import { buildConfigSchema } from '../schemaBuilder';
import { htmlToText } from '../../mcp/net';

/**
 * Atlassian Confluence connector — indexes pages of a space via the Cloud
 * REST API (basic auth: account email + API token from id.atlassian.com).
 * Page bodies arrive as Confluence storage-format XHTML and are folded to
 * plain text with the shared htmlToText helper.
 */

const MAX_PAGES_DEFAULT = 50;

function confluenceBaseUrl(domain: string): string {
  const cleaned = (domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  return `https://${cleaned}/wiki/rest/api`;
}

export async function extractFromConfluence(config: Record<string, unknown>): Promise<ConnectorExtraction> {
  const domain = typeof config?.domain === 'string' ? config.domain.trim() : '';
  const spaceKey = typeof config?.spaceKey === 'string' ? config.spaceKey.trim() : '';
  const email = typeof config?.email === 'string' ? config.email.trim() : '';
  const apiToken = typeof config?.apiToken === 'string' ? config.apiToken.trim() : '';
  if (!domain || !spaceKey) throw new Error('نطاق Atlassian ومفتاح المساحة مطلوبان.');
  if (!email || !apiToken) throw new Error('بريد الحساب ورمز API مطلوبان لمصادقة Confluence.');

  const auth = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
  const base = confluenceBaseUrl(domain);
  const limit = Math.min(Math.max(Number(config?.maxPages) || MAX_PAGES_DEFAULT, 1), 100);

  const listRes = await fetch(
    `${base}/content?spaceKey=${encodeURIComponent(spaceKey)}&type=page&limit=${limit}&expand=body.storage,version`,
    { headers: { Authorization: auth, Accept: 'application/json' } },
  );
  if (listRes.status === 401) throw new Error('مصادقة Confluence مرفوضة (401) — تحقق من البريد ورمز API.');
  if (listRes.status === 404) throw new Error(`المساحة "${spaceKey}" غير موجودة على ${domain} (404).`);
  if (!listRes.ok) throw new Error(`فشل جلب صفحات Confluence (HTTP ${listRes.status}).`);

  const data = await listRes.json();
  const pages: any[] = data.results || [];
  if (pages.length === 0) throw new Error(`لا توجد صفحات في المساحة "${spaceKey}".`);

  const sections = pages
    .map((page) => {
      const html = page?.body?.storage?.value || '';
      const text = html ? htmlToText(html).trim() : '';
      const version = page?.version?.number ? ` (إصدار ${page.version.number})` : '';
      return `## ${page.title || 'صفحة بدون عنوان'}${version}\n${text || '(صفحة فارغة)'}`;
    })
    .join('\n\n---\n\n');

  return {
    title: `[Confluence] مساحة ${spaceKey}`,
    content: `# Confluence — ${domain} / ${spaceKey}\n\nعدد الصفحات: ${pages.length}\n\n${sections}`,
    sourceUrl: `https://${domain.replace(/^https?:\/\//i, '')}/wiki/spaces/${spaceKey}`,
    itemsProcessed: pages.length,
  };
}

const confluenceFields: ConnectorFieldDescriptor[] = [
  {
    key: 'domain',
    labelAr: 'نطاق Atlassian',
    labelEn: 'Atlassian Site Domain',
    type: 'text',
    required: true,
    placeholder: 'company.atlassian.net',
  },
  {
    key: 'spaceKey',
    labelAr: 'مفتاح المساحة (Space Key)',
    labelEn: 'Space Key',
    type: 'text',
    required: true,
    placeholder: 'ENG',
  },
  {
    key: 'email',
    labelAr: 'بريد حساب Atlassian',
    labelEn: 'Atlassian Account Email',
    type: 'text',
    required: true,
  },
  {
    key: 'apiToken',
    labelAr: 'رمز API Token',
    labelEn: 'API Token',
    type: 'password',
    required: true,
    secret: true,
    helpAr: 'أنشئ الرمز من id.atlassian.com → Security → API tokens.',
    helpEn: 'Create a token at id.atlassian.com → Security → API tokens.',
  },
  {
    key: 'maxPages',
    labelAr: 'الحد الأقصى للصفحات',
    labelEn: 'Max Pages',
    type: 'number',
    required: false,
    default: 50,
  },
];

export const confluenceConnector: ConnectorDescriptor = {
  type: 'confluence',
  nameAr: 'مساحة Confluence',
  nameEn: 'Confluence Space',
  descriptionAr: 'فهرسة صفحات Wiki لفرق العمل عبر واجهة Atlassian السحابية.',
  descriptionEn: 'Index team wiki pages via the Atlassian Cloud API.',
  category: 'workplace',
  iconName: 'Layers',
  defaultSchedule: '0 */6 * * *',
  supportsSchedule: true,
  fields: confluenceFields,
  configSchema: buildConfigSchema(confluenceFields),
  extract: extractFromConfluence,
};
