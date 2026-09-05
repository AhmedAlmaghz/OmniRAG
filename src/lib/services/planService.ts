import { createLogger } from '@/lib/logging/logger';

const log = createLogger('LibServicesPlanService');

import { NextResponse } from 'next/server';
import { db } from '../storage/db';
import { getPostgresPool } from '../storage/postgres';
import { listTenantMemberships, listTenantTeams } from './membershipService';
import type { PlanId, Tenant } from '../types/omnirag';

/**
 * Subscription plans (Phase 7) — activates the previously inert `tenants.plan`
 * column with a quota catalog and enforcement helpers.
 *
 * Plans: individual (فرد), team (فريق), business (أعمال), enterprise (مؤسسة).
 * A quota of `null` means unlimited. Legacy plan ids are normalized forward
 * (starter → individual, pro → business) so existing deployments keep working
 * without a data migration; the mapped value is resolved on read, never
 * rewritten silently.
 *
 * Enforcement is fail-open on lookup errors (a quota check must not take the
 * platform down when a count query fails) but fail-closed on quota exhaustion
 * (over-limit creates are rejected with 403 QUOTA_EXCEEDED).
 */

export const PLAN_IDS: readonly PlanId[] = ['individual', 'team', 'business', 'enterprise'] as const;

export interface PlanQuotas {
  /** Workspace members (memberships; the creator always counts as one). */
  maxMembers: number | null;
  maxDocuments: number | null;
  maxCollections: number | null;
  /** Source connectors. */
  maxConnectors: number | null;
  maxApiKeys: number | null;
  maxWebhooks: number | null;
  maxTeams: number | null;
}

export interface PlanDescriptor {
  id: PlanId;
  name: { ar: string; en: string };
  description: { ar: string; en: string };
  quotas: PlanQuotas;
  /**
   * Monthly LLM token ceiling for the whole workspace (input+output, all
   * chat/completions). null = unlimited. Enforced via usage_counters — the
   * tokens were recorded per message before but never budgeted, so a single
   * tenant could burn the platform's provider keys indefinitely. Lives on
   * the descriptor (not in PlanQuotas) because it is a spend budget, not a
   * countable resource: QUOTA_RESOURCES drives the usage snapshot and must
   * stay per-resource.
   */
  monthlyTokenBudget: number | null;
}

export const PLANS: Record<PlanId, PlanDescriptor> = {
  individual: {
    id: 'individual',
    name: { ar: 'فرد', en: 'Individual' },
    description: {
      ar: 'مساحة عمل شخصية بحصص أساسية.',
      en: 'Personal workspace with essential quotas.',
    },
    quotas: {
      maxMembers: 1,
      maxDocuments: 500,
      maxCollections: 5,
      maxConnectors: 3,
      maxApiKeys: 1,
      maxWebhooks: 1,
      maxTeams: 1,
    },
    monthlyTokenBudget: 2_000_000,
  },
  team: {
    id: 'team',
    name: { ar: 'فريق', en: 'Team' },
    description: {
      ar: 'تعاون فرق صغيرة بحصص موسعة.',
      en: 'Small team collaboration with expanded quotas.',
    },
    quotas: {
      maxMembers: 10,
      maxDocuments: 5000,
      maxCollections: 20,
      maxConnectors: 10,
      maxApiKeys: 3,
      maxWebhooks: 3,
      maxTeams: 5,
    },
    monthlyTokenBudget: 10_000_000,
  },
  business: {
    id: 'business',
    name: { ar: 'أعمال', en: 'Business' },
    description: {
      ar: 'مؤسسات نامية بحدود متقدمة.',
      en: 'Growing organizations with advanced limits.',
    },
    quotas: {
      maxMembers: 50,
      maxDocuments: 50000,
      maxCollections: 100,
      maxConnectors: 50,
      maxApiKeys: 10,
      maxWebhooks: 10,
      maxTeams: 20,
    },
    monthlyTokenBudget: 50_000_000,
  },
  enterprise: {
    id: 'enterprise',
    name: { ar: 'مؤسسة', en: 'Enterprise' },
    description: {
      ar: 'نطاق غير محدود مع تحكم مخصص.',
      en: 'Unlimited scale with dedicated controls.',
    },
    quotas: {
      maxMembers: null,
      maxDocuments: null,
      maxCollections: null,
      maxConnectors: null,
      maxApiKeys: null,
      maxWebhooks: null,
      maxTeams: null,
    },
    monthlyTokenBudget: null,
  },
};

/** Maps legacy/unknown plan ids onto the active catalog. */
export function normalizePlanId(raw: string | null | undefined): PlanId {
  switch (raw) {
    case 'team':
    case 'business':
    case 'enterprise':
    case 'individual':
      return raw;
    case 'starter':
      return 'individual';
    case 'pro':
      return 'business';
    default:
      return 'individual';
  }
}

export async function getTenantPlanId(tenantId: string): Promise<PlanId> {
  try {
    const tenant: Tenant | undefined = await db.getTenant(tenantId);
    return normalizePlanId(tenant?.plan);
  } catch (err) {
    log.warn('[plans] plan lookup failed, defaulting to individual:', (err as Error)?.message);
    return 'individual';
  }
}

export async function getTenantPlan(tenantId: string): Promise<PlanDescriptor> {
  return PLANS[await getTenantPlanId(tenantId)];
}

/**
 * Plan tier order — used to distinguish upgrades from downgrades.
 * Enterprise sits above business; the numeric order matches PLAN_IDS.
 */
const PLAN_RANK: Record<PlanId, number> = { individual: 0, team: 1, business: 2, enterprise: 3 };

export interface PlanSwitchCheck {
  allowed: boolean;
  /** True when the change raises the tier (needs PLAN_SELF_SERVE). */
  isUpgrade: boolean;
}

/**
 * Self-serve plan switching gate. Until a billing provider is wired, free
 * upgrades would hand every owner enterprise (unlimited) quotas for free, so
 * upgrades require an explicit operator opt-in via PLAN_SELF_SERVE=true.
 * Downgrades are always allowed — they only ever shrink the tenant's quotas.
 */
export function canSwitchPlan(currentPlan: PlanId, requestedPlan: PlanId): PlanSwitchCheck {
  const isUpgrade = PLAN_RANK[requestedPlan] > PLAN_RANK[currentPlan];
  if (!isUpgrade) return { allowed: true, isUpgrade: false };
  const selfServe = (process.env.PLAN_SELF_SERVE || '').toLowerCase() === 'true';
  return { allowed: selfServe, isUpgrade: true };
}

export type QuotaResource = keyof PlanQuotas;

export const QUOTA_RESOURCES: readonly QuotaResource[] = [
  'maxMembers',
  'maxDocuments',
  'maxCollections',
  'maxConnectors',
  'maxApiKeys',
  'maxWebhooks',
  'maxTeams',
] as const;

/** Current usage per resource. Errors resolve to 0 (fail-open on counting). */
export async function countResourceUsage(tenantId: string, resource: QuotaResource): Promise<number> {
  try {
    switch (resource) {
      case 'maxMembers': {
        const rows = await listTenantMemberships(tenantId);
        // Legacy single-user tenants may have no membership rows yet — the
        // creator is still a member, so the floor is 1.
        return Math.max(rows.length, 1);
      }
      case 'maxDocuments':
        return (await db.getDocuments(tenantId)).length;
      case 'maxCollections':
        return (await db.getCollections(tenantId)).length;
      case 'maxConnectors':
        return (await db.getSources(tenantId)).length;
      case 'maxApiKeys':
        return (await db.listApiKeys(tenantId)).length;
      case 'maxWebhooks':
        return (await db.listWebhookEndpoints(tenantId)).length;
      case 'maxTeams':
        return (await listTenantTeams(tenantId)).length;
      default:
        return 0;
    }
  } catch (err) {
    log.warn(`[plans] usage count failed for ${resource}:`, (err as Error)?.message);
    return 0;
  }
}

export interface QuotaCheck {
  allowed: boolean;
  limit: number | null;
  current: number;
}

/**
 * Checks whether one more unit of `resource` fits within the tenant's plan.
 * `null` limit = unlimited (always allowed).
 */
export async function checkTenantQuota(tenantId: string, resource: QuotaResource): Promise<QuotaCheck> {
  const plan = await getTenantPlan(tenantId);
  const limit = plan.quotas[resource];
  const current = await countResourceUsage(tenantId, resource);
  if (limit === null) return { allowed: true, limit, current };
  return { allowed: current < limit, limit, current };
}

/** Usage snapshot for the plans UI / GET /api/v1/plan. */
export async function getTenantUsage(
  tenantId: string,
): Promise<Record<QuotaResource, { limit: number | null; current: number }>> {
  const plan = await getTenantPlan(tenantId);
  const usage = {} as Record<QuotaResource, { limit: number | null; current: number }>;
  for (const resource of QUOTA_RESOURCES) {
    usage[resource] = { limit: plan.quotas[resource], current: await countResourceUsage(tenantId, resource) };
  }
  return usage;
}

/**
 * One-shot guard for create paths: returns a 403 response when the tenant's
 * plan quota for `resource` is exhausted, or null when the create may
 * proceed (mirrors the guardPermission pattern used across routes).
 */
export async function guardQuota(tenantId: string, resource: QuotaResource): Promise<NextResponse | null> {
  const check = await checkTenantQuota(tenantId, resource);
  if (check.allowed) return null;
  return NextResponse.json(
    {
      error: `تم تجاوز حصة الخطة لهذا المورد — الحد ${check.limit} (Plan quota exceeded for ${resource})`,
      code: '403_QUOTA_EXCEEDED',
      quota: { resource, limit: check.limit, current: check.current },
    },
    { status: 403 },
  );
}

/* ── Monthly token budget (Phase 4) ─────────────────────────────────────────
   tokensUsed was recorded per message but never budgeted — one tenant could
   burn the platform's provider keys indefinitely. The usage_counters row is
   the atomic source of truth: one upsert per completion, fail-open on DB
   errors (a quota counter outage must not take chat down). */

/** Current calendar month key, e.g. '2026-08'. */
function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface TokenBudgetStatus {
  budget: number | null;
  used: number;
  remaining: number | null;
  exhausted: boolean;
}

/** Read the tenant's month-to-date token spend (0 when the DB is away). */
export async function getTokenUsage(tenantId: string, period = currentPeriod()): Promise<number> {
  try {
    const pool = getPostgresPool();
    if (!pool) return 0;
    const res = await pool.query('SELECT tokens_used FROM usage_counters WHERE tenant_id = $1 AND period = $2', [
      tenantId,
      period,
    ]);
    return Number(res.rows[0]?.tokens_used ?? 0);
  } catch {
    return 0;
  }
}

export async function getTokenBudgetStatus(tenantId: string): Promise<TokenBudgetStatus> {
  const plan = await getTenantPlan(tenantId);
  const budget = plan.monthlyTokenBudget;
  const used = await getTokenUsage(tenantId);
  return {
    budget,
    used,
    remaining: budget === null ? null : Math.max(0, budget - used),
    exhausted: budget !== null && used >= budget,
  };
}

/**
 * Atomically add `tokens` to the month counter (single guarded upsert, no
 * read-modify-write). Call after each completion with the model-reported
 * usage; fail-open so accounting can never break chat.
 */
export async function recordTokenUsage(tenantId: string, tokens: number, period = currentPeriod()): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  try {
    const pool = getPostgresPool();
    if (!pool) return;
    await pool.query(
      `INSERT INTO usage_counters (tenant_id, period, tokens_used, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, period) DO UPDATE SET
         tokens_used = usage_counters.tokens_used + $3,
         updated_at = $4`,
      [tenantId, period, Math.round(tokens), new Date().toISOString()],
    );
  } catch (err) {
    log.warn('[plans] token usage record failed:', (err as Error)?.message);
  }
}
