'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Database, HardDrive, Save, CheckCircle2, AlertTriangle, RefreshCw, Boxes } from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';

/**
 * Storage backends — lets the organization choose WHERE its data lives:
 * which vector store powers semantic search, and which object store keeps
 * original files and generated artifacts. Catalog + configured status come
 * from the server registries (/api/v1/storage), so a new backend registered
 * server-side appears here with zero UI changes.
 */

interface VectorStoreEntry {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  requirement: string;
  configured: boolean;
}

interface ObjectStoreEntry extends VectorStoreEntry {
  supportsPresignPut: boolean;
}

interface StorageSelection {
  vectorStoreId: string;
  vectorStoreExplicit: boolean;
  objectStoreId: string;
  objectStoreExplicit: boolean;
  savedVectorStoreId: string | null;
  savedObjectStoreId: string | null;
}

export default function StorageView({ lang }: { lang: 'ar' | 'en' }) {
  const [vectorStores, setVectorStores] = useState<VectorStoreEntry[]>([]);
  const [objectStores, setObjectStores] = useState<ObjectStoreEntry[]>([]);
  const [selection, setSelection] = useState<StorageSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Draft selections (what the user picked, before saving)
  const [draftVector, setDraftVector] = useState<string>('');
  const [draftObject, setDraftObject] = useState<string>('');

  const ar = lang === 'ar';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/v1/storage');
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setVectorStores(data.vectorStores || []);
      setObjectStores(data.objectStores || []);
      setSelection(data.selection || null);
      setDraftVector(data.selection?.vectorStoreId || '');
      setDraftObject(data.selection?.objectStoreId || '');
    } catch (e: any) {
      setError(e?.message || 'تعذر تحميل إعدادات التخزين');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty =
    selection !== null && (draftVector !== selection.vectorStoreId || draftObject !== selection.objectStoreId);

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetchWithAuth('/api/v1/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vectorStoreId: draftVector, objectStoreId: draftObject }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setMessage({ kind: 'ok', text: ar ? 'تم حفظ خلفيات التخزين وتطبيقها.' : 'Storage backends saved and applied.' });
      await load();
    } catch (e: any) {
      setMessage({ kind: 'err', text: e?.message || 'فشل حفظ إعدادات التخزين' });
    } finally {
      setSaving(false);
    }
  };

  const renderCard = (
    store: VectorStoreEntry | ObjectStoreEntry,
    kind: 'vector' | 'object',
    selectedId: string,
    onSelect: (id: string) => void,
  ) => {
    const selected = selectedId === store.id;
    return (
      <button
        key={store.id}
        type="button"
        onClick={() => onSelect(store.id)}
        aria-pressed={selected}
        className={`w-full text-right p-4 rounded-2xl border transition flex flex-col gap-2 ${
          selected
            ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-200'
            : 'border-slate-200 bg-white hover:border-indigo-300'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-extrabold text-slate-900">{ar ? store.nameAr : store.nameEn}</span>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${
              store.configured
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-slate-100 text-slate-500 border-slate-200'
            }`}
          >
            {store.configured ? (ar ? 'مهيأ' : 'Configured') : ar ? 'غير مهيأ' : 'Not configured'}
          </span>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">{ar ? store.descriptionAr : store.descriptionEn}</p>
        <p className="text-[11px] text-slate-400 font-mono">{store.requirement}</p>
        {kind === 'object' && 'supportsPresignPut' in store && store.supportsPresignPut && (
          <p className="text-[10px] text-indigo-500 font-bold">
            {ar ? 'يدعم الرفع المباشر presign' : 'Supports presigned direct upload'}
          </p>
        )}
        {!store.configured && selected && (
          <p className="text-[11px] text-amber-600 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {ar
              ? 'هذا المخزن غير مهيأ بعد — ستفشل العمليات حتى تتوفر متطلباته.'
              : 'This backend is not configured yet — operations will fail until its requirements exist.'}
          </p>
        )}
      </button>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm p-6">
        <RefreshCw className="w-4 h-4 animate-spin" />
        {ar ? 'جاري تحميل خلفيات التخزين…' : 'Loading storage backends…'}
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={ar ? 'rtl' : 'ltr'}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <Boxes className="w-5 h-5 text-indigo-600" />
            {ar ? 'خلفيات التخزين' : 'Storage Backends'}
          </h2>
          <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
            {ar
              ? 'اختر أين تُخزن متجهات البحث الدلالي وأين تُحفظ الملفات الأصلية والمخرجات. التغيير يسري على المستأجر كله ويتطلب إعادة فهرسة المستندات عند تبديل مخزن المتجهات.'
              : 'Choose where semantic vectors and original files/artifacts are stored. Applies tenant-wide; switching the vector store requires reindexing documents.'}
          </p>
        </div>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold transition flex items-center gap-1.5"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? (ar ? 'جاري الحفظ…' : 'Saving…') : ar ? 'حفظ الاختيار' : 'Save selection'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {message && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
            message.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          {message.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
          <Database className="w-4 h-4 text-indigo-500" />
          {ar ? 'مخزن المتجهات (البحث الدلالي)' : 'Vector store (semantic search)'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {vectorStores.map((s) => renderCard(s, 'vector', draftVector, setDraftVector))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-indigo-500" />
          {ar ? 'مخزن الكائنات (الملفات والمخرجات)' : 'Object store (files & artifacts)'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {objectStores.map((s) => renderCard(s, 'object', draftObject, setDraftObject))}
        </div>
      </section>

      {selection && (
        <p className="text-[11px] text-slate-400 font-mono">
          {ar ? 'الفعال حاليًا:' : 'Currently active:'} {selection.vectorStoreId} / {selection.objectStoreId}
          {!selection.vectorStoreExplicit && (ar ? ' (متجهات: افتراضي النشر)' : ' (vectors: deployment default)')}
          {!selection.objectStoreExplicit && (ar ? ' (كائنات: افتراضي النشر)' : ' (objects: deployment default)')}
        </p>
      )}
    </div>
  );
}
