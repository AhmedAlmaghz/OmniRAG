'use client';

/**
 * Workspace context — provides the authenticated identity (tenantId), UI
 * language, and session info to route pages, replacing the prop-drilling
 * MainApp used to do across every view.
 */

import React, { createContext, useContext } from 'react';

export interface WorkspaceContextValue {
  tenantId: string;
  lang: 'ar' | 'en';
  userEmail?: string | null;
  logOut?: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({ tenantId: '', lang: 'ar' });

export const WorkspaceProvider = WorkspaceContext.Provider;

export function useWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext);
}

/** Session-only fields (used by the settings page for profile + logout). */
export function useWorkspaceSession(): { userEmail: string | null; logOut: () => void } {
  const { userEmail, logOut } = useContext(WorkspaceContext);
  return { userEmail: userEmail ?? null, logOut: logOut ?? (() => {}) };
}
