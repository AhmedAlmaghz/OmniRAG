'use client';

import React, { useState, useEffect } from 'react';
import Header from '@/components/Header';
import ChatStudio from '@/components/ChatStudio';
import KnowledgeBase from '@/components/KnowledgeBase';
import McpGateway from '@/components/McpGateway';
import RetrievalPlayground from '@/components/RetrievalPlayground';
import SecurityCenter from '@/components/SecurityCenter';
import AnalyticsView from '@/components/AnalyticsView';
import ModelSettingsView from '@/components/ModelSettingsView';
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
  Cpu,
} from 'lucide-react';

type TabType = 'landing' | 'chat' | 'knowledge' | 'mcp' | 'search' | 'security' | 'analytics' | 'models';

export default function MainApp() {
  const [tenantId, setTenantId] = useState('tenant-acme-01');
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [activeTab, setActiveTab] = useState<TabType>('landing');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

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
      if (tabParam && ['landing', 'chat', 'knowledge', 'mcp', 'search', 'security', 'analytics', 'models'].includes(tabParam)) {
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
      id: 'models',
      label: lang === 'ar' ? 'إعدادات نماذج AI' : 'AI Models Registry',
      icon: Cpu,
      badge: 'إدارة مركزية',
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
      id: 'search',
      label: lang === 'ar' ? 'مختبر الاسترجاع الهجين' : 'Hybrid Search',
      icon: Search,
      badge: 'RRF + HyDE',
    },
    {
      id: 'security',
      label: lang === 'ar' ? 'مركز الأمن والحوكمة' : 'Security Guardrails',
      icon: ShieldCheck,
      badge: 'HookHarness',
    },
    {
      id: 'analytics',
      label: lang === 'ar' ? 'التحليلات وسجلات التدقيق' : 'Analytics & Audit',
      icon: BarChart3,
      badge: 'P95 & Audit',
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
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-900" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Top Main Navigation Header */}
      <Header
        currentTenantId={tenantId}
        onTenantChange={setTenantId}
        lang={lang}
        onLangChange={setLang}
        onNavigateTab={handleTabChange}
        userEmail={userEmail}
        onLogOut={handleLogOut}
      />

      {/* Main Workspace Navigation Bar */}
      <nav className="bg-white border-b border-slate-200 sticky top-16 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-2 sm:gap-3 overflow-x-auto py-2.5 no-scrollbar items-center">
            {navTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id as TabType)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer shrink-0 select-none ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-xs font-bold ring-2 ring-indigo-300'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 bg-slate-50/80 border border-slate-200/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-indigo-600'}`} />
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                      isActive ? 'bg-indigo-700/80 text-white' : 'bg-slate-200/70 text-slate-600'
                    }`}
                  >
                    {tab.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Workspace Active Tab View Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'chat' && <ChatStudio tenantId={tenantId} lang={lang} onNavigateTab={handleTabChange} />}
        {activeTab === 'models' && <ModelSettingsView />}
        {activeTab === 'knowledge' && <KnowledgeBase tenantId={tenantId} lang={lang} />}
        {activeTab === 'mcp' && <McpGateway tenantId={tenantId} lang={lang} />}
        {activeTab === 'search' && <RetrievalPlayground tenantId={tenantId} lang={lang} />}
        {activeTab === 'security' && <SecurityCenter tenantId={tenantId} lang={lang} />}
        {activeTab === 'analytics' && <AnalyticsView tenantId={tenantId} lang={lang} />}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap items-center justify-between gap-2">
          <span>OmniRAG v2.4 Platform — Enterprise Agentic RAG & MCP Security Gateway</span>
          <span>Next.js 16 App Router | Gemini 3.6 Flash | Qdrant + Neon RLS</span>
        </div>
      </footer>
    </div>
  );
}
