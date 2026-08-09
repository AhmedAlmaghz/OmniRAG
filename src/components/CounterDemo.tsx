'use client';

import { useState } from 'react';
import { Plus, Minus, RotateCcw, Sparkles } from 'lucide-react';

export default function CounterDemo() {
  const [count, setCount] = useState<number>(0);

  return (
    <div id="counter-demo-card" className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">مكون تفاعلي (Client Component)</h3>
            <p className="text-xs text-slate-500">تجربة إدارات الحالة التفاعلية في Next.js 16</p>
          </div>
        </div>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 dir-ltr">
          &apos;use client&apos;
        </span>
      </div>

      <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-200/60 my-4">
        <span className="text-sm font-medium text-slate-600">القيمة الحالية:</span>
        <span className="text-3xl font-bold font-mono text-indigo-600 tabular-nums">{count}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          id="counter-increment-btn"
          onClick={() => setCount((prev) => prev + 1)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors shadow-xs active:scale-95 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>زيادة</span>
        </button>
        <button
          id="counter-decrement-btn"
          onClick={() => setCount((prev) => prev - 1)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl transition-colors active:scale-95 cursor-pointer"
        >
          <Minus className="w-4 h-4" />
          <span>إنقاص</span>
        </button>
        <button
          id="counter-reset-btn"
          onClick={() => setCount(0)}
          className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          title="إعادة ضبط"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
