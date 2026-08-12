'use client';

import React, { useState } from 'react';
import { Collection } from '@/lib/types/omnirag';
import { FolderPlus, X, Loader2, Sparkles, Folder } from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';

interface CreateCollectionModalProps {
  tenantId: string;
  lang: 'ar' | 'en';
  onClose: () => void;
  onCreated: (collection: Collection) => void;
}

export function CreateCollectionModal({ tenantId, lang, onClose, onCreated }: CreateCollectionModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          name: name.trim(),
          description: description.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.collection) {
          onCreated(data.collection);
          onClose();
        }
      }
    } catch (err) {
      console.error('Failed to create collection:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <FolderPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                {lang === 'ar' ? 'إنشاء مجموعة معرفية جديدة' : 'Create Knowledge Collection'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {lang === 'ar' ? 'تصنيف وتنظيم المستندات في مجالات متخصصة' : 'Group documents by domain or topic'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              {lang === 'ar' ? 'اسم المجموعة المعرفية:' : 'Collection Name:'}
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={lang === 'ar' ? 'مثال: سياسات الأمن السيبراني ISO27001' : 'e.g., ISO27001 Cybersecurity Policies'}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              {lang === 'ar' ? 'الوصف والنطاق:' : 'Description:'}
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={lang === 'ar' ? 'وصف مختصر لنوع المستندات المضمنة بهذه المجموعة...' : 'Brief description of documents stored...'}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{lang === 'ar' ? 'جاري الإنشاء...' : 'Creating...'}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{lang === 'ar' ? 'إنشاء المجموعة' : 'Create Collection'}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
