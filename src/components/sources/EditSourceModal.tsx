'use client';

import React, { useState } from 'react';
import { SourceConnector } from '@/lib/types/omnirag';
import { X, Save, Clock, ShieldCheck, Database, Sliders } from 'lucide-react';

interface EditSourceModalProps {
  source: SourceConnector;
  lang: 'ar' | 'en';
  onClose: () => void;
  onSave: (id: string, updates: Partial<SourceConnector>) => Promise<void>;
}

export function EditSourceModal({ source, lang, onClose, onSave }: EditSourceModalProps) {
  const [name, setName] = useState(source.name);
  const [syncSchedule, setSyncSchedule] = useState(source.syncSchedule || 'manual');
  const [status, setStatus] = useState(source.status);
  const [configJson, setConfigJson] = useState(JSON.stringify(source.config, null, 2));
  const [isSaving, setIsSaving] = useState(false);
  const [jsonError, setJsonError] = useState('');

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
      });
      onClose();
    } catch (error) {
      console.error('Failed to update source:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl p-6 max-w-xl w-full border border-slate-200 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {lang === 'ar' ? `تعديل إعدادات الموصل: ${source.name}` : `Edit Connector: ${source.name}`}
              </h3>
              <p className="text-xs text-slate-500 font-mono">ID: {source.id} | Type: {source.type}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              {lang === 'ar' ? 'اسم الموصل المصدر:' : 'Connector Name:'}
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-indigo-500" />
                <span>{lang === 'ar' ? 'جدولة المزامنة التلقائية (Cron):' : 'Auto Sync Schedule (Cron):'}</span>
              </label>
              <select
                value={syncSchedule}
                onChange={(e) => setSyncSchedule(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
              >
                <option value="manual">{lang === 'ar' ? 'يدوي فقط (Manual Sync)' : 'Manual Only'}</option>
                <option value="*/30 * * * *">{lang === 'ar' ? 'كل 30 دقيقة' : 'Every 30 Mins'}</option>
                <option value="0 */1 * * *">{lang === 'ar' ? 'كل ساعة' : 'Every Hour'}</option>
                <option value="0 */3 * * *">{lang === 'ar' ? 'كل 3 ساعات' : 'Every 3 Hours'}</option>
                <option value="0 */6 * * *">{lang === 'ar' ? 'كل 6 ساعات' : 'Every 6 Hours'}</option>
                <option value="0 */12 * * *">{lang === 'ar' ? 'كل 12 ساعة' : 'Every 12 Hours'}</option>
                <option value="0 0 * * *">{lang === 'ar' ? 'يومياً الساعة 12 منتصف الليل' : 'Daily at midnight'}</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>{lang === 'ar' ? 'حالة التشغيل:' : 'Operating Status:'}</span>
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
              >
                <option value="healthy">{lang === 'ar' ? 'سليم وفاعِل (Healthy)' : 'Healthy'}</option>
                <option value="paused">{lang === 'ar' ? 'موقوف مؤقتاً (Paused)' : 'Paused'}</option>
                <option value="degraded">{lang === 'ar' ? 'متأثر بأخطاء (Degraded)' : 'Degraded'}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1 flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-amber-500" />
              <span>{lang === 'ar' ? 'معلمات وإعدادات الربط التفصيلية (JSON Config):' : 'Connection Parameters (JSON Config):'}</span>
            </label>
            <textarea
              rows={6}
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-mono text-slate-800 bg-slate-900/90 text-emerald-400 focus:outline-none focus:border-indigo-500"
            />
            {jsonError && <p className="text-[11px] text-rose-500 mt-1 font-semibold">{jsonError}</p>}
          </div>

          <div className="flex gap-2 pt-3 border-t border-slate-100">
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? (lang === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (lang === 'ar' ? 'حفظ التغييرات' : 'Save Changes')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-5 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
            >
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
