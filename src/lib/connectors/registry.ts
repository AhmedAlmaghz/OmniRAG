import type { ConnectorDescriptor } from './types';
import { applyFieldDefaults } from './schemaBuilder';
import { urlConnector, rssConnector, webFileConnector } from './adapters/web';
import { githubConnector } from './adapters/github';
import { fileConnector, youtubeConnector } from './adapters/files';
import { notionConnector } from './adapters/notion';
import { gdriveConnector } from './adapters/gdrive';
import { confluenceConnector } from './adapters/confluence';
import { slackConnector } from './adapters/slack';
import { emailConnector } from './adapters/email';
import { databaseConnector } from './adapters/database';
import { apiConnector } from './adapters/api';

/**
 * Connector registry — the single source of truth for every knowledge source
 * type. The wizard catalog endpoint, config validation, the sync worker and
 * the "test connection" button all read from here, so a connector's UI shape
 * and runtime behavior can never drift apart.
 *
 * Adding a connector = one adapter file + one entry in this array.
 */
export const CONNECTOR_REGISTRY: ConnectorDescriptor[] = [
  fileConnector,
  urlConnector,
  rssConnector,
  youtubeConnector,
  githubConnector,
  webFileConnector,
  notionConnector,
  gdriveConnector,
  confluenceConnector,
  slackConnector,
  emailConnector,
  databaseConnector,
  apiConnector,
];

const REGISTRY_BY_TYPE = new Map<string, ConnectorDescriptor>(
  CONNECTOR_REGISTRY.map((descriptor) => [descriptor.type, descriptor]),
);

export function getConnectorDescriptor(type: string): ConnectorDescriptor | undefined {
  return REGISTRY_BY_TYPE.get(type);
}

export function listConnectors(): ConnectorDescriptor[] {
  return [...CONNECTOR_REGISTRY];
}

/**
 * Connectors whose sync runs through the generic `extract()` pipeline.
 * `youtube` and `file` keep their dedicated specialized pipelines inside the
 * storage layer (transcript ladder / batched PDF pipeline) and are handled
 * before this check by the sync worker.
 */
export function hasGenericExtraction(type: string): boolean {
  const descriptor = REGISTRY_BY_TYPE.get(type);
  return Boolean(descriptor?.extract);
}

/** Client-safe catalog entry — no functions, no zod schema objects. */
export interface ConnectorCatalogEntry {
  id: string;
  nameAr: string;
  nameEn: string;
  category: ConnectorDescriptor['category'];
  descriptionAr: string;
  descriptionEn: string;
  iconName: string;
  defaultSchedule: string;
  supportsSchedule: boolean;
  /** True when background sync can produce real content for this type. */
  supportsLiveSync: boolean;
  fields: ConnectorDescriptor['fields'];
}

/**
 * Serializes the registry for the wizard (`/api/v1/sources/types`). Mirrors
 * the historical response shape (`id` instead of `type`) so the existing
 * AddSourceWizard keeps working unchanged.
 */
export function toConnectorCatalog(): ConnectorCatalogEntry[] {
  return CONNECTOR_REGISTRY.map((descriptor) => ({
    id: descriptor.type,
    nameAr: descriptor.nameAr,
    nameEn: descriptor.nameEn,
    category: descriptor.category,
    descriptionAr: descriptor.descriptionAr,
    descriptionEn: descriptor.descriptionEn,
    iconName: descriptor.iconName,
    defaultSchedule: descriptor.defaultSchedule,
    supportsSchedule: descriptor.supportsSchedule,
    supportsLiveSync:
      hasGenericExtraction(descriptor.type) || descriptor.type === 'youtube' || descriptor.type === 'file',
    fields: descriptor.fields.map((field) => ({ ...field, options: field.options ? [...field.options] : undefined })),
  }));
}

export type ConnectorConfigValidation = { ok: true; config: Record<string, unknown> } | { ok: false; errors: string[] };

/**
 * Validates a runtime config against the connector's schema (built from the
 * same field descriptors the wizard renders) and applies declared defaults.
 * Unknown keys pass through so legacy rows with stale fields keep working.
 */
export function validateConnectorConfig(type: string, config: Record<string, unknown>): ConnectorConfigValidation {
  const descriptor = REGISTRY_BY_TYPE.get(type);
  if (!descriptor) {
    return { ok: false, errors: [`نوع مصدر غير معروف: ${type}`] };
  }
  const withDefaults = applyFieldDefaults(descriptor.fields, config);
  const result = descriptor.configSchema.safeParse(withDefaults);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`),
    };
  }
  return { ok: true, config: result.data };
}
