import React, { useState } from 'react';
import { Palette, Check, AlertCircle, Info, Sparkles, Layers, Sliders, Bell } from 'lucide-react';
import { Language } from '../types';

interface ComponentsGalleryPageProps {
  lang: Language;
}

export const ComponentsGalleryPage: React.FC<ComponentsGalleryPageProps> = ({ lang }) => {
  const [activeTab, setActiveTab] = useState<'buttons' | 'badges' | 'cards' | 'forms'>('buttons');
  const [inputText, setInputText] = useState('');
  const [checkboxChecked, setCheckboxChecked] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="space-y-8">
      
      {/* Header Banner */}
      <div className="p-8 rounded-3xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 text-violet-400 text-xs font-semibold border border-violet-500/20">
          <Palette className="w-4 h-4" />
          <span>{lang === 'ar' ? 'معرض المكونات والتنسيقات المعيارية' : 'Tailwind CSS v4 & React 19 Component Gallery'}</span>
        </div>

        <h1 className="text-3xl font-black text-white">
          {lang === 'ar' ? 'مكتبة مكونات الواجهة التفاعلية (UI Design System)' : 'Next.js v16 UI Design System'}
        </h1>

        <p className="text-slate-300 text-sm max-w-3xl leading-relaxed">
          {lang === 'ar'
            ? 'مجموعة من المكونات الجاهزة المصممة خصيصاً بـ Tailwind CSS v4 و TypeScript وفق أحدث معايير التوافقية وسهولة الاستخدام.'
            : 'Accessible, production-grade UI components styled with Tailwind CSS v4 design tokens and TypeScript strict typing.'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        {(['buttons', 'badges', 'cards', 'forms'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer capitalize ${
              activeTab === tab
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Contents */}
      {activeTab === 'buttons' && (
        <div className="p-8 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-6">
          <h3 className="text-base font-bold text-white">Button Variants & States</h3>
          
          <div className="flex flex-wrap gap-4 items-center">
            <button className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs transition-all shadow-md shadow-indigo-500/20 cursor-pointer">
              Primary Gradient Button
            </button>

            <button className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold text-xs transition-colors cursor-pointer border border-slate-700">
              Secondary Solid
            </button>

            <button className="px-5 py-2.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 font-bold text-xs transition-colors cursor-pointer border border-cyan-500/20">
              Subtle Accent
            </button>

            <button className="px-5 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-bold text-xs transition-colors cursor-pointer border border-rose-500/20">
              Destructive Alert
            </button>

            <button
              onClick={() => setModalOpen(true)}
              className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs transition-colors cursor-pointer flex items-center gap-2"
            >
              <Bell className="w-4 h-4" />
              <span>Open Modal Dialog</span>
            </button>
          </div>
        </div>
      )}

      {activeTab === 'badges' && (
        <div className="p-8 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-6">
          <h3 className="text-base font-bold text-white">Status Pills & SDLC Badges</h3>

          <div className="flex flex-wrap gap-3">
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" />
              <span>Build Passed</span>
            </span>

            <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Warning Notice</span>
            </span>

            <span className="px-3 py-1 rounded-full text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              <span>Next.js v16 App Router</span>
            </span>

            <span className="px-3 py-1 rounded-full text-xs font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>React 19 RSC</span>
            </span>
          </div>
        </div>
      )}

      {activeTab === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
            <div className="text-xs text-indigo-400 font-mono font-bold">CARD COMPONENT 01</div>
            <h4 className="text-lg font-bold text-white">Server-Side Data Rendering</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Example of a clean, elevated card element adhering to mathematical inner radius rules without AI Slop tropes.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/90 border border-indigo-500/30 space-y-3">
            <div className="text-xs text-cyan-400 font-mono font-bold">CARD COMPONENT 02</div>
            <h4 className="text-lg font-bold text-white">Client State Interactive Boundary</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Provides interactive feedback, hover transition effects, and clean typography scale.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'forms' && (
        <div className="p-8 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-6 max-w-xl">
          <h3 className="text-base font-bold text-white">Form Controls & Validation</h3>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-300 mb-1.5 block">Project Name Input</label>
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Enter project name..."
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={checkboxChecked}
                onChange={(e) => setCheckboxChecked(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 bg-slate-950 border-slate-800 focus:ring-0"
              />
              <span className="text-xs text-slate-300 font-medium">Enable Server-side Cache Revalidation</span>
            </label>
          </div>
        </div>
      )}

      {/* Modal Dialog */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Modal Dialog Component</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              This dialog component demonstrates clean state management in React 19 without blocking main thread.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs cursor-pointer"
              >
                Close Dialog
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
