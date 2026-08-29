import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canSwitchPlan } from '../lib/services/planService';

/**
 * Free-plan-upgrade lock (Phase security): without a billing provider,
 * PUT /api/v1/plan would grant any owner enterprise (unlimited) quotas for
 * free. Upgrades now require PLAN_SELF_SERVE=true; downgrades always pass.
 */

describe('canSwitchPlan — self-serve plan switch gate', () => {
  const prev = process.env.PLAN_SELF_SERVE;

  beforeEach(() => {
    delete process.env.PLAN_SELF_SERVE;
  });

  afterEach(() => {
    if (prev !== undefined) process.env.PLAN_SELF_SERVE = prev;
  });

  it('blocks upgrades by default (no env opt-in)', () => {
    expect(canSwitchPlan('individual', 'team').allowed).toBe(false);
    expect(canSwitchPlan('individual', 'enterprise').allowed).toBe(false);
    expect(canSwitchPlan('team', 'business').allowed).toBe(false);
    expect(canSwitchPlan('business', 'enterprise').allowed).toBe(false);
  });

  it('always allows downgrades, even without the env opt-in', () => {
    expect(canSwitchPlan('enterprise', 'business').allowed).toBe(true);
    expect(canSwitchPlan('business', 'individual').allowed).toBe(true);
    expect(canSwitchPlan('enterprise', 'individual').allowed).toBe(true);
  });

  it('allows lateral switches (same tier)', () => {
    const r = canSwitchPlan('team', 'team');
    expect(r.allowed).toBe(true);
    expect(r.isUpgrade).toBe(false);
  });

  it('allows upgrades when PLAN_SELF_SERVE=true (operator opt-in)', () => {
    process.env.PLAN_SELF_SERVE = 'true';
    expect(canSwitchPlan('individual', 'enterprise').allowed).toBe(true);
    expect(canSwitchPlan('individual', 'enterprise').isUpgrade).toBe(true);
  });

  it('treats any non-true value as locked (not just absence)', () => {
    process.env.PLAN_SELF_SERVE = 'false';
    expect(canSwitchPlan('individual', 'team').allowed).toBe(false);
    process.env.PLAN_SELF_SERVE = '1';
    expect(canSwitchPlan('individual', 'team').allowed).toBe(false);
    process.env.PLAN_SELF_SERVE = 'TRUE';
    expect(canSwitchPlan('individual', 'team').allowed).toBe(true);
  });
});
