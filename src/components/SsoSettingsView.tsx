'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Fingerprint, RefreshCw, Save, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';

/**
 * Per-tenant OIDC SSO configuration (Phase 5). Lets an owner/admin connect a
 * corporate identity provider (Azure AD, Okta, Google Workspace, Keycloak, …)
 * by issuer + client credentials, optionally binding an email domain and
 * choosing the role JIT-provisioned users receive.
 */

interface SsoView {
  enabled: boolean;
  issuer: string;
  clientId: string;
  emailDomain: string;
  defaultRole: 'admin' | 'editor' | 'viewer';
  hasClientSecret: boolean;
  clientSecret: string;
}

const DEFAULT_SSO: SsoView = {
  enabled: false,
  issuer: '',
  clientId: '',
  emailDomain: '',
  defaultRole: 'viewer',
  hasClientSecret: false,
  clientSecret: '',
};

export default function SsoSettingsView({ lang }: { lang: 'ar' | 'en' }) {
  const ar = lang === 'ar';
  const [sso, setSso] = useState<SsoView>(DEFAULT_SSO);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/v1/auth/sso/config');
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || (ar ? 'تعذر تحميل إعدادات SSO' : 'Failed to load SSO config'));
        return;
      }
      setSso({ ...DEFAULT_SSO, ...(data.sso || {}) });
    } catch (e: any) {
      setError(e?.message || (ar ? 'خطأ في الاتصال' : 'Connection error'));
    } finally {
      setLoading(false);
    }
  }, [ar]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetchWithAuth('/api/v1/auth/sso/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sso),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || (ar ? 'فشل الحفظ' : 'Save failed'));
        return;
      }
      setSso({ ...DEFAULT_SSO, ...(data.sso || {}) });
      setNotice(ar ? 'تم حفظ إعدادات تسجيل الدخول الأحادي' : 'SSO configuration saved');
      window.setTimeout(() => setNotice(null), 3500);
    } catch (e: any) {
      setError(e?.message || (ar ? 'خطأ' : 'Error'));
    } finally {
      setSaving(false);
    }
  };

  const field =
    'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-3xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-indigo-600" />
            <h3 className="font-semibold text-slate-900">
              {ar ? 'تسجيل الدخول الأحادي (OIDC)' : 'Single Sign-On (OIDC)'}
            </h3>
          </div>
          <button onClick={load} className="text-slate-400 hover:text-slate-600" title={ar ? 'تحديث' : 'Refresh'}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-500 leading-relaxed">
            {ar
              ? 'اربط مساحة العمل بمزود هوية مؤسسي متوافق مع OpenID Connect مثل Azure AD أو Okta أو Google Workspace أو Keycloak. عند التفعيل يمكن للمستخدمين الدخول عبر مزودهم، ويُمنحون عضوية فورية بالدور المحدد أدناه.'
              : 'Connect this workspace to an OpenID Connect identity provider such as Azure AD, Okta, Google Workspace, or Keycloak. When enabled, users can sign in through their provider and are just-in-time granted membership with the role selected below.'}
          </p>

          {/* Enable toggle */}
          <label className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <ShieldCheck className="w-4 h-4 text-indigo-600" />
              {ar ? 'تفعيل تسجيل الدخول الأحادي' : 'Enable SSO'}
            </span>
            <input
              type="checkbox"
              checked={sso.enabled}
              onChange={(e) => setSso({ ...sso, enabled: e.target.checked })}
              className="w-5 h-5 accent-indigo-600"
            />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {ar ? 'رابط المُصدِر (Issuer URL)' : 'Issuer URL'}
              </label>
              <input
                value={sso.issuer}
                onChange={(e) => setSso({ ...sso, issuer: e.target.value })}
                placeholder="https://login.microsoftonline.com/{tenant}/v2.0"
                dir="ltr"
                className={field}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {ar ? 'معرف العميل (Client ID)' : 'Client ID'}
              </label>
              <input
                value={sso.clientId}
                onChange={(e) => setSso({ ...sso, clientId: e.target.value })}
                dir="ltr"
                className={field}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {ar ? 'سر العميل (Client Secret)' : 'Client Secret'}
                {sso.hasClientSecret && <span className="ms-1 text-emerald-600">({ar ? 'محفوظ' : 'saved'})</span>}
              </label>
              <input
                type="password"
                value={sso.clientSecret}
                onChange={(e) => setSso({ ...sso, clientSecret: e.target.value })}
                placeholder={
                  sso.hasClientSecret
                    ? '••••••••'
                    : ar
                      ? 'اتركه فارغاً للإبقاء على الحالي'
                      : 'Leave blank to keep current'
                }
                dir="ltr"
                className={field}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {ar ? 'نطاق البريد الملزم (اختياري)' : 'Email domain binding (optional)'}
              </label>
              <input
                value={sso.emailDomain}
                onChange={(e) => setSso({ ...sso, emailDomain: e.target.value })}
                placeholder="company.com"
                dir="ltr"
                className={field}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {ar ? 'دور المستخدمين الجدد (JIT)' : 'JIT-provisioned role'}
              </label>
              <select
                value={sso.defaultRole}
                onChange={(e) => setSso({ ...sso, defaultRole: e.target.value as SsoView['defaultRole'] })}
                className={field}
              >
                <option value="viewer">{ar ? 'مشاهد' : 'Viewer'}</option>
                <option value="editor">{ar ? 'محرر' : 'Editor'}</option>
                <option value="admin">{ar ? 'مشرف' : 'Admin'}</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'حفظ الإعدادات' : 'Save configuration'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
