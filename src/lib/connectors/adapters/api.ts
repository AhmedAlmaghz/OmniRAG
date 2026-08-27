import type { ConnectorDescriptor, ConnectorFieldDescriptor, ConnectorExtraction } from '../types';
import { buildConfigSchema } from '../schemaBuilder';
import { safeFetchText, htmlToText } from '../../mcp/net';

/**
 * Generic REST endpoint connector — pulls JSON (pretty-printed verbatim) or
 * HTML (folded to readable text) from any endpoint, with custom method and
 * headers for auth. Outbound requests go through the SSRF-guarded fetch
 * helpers, so tenant-supplied URLs cannot target private hosts.
 */

const API_TIMEOUT_MS = 30_000;
const API_MAX_BYTES = 4 * 1024 * 1024;

function parseHeadersJson(raw: string): Record<string, string> {
  const trimmed = (raw || '').trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('headers must be a JSON object');
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    throw new Error('ترويسات الطلب (headersJson) ليست JSON صالحًا — مثال: {"Authorization": "Bearer ..."}');
  }
}

export async function extractFromApi(config: Record<string, unknown>): Promise<ConnectorExtraction> {
  const endpointUrl = typeof config?.endpointUrl === 'string' ? config.endpointUrl.trim() : '';
  if (!endpointUrl) throw new Error('رابط نقطة النهاية (endpointUrl) مطلوب.');
  const method = config?.httpMethod === 'POST' ? 'POST' : 'GET';
  const headers = parseHeadersJson(typeof config?.headersJson === 'string' ? config.headersJson : '');
  const body = typeof config?.bodyJson === 'string' && config.bodyJson.trim() ? config.bodyJson.trim() : undefined;
  if (method === 'POST' && body) {
    try {
      JSON.parse(body);
    } catch {
      throw new Error('جسم الطلب (bodyJson) ليس JSON صالحًا.');
    }
  }

  const res = await safeFetchText(endpointUrl, {
    timeoutMs: API_TIMEOUT_MS,
    maxBytes: API_MAX_BYTES,
    method,
    headers: { Accept: 'application/json, text/html;q=0.8, */*;q=0.5', ...headers },
    body: method === 'POST' ? body : undefined,
  });
  if (!res.ok) {
    throw new Error(`فشل طلب نقطة النهاية: ${res.error || `HTTP ${res.status}`}`);
  }

  const title = endpointUrl;
  let text = '';
  if (res.contentType.includes('application/json')) {
    // JSON is ingested verbatim (pretty-printed) — reformatting risks
    // corrupting structure the model can exploit directly.
    try {
      text = JSON.stringify(JSON.parse(res.text), null, 2);
    } catch {
      text = res.text;
    }
  } else if (res.contentType.includes('text/html')) {
    text = htmlToText(res.text);
  } else {
    text = res.text;
  }

  if (!text || text.trim().length === 0) {
    throw new Error('نقطة النهاية أعادت استجابة فارغة.');
  }

  return {
    title: `[API] ${title}`,
    content: `# استجابة نقطة نهاية REST\n\nالمصدر: ${endpointUrl}\nالطريقة: ${method}\n\n${text.trim()}`,
    sourceUrl: endpointUrl,
    itemsProcessed: 1,
  };
}

const apiFields: ConnectorFieldDescriptor[] = [
  {
    key: 'endpointUrl',
    labelAr: 'رابط نقطة النهاية',
    labelEn: 'Endpoint URL',
    type: 'text',
    required: true,
    placeholder: 'https://api.company.com/v1/knowledge',
  },
  {
    key: 'httpMethod',
    labelAr: 'طريقة HTTP',
    labelEn: 'HTTP Method',
    type: 'select',
    required: false,
    default: 'GET',
    options: [
      { label: 'GET', value: 'GET' },
      { label: 'POST', value: 'POST' },
    ],
  },
  {
    key: 'headersJson',
    labelAr: 'ترويسات الطلب (JSON)',
    labelEn: 'Request Headers (JSON)',
    type: 'textarea',
    required: false,
    placeholder: '{"Authorization": "Bearer ...", "Accept": "application/json"}',
    secret: true,
  },
  {
    key: 'bodyJson',
    labelAr: 'جسم الطلب لـ POST (JSON)',
    labelEn: 'POST Body (JSON)',
    type: 'textarea',
    required: false,
    placeholder: '{"query": "..."}',
  },
];

export const apiConnector: ConnectorDescriptor = {
  type: 'api',
  nameAr: 'نقطة نهاية REST مخصصة',
  nameEn: 'Custom REST Endpoint',
  descriptionAr: 'ربط أي نظام (ERP/CRM/داخلي) عبر نقطة JSON أو HTML مع ترويسات مخصصة.',
  descriptionEn: 'Connect any system (ERP/CRM/internal) via a JSON or HTML endpoint with custom headers.',
  category: 'databases',
  iconName: 'Code',
  defaultSchedule: '0 */6 * * *',
  supportsSchedule: true,
  fields: apiFields,
  configSchema: buildConfigSchema(apiFields),
  extract: extractFromApi,
};
