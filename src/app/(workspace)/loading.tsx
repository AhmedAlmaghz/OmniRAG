import { WorkspaceSkeleton, ChatSkeleton } from '@/components/workspace/Skeletons';

/**
 * Route-level loading UI: shown while the workspace layout's session boot and
 * the route's feature chunk stream in. No more blank screen on cold navigations.
 */
export default function WorkspaceLoading() {
  // The chat layout is full-viewport; the other tabs are centered cards.
  return (
    <>
      <ChatSkeleton />
      <WorkspaceSkeleton />
    </>
  );
}
