'use client';

import dynamic from 'next/dynamic';
import { ChatSkeleton } from '@/components/workspace/Skeletons';
import { useWorkspace } from '@/components/workspace/WorkspaceContext';

// Route-level code splitting: the chat bundle (AI SDK streaming, markdown,
// KaTeX) is its own chunk; /knowledge etc. never download it.
const ChatStudio = dynamic(() => import('@/components/ChatStudio'), {
  ssr: false,
  loading: () => <ChatSkeleton />,
});

export default function ChatPage() {
  const { tenantId, lang } = useWorkspace();
  return (
    <div className="w-full h-full">
      <ChatStudio tenantId={tenantId} lang={lang} />
    </div>
  );
}
