'use client';

import dynamic from 'next/dynamic';
import { useWorkspace } from '@/components/workspace/WorkspaceContext';

const KnowledgeBase = dynamic(() => import('@/components/KnowledgeBase'), {
  ssr: false,
  loading: () => <KnowledgeSkeleton />,
});

function KnowledgeSkeleton() {
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
        ))}
      </div>
      <div className="h-64 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
    </div>
  );
}

export default function KnowledgePage() {
  const { tenantId, lang } = useWorkspace();
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <KnowledgeBase tenantId={tenantId} lang={lang} />
    </div>
  );
}
