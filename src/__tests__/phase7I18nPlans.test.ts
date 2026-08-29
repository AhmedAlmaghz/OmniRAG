import { describe, it, expect, beforeEach, vi } from 'vitest';
// The webhook quota test dials a fictional host (hooks.acme-corp.net); the
// SSRF guard resolves DNS before allowing it, so mock a public answer. Real
// DNS rejection is covered in mcpNetSsrf.test.ts.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));
import { db, memoryDb } from '@/lib/storage/db';
import { t, isLocale, getDictionary, SUPPORTED_LOCALES, type Dictionary, type Locale } from '@/lib/i18n';
import { en } from '@/lib/i18n/dictionaries/en';
import {
  PLANS,
  PLAN_IDS,
  QUOTA_RESOURCES,
  normalizePlanId,
  getTenantPlanId,
  getTenantPlan,
  getTenantUsage,
  countResourceUsage,
  checkTenantQuota,
  guardQuota,
} from '@/lib/services/planService';
import { createWebhookEndpoint } from '@/lib/services/webhookService';
import type { Collection, Tenant } from '@/lib/types/omnirag';

/**
 * Phase 7 — i18n dictionaries + subscription plan quotas. Runs against the
 * in-memory fallback store (no DATABASE_URL in the test env); each test
 * resets state via memoryDb (the wrapper's reset only clears Postgres state).
 */

const TENANT = 'tenant-phase7';

function tenantOverrides(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: TENANT,
    name: 'Phase 7 workspace',
    plan: 'individual',
    createdAt: new Date().toISOString(),
    settings: {
      chunkSize: 500,
      chunkOverlap: 50,
      hybridWeights: { semantic: 0.7, lexical: 0.3 },
      defaultModel: 'gemini-2.0-flash',
      dataRetentionDays: 90,
      enablePiiRedaction: false,
      enablePromptSanitizer: false,
    },
    ...overrides,
  };
}

async function seedCollections(tenantId: string, count: number, start = 0): Promise<void> {
  for (let i = start; i < start + count; i++) {
    const collection: Collection = {
      id: `col-${tenantId}-${i}`,
      tenantId,
      name: `Collection ${i}`,
      description: '',
      documentCount: 0,
      createdAt: new Date().toISOString(),
    };
    await memoryDb.addCollection(collection);
  }
}

beforeEach(() => {
  memoryDb.resetDatabaseState();
  // Without DATABASE_URL the wrapper's Postgres path returns empty lists
  // instead of erroring (silent bypass), so demo-data seeding would shadow
  // the rows we seed here. Force memory mode for deterministic quota counts.
  (db as unknown as { enableMemoryFallback(): void }).enableMemoryFallback();
});

/* ------------------------------------------------------------------ */
/* i18n                                                                */
/* ------------------------------------------------------------------ */

describe('i18n — t() lookup and interpolation', () => {
  it('resolves dotted keys in both locales', () => {
    expect(t('en', 'header.signOut')).toBe('Log Out');
    expect(t('ar', 'header.signOut')).toBe(getDictionary('ar').header.signOut);
    expect(t('ar', 'header.signOut')).not.toBe(t('en', 'header.signOut'));
    expect(t('en', 'settings.tabs.plans')).toBe('Subscription & Plans');
  });

  it('interpolates {placeholders} and leaves unknown placeholders intact', () => {
    const result = t('en', 'plans.quotaExceeded', { resource: 'Members' });
    expect(result).toContain('Members');
    expect(result).not.toContain('{resource}');

    const partial = t('en', 'plans.quotaExceeded', {});
    expect(partial).toContain('{resource}');
  });

  it('falls back to English, then to the key itself', () => {
    expect(t('ar', 'no.such.key')).toBe('no.such.key');
    expect(t('en', 'no.such.key')).toBe('no.such.key');
    // A key that resolves to a non-string node degrades to the key too.
    expect(t('en', 'header')).toBe('header');
  });

  it('isLocale narrows unknown values', () => {
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(SUPPORTED_LOCALES).toEqual(['ar', 'en']);
  });
});

describe('i18n — dictionary parity', () => {
  function walk(node: unknown, prefix: string, keys: string[]): void {
    for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${name}` : name;
      if (typeof value === 'string') keys.push(path);
      else if (value && typeof value === 'object') walk(value, path, keys);
    }
  }

  it('every English key resolves to an Arabic string (no silent en fallback)', () => {
    const keys: string[] = [];
    walk(en, '', keys);
    expect(keys.length).toBeGreaterThan(50);

    const arDict = getDictionary('ar');
    for (const key of keys) {
      const parts = key.split('.');
      let node: unknown = arDict;
      for (const part of parts) node = (node as Record<string, unknown>)?.[part];
      expect(typeof node, `ar dictionary missing key: ${key}`).toBe('string');
      expect((node as string).length, `ar dictionary empty key: ${key}`).toBeGreaterThan(0);
    }
  });

  it('getDictionary returns a stable object per locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(getDictionary(locale)).toBe(getDictionary(locale));
    }
    const dict: Dictionary = getDictionary('en');
    expect(dict.common.save).toBe('Save');
  });
});

/* ------------------------------------------------------------------ */
/* Plans — catalog and normalization                                   */
/* ------------------------------------------------------------------ */

describe('plans — catalog and normalization', () => {
  it('normalizes legacy and unknown plan ids forward', () => {
    expect(normalizePlanId('starter')).toBe('individual');
    expect(normalizePlanId('pro')).toBe('business');
    expect(normalizePlanId('individual')).toBe('individual');
    expect(normalizePlanId('team')).toBe('team');
    expect(normalizePlanId('business')).toBe('business');
    expect(normalizePlanId('enterprise')).toBe('enterprise');
    expect(normalizePlanId('gold')).toBe('individual');
    expect(normalizePlanId('')).toBe('individual');
    expect(normalizePlanId(null)).toBe('individual');
    expect(normalizePlanId(undefined)).toBe('individual');
  });

  it('catalog covers all four plans with ar/en names and quota tables', () => {
    expect(PLAN_IDS).toEqual(['individual', 'team', 'business', 'enterprise']);
    for (const id of PLAN_IDS) {
      const plan = PLANS[id];
      expect(plan.id).toBe(id);
      expect(plan.name.ar.length).toBeGreaterThan(0);
      expect(plan.name.en.length).toBeGreaterThan(0);
      expect(plan.description.ar.length).toBeGreaterThan(0);
      expect(plan.description.en.length).toBeGreaterThan(0);
      expect(Object.keys(plan.quotas).sort()).toEqual([...QUOTA_RESOURCES].sort());
    }
  });

  it('enterprise is unlimited (all quotas null); individual is the tightest', () => {
    for (const resource of QUOTA_RESOURCES) {
      expect(PLANS.enterprise.quotas[resource]).toBeNull();
    }
    expect(PLANS.individual.quotas.maxMembers).toBe(1);
    expect(PLANS.individual.quotas.maxApiKeys).toBe(1);
    // Quotas grow monotonically individual < team < business.
    for (const resource of QUOTA_RESOURCES) {
      const individual = PLANS.individual.quotas[resource]!;
      const team = PLANS.team.quotas[resource]!;
      const business = PLANS.business.quotas[resource]!;
      expect(team).toBeGreaterThan(individual);
      expect(business).toBeGreaterThan(team);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Plans — resolution, usage counting, quota enforcement               */
/* ------------------------------------------------------------------ */

describe('plans — tenant resolution', () => {
  it('resolves the plan from the tenant row', async () => {
    await memoryDb.createTenant(tenantOverrides({ plan: 'team' }));
    expect(await getTenantPlanId(TENANT)).toBe('team');
    expect((await getTenantPlan(TENANT)).id).toBe('team');
  });

  it('normalizes legacy plan ids stored on the tenant without rewriting them', async () => {
    await memoryDb.createTenant(tenantOverrides({ plan: 'pro' }));
    expect(await getTenantPlanId(TENANT)).toBe('business');
    // The stored row keeps the legacy value — normalization is read-side only.
    const stored = await db.getTenant(TENANT);
    expect(stored?.plan).toBe('pro');
  });

  it('fails open to individual for unknown tenants', async () => {
    expect(await getTenantPlanId('tenant-does-not-exist')).toBe('individual');
  });
});

describe('plans — usage counting and quota checks', () => {
  it('counts members with a floor of 1 for tenants without membership rows', async () => {
    await memoryDb.createTenant(tenantOverrides());
    expect(await countResourceUsage(TENANT, 'maxMembers')).toBe(1);
  });

  it('checkTenantQuota allows under the limit and blocks at exhaustion', async () => {
    await memoryDb.createTenant(tenantOverrides({ plan: 'individual' }));
    // individual allows 5 collections.
    await seedCollections(TENANT, 4);
    const under = await checkTenantQuota(TENANT, 'maxCollections');
    expect(under).toEqual({ allowed: true, limit: 5, current: 4 });

    await seedCollections(TENANT, 1, 4);
    const atLimit = await checkTenantQuota(TENANT, 'maxCollections');
    expect(atLimit).toEqual({ allowed: false, limit: 5, current: 5 });
  });

  it('guardQuota returns null under the limit and a 403 QUOTA_EXCEEDED at it', async () => {
    await memoryDb.createTenant(tenantOverrides({ plan: 'individual' }));
    await seedCollections(TENANT, 4);
    expect(await guardQuota(TENANT, 'maxCollections')).toBeNull();

    await seedCollections(TENANT, 1, 4);
    const denied = await guardQuota(TENANT, 'maxCollections');
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(403);
    const body = await denied!.json();
    expect(body.code).toBe('403_QUOTA_EXCEEDED');
    expect(body.quota).toEqual({ resource: 'maxCollections', limit: 5, current: 5 });
  });

  it('enterprise (null limits) always passes regardless of usage', async () => {
    await memoryDb.createTenant(tenantOverrides({ plan: 'enterprise' }));
    await seedCollections(TENANT, 30);
    const check = await checkTenantQuota(TENANT, 'maxCollections');
    expect(check).toEqual({ allowed: true, limit: null, current: 30 });
    expect(await guardQuota(TENANT, 'maxCollections')).toBeNull();
  });

  it('getTenantUsage snapshots every quota resource', async () => {
    await memoryDb.createTenant(tenantOverrides({ plan: 'team' }));
    await seedCollections(TENANT, 3);
    const usage = await getTenantUsage(TENANT);
    expect(Object.keys(usage).sort()).toEqual([...QUOTA_RESOURCES].sort());
    expect(usage.maxCollections).toEqual({ limit: 20, current: 3 });
    expect(usage.maxMembers.current).toBeGreaterThanOrEqual(1);
    expect(usage.maxDocuments.limit).toBe(5000);
  });
});

describe('plans — plan changes and quota interaction', () => {
  it('db.updateTenantPlan switches the effective plan', async () => {
    await memoryDb.createTenant(tenantOverrides({ plan: 'individual' }));
    expect(await getTenantPlanId(TENANT)).toBe('individual');

    const updated = await db.updateTenantPlan(TENANT, 'business');
    expect(updated?.plan).toBe('business');
    expect(await getTenantPlanId(TENANT)).toBe('business');
    // Quotas relax immediately: 5 collections no longer exhaust the limit.
    await seedCollections(TENANT, 5);
    expect(await guardQuota(TENANT, 'maxCollections')).toBeNull();
  });

  it('updateTenantPlan on a missing tenant resolves undefined', async () => {
    expect(await db.updateTenantPlan('tenant-ghost', 'team')).toBeUndefined();
  });

  it('webhook creation honors the plan quota (individual: 1 webhook)', async () => {
    await memoryDb.createTenant(tenantOverrides({ plan: 'individual' }));
    const first = await createWebhookEndpoint(TENANT, {
      name: 'Primary hook',
      url: 'https://hooks.acme-corp.net/primary',
      events: ['document.indexed'],
    });
    expect(first.error).toBeUndefined();
    expect(first.endpoint).toBeTruthy();

    const second = await createWebhookEndpoint(TENANT, {
      name: 'Second hook',
      url: 'https://hooks.acme-corp.net/secondary',
      events: ['sync.completed'],
    });
    expect(second.endpoint).toBeUndefined();
    expect(second.code).toBe('403_QUOTA_EXCEEDED');
  });
});
