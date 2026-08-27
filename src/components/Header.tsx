'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Layers,
  MessageSquare,
  BookOpen,
  Plug,
  BarChart3,
  Settings,
  User,
  LogOut,
  LogIn,
  UserPlus,
  ChevronDown,
  Globe,
  Sun,
  Moon,
  Check,
  Building2,
} from 'lucide-react';
import { t } from '@/lib/i18n';

/** A workspace the signed-in user belongs to (Phase 5 multi-tenancy). */
export interface WorkspaceRef {
  tenantId: string;
  name: string;
  role: string;
  isCurrent: boolean;
}

interface HeaderProps {
  currentTenantId: string;
  onTenantChange: (id: string) => void;
  lang: 'ar' | 'en';
  onLangChange: (lang: 'ar' | 'en') => void;
  onNavigateTab: (tab: any) => void;
  userEmail?: string | null;
  onLogOut?: () => void;
  currentTenantName?: string;
  activeTab?: string;
  theme?: 'light' | 'dark';
  onThemeChange?: (theme: 'light' | 'dark') => void;
  workspaces?: WorkspaceRef[];
}

export default function Header({
  currentTenantId,
  onTenantChange,
  lang,
  onLangChange,
  onNavigateTab,
  userEmail,
  onLogOut,
  currentTenantName,
  activeTab = 'landing',
  theme = 'light',
  onThemeChange,
  workspaces = [],
}: HeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Live profile from Settings → Profile (localStorage per email). The
  // settings screen dispatches omnirag_profile_changed on save so the header
  // reflects the new name/color instantly without a reload.
  const [profileName, setProfileName] = useState('');
  const [profileColor, setProfileColor] = useState('indigo');

  useEffect(() => {
    const loadProfile = () => {
      if (!userEmail) return;
      try {
        setProfileName(localStorage.getItem(`omnirag_profile_name_${userEmail}`) || '');
        setProfileColor(localStorage.getItem(`omnirag_profile_color_${userEmail}`) || 'indigo');
      } catch {
        /* storage unavailable */
      }
    };
    loadProfile();
    window.addEventListener('storage', loadProfile);
    window.addEventListener('omnirag_profile_changed', loadProfile);
    return () => {
      window.removeEventListener('storage', loadProfile);
      window.removeEventListener('omnirag_profile_changed', loadProfile);
    };
  }, [userEmail]);

  const AVATAR_GRADIENTS: Record<string, string> = {
    indigo: 'from-indigo-600 to-violet-500',
    teal: 'from-teal-500 to-cyan-500',
    rose: 'from-rose-500 to-pink-500',
    emerald: 'from-emerald-500 to-teal-500',
    amber: 'from-amber-500 to-orange-500',
    violet: 'from-violet-500 to-purple-500',
  };
  const avatarGradient = AVATAR_GRADIENTS[profileColor] || AVATAR_GRADIENTS.indigo;
  const shownInitial = (profileName || userEmail || 'U').charAt(0).toUpperCase();

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navTabs = [
    {
      id: 'chat',
      label: t(lang, 'header.navChat'),
      icon: MessageSquare,
    },
    {
      id: 'knowledge',
      label: t(lang, 'header.navKnowledge'),
      icon: BookOpen,
    },
    {
      id: 'mcp',
      label: t(lang, 'header.navMcp'),
      icon: Plug,
    },
    {
      id: 'analytics',
      label: t(lang, 'header.navAnalytics'),
      icon: BarChart3,
    },
  ];

  const handleDropdownAction = (action: () => void) => {
    action();
    setDropdownOpen(false);
  };

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo & Name */}
        <button
          type="button"
          onClick={() => onNavigateTab('landing')}
          className="flex items-center gap-3 text-left dir-ltr cursor-pointer group focus:outline-none shrink-0"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div className="hidden sm:block">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight text-white group-hover:text-indigo-300 transition-colors">
                OmniRAG
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden lg:block">{t(lang, 'header.tagline')}</p>
          </div>
        </button>

        {/* Embedded Desktop Nav Links */}
        <nav className="hidden md:flex items-center gap-1 bg-slate-950/60 p-1.5 rounded-2xl border border-slate-800/80 mx-4">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onNavigateTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap select-none ${
                  isActive
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-500/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-4 h-4 text-indigo-400" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User Account Dropdown Controls */}
        <div className="flex items-center gap-3 shrink-0" ref={dropdownRef}>
          <div className="relative">
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-10 h-10 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700/80 flex items-center justify-center transition cursor-pointer select-none focus:outline-none ring-2 ring-indigo-500/20 hover:ring-indigo-500/40 shadow-sm"
              aria-label={t(lang, 'header.userMenuAria')}
              title={userEmail || t(lang, 'header.userAccount')}
            >
              {userEmail ? (
                <div
                  className={`w-full h-full rounded-full bg-gradient-to-tr ${avatarGradient} text-white flex items-center justify-center font-bold text-sm uppercase shadow-inner`}
                >
                  {shownInitial}
                </div>
              ) : (
                <div className="w-full h-full rounded-full bg-slate-800 flex items-center justify-center text-slate-300 hover:text-white">
                  <User className="w-4 h-4" />
                </div>
              )}
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <div
                className={`absolute mt-2 w-64 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl py-2 z-50 animate-in fade-in slide-in-from-top-3 duration-150 ${
                  lang === 'ar' ? 'left-0 origin-top-left' : 'right-0 origin-top-right'
                }`}
              >
                {/* Profile Header section */}
                <div className="px-4 py-3 border-b border-slate-800/65">
                  <p className="text-[10px] font-mono font-bold tracking-wider text-indigo-400 uppercase">
                    {t(lang, userEmail ? 'header.activeAccount' : 'header.guestSession')}
                  </p>
                  <p className="text-sm font-semibold text-white truncate mt-1">
                    {profileName || userEmail || t(lang, 'header.secureSession')}
                  </p>
                  {profileName && userEmail && (
                    <p className="text-[10px] text-slate-400 font-mono truncate">{userEmail}</p>
                  )}
                  {userEmail && currentTenantName && (
                    <p className="text-xs text-slate-400 mt-1 truncate">
                      {t(lang, 'header.spacePrefix')} {currentTenantName}
                    </p>
                  )}
                </div>

                {/* Workspace Switcher (Phase 5 multi-tenancy) */}
                {userEmail && workspaces.length > 0 && (
                  <div className="p-1.5 border-b border-slate-800/65">
                    <div className="px-3 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      {t(lang, 'header.workspacesTitle')}
                    </div>
                    <div className="space-y-0.5 max-h-48 overflow-y-auto">
                      {workspaces.map((ws) => (
                        <button
                          key={ws.tenantId}
                          type="button"
                          onClick={() =>
                            handleDropdownAction(() => {
                              if (!ws.isCurrent) onTenantChange(ws.tenantId);
                            })
                          }
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer text-start ${
                            ws.isCurrent
                              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                              : 'text-slate-300 hover:text-white hover:bg-slate-800'
                          }`}
                        >
                          <Building2 className="w-4 h-4 shrink-0 text-indigo-400" />
                          <span className="truncate flex-1">{ws.name}</span>
                          <span className="text-[10px] text-slate-500 uppercase">{ws.role}</span>
                          {ws.isCurrent && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Main Action Links */}
                <div className="p-1.5 border-b border-slate-800/65 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => handleDropdownAction(() => onNavigateTab('settings'))}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer text-start"
                  >
                    <Settings className="w-4 h-4 text-indigo-400" />
                    <span>{t(lang, 'header.platformSettings')}</span>
                  </button>
                </div>

                {/* Language Switch */}
                <div className="p-1.5 border-b border-slate-800/65">
                  <div className="px-3 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    {t(lang, 'header.languageTitle')}
                  </div>
                  <div className="grid grid-cols-2 gap-1 p-1">
                    <button
                      type="button"
                      onClick={() => handleDropdownAction(() => onLangChange('ar'))}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                        lang === 'ar'
                          ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                          : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                      }`}
                    >
                      <span>العربية</span>
                      {lang === 'ar' && <Check className="w-3 h-3" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDropdownAction(() => onLangChange('en'))}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                        lang === 'en'
                          ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                          : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                      }`}
                    >
                      <span>English</span>
                      {lang === 'en' && <Check className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                {/* Theme / Appearance Switch */}
                <div className="p-1.5 border-b border-slate-800/65">
                  <div className="px-3 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    {t(lang, 'header.themeTitle')}
                  </div>
                  <div className="grid grid-cols-2 gap-1 p-1">
                    <button
                      type="button"
                      onClick={() => onThemeChange && handleDropdownAction(() => onThemeChange('light'))}
                      className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                        theme === 'light'
                          ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                          : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                      }`}
                    >
                      <Sun className="w-3.5 h-3.5" />
                      <span>{t(lang, 'header.themeLight')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onThemeChange && handleDropdownAction(() => onThemeChange('dark'))}
                      className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                        theme === 'dark'
                          ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                          : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                      }`}
                    >
                      <Moon className="w-3.5 h-3.5" />
                      <span>{t(lang, 'header.themeDark')}</span>
                    </button>
                  </div>
                </div>

                {/* Auth Actions (Login / Register / Logout) */}
                <div className="p-1.5">
                  {userEmail ? (
                    <button
                      type="button"
                      onClick={() => handleDropdownAction(onLogOut || (() => {}))}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-bold text-rose-400 hover:text-white hover:bg-rose-950/50 transition cursor-pointer text-start"
                    >
                      <LogOut className="w-4 h-4 text-rose-400" />
                      <span>{t(lang, 'header.signOut')}</span>
                    </button>
                  ) : (
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() =>
                          handleDropdownAction(() => {
                            if (typeof window !== 'undefined') {
                              const url = new URL(window.location.href);
                              url.searchParams.set('auth', 'login');
                              window.history.pushState({}, '', url.toString());
                            }
                            onNavigateTab('chat');
                          })
                        }
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-bold text-indigo-400 hover:text-white hover:bg-indigo-950/40 transition cursor-pointer text-start"
                      >
                        <LogIn className="w-4 h-4 text-indigo-400" />
                        <span>{t(lang, 'header.signIn')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleDropdownAction(() => {
                            if (typeof window !== 'undefined') {
                              const url = new URL(window.location.href);
                              url.searchParams.set('auth', 'register');
                              window.history.pushState({}, '', url.toString());
                            }
                            onNavigateTab('chat');
                          })
                        }
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer text-start"
                      >
                        <UserPlus className="w-4 h-4 text-slate-400" />
                        <span>{t(lang, 'header.createAccount')}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Embedded Mobile Subnav Row */}
      <div className="md:hidden border-t border-slate-800/60 bg-slate-950/95 px-2 py-2 overflow-x-auto flex items-center gap-1 scrollbar-none">
        {navTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onNavigateTab(tab.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                isActive
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5 text-indigo-400" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </header>
  );
}
