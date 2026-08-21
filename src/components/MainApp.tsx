'use client';

import { APP_VERSION } from '@/lib/config/systemConfig';

import React, { useState, useEffect } from 'react';
import Header from '@/components/Header';
import ChatStudio from '@/components/ChatStudio';
import KnowledgeBase from '@/components/KnowledgeBase';
import McpGateway from '@/components/McpGateway';
import SettingsView from '@/components/SettingsView';
import AnalyticsCenter from '@/components/AnalyticsCenter';
import AuthScreen from '@/components/AuthScreen';
import LandingPage from '@/components/LandingPage';
import { logOutUser, getSession } from '@/lib/auth/authClient';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import { useUserPreferences } from '@/lib/preferences/userPreferences';

import { Layers } from 'lucide-react';
import { ToastProvider } from '@/components/ui/Toast';

type TabType = 'landing' | 'chat' | 'knowledge' | 'mcp' | 'analytics' | 'settings';

export default function MainApp() {
  const [tenantId, setTenantId] = useState('');
  const [currentTenantName, setCurrentTenantName] = useState<string>('');
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Global appearance preferences (theme, fonts, density, math engine).
  // The store hydrates from localStorage on mount and applies the resolved
  // theme class + data attributes to <html> automatically.
  const { update: updatePreferences, resolvedTheme } = useUserPreferences();

  // Load session, active tab, and first launch onboarding check from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedAuth = localStorage.getItem('omnirag-auth');
      const savedEmail = localStorage.getItem('omnirag-user-email');

      // Check URL query parameters for tab overriding
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab') as TabType;
      const savedTab = localStorage.getItem('omnirag-active-tab') as TabType;

      if (tabParam && ['landing', 'chat', 'knowledge', 'mcp', 'analytics', 'settings'].includes(tabParam)) {
        setActiveTab(tabParam);
      } else if (savedTab && ['landing', 'chat', 'knowledge', 'mcp', 'analytics', 'settings'].includes(savedTab)) {
        setActiveTab(savedTab);
      }

      // Flash-reduction: `savedAuth` only shortens the login-screen flash — it
      // is a yes/no flag, never an identity. tenantId and userEmail are derived
      // EXCLUSIVELY from the server session (getSession boot, below), so a
      // tampered localStorage cannot impersonate a tenant; a forged flag can
      // only briefly delay the auth gate, which the server reopens to the true
      // session holder.
      if (savedAuth === 'true') {
        setIsAuthenticated(true);
        if (savedEmail) setUserEmail(savedEmail);
      } else {
        setIsAuthenticated(false);
      }

      // Sync client local environment variables to server runtime
      const envKeys = [
        'DATABASE_URL',
        'POSTGRES_URL',
        'QDRANT_URL',
        'QDRANT_API_KEY',
        'MISTRAL_API_KEY',
        'UNSTRUCTURED_API_KEY',
        'GEMINI_API_KEY',
      ];
      const localEnvs: Record<string, string> = {};
      envKeys.forEach((k) => {
        try {
          const val = localStorage.getItem(`omnirag_env_${k}`);
          if (val && !val.includes('•') && val.trim() !== '') {
            localEnvs[k] = val.trim();
          }
        } catch (e) {}
      });

      if (Object.keys(localEnvs).length > 0) {
        fetchWithAuth('/api/v1/env-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sync',
            envs: localEnvs,
          }),
        }).catch(() => {});
      }
    }
  }, []);

  const handleAuthSuccess = (tid: string, email: string) => {
    setTenantId(tid);
    setUserEmail(email);
    setIsAuthenticated(true);

    if (typeof window !== 'undefined') {
      localStorage.setItem('omnirag-auth', 'true');
      localStorage.setItem('omnirag-user-email', email);

      const currentTab = localStorage.getItem('omnirag-active-tab') as TabType;
      if (!currentTab || currentTab === 'landing') {
        setActiveTab('chat');
        localStorage.setItem('omnirag-active-tab', 'chat');
      }
    }
  };

  const handleThemeChange = (newTheme: 'light' | 'dark') => {
    // Persisted through the global preferences store, which also applies the
    // `.dark` class to <html> immediately.
    updatePreferences({ theme: newTheme });
  };

  // Dynamically fetch or determine correct tenant name
  useEffect(() => {
    async function fetchTenantName() {
      if (!tenantId) return;

      if (tenantId === 'tenant-acme-01') {
        setCurrentTenantName(lang === 'ar' ? 'شركة أكمي العالمية (ACME Corp)' : 'ACME Corp');
        return;
      }
      if (tenantId === 'tenant-health-02') {
        setCurrentTenantName(lang === 'ar' ? 'مجموعة الرعاية الصحية العالمية (BioHealth)' : 'BioHealth Group');
        return;
      }

      if (userEmail) {
        setCurrentTenantName(lang === 'ar' ? `مساحة عمل ${userEmail}` : `Workspace ${userEmail}`);
      } else {
        setCurrentTenantName(lang === 'ar' ? 'مساحة عمل مخصصة' : 'Custom Workspace');
      }
    }

    fetchTenantName();
  }, [tenantId, userEmail, lang]);

  // Rehydrate auth state from the server-side session (Postgres-only, cookie-based).
  // The httpOnly cookie is opaque, so identity can only be recovered via the
  // session route. We do NOT trust localStorage for identity — it stays a
  // yes/no flash-reduction flag (set above); tenantId/email come from the server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession();
      if (cancelled) return;
      if (session.authenticated) {
        setIsAuthenticated(true);
        setTenantId(session.tenantId);
        setUserEmail(session.userEmail);
        if (typeof window !== 'undefined') {
          localStorage.setItem('omnirag-auth', 'true');
          localStorage.setItem('omnirag-user-email', session.userEmail);
        }
      } else {
        setIsAuthenticated(false);
        setUserEmail(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('omnirag-auth');
          localStorage.removeItem('omnirag-user-email');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogOut = async () => {
    try {
      await logOutUser();
    } catch (e) {
      console.error('Logout error:', e);
    } finally {
      setIsAuthenticated(false);
      setUserEmail(null);
      setTenantId('');
      setActiveTab('landing');
      if (typeof window !== 'undefined') {
        localStorage.removeItem('omnirag-auth');
        localStorage.removeItem('omnirag-tenant-id');
        localStorage.removeItem('omnirag-user-email');
        localStorage.setItem('omnirag-active-tab', 'landing');
      }
    }
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      localStorage.setItem('omnirag-active-tab', tab);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', tab);
        window.history.pushState({}, '', url.toString());
      } catch (e) {
        // Safe fallback for sandboxed iframe environments
      }
    }
  };

  // Global keyboard shortcuts for tabs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        if (e.key === '1') {
          e.preventDefault();
          handleTabChange('chat');
        } else if (e.key === '2') {
          e.preventDefault();
          handleTabChange('knowledge');
        } else if (e.key === '3') {
          e.preventDefault();
          handleTabChange('mcp');
        } else if (e.key === '4') {
          e.preventDefault();
          handleTabChange('analytics');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 1. Prioritize displaying the landing page if activeTab is 'landing' (instantly available)
  if (activeTab === 'landing') {
    return (
      <LandingPage
        onEnterApp={() => handleTabChange('chat')}
        lang={lang}
        setLang={setLang}
        onNavigateTab={(tab) => handleTabChange(tab as TabType)}
      />
    );
  }

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-200">
        <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center animate-spin mb-4">
          <Layers className="w-6 h-6 text-white" />
        </div>
        <p className="text-xs font-mono tracking-widest text-indigo-400">
          OMNIRAG v{APP_VERSION} SECURE CONTAINER BOOTING...
        </p>
      </div>
    );
  }

  // 2. If trying to access any other tab, require authentication
  if (!isAuthenticated) {
    return (
      <AuthScreen
        onAuthSuccess={handleAuthSuccess}
        lang={lang}
        onLangChange={setLang}
        onBackToLanding={() => handleTabChange('landing')}
      />
    );
  }

  return (
    <ToastProvider>
      <div
        className={`print-expand min-h-screen flex flex-col font-sans transition-colors duration-300 ${resolvedTheme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'} ${activeTab === 'chat' ? 'h-screen' : ''}`}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
      >
      {/* Top Main Navigation Header with integrated links */}
      <Header
        currentTenantId={tenantId}
        onTenantChange={setTenantId}
        lang={lang}
        onLangChange={setLang}
        onNavigateTab={handleTabChange}
        userEmail={userEmail}
        onLogOut={handleLogOut}
        currentTenantName={currentTenantName}
        activeTab={activeTab}
        theme={resolvedTheme}
        onThemeChange={handleThemeChange}
      />

      {/* Workspace Active Tab View Content
          Chat is the primary workspace and fills the full viewport width.
          Other tabs keep the centered max-width container for their content. */}
      <main className="print-expand flex-1 w-full min-h-0">
        {activeTab === 'chat' && (
          <div className="w-full h-full">
            <ChatStudio tenantId={tenantId} lang={lang} onNavigateTab={handleTabChange} />
          </div>
        )}
        {(activeTab === 'knowledge' ||
          activeTab === 'mcp' ||
          activeTab === 'analytics' ||
          activeTab === 'settings') && (
          <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {activeTab === 'knowledge' && <KnowledgeBase tenantId={tenantId} lang={lang} />}
            {activeTab === 'mcp' && <McpGateway tenantId={tenantId} lang={lang} />}
            {activeTab === 'analytics' && <AnalyticsCenter tenantId={tenantId} lang={lang} />}
            {activeTab === 'settings' && (
              <SettingsView tenantId={tenantId} lang={lang} userEmail={userEmail} onLogOut={handleLogOut} />
            )}
          </div>
        )}
      </main>

      {/* Footer — hidden when chat is active so the chat surface fills the
          available height between the header and the bottom of the viewport. */}
      {activeTab !== 'chat' && (
        <footer
          className={`py-4 text-center text-xs text-slate-500 transition-colors duration-300 ${resolvedTheme === 'dark' ? 'bg-slate-900 border-t border-slate-800' : 'bg-white border-t border-slate-200'}`}
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
            <span>OmniRAG Platform — Enterprise Agentic RAG & MCP Security Gateway</span>
          </div>
        </footer>
      )}
      </div>
    </ToastProvider>
  );
}
