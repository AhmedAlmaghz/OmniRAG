'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard, RefreshCw, AlertTriangle, CheckCircle2, Infinity as InfinityIcon } from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import { t } from '@/lib/i18n';

/**
 * Subscription & Plans (Phase 7) — shows the workspace's current plan, live
 * usage against each quota, and plan switching. Changing the plan requires
 * `billing:manage` (owner only); everyone else with settings:read sees a
 * read-only view (the switch button is hidden server-side by the 403, and
 * client-side via `canManage`).
 */

interface QuotaUsage {
  limit: number | null;
  current: number;
}

interface PlanView {
  id: string;
  name: { ar: string; en: string };
  description: { ar: string; en: string };
  quotas: Record<string, number | null>;
}

interface PlanDetails {
  plan: PlanView;
  usage: Record<string, QuotaUsage>;
  canManage: boolean;
  availablePlans: PlanView[];
}

const QUOTA_LABEL_KEYS: Record<string, string> = {
  maxMembers: 'plans.quotaMembers',
  maxDocuments: 'plans.quotaDocuments',
  maxCollections: 'plans.quotaCollections',
  maxConnectors: 'plans.quotaConnectors',
  maxApiKeys: 'plans.quotaApiKeys',
  maxWebhooks: 'plans.quotaWebhooks',
  maxTeams: 'plans.quotaTeams',
};

export default function PlansView({ lang }: { lang: 'ar' | 'en' }) {
  const [details, setDetails] = useState<PlanDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const ar = lang === 'ar';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/v1/plan');
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error || t(lang, 'plans.loadFailed'));
        return;
      }
      setDetails(data);
    } catch (e: any) {
      setError(e?.message || t(lang, 'common.connectionError'));
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    load();
  }, [load]);

  const switchPlan = async (planId: string) => {
    setSwitching(planId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetchWithAuth('/api/v1/plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error || t(lang, 'plans.changeFailed'));
        return;
      }
      setNotice(t(lang, 'plans.planChanged'));
      await load();
    } catch (e: any) {
      setError(e?.message || t(lang, 'common.error'));
    } finally {
      setSwitching(null);
    }
  };

  const renderQuotaRow = (key: string, usage: QuotaUsage | undefined) => {
    if (!usage) return null;
    const labelKey = QUOTA_LABEL_KEYS[key];
    if (!labelKey) return null;
    const unlimited = usage.limit === null;
    const pct = unlimited ? 0 : Math.min(100, Math.round((usage.current / Math.max(usage.limit ?? 1, 1)) * 100));
    const barColor = pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-indigo-500';

    return (
      <div key={key} className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-600 font-medium">{t(lang, labelKey)}</span>
          <span className="font-mono text-slate-500" dir="ltr">
            {usage.current} / {unlimited ? '∞' : usage.limit}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${unlimited ? 0 : pct}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-3xs overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-bold text-slate-900">{t(lang, 'plans.title')}</h2>
        </div>
        {details && (
          <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-600 px-2 py-1 rounded border border-indigo-100 uppercase">
            {details.plan.name[ar ? 'ar' : 'en']}
          </span>
        )}
      </div>

      <div className="p-6 space-y-5">
        <p className="text-xs text-slate-500 leading-relaxed max-w-3xl">{t(lang, 'plans.intro')}</p>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}
        {notice && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {notice}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-slate-500 text-xs py-8 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" /> {t(lang, 'common.loading')}
          </div>
        )}

        {!loading && details && (
          <>
            {/* Current plan usage */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 uppercase">{t(lang, 'plans.usage')}</h3>
                <span className="text-[11px] text-slate-500">
                  {t(lang, 'plans.currentPlan')}: <b>{details.plan.name[ar ? 'ar' : 'en']}</b>
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                {Object.entries(details.usage).map(([key, usage]) => renderQuotaRow(key, usage))}
              </div>
            </div>

            {/* Available plans */}
            {details.canManage && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {details.availablePlans.map((p) => {
                  const isCurrent = p.id === details.plan.id;
                  return (
                    <div
                      key={p.id}
                      className={`p-4 rounded-xl border space-y-2 ${
                        isCurrent
                          ? 'border-indigo-400 bg-indigo-50/50 ring-1 ring-indigo-200'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-slate-900">{p.name[ar ? 'ar' : 'en']}</span>
                        {p.id === 'enterprise' && <InfinityIcon className="w-4 h-4 text-indigo-500" />}
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed min-h-8">
                        {p.description[ar ? 'ar' : 'en']}
                      </p>
                      <button
                        type="button"
                        disabled={isCurrent || switching !== null}
                        onClick={() => switchPlan(p.id)}
                        className={`w-full px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${
                          isCurrent
                            ? 'bg-indigo-100 text-indigo-500 cursor-default'
                            : 'bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white cursor-pointer'
                        }`}
                      >
                        {isCurrent ? t(lang, 'plans.currentPlan') : t(lang, 'plans.changePlan')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
