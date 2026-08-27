import type { ConnectorDescriptor, ConnectorFieldDescriptor } from '../types';
import { buildConfigSchema } from '../schemaBuilder';
import { extractFromWebPage, extractFromRssFeed, extractFromWebFile } from '../liveConnectors';

/**
 * Web-family connectors: single page, RSS/Atom feed, and remote file.
 * All extraction delegates to the SSRF-guarded implementations in
 * liveConnectors.ts — the descriptors here add the self-describing layer
 * (fields, schema, metadata) the registry/UI/sync worker share.
 */

const urlFields: ConnectorFieldDescriptor[] = [
  {
    key: 'url',
    labelAr: 'رابط الصفحة المستهدفة',
    labelEn: 'Target Page URL',
    type: 'text',
    required: true,
    placeholder: 'https://docs.example.com/guide',
  },
];

export const urlConnector: ConnectorDescriptor = {
  type: 'url',
  nameAr: 'صفحة ويب واحدة',
  nameEn: 'Single Web Page',
  descriptionAr: 'جلب صفحة ويب واستخلاص نصها المقروء مع حماية SSRF.',
  descriptionEn: 'Fetches a web page and extracts its readable text (SSRF-guarded).',
  category: 'web',
  iconName: 'Globe',
  defaultSchedule: '0 */6 * * *',
  supportsSchedule: true,
  fields: urlFields,
  configSchema: buildConfigSchema(urlFields),
  extract: (config) => extractFromWebPage(config),
};

const rssFields: ConnectorFieldDescriptor[] = [
  {
    key: 'feedUrl',
    labelAr: 'رابط التغذية RSS/Atom',
    labelEn: 'Feed URL',
    type: 'text',
    required: true,
    placeholder: 'https://news.example.com/feed.xml',
  },
];

export const rssConnector: ConnectorDescriptor = {
  type: 'rss',
  nameAr: 'تغذية الأخبار والمقالات (RSS / Atom)',
  nameEn: 'RSS / Atom Feed',
  descriptionAr: 'متابعة ومزامنة التحديثات الدورية من موجزات الأخبار ومدونات الشركات.',
  descriptionEn: 'Continuous ingestion from RSS/Atom channels and company blogs.',
  category: 'web',
  iconName: 'Rss',
  defaultSchedule: '0 */1 * * *',
  supportsSchedule: true,
  fields: rssFields,
  configSchema: buildConfigSchema(rssFields),
  extract: (config) => extractFromRssFeed(config),
};

const webFileFields: ConnectorFieldDescriptor[] = [
  {
    key: 'fileUrl',
    labelAr: 'رابط الملف المباشر',
    labelEn: 'Direct File URL',
    type: 'text',
    required: true,
    placeholder: 'https://example.com/report.pdf',
  },
  {
    key: 'fileName',
    labelAr: 'اسم الملف (اختياري)',
    labelEn: 'File Name (optional)',
    type: 'text',
    required: false,
    placeholder: 'report.pdf',
  },
  {
    key: 'engine',
    labelAr: 'محرك الاستخراج',
    labelEn: 'Extraction Engine',
    type: 'select',
    required: false,
    default: 'auto',
    options: [
      { label: 'تلقائي', value: 'auto' },
      { label: 'Mistral Document AI', value: 'mistral' },
      { label: 'Unstructured', value: 'unstructured' },
    ],
  },
];

export const webFileConnector: ConnectorDescriptor = {
  type: 'web_file',
  nameAr: 'ملف من رابط (PDF/DOCX/…)',
  nameEn: 'Remote File by URL',
  descriptionAr: 'تنزيل ملف من رابط عام ومعالجته عبر خط أنابيب الاستخراج المشترك.',
  descriptionEn: 'Downloads a public file URL and runs it through the shared extraction pipeline.',
  category: 'web',
  iconName: 'FileDown',
  defaultSchedule: 'manual',
  supportsSchedule: true,
  fields: webFileFields,
  configSchema: buildConfigSchema(webFileFields),
  extract: (config) => extractFromWebFile(config),
};
