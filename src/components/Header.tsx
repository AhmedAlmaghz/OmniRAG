'use client';

import React from 'react';
import { Layers, ShieldCheck, Cpu, Database, RefreshCw } from 'lucide-react';
import { INITIAL_TENANTS } from '@/lib/storage/constants';

interface HeaderProps {
  currentTenantId: string;
  onTenantChange: (id: string) => void;
  lang: 'ar' | 'en';
  onLangChange: (lang: 'ar' | 'en') => void;
  onNavigateTab: (tab: 'chat' | 'knowledge' | 'mcp' | 'search' | 'security' | 'analytics' | 'models') => void;
  userEmail?: string | null;
  onLogOut?: () => void;
}

export default function Header({ currentTenantId, onTenantChange, lang, onLangChange, onNavigateTab, userEmail, onLogOut }: HeaderProps) {
  const currentTenant = INITIAL_TENANTS.find((t) => t.id === currentTenantId) || INITIAL_TENANTS[0];

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo & Name - Clickable to Home/Chat */}
        <button
          type="button"
          onClick={() => onNavigateTab('chat')}
          className="flex items-center gap-3 text-left dir-ltr cursor-pointer group focus:outline-none"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight text-white group-hover:text-indigo-300 transition-colors">OmniRAG</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                v2.4 Enterprise
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              {lang === 'ar' ? 'منصة وكلاء الاسترجاع المعزز والتحكم الحتمي' : 'Agentic RAG & MCP Security Gateway'}
            </p>
          </div>
        </button>

        {/* Status Indicators & Tenant Selector */}
        <div className="flex items-center gap-3">
          {/* Active Guardrail Badge - Clickable to Security */}
          <button
            type="button"
            onClick={() => onNavigateTab('security')}
            className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800/60 hover:bg-emerald-900/60 text-emerald-300 text-xs transition cursor-pointer"
            title={lang === 'ar' ? 'الانتقال إلى مركز الأمن' : 'Go to Security Center'}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>{lang === 'ar' ? 'درع HookHarness: نشط' : 'HookHarness: Active'}</span>
          </button>

          {/* AI Models Settings Badge - Clickable to Models Settings */}
          <button
            type="button"
            onClick={() => onNavigateTab('models')}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900/90 border border-indigo-700/60 text-indigo-300 text-xs font-mono transition cursor-pointer"
            title={lang === 'ar' ? 'الانتقال إلى إعدادات النماذج' : 'Go to AI Models Registry'}
          >
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <span>{lang === 'ar' ? 'نماذج AI' : 'AI Models'}</span>
          </button>

          {/* Database System Badge - Clickable to Knowledge Base */}
          <button
            type="button"
            onClick={() => onNavigateTab('knowledge')}
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-mono transition cursor-pointer"
            title={lang === 'ar' ? 'الانتقال إلى مستودع المعرفة' : 'Go to Knowledge Base'}
          >
            <Database className="w-3.5 h-3.5 text-indigo-400" />
            <span>Qdrant + Neon RLS</span>
          </button>

          {/* Tenant Selector */}
          <div className="flex items-center gap-2 bg-slate-800/90 p-1 rounded-xl border border-slate-700">
            <span className="text-xs text-slate-400 px-2 font-medium hidden sm:inline">
              {lang === 'ar' ? 'المستأجر:' : 'Tenant:'}
            </span>
            <select
              value={currentTenantId}
              onChange={(e) => onTenantChange(e.target.value)}
              className="bg-slate-900 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 font-medium border border-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              {INITIAL_TENANTS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* User Profile & Logout */}
          {userEmail && (
            <div className="flex items-center gap-2 bg-slate-850 p-1.5 rounded-xl border border-slate-700/60 max-h-9 select-none">
              <span className="text-[11px] text-indigo-300 font-medium font-mono hidden lg:inline max-w-[140px] truncate px-1.5" title={userEmail}>
                {userEmail}
              </span>
              <button
                type="button"
                onClick={onLogOut}
                className="px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-[10px] text-rose-300 border border-rose-800/40 hover:border-rose-700 transition font-bold cursor-pointer select-none"
              >
                {lang === 'ar' ? 'خروج' : 'Logout'}
              </button>
            </div>
          )}

          {/* Language Toggle */}
          <button
            type="button"
            onClick={() => onLangChange(lang === 'ar' ? 'en' : 'ar')}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700 transition font-bold cursor-pointer"
          >
            {lang === 'ar' ? 'EN' : 'العربية'}
          </button>
        </div>
      </div>
    </header>
  );
}
