'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Plug, RefreshCw, Save, Trash2, CheckCircle2, AlertTriangle, Cpu, Search } from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';

/**
 * Providers & Keys — lets the organization choose which AI backends power the
 * platform. The provider catalog and credential field shapes come from the
 * server registry (/api/v1/providers), so adding a provider server-side shows
 * up here with zero UI changes. Secrets are encrypted at rest; masked values
 * mean "keep existing".
 */

interface CredentialField {
  key: string;
  labelAr: string;
  labelEn: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
}

interface ModelEntry {
  id: string;
  name: string;
  capabilities: string[];
  embeddingDimensions?: number;
}

interface ProviderCatalogEntry {
  id: string;
  nameAr: string;
  nameEn: string;
  capabilities: string[];
  credentialFields: CredentialField[];
  baseUrlConfigurable: boolean;
  defaultBaseUrl?: string;
  models: ModelEntry[];
  supportsDiscovery: boolean;
}

interface ProviderStatus {
  providerId: string;
  configured: boolean;
  enabled: boolean;
  baseUrl: string;
}

const CAPABILITY_LABELS: Record<string, { ar: string; en: string }> = {
  chat: { ar: 'محادثة', en: 'Chat' },
  embedding: { ar: 'تضمين', en: 'Embedding' },
  image: { ar: 'صور', en: 'Image' },
  'speech-to-text': { ar: 'تفريغ صوتي', en: 'Speech-to-text' },
  'text-to-speech': { ar: 'نطق', en: 'Text-to-speech' },
  ocr: { ar: 'OCR', en: 'OCR' },
  rerank: { ar: 'إعادة ترتيب', en: 'Rerank' },
};

export default function ProvidersView({ lang }: { lang: 'ar' | 'en' }) {
  const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
  const [status, setStatus] = useState<Record<string, ProviderStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-provider draft form state: { [providerId]: { [fieldKey]: value, baseUrl } }
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<Record<string, ModelEntry[]>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const ar = lang === 'ar';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/v1/providers');
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error || (ar ? 'تعذر تحميل المزودين' : 'Failed to load providers'));
        return;
      }
      setProviders(data.providers || []);
      const map: Record<string, ProviderStatus> = {};
      for (const s of data.status || []) map[s.providerId] = s;
      setStatus(map);
    } catch (e: any) {
      setError(e?.message || (ar ? 'خطأ في الاتصال' : 'Connection error'));
    } finally {
      setLoading(false);
    }
  }, [ar]);

  useEffect(() => {
    load();
  }, [load]);

  const setDraft = (providerId: string, key: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [providerId]: { ...prev[providerId], [key]: value } }));
  };

  const handleSave = async (provider: ProviderCatalogEntry) => {
    setSavingId(provider.id);
    setMessage(null);
    try {
      const draft = drafts[provider.id] || {};
      const credentials: Record<string, string> = {};
      for (const f of provider.credentialFields) {
        if (f.key === 'baseUrl') continue;
        if (draft[f.key] !== undefined) credentials[f.key] = draft[f.key];
      }
      const res = await fetchWithAuth('/api/v1/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          providerId: provider.id,
          credentials,
          baseUrl: draft.baseUrl ?? '',
          enabled: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMessage({ kind: 'err', text: data?.error || (ar ? 'فشل الحفظ' : 'Save failed') });
        return;
      }
      setMessage({ kind: 'ok', text: data.message || (ar ? 'تم الحفظ' : 'Saved') });
      // Clear secret drafts so they aren't left in the DOM.
      setDrafts((prev) => {
        const next = { ...prev };
        const cleared: Record<string, string> = { ...(next[provider.id] || {}) };
        for (const f of provider.credentialFields) if (f.secret) delete cleared[f.key];
        next[provider.id] = cleared;
        return next;
      });
      await load();
    } catch (e: any) {
      setMessage({ kind: 'err', text: e?.message || (ar ? 'خطأ في الحفظ' : 'Save error') });
    } finally {
      setSavingId(null);
    }
  };

  const handleRemove = async (provider: ProviderCatalogEntry) => {
    setSavingId(provider.id);
    setMessage(null);
    try {
      const res = await fetchWithAuth('/api/v1/providers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: provider.id }),
      });
      const data = await res.json();
      setMessage({
        kind: res.ok && data.success ? 'ok' : 'err',
        text: data?.message || data?.error || (ar ? 'تمت الإزالة' : 'Removed'),
      });
      await load();
    } catch (e: any) {
      setMessage({ kind: 'err', text: e?.message || (ar ? 'خطأ' : 'Error') });
    } finally {
      setSavingId(null);
    }
  };

  const handleDiscover = async (provider: ProviderCatalogEntry) => {
    setDiscoveringId(provider.id);
    try {
      const res = await fetchWithAuth('/api/v1/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discover', providerId: provider.id }),
      });
      const data = await res.json();
      setDiscovered((prev) => ({ ...prev, [provider.id]: data?.models || [] }));
    } catch {
      setDiscovered((prev) => ({ ...prev, [provider.id]: [] }));
    } finally {
      setDiscoveringId(null);
    }
  };

  const configuredCount = useMemo(() => Object.values(status).filter((s) => s.configured).length, [status]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-3xs overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-bold text-slate-900">
            {ar ? 'مزودو الذكاء الاصطناعي والمفاتيح' : 'AI Providers & Keys'}
          </h2>
        </div>
        <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-600 px-2 py-1 rounded border border-indigo-100 uppercase">
          {configuredCount} {ar ? 'مهيأ' : 'configured'}
        </span>
      </div>

      <div className="p-6 space-y-4">
        <p className="text-xs text-slate-500 leading-relaxed max-w-3xl">
          {ar
            ? 'اختر المزودين الذين تريد أن تعمل بهم المنصة (محادثة، تضمين، صور، تفريغ صوتي). تُشفَّر المفاتيح عند التخزين ولا تُعرض مرة أخرى بعد الحفظ.'
            : 'Choose which AI backends power the platform (chat, embedding, image, speech). Keys are encrypted at rest and never shown again after saving.'}
        </p>

        {message && (
          <div
            className={`p-3 rounded-xl flex items-center gap-2 text-xs font-medium ${
              message.kind === 'ok'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}
          >
            {message.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {message.text}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-slate-500 text-xs py-8 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" /> {ar ? 'جاري التحميل...' : 'Loading...'}
          </div>
        )}
        {error && !loading && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">{error}</div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {providers.map((p) => {
              const st = status[p.id];
              const isConfigured = Boolean(st?.configured);
              const draft = drafts[p.id] || {};
              return (
                <div key={p.id} className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/40">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Plug className={`w-4 h-4 ${isConfigured ? 'text-emerald-600' : 'text-slate-400'}`} />
                      <h3 className="text-sm font-bold text-slate-900">{ar ? p.nameAr : p.nameEn}</h3>
                      <code className="text-[10px] text-slate-400 font-mono">{p.id}</code>
                    </div>
                    {isConfigured && (
                      <span className="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                        {ar ? 'مهيأ' : 'CONFIGURED'}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {p.capabilities.map((c) => (
                      <span
                        key={c}
                        className="text-[9px] font-semibold bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100"
                      >
                        {CAPABILITY_LABELS[c] ? (ar ? CAPABILITY_LABELS[c].ar : CAPABILITY_LABELS[c].en) : c}
                      </span>
                    ))}
                  </div>

                  {/* Credential fields (generated from the registry) */}
                  <div className="space-y-2">
                    {p.credentialFields.map((f) => (
                      <div key={f.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                          {ar ? f.labelAr : f.labelEn}
                          {f.required && <span className="text-rose-500"> *</span>}
                        </label>
                        <div className="relative">
                          {f.secret && <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-2.5" />}
                          <input
                            type={f.secret ? 'password' : 'text'}
                            autoComplete="off"
                            value={draft[f.key] ?? ''}
                            onChange={(e) => setDraft(p.id, f.key, e.target.value)}
                            placeholder={isConfigured && f.secret ? '••••••••' : f.placeholder || ''}
                            className={`w-full px-3 py-2 ${f.secret ? 'ps-8' : ''} bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-mono`}
                          />
                        </div>
                      </div>
                    ))}
                    {p.baseUrlConfigurable && !p.credentialFields.some((f) => f.key === 'baseUrl') && (
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                          {ar ? 'عنوان الأساس (اختياري)' : 'Base URL (optional)'}
                        </label>
                        <input
                          type="text"
                          value={draft.baseUrl ?? st?.baseUrl ?? ''}
                          onChange={(e) => setDraft(p.id, 'baseUrl', e.target.value)}
                          placeholder={p.defaultBaseUrl || ''}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-mono"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleSave(p)}
                      disabled={savingId === p.id}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold text-[11px] flex items-center gap-1.5 cursor-pointer"
                    >
                      {savingId === p.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      {ar ? 'حفظ' : 'Save'}
                    </button>
                    {p.supportsDiscovery && (
                      <button
                        type="button"
                        onClick={() => handleDiscover(p)}
                        disabled={discoveringId === p.id}
                        className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-[11px] flex items-center gap-1.5 cursor-pointer"
                      >
                        {discoveringId === p.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Search className="w-3.5 h-3.5" />
                        )}
                        {ar ? 'اكتشاف النماذج' : 'Discover models'}
                      </button>
                    )}
                    {isConfigured && (
                      <button
                        type="button"
                        onClick={() => handleRemove(p)}
                        disabled={savingId === p.id}
                        className="ms-auto px-2.5 py-1.5 rounded-lg bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Discovered models */}
                  {discovered[p.id] && discovered[p.id].length > 0 && (
                    <div className="pt-2 border-t border-slate-100">
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">
                        {ar ? 'نماذج مكتشفة' : 'Discovered models'} ({discovered[p.id].length})
                      </p>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                        {discovered[p.id].map((m) => (
                          <code
                            key={m.id}
                            className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono"
                          >
                            {m.id}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
