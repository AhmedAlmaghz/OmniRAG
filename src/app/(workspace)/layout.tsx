import WorkspaceShell from '@/components/workspace/WorkspaceShell';

/**
 * Authenticated workspace frame. All five feature routes render inside this
 * shell; it owns the session gate (client-side) that redirects to /auth.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
