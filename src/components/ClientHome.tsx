'use client';

import dynamic from 'next/dynamic';

const MainApp = dynamic(() => import('@/components/MainApp'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 p-4">
      <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mb-4 animate-bounce">
        <span className="text-indigo-400 font-bold">Ω</span>
      </div>
      <p className="text-sm font-medium animate-pulse">جاري تحميل منصة OmniRAG...</p>
    </div>
  ),
});

export default function ClientHome() {
  return <MainApp />;
}
