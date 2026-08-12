import { fetchWithAuth } from "@/lib/auth/fetchWithAuth";
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  Layers, 
  LayoutDashboard, 
  FileCheck2, 
  Terminal, 
  Palette, 
  Settings, 
  Globe, 
  Activity,
  Zap,
  Sparkles,
  Database
} from 'lucide-react';
import { Language } from '../../types';

interface NavbarProps {
  lang: Language;
  setLang: (lang: Language) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ lang, setLang }) => {
  const location = useLocation();
  const [serverStatus, setServerStatus] = useState<'online' | 'checking' | 'offline'>('checking');

  useEffect(() => {
    fetchWithAuth('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 'ok') setServerStatus('online');
        else setServerStatus('offline');
      })
      .catch(() => setServerStatus('offline'));
  }, []);

  const navItems = [
    {
      path: '/knowledge',
      labelAr: 'مستودع المعرفة والجلب (Knowledge & Ingestion)',
      labelEn: 'Knowledge Pipeline',
      icon: Database,
    },
    {
      path: '/chat',
      labelAr: 'استوديو المحادثة (Chat Studio)',
      labelEn: 'Agentic Chat',
      icon: Sparkles,
    },
    {
      path: '/search',
      labelAr: 'الاسترجاع الهجين (Hybrid Search)',
      labelEn: 'Hybrid Retrieval',
      icon: Activity,
    },
    {
      path: '/mcp',
      labelAr: 'بوابة أدوات MCP',
      labelEn: 'MCP Gateway',
      icon: Zap,
    },
    {
      path: '/security',
      labelAr: 'مركز الأمن والحوكمة',
      labelEn: 'Security Guardrails',
      icon: Layers,
    },
    {
      path: '/dashboard',
      labelAr: 'لوحة القيادة (Dashboard)',
      labelEn: 'Dashboard',
      icon: LayoutDashboard,
    },
    {
      path: '/sdlc',
      labelAr: 'معايير SDLC',
      labelEn: 'SDLC Guide',
      icon: FileCheck2,
    },
    {
      path: '/api-demo',
      labelAr: 'المعالجات والخدمات (API Routes)',
      labelEn: 'API Handlers',
      icon: Terminal,
    },
    {
      path: '/settings',
      labelAr: 'الإعدادات',
      labelEn: 'Settings',
      icon: Settings,
    },
  ];

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-950/85 border-b border-slate-800/80 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo & Version Badge */}
          <Link to="/" className="flex items-center gap-3 group">
            <img 
              src="/icon.jpg" 
              alt="OmniRAG Icon" 
              className="w-9 h-9 rounded-xl object-cover shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform border border-slate-700/60"
              referrerPolicy="no-referrer"
            />
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  OmniRAG
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  Enterprise RAG
                </span>
              </div>
              <span className="text-xs text-slate-400">
                {lang === 'ar' ? 'منصة الاسترجاع المعزز بالوكلاء الذكية' : 'Enterprise Agentic RAG Platform'}
              </span>
            </div>
          </Link>

          {/* Nav Links Desktop */}
          <nav className="hidden lg:flex items-center gap-1 bg-slate-900/60 p-1 rounded-2xl border border-slate-800/60">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-500/30'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{lang === 'ar' ? item.labelAr : item.labelEn}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right Controls (Server Status & Language Toggle) */}
          <div className="flex items-center gap-3">
            
            {/* Server Health Status */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs">
              <span className="relative flex h-2 w-2">
                {serverStatus === 'online' && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    serverStatus === 'online'
                      ? 'bg-emerald-500'
                      : serverStatus === 'checking'
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                  }`}
                ></span>
              </span>
              <span className="text-slate-300 font-mono text-[11px]">
                {serverStatus === 'online' ? 'API 0.0.0.0:3000' : 'Offline'}
              </span>
            </div>

            {/* Language Switcher */}
            <button
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
              title="تغيير اللغة / Change Language"
            >
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              <span>{lang === 'ar' ? 'English' : 'العربية'}</span>
            </button>

          </div>

        </div>
      </div>

      {/* Mobile Subnav Row */}
      <div className="lg:hidden border-t border-slate-800/60 bg-slate-950/95 px-2 py-1.5 overflow-x-auto flex items-center gap-1 scrollbar-none">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{lang === 'ar' ? item.labelAr.split(' ')[0] : item.labelEn}</span>
            </Link>
          );
        })}
      </div>
    </header>
  );
};
