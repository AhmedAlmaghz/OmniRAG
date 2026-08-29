'use client';

/**
 * Shared skeletons shown by each route's loading.tsx while the feature chunk
 * (KnowledgeBase/McpGateway/… — split from the entry bundle) streams in.
 * Layout mirrors the real pages so the swap is visually stable.
 */

export function WorkspaceSkeleton({ lang = 'ar' }: { lang?: 'ar' | 'en' }) {
  const title = lang === 'ar' ? 'جارٍ تحميل مساحة العمل…' : 'Loading workspace…';
  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
        <div className="h-6 w-48 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-slate-100 dark:bg-slate-900 animate-pulse" />
        ))}
      </div>
      <div className="h-64 rounded-2xl bg-slate-100 dark:bg-slate-900 animate-pulse" />
      <p className="sr-only">{title}</p>
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div className="flex w-full h-full" aria-hidden>
      {/* Sidebar */}
      <div className="w-72 shrink-0 border-e border-slate-200 dark:border-slate-800 p-3 hidden md:block">
        <div className="h-8 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse mb-3" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse mb-2" />
        ))}
      </div>
      {/* Center column */}
      <div className="flex-1 flex flex-col p-4 gap-3">
        <div className="h-16 rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse" />
        <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse w-3/4" />
        <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse w-1/2 ms-auto" />
        <div className="mt-auto h-12 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
      </div>
    </div>
  );
}
