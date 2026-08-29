'use client';

/**
 * WorkspaceShell — the authenticated app frame for every /chat, /knowledge,
 * /mcp, /analytics, /settings route.
 *
 * Owns what used to live inside MainApp's single-route tab switcher:
 * session boot (server is the only identity source; localStorage is a
 * flash-reduction flag only), workspace switching, the Header, the Toast
 * provider, and the footer. Navigation is real route navigation now — the
 * Header receives a path-based activeTab and a router-based navigate callback,
 * so its existing props contract is unchanged.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Header, { type WorkspaceRef } from '@/components/Header';
import { ToastProvider } from '@/components/ui/Toast';
import { WorkspaceProvider } from '@/components/workspace/WorkspaceContext';
import { logOutUser, getSession, switchWorkspace } from '@/lib/auth/authClient';
import { useUserPreferences } from '@/lib/preferences/userPreferences';
import { useDocumentCache } from '@/hooks/useDocumentCache';
import { APP_VERSION } from '@/lib/config/systemConfig'; /** Route path ↔ legacy tab id (Header still speaks tab ids). */
export function pathToTab(pathname: string): string {
  switch (pathname) {
    case '/chat':
      return 'chat';
    case '/knowledge':
      return 'knowledge';
    case '/mcp':
      return 'mcp';
    case '/analytics':
      return 'analytics';
    case '/settings':
      return 'settings';
    case '/':
    case '':
      return 'landing';
    default:
      return pathname.replace(/^\//, '').split('/')[0] || 'chat';
  }
}

export default function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/chat';

  const [tenantId, setTenantId] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRef[]>([]);
  const [currentTenantName, setCurrentTenantName] = useState<string>('');

  const { preferences, update: updatePreferences, resolvedTheme } = useUserPreferences();
  const lang = preferences.language;
  const setLang = (next: 'ar' | 'en') => updatePreferences({ language: next });

  // OCR-cache stats are per-workspace; refresh them when the tenant switches.
  const { refreshCache } = useDocumentCache();

  // Session boot: the httpOnly cookie is opaque, so identity can ONLY be
  // recovered via the session route. localStorage `omnirag-auth` is a yes/no
  // flash-reduction flag, never an identity (see MainApp history).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession();
      if (cancelled) return;
      if (session.authenticated) {
        setIsAuthenticated(true);
        setTenantId(session.tenantId);
        setUserEmail(session.userEmail);
        setWorkspaces(session.workspaces || []);
        try {
          localStorage.setItem('omnirag-auth', 'true');
          localStorage.setItem('omnirag-user-email', session.userEmail);
        } catch {}
      } else {
        setIsAuthenticated(false);
        setUserEmail(null);
        try {
          localStorage.removeItem('omnirag-auth');
          localStorage.removeItem('omnirag-user-email');
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Unauthenticated visitors are bounced to /auth; the login screen then
  // redirects back here. Null (still booting) renders the splash below.
  useEffect(() => {
    if (isAuthenticated === false) {
      router.replace('/auth');
    }
  }, [isAuthenticated, router]);

  // Dynamic workspace display name.
  useEffect(() => {
    const ws = workspaces.find((w) => w.tenantId === tenantId);
    if (ws?.name) {
      setCurrentTenantName(ws.name);
    } else if (userEmail) {
      setCurrentTenantName(userEmail.split('@')[0] || '');
    }
  }, [tenantId, userEmail, workspaces]);

  const handleTenantChange = useCallback(
    async (targetTenantId: string) => {
      if (!targetTenantId || targetTenantId === tenantId) return;
      try {
        await switchWorkspace(targetTenantId);
        const session = await getSession();
        if (session.authenticated) {
          setTenantId(session.tenantId);
          setWorkspaces(session.workspaces || []);
          refreshCache();
        }
      } catch (e) {
        console.error('Workspace switch error:', e);
      }
    },
    [tenantId, refreshCache],
  );

  const handleLogOut = useCallback(async () => {
    try {
      await logOutUser();
    } catch (e) {
      console.error('Logout error:', e);
    } finally {
      try {
        localStorage.removeItem('omnirag-auth');
        localStorage.removeItem('omnirag-tenant-id');
        localStorage.removeItem('omnirag-user-email');
      } catch {}
      router.replace('/');
    }
  }, [router]);

  const handleNavigateTab = useCallback(
    (tab: string) => {
      // Header still speaks legacy tab ids; map them onto real routes.
      const route = tab === 'landing' ? '/' : `/${tab}`;
      router.push(route);
    },
    [router],
  );

  const handleThemeChange = useCallback(
    (newTheme: 'light' | 'dark') => {
      updatePreferences({ theme: newTheme });
    },
    [updatePreferences],
  );

  // Global tab shortcuts (Ctrl/Cmd+1..4 → chat/knowledge/mcp/analytics),
  // preserved from the MainApp tab-switcher era but routed now.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const routes: Record<string, string> = { '1': '/chat', '2': '/knowledge', '3': '/mcp', '4': '/analytics' };
      const route = routes[e.key];
      if (route) {
        e.preventDefault();
        router.push(route);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);

  // Boot splash while the session resolves.
  if (isAuthenticated !== true) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-200">
        <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center animate-spin mb-4">
          <span className="text-white font-bold text-lg">Ω</span>
        </div>
        <p className="text-xs font-mono tracking-widest text-indigo-400">OMNIRAG v{APP_VERSION} BOOTING…</p>
      </div>
    );
  }

  const activeTab = pathToTab(pathname);
  const isChat = activeTab === 'chat';

  return (
    <ToastProvider>
      <WorkspaceProvider value={{ tenantId, lang, userEmail, logOut: handleLogOut }}>
        <div
          className={`print-expand min-h-screen flex flex-col font-sans transition-colors duration-300 ${
            resolvedTheme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
          } ${isChat ? 'h-screen' : ''}`}
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
        >
          <Header
            currentTenantId={tenantId}
            onTenantChange={handleTenantChange}
            lang={lang}
            onLangChange={setLang}
            onNavigateTab={handleNavigateTab}
            userEmail={userEmail}
            onLogOut={handleLogOut}
            currentTenantName={currentTenantName}
            activeTab={activeTab}
            theme={resolvedTheme}
            onThemeChange={handleThemeChange}
            workspaces={workspaces}
          />
          <main className="print-expand flex-1 w-full min-h-0">{children}</main>
          {!isChat && (
            <footer
              className={`py-4 text-center text-xs text-slate-500 transition-colors duration-300 ${
                resolvedTheme === 'dark'
                  ? 'bg-slate-900 border-t border-slate-800'
                  : 'bg-white border-t border-slate-200'
              }`}
            >
              <div className="max-w-7xl mx-auto px-4 flex flex-wrap items-center justify-between gap-2">
                <span>
                  POWERED BY{' '}
                  <a
                    href="https://github.com/ahmedAlmaghz/omnirag"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-indigo-600 hover:text-indigo-800 underline transition"
                  >
                    ENG. AHMED ALMAGHZ
                  </a>{' '}
                  - 2026 - v{APP_VERSION}
                </span>
                <span>OmniRAG Platform — Enterprise Agentic RAG &amp; MCP Security Gateway</span>
              </div>
            </footer>
          )}
        </div>
      </WorkspaceProvider>
    </ToastProvider>
  );
}
