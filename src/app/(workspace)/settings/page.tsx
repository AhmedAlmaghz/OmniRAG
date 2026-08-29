'use client';

import dynamic from 'next/dynamic';
import { useWorkspace, useWorkspaceSession } from '@/components/workspace/WorkspaceContext';
import { WorkspaceSkeleton } from '@/components/workspace/Skeletons';

const SettingsView = dynamic(() => import('@/components/SettingsView'), {
  ssr: false,
  loading: () => <WorkspaceSkeleton />,
});

export default function SettingsPage() {
  const { tenantId, lang } = useWorkspace();
  const { userEmail, logOut } = useWorkspaceSession();
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <SettingsView tenantId={tenantId} lang={lang} userEmail={userEmail} onLogOut={logOut} />
    </div>
  );
}
