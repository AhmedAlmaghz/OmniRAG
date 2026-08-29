'use client';

import dynamic from 'next/dynamic';
import { useWorkspace } from '@/components/workspace/WorkspaceContext';

const McpGateway = dynamic(() => import('@/components/McpGateway'), {
  ssr: false,
  loading: () => <GatewaySkeleton />,
});

function GatewaySkeleton() {
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="h-8 w-56 rounded-lg bg-slate-200/70 dark:bg-slate-800/70 animate-pulse mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export default function McpPage() {
  const { tenantId, lang } = useWorkspace();
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <McpGateway tenantId={tenantId} lang={lang} />
    </div>
  );
}
