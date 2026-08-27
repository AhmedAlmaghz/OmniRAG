import crypto from 'node:crypto';
import type { ConnectorDescriptor, ConnectorFieldDescriptor, ConnectorExtraction } from '../types';
import { buildConfigSchema } from '../schemaBuilder';
import { processFileBuffer } from '../../services/unstructuredService';

/**
 * Google Drive connector — lists a folder and ingests its files:
 *  - Google Docs/Sheets/Slides are EXPORTED (text/plain, text/csv, pdf) —
 *    no binary parsing of Google's native formats;
 *  - uploaded files (PDF/DOCX/…) download and run through the shared
 *    extraction pipeline.
 *
 * Auth: a service-account JSON key (self-refreshing, the right choice for
 * scheduled syncs — the JWT bearer flow is implemented locally with
 * node:crypto, no SDK) or a short-lived OAuth access token.
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const MAX_FILES_DEFAULT = 20;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function parseServiceAccount(raw: string): ServiceAccountKey {
  const parsed = JSON.parse(raw);
  if (!parsed?.client_email || !parsed?.private_key) {
    throw new Error('ملف مفتاح Service Account غير مكتمل (ينقص client_email أو private_key).');
  }
  return parsed as ServiceAccountKey;
}

/** RS256 JWT bearer exchange → access token (RFC 7523, Google flavor). */
async function tokenFromServiceAccount(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: DRIVE_SCOPE,
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  ).toString('base64url');
  const signingInput = `${header}.${claims}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), sa.private_key).toString('base64url');
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) {
    throw new Error(`فشل تبادل رمز Service Account عند Google (HTTP ${res.status}).`);
  }
  const data = await res.json();
  if (!data?.access_token) throw new Error('استجابة Google لا تحتوي access_token.');
  return data.access_token as string;
}

async function resolveAccessToken(config: Record<string, unknown>): Promise<string> {
  const saRaw = typeof config?.serviceAccountJson === 'string' ? config.serviceAccountJson.trim() : '';
  if (saRaw) {
    return tokenFromServiceAccount(parseServiceAccount(saRaw));
  }
  const token = typeof config?.accessToken === 'string' ? config.accessToken.trim() : '';
  if (token) return token;
  throw new Error('لا توجد اعتمادات Google Drive: أضف مفتاح Service Account أو رمز وصول OAuth.');
}

async function driveFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
}

/** Export MIME for Google native formats; empty = download raw bytes. */
function exportMimeFor(mimeType: string): string {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
      return 'text/plain';
    case 'application/vnd.google-apps.spreadsheet':
      return 'text/csv';
    case 'application/vnd.google-apps.presentation':
      return 'application/pdf';
    default:
      return '';
  }
}

export async function extractFromGoogleDrive(config: Record<string, unknown>): Promise<ConnectorExtraction> {
  const folderId = typeof config?.folderId === 'string' ? config.folderId.trim() : '';
  if (!folderId) throw new Error('لا يوجد معرف مجلد Google Drive (folderId) في إعدادات الموصل.');
  const maxFiles = Math.min(Math.max(Number(config?.maxFiles) || MAX_FILES_DEFAULT, 1), 100);

  const token = await resolveAccessToken(config);

  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const listRes = await driveFetch(
    `${DRIVE_API}/files?q=${query}&pageSize=${maxFiles}&fields=files(id,name,mimeType,size)`,
    token,
  );
  if (listRes.status === 404) {
    throw new Error('المجلد غير موجود أو غير مشارك مع حساب Service Account (404).');
  }
  if (listRes.status === 401) {
    throw new Error('اعتمادات Google Drive مرفوضة (401) — تحقق من المفتاح أو رمز الوصول.');
  }
  if (!listRes.ok) {
    throw new Error(`فشل سرد مجلد Google Drive (HTTP ${listRes.status}).`);
  }
  const listData = (await listRes.json()) as {
    files?: Array<{ id: string; name: string; mimeType: string; size?: string }>;
  };
  const files = (listData.files || []).filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');
  if (files.length === 0) {
    throw new Error('المجلد فارغ أو لا يحتوي ملفات قابلة للقراءة (تأكد من مشاركة المجلد مع الخدمة).');
  }

  const sections: string[] = [];
  let processed = 0;
  for (const file of files.slice(0, maxFiles)) {
    try {
      const exportMime = exportMimeFor(file.mimeType || '');
      const url = exportMime
        ? `${DRIVE_API}/files/${file.id}/export?mimeType=${encodeURIComponent(exportMime)}`
        : `${DRIVE_API}/files/${file.id}?alt=media`;
      const res = await driveFetch(url, token);
      if (!res.ok) {
        sections.push(`## ${file.name}\n(تعذر التنزيل: HTTP ${res.status})`);
        continue;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
        sections.push(`## ${file.name}\n(ملف فارغ أو يتجاوز حد الحجم)`);
        continue;
      }

      let text = '';
      if (exportMime === 'text/plain' || exportMime === 'text/csv') {
        text = bytes.toString('utf8');
      } else {
        // Binary (uploaded files, exported slides as PDF) → shared pipeline.
        const mime = exportMime || file.mimeType || 'application/octet-stream';
        const parsed = await processFileBuffer(bytes, file.name || 'file', mime, { preferredEngine: 'auto' });
        text = parsed.text || '';
      }
      if (text.trim().length > 0) {
        sections.push(`## ${file.name}\n${text.trim()}`);
        processed++;
      } else {
        sections.push(`## ${file.name}\n(لم يُستخرج نص من هذا الملف)`);
      }
    } catch (e: any) {
      sections.push(`## ${file.name}\n(خطأ في المعالجة: ${e?.message || e})`);
    }
  }

  if (processed === 0) {
    throw new Error('تعذر استخراج أي نص من ملفات المجلد.');
  }

  return {
    title: `[Google Drive] مجلد ${folderId}`,
    content: `# Google Drive — مجلد ${folderId}\n\nعدد الملفات: ${files.length} | تم استخراج: ${processed}\n\n${sections.join('\n\n---\n\n')}`,
    sourceUrl: `https://drive.google.com/drive/folders/${folderId}`,
    itemsProcessed: processed,
  };
}

const gdriveFields: ConnectorFieldDescriptor[] = [
  {
    key: 'folderId',
    labelAr: 'معرف مجلد Google Drive',
    labelEn: 'Google Drive Folder ID',
    type: 'text',
    required: true,
    placeholder: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
    helpAr: 'الجزء الأخير من رابط المجلد: drive.google.com/drive/folders/<ID>',
    helpEn: 'The last segment of the folder URL: drive.google.com/drive/folders/<ID>',
  },
  {
    key: 'serviceAccountJson',
    labelAr: 'مفتاح Service Account (JSON كامل)',
    labelEn: 'Service Account Key (full JSON)',
    type: 'textarea',
    required: false,
    secret: true,
    helpAr: 'الخيار الموصى به للمزامنة المجدولة — شارك المجلد مع بريد الخدمة.',
    helpEn: 'Recommended for scheduled sync — share the folder with the service account email.',
  },
  {
    key: 'accessToken',
    labelAr: 'رمز وصول OAuth (مؤقت)',
    labelEn: 'OAuth Access Token (short-lived)',
    type: 'password',
    required: false,
    secret: true,
  },
  {
    key: 'maxFiles',
    labelAr: 'الحد الأقصى للملفات',
    labelEn: 'Max Files',
    type: 'number',
    required: false,
    default: 20,
  },
];

export const gdriveConnector: ConnectorDescriptor = {
  type: 'gdrive',
  nameAr: 'مجلدات Google Drive',
  nameEn: 'Google Drive Folders',
  descriptionAr: 'مزامنة ملفات مجلد Drive: تصدير Docs/Sheets/Slides وتنزيل الملفات الأخرى.',
  descriptionEn: 'Sync a Drive folder: export Docs/Sheets/Slides and download other files.',
  category: 'cloud',
  iconName: 'Folder',
  defaultSchedule: '0 */12 * * *',
  supportsSchedule: true,
  fields: gdriveFields,
  configSchema: buildConfigSchema(gdriveFields),
  extract: extractFromGoogleDrive,
};
