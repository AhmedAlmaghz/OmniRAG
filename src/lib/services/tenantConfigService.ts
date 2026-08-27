import { db } from '../storage/db';
import type { Tenant, TenantSettings } from '../types/omnirag';
import { DEFAULT_AI_MODELS, type AIModelConfig, normalizeModelConfig } from '../config/aiModels';

/**
 * Server-side tenant configuration of record.
 *
 * Before this service, ingestion/model preferences lived in each browser's
 * localStorage and were shipped per-request via headers — meaning the same
 * tenant saw different behavior per device and the server had no durable
 * config to apply in background jobs (sync workers, scheduled ingestion).
 *
 * This service is the single read/write path for tenant-level settings. It
 * persists into `tenants.settings` (jsonb) through the storage contract and
 * merges over sane defaults so partially-configured tenants keep working.
 *
 * Model routing: `settings.modelRouting` holds qualified model references
 * (`provider/modelId`) per operation. When absent, callers fall back to the
 * per-request config / DEFAULT_AI_MODELS, preserving existing behavior.
 */

/** Tenant settings extended with platform-evolution fields (Phase 0+). */
export interface TenantConfig extends TenantSettings {
  /** Per-operation model routing as qualified refs (`provider/modelId`). */
  modelRouting?: Partial<AIModelConfig>;
  /** Preferred vector store backend id (Phase 2). Defaults to `qdrant`. */
  vectorStoreId?: string;
  /** Preferred object store backend id (Phase 2). Defaults to `local`. */
  objectStoreId?: string;
  /** Ingestion pipeline template id (Phase 3): fast | balanced | accurate. */
  pipelineTemplateId?: string;
  /** OIDC single-sign-on configuration (Phase 5). */
  ssoOidc?: SsoOidcConfig;
}

/**
 * Per-tenant OIDC SSO settings (Phase 5). Works with any standards-compliant
 * provider: Azure AD, Okta, Google Workspace, Keycloak, Auth0, etc.
 *
 * `clientSecret` is stored as AES-256-GCM ciphertext (encryptToken format) and
 * only decrypted at the token-exchange step. `emailDomain` (optional) binds the
 * flow to a corporate domain so JIT provisioning only accepts matching emails.
 */
export interface SsoOidcConfig {
  enabled: boolean;
  /** OIDC issuer URL, e.g. https://login.microsoftonline.com/{tenant}/v2.0 */
  issuer: string;
  clientId: string;
  /** AES-256-GCM ciphertext of the client secret (never plaintext at rest). */
  clientSecret?: string;
  /** Optional corporate email domain enforced on JIT provisioning. */
  emailDomain?: string;
  /** Role assigned to JIT-provisioned users. Defaults to `viewer`. */
  defaultRole?: 'admin' | 'editor' | 'viewer';
}

const BASE_DEFAULTS: TenantSettings = {
  chunkSize: 500,
  chunkOverlap: 50,
  hybridWeights: { semantic: 0.7, lexical: 0.3 },
  defaultModel: DEFAULT_AI_MODELS.chatModel,
  dataRetentionDays: 90,
  enablePiiRedaction: true,
  enablePromptSanitizer: true,
};

/** Full default config used when a tenant has no persisted settings. */
export function defaultTenantConfig(): TenantConfig {
  return { ...BASE_DEFAULTS };
}

/**
 * Normalizes a raw persisted settings blob into a complete TenantConfig,
 * filling missing fields from defaults. Tolerates legacy rows that predate
 * the platform-evolution fields.
 */
export function normalizeTenantConfig(raw?: Partial<TenantConfig> | null): TenantConfig {
  const base = { ...BASE_DEFAULTS };
  if (!raw || typeof raw !== 'object') return base;
  const merged: TenantConfig = {
    ...base,
    ...raw,
    hybridWeights: {
      ...base.hybridWeights,
      ...(raw.hybridWeights && typeof raw.hybridWeights === 'object' ? raw.hybridWeights : {}),
    },
  };
  return merged;
}

/**
 * Loads the effective config for a tenant. Returns defaults when the tenant
 * row or settings are missing — never throws into request handlers.
 */
export async function getTenantConfig(tenantId: string): Promise<TenantConfig> {
  try {
    const tenant: Tenant | undefined = await db.getTenant(tenantId);
    return normalizeTenantConfig((tenant?.settings as TenantConfig | undefined) ?? null);
  } catch (e) {
    console.warn('[tenantConfig] getTenantConfig failed, using defaults:', (e as Error)?.message);
    return defaultTenantConfig();
  }
}

/**
 * Persists a partial config update for a tenant (shallow merge over current).
 * Returns the resulting effective config.
 */
export async function updateTenantConfig(
  tenantId: string,
  updates: Partial<TenantConfig>,
): Promise<TenantConfig | undefined> {
  const current = await getTenantConfig(tenantId);
  const next = normalizeTenantConfig({ ...current, ...updates });
  const tenant = await db.updateTenantSettings(tenantId, next as Partial<Tenant['settings']>);
  if (!tenant) return undefined;
  return next;
}

/**
 * Resolves the effective model routing for a tenant as a complete
 * AIModelConfig. Qualified refs are preserved as-is; missing operations fall
 * back to DEFAULT_AI_MODELS. Callers pass the result through the provider
 * registry's resolveModel() to obtain concrete model instances.
 */
export async function getTenantModelRouting(tenantId: string): Promise<AIModelConfig> {
  const config = await getTenantConfig(tenantId);
  return normalizeModelConfig(config.modelRouting ?? null);
}
