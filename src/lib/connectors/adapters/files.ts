import type { ConnectorDescriptor, ConnectorFieldDescriptor } from '../types';
import { buildConfigSchema } from '../schemaBuilder';

/**
 * File-upload and YouTube connectors keep their DEDICATED pipelines inside the
 * storage layer (batched PDF pipeline / YouTube transcript ladder), so their
 * descriptors carry UI metadata + validation only, with `extract` undefined —
 * the sync worker routes them to their specialized flows.
 */

const fileFields: ConnectorFieldDescriptor[] = [
  {
    key: 'chunkStrategy',
    labelAr: 'استراتيجية التقطيع',
    labelEn: 'Chunking Strategy',
    type: 'select',
    required: false,
    default: 'sliding',
    options: [
      { label: 'تقطيع دلالي محتذى (Semantic)', value: 'semantic' },
      { label: 'هيكل ماركداون (Markdown Structure)', value: 'markdown' },
      { label: 'نصوص وكود مصدري (Code / AST)', value: 'code' },
      { label: 'شريحة متداخلة (Sliding Window)', value: 'sliding' },
    ],
  },
  {
    key: 'chunkSize',
    labelAr: 'حجم القطعة (رمز/حرف)',
    labelEn: 'Chunk Size',
    type: 'number',
    required: false,
    default: 512,
  },
  {
    key: 'chunkOverlap',
    labelAr: 'التداخل بين القطع (%)',
    labelEn: 'Chunk Overlap %',
    type: 'number',
    required: false,
    default: 20,
  },
];

export const fileConnector: ConnectorDescriptor = {
  type: 'file',
  nameAr: 'رفع الملفات المباشرة',
  nameEn: 'Local File Upload',
  descriptionAr: 'رفع مستندات PDF, DOCX, TXT, MD, CSV, JSON واستخراج النصوص وتجزئتها آلياٌ.',
  descriptionEn: 'Direct PDF, DOCX, TXT, MD, CSV, JSON upload with automated parsing & chunking.',
  category: 'files',
  iconName: 'FileText',
  defaultSchedule: 'manual',
  // The file bytes live in the source config; re-sync re-runs the dedicated
  // PDF pipeline, so scheduling is meaningful even for uploads.
  supportsSchedule: true,
  fields: fileFields,
  configSchema: buildConfigSchema(fileFields),
  // extract intentionally undefined — dedicated pipeline in the storage layer.
};

const youtubeFields: ConnectorFieldDescriptor[] = [
  {
    key: 'url',
    labelAr: 'رابط الفيديو أو قائمة التشغيل',
    labelEn: 'Video / Playlist URL',
    type: 'text',
    required: true,
    placeholder: 'https://youtube.com/watch?v=…',
  },
  {
    key: 'autoTranslateArabic',
    labelAr: 'ترجمة تلقائية للعربية',
    labelEn: 'Auto-translate to Arabic',
    type: 'select',
    required: false,
    default: 'false',
    options: [
      { label: 'نعم', value: 'true' },
      { label: 'لا', value: 'false' },
    ],
  },
];

export const youtubeConnector: ConnectorDescriptor = {
  type: 'youtube',
  nameAr: 'تفريغ مقاطع يوتيوب',
  nameEn: 'YouTube Transcripts',
  descriptionAr: 'استخراج التفريغ النصي الحقيقي للفيديو (ترجمات/تسميات) مع الطوابع الزمنية.',
  descriptionEn: 'Extract real video transcripts (captions) with timestamps.',
  category: 'web',
  iconName: 'Youtube',
  defaultSchedule: '0 0 * * *',
  supportsSchedule: true,
  fields: youtubeFields,
  configSchema: buildConfigSchema(youtubeFields),
  // extract intentionally undefined — dedicated transcript ladder in the sync worker.
};
