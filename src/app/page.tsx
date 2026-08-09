'use client';

import React, { useState } from 'react';
import Header from '@/components/Header';
import ChatStudio from '@/components/ChatStudio';
import KnowledgeBase from '@/components/KnowledgeBase';
import McpGateway from '@/components/McpGateway';
import RetrievalPlayground from '@/components/RetrievalPlayground';
import SecurityCenter from '@/components/SecurityCenter';
import AnalyticsView from '@/components/AnalyticsView';

import {
  MessageSquare,
  BookOpen,
  Plug,
  Search,
  ShieldCheck,
  BarChart3,
  Layers,
} from 'lucide-react';

export default function HomePage() {
  const [tenantId, setTenantId] = useState('tenant-acme-01');
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [activeTab, setActiveTab] = useState<
    'chat' | 'knowledge' | 'mcp' | 'search' | 'security' | 'analytics'
  >('chat');

  const navTabs = [
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

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-900" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Top Main Navigation Header */}
      <Header
        currentTenantId={tenantId}
        onTenantChange={setTenantId}
        lang={lang}
        onLangChange={setLang}
      />

      {/* Main Workspace Navigation Bar */}
      <nav className="bg-white border-b border-slate-200 sticky top-16 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-1 sm:space-x-2 overflow-x-auto py-2.5 no-scrollbar">
            {navTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-xs font-bold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-indigo-600'}`} />
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                      isActive ? 'bg-indigo-700/80 text-white' : 'bg-slate-100 text-slate-500'
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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'chat' && <ChatStudio tenantId={tenantId} lang={lang} />}
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
