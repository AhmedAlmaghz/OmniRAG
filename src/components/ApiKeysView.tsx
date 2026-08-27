'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { KeySquare, Plus, RefreshCw, Trash2, Copy, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import { t } from '@/lib/i18n';

/**
 * Tenant API keys — enables external systems (REST clients, MCP clients,
 * automation) to access the platform headlessly via `Authorization: Bearer`.
 * The plaintext key is shown exactly once at creation; only its hash is stored.
 */

interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rateLimitPerMinute: number | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
}

export default function ApiKeysView({ lang }: { lang: 'ar' | 'en' }) {
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState('');
  const [rateLimit, setRateLimit] = useState('');
  const ar = lang === 'ar';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/v1/api-keys');
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error || t(lang, 'apiKeys.loadFailed'));
        return;
      }
      setKeys(data.keys || []);
    } catch (e: any) {
      setError(e?.message || t(lang, 'common.connectionError'));
    } finally {
      setLoading(false);
    }
  }, [ar]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const parsedLimit = rateLimit.trim() ? Number(rateLimit) : null;
      if (parsedLimit !== null && (!Number.isInteger(parsedLimit) || parsedLimit < 1)) {
        setError(t(lang, 'apiKeys.rateLimitInvalid'));
        setCreating(false);
        return;
      }
      const res = await fetchWithAuth('/api/v1/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || t(lang, 'apiKeys.defaultName'),
          rateLimitPerMinute: parsedLimit,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error || t(lang, 'apiKeys.createFailed'));
        return;
      }
      setNewKey(data.plainKey);
      setName('');
      setRateLimit('');
      await load();
    } catch (e: any) {
      setError(e?.message || t(lang, 'common.error'));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await fetchWithAuth('/api/v1/api-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await load();
    } catch (e: any) {
      setError(e?.message || t(lang, 'common.error'));
    }
  };

  const copyKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-3xs overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeySquare className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-bold text-slate-900">{t(lang, 'apiKeys.title')}</h2>
        </div>
        <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-600 px-2 py-1 rounded border border-indigo-100 uppercase">
          {keys.filter((k) => k.active).length} {t(lang, 'common.active')}
        </span>
      </div>

      <div className="p-6 space-y-4">
        <p className="text-xs text-slate-500 leading-relaxed max-w-3xl">
          {ar
            ? 'استخدم هذه المفاتيح لربط أنظمة خارجية بالمنصة عبر REST أو MCP. يُخزَّن تجزئة المفتاح فقط، ويظهر المفتاح الكامل مرة واحدة عند الإنشاء.'
            : 'Use these keys to connect external systems via REST or MCP. Only the key hash is stored; the full key is shown once at creation.'}
        </p>

        {/* Create row */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(lang, 'apiKeys.namePlaceholder')}
            className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <input
            type="number"
            min={1}
            max={100000}
            value={rateLimit}
            onChange={(e) => setRateLimit(e.target.value)}
            placeholder={t(lang, 'apiKeys.rateLimitPlaceholder')}
            className="w-full sm:w-52 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t(lang, 'apiKeys.createKey')}
          </button>
        </div>

        {/* One-time plaintext reveal */}
        {newKey && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2">
            <div className="flex items-center gap-2 text-emerald-800 text-xs font-bold">
              <ShieldCheck className="w-4 h-4" />
              {t(lang, 'apiKeys.createdNotice')}
            </div>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 text-[11px] font-mono bg-white border border-emerald-200 rounded-lg px-3 py-2 text-slate-800 break-all"
                dir="ltr"
              >
                {newKey}
              </code>
              <button
                type="button"
                onClick={copyKey}
                className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? t(lang, 'common.copied') : t(lang, 'common.copy')}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setNewKey(null)}
              className="text-[11px] text-emerald-700 underline cursor-pointer"
            >
              {t(lang, 'apiKeys.dismiss')}
            </button>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-slate-500 text-xs py-8 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" /> {t(lang, 'common.loading')}
          </div>
        )}

        {!loading && keys.length === 0 && !error && (
          <div className="text-center py-8 text-slate-400 text-xs">{t(lang, 'apiKeys.noKeys')}</div>
        )}

        {!loading && keys.length > 0 && (
          <div className="space-y-2">
            {keys.map((k) => (
              <div
                key={k.id}
                className={`flex items-center justify-between p-3 rounded-xl border ${
                  k.active ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 opacity-60'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">{k.name}</span>
                    <code className="text-[10px] font-mono text-slate-400" dir="ltr">
                      {k.prefix}…
                    </code>
                    {!k.active && (
                      <span className="text-[9px] font-bold bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded">
                        {t(lang, 'apiKeys.revoked')}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400">
                    {t(lang, 'apiKeys.createdLabel')}: {new Date(k.createdAt).toLocaleDateString(ar ? 'ar' : 'en')}
                    {k.lastUsedAt && (
                      <>
                        {' '}
                        · {t(lang, 'apiKeys.lastUsed')}: {new Date(k.lastUsedAt).toLocaleDateString(ar ? 'ar' : 'en')}
                      </>
                    )}
                    {k.rateLimitPerMinute && (
                      <>
                        {' '}
                        · {t(lang, 'apiKeys.limitLabel')}: {k.rateLimitPerMinute}/{t(lang, 'apiKeys.perMinute')}
                      </>
                    )}
                  </p>
                </div>
                {k.active && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(k.id)}
                    className="px-2.5 py-1.5 rounded-lg bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t(lang, 'apiKeys.revoke')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
