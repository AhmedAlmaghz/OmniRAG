'use client';

import React, { useState } from 'react';
import { SourceConnector, Collection } from '@/lib/types/omnirag';
import { Save, Clock, ShieldCheck, Database, Sliders, Folder, Search, Check, Info } from 'lucide-react';
import { Modal, ModalCloseButton } from '@/components/ui/Modal';

interface EditSourceModalProps {
  source: SourceConnector;
  lang: 'ar' | 'en';
  onClose: () => void;
  onSave: (id: string, updates: Partial<SourceConnector>) => Promise<void>;
  availableCollections: Collection[];
}

export function EditSourceModal({ source, lang, onClose, onSave, availableCollections }: EditSourceModalProps) {
  const [name, setName] = useState(source.name);
  const [syncSchedule, setSyncSchedule] = useState(source.syncSchedule || 'manual');
  const [status, setStatus] = useState(source.status);
  const [configJson, setConfigJson] = useState(JSON.stringify(source.config, null, 2));
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>(source.collectionIds || []);
  const [collectionQuery, setCollectionQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [jsonError, setJsonError] = useState('');

  const toggleCollection = (id: string) => {
    setSelectedCollectionIds((prev) => (prev.includes(id) ? prev.filter((cid) => cid !== id) : [...prev, id]));
  };

  const filteredCols = availableCollections.filter(
    (col) =>
      col.name.toLowerCase().includes(collectionQuery.toLowerCase()) ||
      (col.description && col.description.toLowerCase().includes(collectionQuery.toLowerCase())),
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setJsonError('');

    let parsedConfig = source.config;
    try {
      parsedConfig = JSON.parse(configJson);
    } catch (err) {
      setJsonError(lang === 'ar' ? 'تنسيق JSON الخاص بالإعدادات غير صالح' : 'Invalid JSON format in settings');
      return;
    }

    setIsSaving(true);
    try {
      await onSave(source.id, {
        name,
        syncSchedule,
        status,
        config: parsedConfig,
        collectionIds: selectedCollectionIds,
      });
      onClose();
    } catch (error) {
      console.error('Failed to update source:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const isRtl = lang === 'ar';

  return (
    <Modal open onClose={onClose} maxWidthClass="max-w-2xl" ariaLabelledBy="edit-source-title">
      <div className="p-6 space-y-5 overflow-y-auto max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 id="edit-source-title" className="text-base font-bold text-slate-900">
                {isRtl ? `تعديل إعدادات المصدر: ${source.name}` : `Edit Source: ${source.name}`}
              </h3>
              <p className="text-xs text-slate-500 font-mono">
                ID: {source.id} | Type: {source.type}
              </p>
            </div>
          </div>
          <ModalCloseButton onClose={onClose} label={isRtl ? 'إغلاق' : 'Close'} />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Grid Layout for General Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                {isRtl ? 'اسم الموصل المصدر:' : 'Source Name:'}
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 bg-slate-50/50"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-indigo-500" />
                <span>{isRtl ? 'جدولة المزامنة التلقائية (Cron):' : 'Auto Sync Schedule (Cron):'}</span>
              </label>
              <select
                value={syncSchedule}
                onChange={(e) => setSyncSchedule(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 bg-slate-50/50"
              >
                <option value="manual">{isRtl ? 'يدوي فقط (Manual Sync)' : 'Manual Only'}</option>
                <option value="*/30 * * * *">{isRtl ? 'كل 30 دقيقة' : 'Every 30 Mins'}</option>
                <option value="0 */1 * * *">{isRtl ? 'كل ساعة' : 'Every Hour'}</option>
                <option value="0 */3 * * *">{isRtl ? 'كل 3 ساعات' : 'Every 3 Hours'}</option>
                <option value="0 */6 * * *">{isRtl ? 'كل 6 ساعات' : 'Every 6 Hours'}</option>
                <option value="0 */12 * * *">{isRtl ? 'كل 12 ساعة' : 'Every 12 Hours'}</option>
                <option value="0 0 * * *">{isRtl ? 'يومياً الساعة 12 منتصف الليل' : 'Daily at midnight'}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>{isRtl ? 'حالة التشغيل:' : 'Operating Status:'}</span>
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 bg-slate-50/50"
              >
                <option value="healthy">{isRtl ? 'سليم وفاعِل (Healthy)' : 'Healthy'}</option>
                <option value="paused">{isRtl ? 'موقوف مؤقتاً (Paused)' : 'Paused'}</option>
                <option value="degraded">{isRtl ? 'متأثر بأخطاء (Degraded)' : 'Degraded'}</option>
              </select>
            </div>

            <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-3 flex gap-2.5 items-start">
              <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="text-[10px] font-bold text-blue-900">{isRtl ? 'تلميح ذكي للمزامنة' : 'Smart Sync Tip'}</p>
                <p className="text-[9px] text-blue-700 leading-normal">
                  {isRtl
                    ? 'عند تعديل مجموعات المصدر، سيتم تلقائياً تحديث وتوزيع كافة المستندات والملفات المدرجة مسبقاً لتنضم للمجموعات الجديدة فوراً.'
                    : 'Updating source collections will automatically cascade and associate all previously indexed documents to the new collections instantly.'}
                </p>
              </div>
            </div>
          </div>

          {/* Collections Selector Block */}
          <div className="border border-slate-100 rounded-2xl p-4 bg-slate-50/30 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Folder className="w-4 h-4 text-indigo-500" />
                <span>{isRtl ? 'تخصيص المجموعات المعرفية المرتبطة:' : 'Assigned Knowledge Collections:'}</span>
              </label>

              {/* Filter search bar inside modal */}
              <div className="relative max-w-xs w-full sm:w-64">
                <Search className={`absolute ${isRtl ? 'right-2.5' : 'left-2.5'} top-2.5 w-3.5 h-3.5 text-slate-400`} />
                <input
                  type="text"
                  placeholder={isRtl ? 'بحث في المجموعات المتاحة...' : 'Search collections...'}
                  value={collectionQuery}
                  onChange={(e) => setCollectionQuery(e.target.value)}
                  className={`w-full ${isRtl ? 'pr-8 pl-3' : 'pl-8 pr-3'} py-1.5 rounded-xl border border-slate-200 text-[11px] text-slate-800 bg-white focus:outline-none focus:border-indigo-500`}
                />
              </div>
            </div>

            {/* Collections toggle list */}
            {availableCollections.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-slate-200 rounded-xl bg-white">
                <p className="text-xs text-slate-500">
                  {isRtl
                    ? 'لا توجد مجموعات معرفية معرفة حالياً في هذا الحساب.'
                    : 'No collections configured in this tenant yet.'}
                </p>
              </div>
            ) : filteredCols.length === 0 ? (
              <div className="text-center py-6 bg-white rounded-xl">
                <p className="text-xs text-slate-500">
                  {isRtl ? 'لا توجد نتائج مطابقة لبحثك' : 'No collections match your search'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                {filteredCols.map((col) => {
                  const isChecked = selectedCollectionIds.includes(col.id);
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => toggleCollection(col.id)}
                      className={`flex items-center justify-between p-2.5 rounded-xl border transition text-left cursor-pointer ${
                        isChecked
                          ? 'border-indigo-600 bg-indigo-50/40 text-indigo-900 shadow-xs'
                          : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center border transition ${
                            isChecked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate leading-tight">{col.name}</p>
                          <p className="text-[10px] text-slate-400 truncate leading-none mt-0.5">
                            {col.description || (isRtl ? 'لا يوجد وصف' : 'No description')}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ml-2 shrink-0 ${isChecked ? 'bg-indigo-200/50 text-indigo-800' : 'bg-slate-100 text-slate-500'}`}
                      >
                        {col.documentCount || 0} {isRtl ? 'مستند' : 'docs'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-slate-500 bg-slate-50 p-2 rounded-xl">
              <span>{isRtl ? 'إجمالي المجموعات المحددة للربط:' : 'Total collections selected:'}</span>
              <span className="font-bold text-indigo-600 font-mono text-xs">{selectedCollectionIds.length}</span>
            </div>
          </div>

          {/* Connection Parameters JSON config */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1 flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-amber-500" />
              <span>
                {isRtl ? 'معلومات وإعدادات الربط التفصيلية (JSON Config):' : 'Connection Parameters (JSON Config):'}
              </span>
            </label>
            <textarea
              rows={4}
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-mono bg-slate-900 text-emerald-400 focus:outline-none focus:border-indigo-500"
            />
            {jsonError && <p className="text-[11px] text-rose-500 mt-1 font-semibold">{jsonError}</p>}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-3 border-t border-slate-100">
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>
                {isSaving ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : isRtl ? 'حفظ التغييرات' : 'Save Changes'}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-5 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
            >
              {isRtl ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
