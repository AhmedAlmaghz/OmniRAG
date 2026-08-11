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
import { auth, logOutUser } from '@/lib/auth/firebaseAuth';
import { onAuthStateChanged } from 'firebase/auth';

import {
  MessageSquare,
  BookOpen,
  Plug,
  Search,
  ShieldCheck,
  BarChart3,
  Layers,
  Home,
  Cpu, Settings,
} from 'lucide-react';

type TabType = 'landing' | 'chat' | 'knowledge' | 'mcp' | 'analytics' | 'settings';

export default function MainApp() {
  const [tenantId, setTenantId] = useState('tenant-acme-01');
  const [currentTenantName, setCurrentTenantName] = useState<string>('');
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [activeTab, setActiveTab] = useState<TabType>('landing');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Load theme from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('omnirag-theme') as 'light' | 'dark';
      if (savedTheme) {
        setTheme(savedTheme);
      }
    }
  }, []);

  const handleThemeChange = (newTheme: 'light' | 'dark') => {
    setTheme(newTheme);
    if (typeof window !== 'undefined') {
      localStorage.setItem('omnirag-theme', newTheme);
    }
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

      try {
        const { doc, getDoc } = await import('firebase/firestore');
        const { firestore } = await import('@/lib/firebase');
        const snap = await getDoc(doc(firestore, 'tenants', tenantId));
        if (snap.exists()) {
          const data = snap.data();
          if (data && data.name) {
            setCurrentTenantName(data.name);
            return;
          }
        }
      } catch (err) {
        console.error('Error fetching tenant name:', err);
      }

      if (userEmail) {
        setCurrentTenantName(lang === 'ar' ? `مساحة عمل ${userEmail}` : `Workspace ${userEmail}`);
      } else {
        setCurrentTenantName(lang === 'ar' ? 'مساحة عمل مخصصة' : 'Custom Workspace');
      }
    }

    fetchTenantName();
  }, [tenantId, userEmail, lang]);

  // Subscribe to Firebase Auth state changes
  useEffect(() => {
    if (!auth) {
      setIsAuthenticated(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setIsAuthenticated(true);
        setTenantId(`tenant-${user.uid}`);
        setUserEmail(user.email || '');
      } else {
        setIsAuthenticated(false);
        setUserEmail(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogOut = async () => {
    try {
      if (auth) {
        await logOutUser();
      }
      setIsAuthenticated(false);
      setUserEmail(null);
      setTenantId('tenant-acme-01');
      setActiveTab('landing');
    } catch (e) {
      console.error('Logout error:', e);
    }
  };

  // Initialize active tab from URL search params if present
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab') as TabType;
      if (tabParam && ['landing', 'chat', 'knowledge', 'mcp', 'analytics', 'settings'].includes(tabParam)) {
        setActiveTab(tabParam);
      }
    }
  }, []);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', tab);
        window.history.pushState({}, '', url.toString());
      } catch (e) {
        // Safe fallback for sandboxed iframe environments
      }
    }
  };

  const navTabs = [
    {
      id: 'landing',
      label: lang === 'ar' ? 'الصفحة الرئيسية' : 'Overview Landing',
      icon: Home,
      badge: 'Remotion 4',
    },
    {
      id: 'chat',
      label: lang === 'ar' ? 'استوديو المحادثة المعززة' : 'Agentic Chat Studio',
      icon: MessageSquare,
      badge: 'Gemini 3.6',
    },
    {
      id: 'knowledge',
      label: lang === 'ar' ? 'مستودع المعرفة والاستيعاب' : 'Knowledge Pipeline',
      icon: BookOpen,
      badge: 'Auto Chunk',
    },
    {
      id: 'mcp',
      label: lang === 'ar' ? 'بوابة أدوات MCP' : 'MCP Gateway',
      icon: Plug,
      badge: 'Stateless 2026',
    },
    {
      id: 'analytics',
      label: lang === 'ar' ? 'مركز التحليلات' : 'Analytics Center',
      icon: BarChart3,
      badge: 'Recall & Guard',
    },
    {
      id: 'settings',
      label: lang === 'ar' ? 'الإعدادات والملف الشخصي' : 'Settings & Profile',
      icon: Settings,
      badge: 'User Prefs',
    },
  ];

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-200">
        <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center animate-spin mb-4">
          <Layers className="w-6 h-6 text-white" />
        </div>
        <p className="text-xs font-mono tracking-widest text-indigo-400">OMNIRAG v2.4 SECURE CONTAINER BOOTING...</p>
      </div>
    );
  }

  // 1. Prioritize displaying the landing page if activeTab is 'landing' (even for unauthenticated users)
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

  // 2. If trying to access any other tab, require authentication
  if (!isAuthenticated) {
    return (
      <AuthScreen
        onAuthSuccess={(tid, email) => {
          setTenantId(tid);
          setUserEmail(email);
          setIsAuthenticated(true);
        }}
        lang={lang}
        onLangChange={setLang}
        onBackToLanding={() => handleTabChange('landing')}
      />
    );
  }

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-950 text-slate-100 dark' : 'bg-slate-50 text-slate-900'}`} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
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
        theme={theme}
        onThemeChange={handleThemeChange}
      />

      {/* Workspace Active Tab View Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'chat' && <ChatStudio tenantId={tenantId} lang={lang} onNavigateTab={handleTabChange} />}
        {activeTab === 'knowledge' && <KnowledgeBase tenantId={tenantId} lang={lang} />}
        {activeTab === 'mcp' && <McpGateway tenantId={tenantId} lang={lang} />}
        {activeTab === 'analytics' && <AnalyticsCenter tenantId={tenantId} lang={lang} />}
        {activeTab === 'settings' && <SettingsView tenantId={tenantId} lang={lang} userEmail={userEmail} onLogOut={handleLogOut} />}
      </main>

      {/* Footer */}
      <footer className={`py-4 text-center text-xs text-slate-500 transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-900 border-t border-slate-800' : 'bg-white border-t border-slate-200'}`}>
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
    </div>
  );
}
