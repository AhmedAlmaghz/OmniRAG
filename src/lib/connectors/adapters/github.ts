import type { ConnectorDescriptor, ConnectorFieldDescriptor } from '../types';
import { buildConfigSchema } from '../schemaBuilder';
import { extractFromGithubRepo } from '../liveConnectors';

/**
 * GitHub connector — repository metadata + README via the public REST API.
 *
 * Field-key normalization: the legacy UI catalog shipped `repo`/`personalToken`
 * while the extractor reads `repoUrl`/`patToken`. The registry standardizes on
 * the extractor's keys; extract() still accepts the legacy spellings so rows
 * created before the registry keep syncing.
 */

const githubFields: ConnectorFieldDescriptor[] = [
  {
    key: 'repoUrl',
    labelAr: 'رابط المستودع',
    labelEn: 'Repository URL',
    type: 'text',
    required: true,
    placeholder: 'https://github.com/owner/repo',
  },
  {
    key: 'branch',
    labelAr: 'الفرع المستهدف (اختياري)',
    labelEn: 'Target Branch (optional)',
    type: 'text',
    required: false,
    default: 'main',
  },
  {
    key: 'patToken',
    labelAr: 'رمز الوصول الشخصي PAT (اختياري)',
    labelEn: 'Personal Access Token (optional)',
    type: 'password',
    required: false,
    secret: true,
    helpAr: 'يرفع حدود معدل الطلبات ويتيح المستودعات الخاصة.',
    helpEn: 'Raises rate limits and unlocks private repositories.',
  },
];

export const githubConnector: ConnectorDescriptor = {
  type: 'github',
  nameAr: 'مستودعات GitHub',
  nameEn: 'GitHub Repositories',
  descriptionAr: 'فهرسة وصف المستودع وملف README عبر واجهة GitHub العامة.',
  descriptionEn: 'Index repository metadata and README via the public GitHub API.',
  category: 'workplace',
  iconName: 'Github',
  defaultSchedule: '0 */3 * * *',
  supportsSchedule: true,
  fields: githubFields,
  configSchema: buildConfigSchema(githubFields),
  extract: async (config) => {
    // Legacy key tolerance (pre-registry rows).
    const normalized: Record<string, unknown> = { ...config };
    if (!normalized.repoUrl && typeof normalized.repo === 'string') {
      const raw = normalized.repo.trim();
      normalized.repoUrl = raw.startsWith('http') ? raw : `https://github.com/${raw}`;
    }
    if (!normalized.patToken && typeof normalized.personalToken === 'string') {
      normalized.patToken = normalized.personalToken;
    }
    return extractFromGithubRepo(normalized);
  },
};
