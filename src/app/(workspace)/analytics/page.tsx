'use client';

import dynamic from 'next/dynamic';
import { useWorkspace } from '@/components/workspace/WorkspaceContext';

const AnalyticsCenter = dynamic(() => import('@/components/AnalyticsCenter'), {
  ssr: false,
  loading: () => <AnalyticsSkeleton />,
});

function AnalyticsSkeleton() {
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
        ))}
      </div>
      <div className="h-80 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
    </div>
  );
}

export default function AnalyticsPage() {
  const { tenantId, lang } = useWorkspace();
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <AnalyticsCenter tenantId={tenantId} lang={lang} />
    </div>
  );
}
