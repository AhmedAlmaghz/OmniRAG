'use client';

import React, { useState } from 'react';
import { Collection } from '@/lib/types/omnirag';
import { FolderPlus, Loader2, Sparkles } from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import { Modal, ModalCloseButton } from '@/components/ui/Modal';

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
  // Honest failure state: previously a failed POST silently did NOTHING —
  // the spinner stopped and the modal stayed open with no explanation.
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isRtl = lang === 'ar';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setSubmitError(null);
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
          return;
        }
      }
      setSubmitError(
        isRtl ? 'فشل إنشاء المجموعة. يرجى المحاولة مرة أخرى.' : 'Failed to create the collection. Please try again.',
      );
    } catch (err) {
      console.error('Failed to create collection:', err);
      setSubmitError(
        isRtl
          ? 'تعذر الاتصال بالخادم أثناء إنشاء المجموعة.'
          : 'Could not reach the server while creating the collection.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} maxWidthClass="max-w-md" ariaLabelledBy="create-collection-title">
      <div className="flex items-center justify-between border-b border-slate-100 p-6 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <FolderPlus className="w-5 h-5" />
          </div>
          <div>
            <h3 id="create-collection-title" className="text-sm font-extrabold text-slate-900">
              {isRtl ? 'إنشاء مجموعة معرفية جديدة' : 'Create Knowledge Collection'}
            </h3>
            <p className="text-[11px] text-slate-500">
              {isRtl ? 'تصنيف وتنظيم المستندات في مجالات متخصصة' : 'Group documents by domain or topic'}
            </p>
          </div>
        </div>

        <ModalCloseButton onClose={onClose} label={isRtl ? 'إغلاق' : 'Close'} />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div>
          <label htmlFor="collection-name-input" className="text-xs font-bold text-slate-700 block mb-1">
            {isRtl ? 'اسم المجموعة المعرفية:' : 'Collection Name:'}
          </label>
          <input
            id="collection-name-input"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isRtl ? 'مثال: سياسات الأمن السيبراني ISO27001' : 'e.g., ISO27001 Cybersecurity Policies'}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label htmlFor="collection-desc-input" className="text-xs font-bold text-slate-700 block mb-1">
            {isRtl ? 'الوصف والنطاق:' : 'Description:'}
          </label>
          <textarea
            id="collection-desc-input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              isRtl ? 'وصف مختصر لنوع المستندات المضمنة بهذه المجموعة...' : 'Brief description of documents stored...'
            }
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
          />
        </div>

        {submitError && (
          <p
            role="alert"
            className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2"
          >
            {submitError}
          </p>
        )}

        <div className="flex gap-2 pt-2 border-t border-slate-100">
          <button
            type="submit"
            disabled={isSubmitting || !name.trim()}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{isRtl ? 'جاري الإنشاء...' : 'Creating...'}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>{isRtl ? 'إنشاء المجموعة' : 'Create Collection'}</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            {isRtl ? 'إلغاء' : 'Cancel'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
