'use client';

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  User,
  Monitor,
  LogOut,
  CheckCircle2,
  ChevronRight,
  Settings,
  Sparkles,
  RefreshCw,
  Sliders,
  Type,
  LayoutGrid,
  Activity,
  HardDrive,
  Cpu,
  KeySquare,
  Database,
  Users,
  Fingerprint,
  CreditCard,
} from 'lucide-react';
// Heavy admin sections are lazy-loaded: each becomes its own chunk, fetched
// on first visit only. Once mounted they STAY mounted (hidden via CSS) so
// unsaved drafts survive tab switches — the behavior the previous
// all-mounted-always layout guaranteed, without paying for every section's
// code on the initial settings visit.
const ModelSettingsView = dynamic(() => import('./ModelSettingsView'));
const MembersView = dynamic(() => import('./MembersView'));
const SsoSettingsView = dynamic(() => import('./SsoSettingsView'));
const DiagnosticUtility = dynamic(() => import('./diagnostics/DiagnosticUtility'));
const EnvVariablesManager = dynamic(() => import('./env/EnvVariablesManager'));
const FirstLaunchEnvModal = dynamic(() => import('./env/FirstLaunchEnvModal'));
import IngestionSettingsView from './IngestionSettingsView';
import ProvidersView from './ProvidersView';
import ApiKeysView from './ApiKeysView';
import StorageView from './StorageView';
import PlansView from './PlansView';
import { useUserPreferences, type MathMode } from '@/lib/preferences/userPreferences';
// i18n lookups are aliased as `tr` throughout this component.
import { t as tr } from '@/lib/i18n';
import { renderArabicToString } from 'katex4arabic';
import katex from 'katex';
import { Calculator, Sigma, Key, Lock } from 'lucide-react';

interface SettingsViewProps {
  tenantId: string;
  lang: 'ar' | 'en';
  userEmail?: string | null;
  onLogOut?: () => void;
}

/* ── Live math preview ────────────────────────────────────────────────────
   Renders a representative equation with the *currently selected* engine so
   the user sees exactly what their chat messages will look like. */
const MATH_PREVIEW_SAMPLES = [
  'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
  '\\int_{0}^{\\infty} e^{-x^2} \\, dx = \\frac{\\sqrt{\\pi}}{2}',
  '\\lim_{x \\to 0} \\frac{\\sin(x)}{x} = 1',
];

const MathPreview: React.FC<{ mode: MathMode; arabicNumerals: boolean }> = ({ mode, arabicNumerals }) => {
  const rendered = useMemo(
    () =>
      MATH_PREVIEW_SAMPLES.map((latex) =>
        mode === 'arabic'
          ? renderArabicToString(latex, {
              numerals: arabicNumerals ? 'arabic' : 'latin',
              displayMode: true,
              throwOnError: false,
            })
          : katex.renderToString(latex, { displayMode: true, throwOnError: false, strict: false }),
      ),
    [mode, arabicNumerals],
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
      {rendered.map((html, i) => (
        <div
          key={i}
          className="rounded-lg bg-white border border-slate-100 px-3 py-2 text-slate-900 overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ))}
    </div>
  );
};

type TabType =
  | 'account'
  | 'appearance'
  | 'aiModels'
  | 'providers'
  | 'apiKeys'
  | 'members'
  | 'sso'
  | 'plans'
  | 'storage'
  | 'ingestion'
  | 'envVars'
  | 'diagnostics';

/**
 * Data-driven settings navigation. The previous implementation hand-wrote
 * eight near-identical button blocks — including two tabs whose entire
 * content was decorative theater (notification toggles that were never
 * persisted, a hardcoded sessions table, an API key nothing validated).
 * Those fake controls were REMOVED rather than wired to pretend.
 *
 * Labels live in the i18n dictionaries (Phase 7) under `settings.tabs.*`.
 */
const SETTINGS_TABS: Array<{ id: TabType; icon: React.ElementType; labelKey: string }> = [
  { id: 'account', icon: User, labelKey: 'settings.tabs.account' },
  { id: 'appearance', icon: Sliders, labelKey: 'settings.tabs.appearance' },
  { id: 'aiModels', icon: Sparkles, labelKey: 'settings.tabs.aiModels' },
  { id: 'providers', icon: Cpu, labelKey: 'settings.tabs.providers' },
  { id: 'apiKeys', icon: KeySquare, labelKey: 'settings.tabs.apiKeys' },
  { id: 'members', icon: Users, labelKey: 'settings.tabs.members' },
  { id: 'sso', icon: Fingerprint, labelKey: 'settings.tabs.sso' },
  { id: 'plans', icon: CreditCard, labelKey: 'settings.tabs.plans' },
  { id: 'storage', icon: Database, labelKey: 'settings.tabs.storage' },
  { id: 'ingestion', icon: HardDrive, labelKey: 'settings.tabs.ingestion' },
  { id: 'envVars', icon: Key, labelKey: 'settings.tabs.envVars' },
  { id: 'diagnostics', icon: Activity, labelKey: 'settings.tabs.diagnostics' },
];

export default function SettingsView({ tenantId, lang, userEmail, onLogOut }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('account');
  const [showFirstLaunchWizard, setShowFirstLaunchWizard] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Visited-sections ledger: a section mounts on FIRST visit and stays
  // mounted (hidden via CSS) afterwards — unsaved drafts in models/ingestion/
  // env survive tab switches, while never-visited sections cost nothing
  // upfront (their lazy chunk isn't even fetched).
  const [visitedSections, setVisitedSections] = useState<Set<TabType>>(new Set(['account']));
  const openTab = (tab: TabType) => {
    setActiveTab(tab);
    setVisitedSections((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  };
  const sectionCls = (id: TabType) => (activeTab === id ? 'space-y-6' : 'hidden');
  const shouldMount = (id: TabType) => visitedSections.has(id);

  // Auto-launch the env wizard once per browser until the user finishes it.
  // The `omnirag_env_first_launch_done` flag was previously WRITTEN by the
  // wizard but read by NOBODY, so the "first launch" behavior never existed.
  useEffect(() => {
    try {
      if (!localStorage.getItem('omnirag_env_first_launch_done')) {
        setShowFirstLaunchWizard(true);
      }
    } catch {
      /* storage unavailable */
    }
  }, []);

  // --- Account Info State ---
  const [displayName, setDisplayName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');
  const [organization, setOrganization] = useState('');
  const [avatarColor, setAvatarColor] = useState('indigo');

  // --- Appearance State (global preferences store) ---
  // These values live in the shared preferences store so they apply
  // automatically across the whole app (chat, knowledge base, settings…).
  // Every change persists instantly — there is intentionally NO save button
  // for this section.
  const { preferences, update: updatePreferences } = useUserPreferences();
  const { theme, fontSize, density, arabicFont, mathMode, mathArabicNumerals } = preferences;
  const setTheme = (v: 'light' | 'dark' | 'system') => updatePreferences({ theme: v });
  const setFontSize = (v: 'sm' | 'md' | 'lg') => updatePreferences({ fontSize: v });
  const setDensity = (v: 'comfortable' | 'compact') => updatePreferences({ density: v });
  const setArabicFont = (v: 'cairo' | 'tajawal' | 'ibm') => updatePreferences({ arabicFont: v });
  const setMathMode = (v: MathMode) => updatePreferences({ mathMode: v });
  const setMathArabicNumerals = (v: boolean) => updatePreferences({ mathArabicNumerals: v });

  // Load profile values from local storage on mount / email resolution
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedName = localStorage.getItem(`omnirag_profile_name_${userEmail}`);
      const savedTitle = localStorage.getItem(`omnirag_profile_title_${userEmail}`);
      const savedPhone = localStorage.getItem(`omnirag_profile_phone_${userEmail}`);
      const savedBio = localStorage.getItem(`omnirag_profile_bio_${userEmail}`);
      const savedOrg = localStorage.getItem(`omnirag_profile_org_${userEmail}`);
      const savedColor = localStorage.getItem(`omnirag_profile_color_${userEmail}`);

      if (savedName) setDisplayName(savedName);
      else setDisplayName(userEmail ? userEmail.split('@')[0] : 'User');

      if (savedTitle) setJobTitle(savedTitle);
      if (savedPhone) setPhone(savedPhone);
      if (savedBio) setBio(savedBio);
      if (savedOrg) setOrganization(savedOrg);
      if (savedColor) setAvatarColor(savedColor);
    }
  }, [userEmail]);

  /**
   * Saves ONLY the profile fields shown on the account tab. The shared bar is
   * now rendered exclusively under this tab — previously it appeared under
   * every tab claiming "تم حفظ الإعدادات" while persisting none of what was
   * on screen. Wrapped so a quota/storage failure can never leave the button
   * permanently disabled (the old code skipped setIsSaving on throw).
   */
  const handleSave = () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(`omnirag_profile_name_${userEmail}`, displayName);
        localStorage.setItem(`omnirag_profile_title_${userEmail}`, jobTitle);
        localStorage.setItem(`omnirag_profile_phone_${userEmail}`, phone);
        localStorage.setItem(`omnirag_profile_bio_${userEmail}`, bio);
        localStorage.setItem(`omnirag_profile_org_${userEmail}`, organization);
        localStorage.setItem(`omnirag_profile_color_${userEmail}`, avatarColor);
      }
      // Notify the app header so the new name/avatar color apply instantly.
      window.dispatchEvent(new CustomEvent('omnirag_profile_changed'));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      console.error('Failed to persist profile settings:', e);
      setSaveError(tr(lang, 'settings.saveErrorLocal'));
    } finally {
      setIsSaving(false);
    }
  };

  // Set avatar bg color class
  const getAvatarBg = (color: string) => {
    switch (color) {
      case 'rose':
        return 'bg-rose-100 text-rose-700 border-rose-300';
      case 'teal':
        return 'bg-teal-100 text-teal-700 border-teal-300';
      case 'emerald':
        return 'bg-emerald-100 text-emerald-700 border-emerald-300';
      case 'amber':
        return 'bg-amber-100 text-amber-700 border-amber-300';
      case 'violet':
        return 'bg-violet-100 text-violet-700 border-violet-300';
      default:
        return 'bg-indigo-100 text-indigo-700 border-indigo-300';
    }
  };

  const getActiveDotColor = (color: string) => {
    switch (color) {
      case 'rose':
        return 'bg-rose-500';
      case 'teal':
        return 'bg-teal-500';
      case 'emerald':
        return 'bg-emerald-500';
      case 'amber':
        return 'bg-amber-500';
      case 'violet':
        return 'bg-violet-500';
      default:
        return 'bg-indigo-500';
    }
  };

  /** Selected-option highlight shared by every appearance picker. */
  const optionActiveCls = 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-200';

  return (
    <div className={`max-w-6xl mx-auto pb-12 ${lang === 'ar' ? 'font-arabic' : ''}`} id="settings-root">
      {/* Saving status banners */}
      {(saveSuccess || saveError) && (
        <div
          role="status"
          className={`mb-4 p-4 rounded-xl flex items-center gap-2.5 font-medium shadow-3xs ${
            saveError
              ? 'bg-rose-50 border border-rose-200 text-rose-800'
              : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
          }`}
          id="settings-save-success-banner"
        >
          <CheckCircle2 className={`w-5 h-5 shrink-0 ${saveError ? 'text-rose-500' : 'text-emerald-500'}`} />
          <span>{saveError || tr(lang, 'settings.profile.saved')}</span>
        </div>
      )}

      <div className="mb-8" id="settings-header">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
          <div className="p-2 bg-indigo-600/10 rounded-xl text-indigo-700 border border-indigo-600/20">
            <Settings className="w-6 h-6 animate-spin-slow text-indigo-600" />
          </div>
          {tr(lang, 'settings.title')}
        </h1>
        <p className="text-sm text-slate-500 mt-2 max-w-3xl leading-relaxed">{tr(lang, 'settings.desc')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8" id="settings-grid-layout">
        {/* Navigation Sidebar — data-driven */}
        <nav className="lg:col-span-1 space-y-1.5" id="settings-sidebar" aria-label={tr(lang, 'settings.sectionsAria')}>
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => openTab(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-medium text-xs transition duration-200 cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10 border-l-4 border-l-indigo-400'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 bg-white border border-slate-200'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4" />
                  {tr(lang, tab.labelKey)}
                </span>
                <ChevronRight
                  className={`w-4 h-4 transition ${lang === 'ar' ? 'rotate-180' : ''} ${isActive ? 'opacity-100' : 'opacity-40'}`}
                />
              </button>
            );
          })}
        </nav>

        {/* Content Area. Sections stay MOUNTED and toggle via `hidden` so any
            unsaved draft in the child views (models / ingestion / env) survives
            switching between settings sections — previously every switch
            unmounted them and silently discarded edits. */}
        <div className="lg:col-span-3 space-y-6" id="settings-content-area">
          {/* ACCOUNT TAB CONTENT */}
          <section id="section-account" className={activeTab === 'account' ? 'space-y-6' : 'hidden'}>
            <div className="bg-white border border-slate-200 rounded-2xl shadow-3xs overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User className="w-5 h-5 text-indigo-600" />
                  <h2 className="text-lg font-bold text-slate-900">{tr(lang, 'settings.profile.details')}</h2>
                </div>
                <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-600 px-2 py-1 rounded border border-indigo-100 uppercase tracking-wide">
                  {tr(lang, 'settings.identitySecure')}
                </span>
              </div>

              <div className="p-6 space-y-6">
                {/* Avatar & Dynamic Customization */}
                <div className="flex flex-col sm:flex-row items-center gap-6 p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="relative">
                    <div
                      className={`w-20 h-20 rounded-2xl ${getAvatarBg(avatarColor)} flex items-center justify-center text-3xl font-extrabold shadow-md border-2 transition-all duration-300 relative`}
                    >
                      {displayName ? displayName.charAt(0).toUpperCase() : 'U'}
                      <span
                        className={`absolute bottom-1.5 right-1.5 w-3.5 h-3.5 rounded-full border-2 border-white ring-1 ring-slate-200 ${getActiveDotColor(avatarColor)}`}
                      />
                    </div>
                  </div>
                  <div className="space-y-3 flex-1 text-center sm:text-start">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {tr(lang, 'settings.profile.avatarStyle')}
                    </h4>
                    <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                      {(['indigo', 'teal', 'rose', 'emerald', 'amber', 'violet'] as const).map((color) => (
                        <button
                          key={color}
                          onClick={() => setAvatarColor(color)}
                          className={`w-8 h-8 rounded-lg border-2 transition transform hover:scale-110 active:scale-95 ${
                            color === 'indigo'
                              ? 'bg-indigo-500'
                              : color === 'teal'
                                ? 'bg-teal-500'
                                : color === 'rose'
                                  ? 'bg-rose-500'
                                  : color === 'emerald'
                                    ? 'bg-emerald-500'
                                    : color === 'amber'
                                      ? 'bg-amber-500'
                                      : 'bg-violet-500'
                          } ${avatarColor === color ? 'border-indigo-600 ring-2 ring-indigo-300 ring-offset-1' : 'border-white shadow-xs hover:shadow-md'}`}
                          aria-label={`Select ${color} color`}
                          aria-pressed={avatarColor === color}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Profile Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <label htmlFor="profile-name" className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                      {tr(lang, 'settings.profile.displayName')}
                    </label>
                    <input
                      id="profile-name"
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-medium transition duration-150"
                      placeholder="Full Name"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="profile-title" className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                      {tr(lang, 'settings.profile.jobTitle')}
                    </label>
                    <input
                      id="profile-title"
                      type="text"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-medium transition duration-150"
                      placeholder="e.g. Lead Security Architect"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="profile-phone" className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                      {tr(lang, 'settings.profile.phoneNumber')}
                    </label>
                    <input
                      id="profile-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-medium transition duration-150 font-mono"
                      placeholder="+966 500 000 000"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="profile-org" className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                      {tr(lang, 'settings.profile.organization')}
                    </label>
                    <input
                      id="profile-org"
                      type="text"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-medium transition duration-150"
                      placeholder="Company Name"
                    />
                  </div>

                  <div className="sm:col-span-2 space-y-1.5">
                    <label htmlFor="profile-bio" className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                      {tr(lang, 'settings.profile.bio')}
                    </label>
                    <textarea
                      id="profile-bio"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      rows={3}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-medium transition duration-150 leading-relaxed resize-none"
                      placeholder="Write a brief professional summary..."
                    />
                  </div>
                </div>

                {/* Locked Identity Credentials */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-4 border-t border-slate-100">
                  <div className="space-y-1.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        {tr(lang, 'settings.profile.emailAddress')}
                      </span>
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                    <p className="text-xs font-semibold text-slate-600 font-mono break-all">{userEmail || 'N/A'}</p>
                  </div>
                  <div className="space-y-1.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        {tr(lang, 'settings.profile.tenantId')}
                      </span>
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                    <p className="text-xs font-semibold text-slate-600 font-mono break-all">{tenantId}</p>
                  </div>
                </div>

                {/* Account-tab save action. Other tabs own their persistence:
                    Appearance applies instantly, and the model/ingestion/env
                    views each ship their own explicit save controls. */}
                <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <p className="text-[11px] text-slate-500 leading-relaxed max-w-md font-medium text-center sm:text-start">
                    {tr(lang, 'settings.profileLocalNote')}
                  </p>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold text-xs flex items-center justify-center gap-2 transition duration-150 cursor-pointer shadow-2xs select-none"
                    id="save-settings-btn"
                  >
                    {isSaving ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>{tr(lang, 'settings.profile.saving')}</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{tr(lang, 'settings.profile.saveChanges')}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* APPEARANCE TAB CONTENT */}
          <section id="section-appearance" className={activeTab === 'appearance' ? 'space-y-6' : 'hidden'}>
            <div className="bg-white border border-slate-200 rounded-2xl shadow-3xs overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-indigo-600" />
                  <h2 className="text-lg font-bold text-slate-900">{tr(lang, 'settings.tabs.appearance')}</h2>
                </div>
              </div>
              <div className="p-6 space-y-6">
                {/* Theme Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-3">
                    {tr(lang, 'settings.appearance.themeTitle')}
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {(['light', 'dark', 'system'] as const).map((tType) => (
                      <button
                        key={tType}
                        onClick={() => setTheme(tType)}
                        aria-pressed={theme === tType}
                        className={`flex flex-col items-center justify-center p-4 rounded-xl border transition cursor-pointer select-none ${
                          theme === tType
                            ? optionActiveCls
                            : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {tType === 'light' && <SunPlaceholder />}
                        {tType === 'dark' && <MoonPlaceholder />}
                        {tType === 'system' && <Monitor className="w-5 h-5 mb-2 text-slate-500" />}
                        <span className="text-xs font-semibold">
                          {tType === 'light'
                            ? tr(lang, 'settings.appearance.light')
                            : tType === 'dark'
                              ? tr(lang, 'settings.appearance.dark')
                              : tr(lang, 'settings.appearance.system')}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font Family Selector — applies to ALL Arabic content (chat,
                    knowledge base) regardless of UI language, so it is no
                    longer hidden when the interface language is English. */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <Type className="w-4 h-4 text-indigo-600" />
                    {tr(lang, 'settings.appearance.arabicFontTitle')}
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {(['cairo', 'tajawal', 'ibm'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setArabicFont(f)}
                        aria-pressed={arabicFont === f}
                        className={`p-3 rounded-xl border text-center transition cursor-pointer select-none ${
                          arabicFont === f
                            ? `${optionActiveCls} font-bold`
                            : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`text-xs block ${
                            f === 'cairo' ? 'font-cairo' : f === 'tajawal' ? 'font-tajawal' : 'font-mono'
                          }`}
                        >
                          {f === 'cairo'
                            ? 'خط القاهرة (Cairo)'
                            : f === 'tajawal'
                              ? 'خط تجول (Tajawal)'
                              : 'خط آي بي إم (IBM Arabic)'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font Size Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-3">
                    {tr(lang, 'settings.appearance.fontSizeTitle')}
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {(['sm', 'md', 'lg'] as const).map((sz) => (
                      <button
                        key={sz}
                        onClick={() => setFontSize(sz)}
                        aria-pressed={fontSize === sz}
                        className={`p-3 rounded-xl border text-center transition cursor-pointer select-none ${
                          fontSize === sz
                            ? `${optionActiveCls} font-bold`
                            : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`text-xs font-semibold ${
                            sz === 'sm' ? 'text-[11px]' : sz === 'md' ? 'text-xs' : 'text-sm'
                          }`}
                        >
                          {sz === 'sm'
                            ? tr(lang, 'settings.appearance.sizeSmall')
                            : sz === 'md'
                              ? tr(lang, 'settings.appearance.sizeMedium')
                              : tr(lang, 'settings.appearance.sizeLarge')}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Display Density Layout Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <LayoutGrid className="w-4 h-4 text-indigo-600" />
                    {tr(lang, 'settings.appearance.densityTitle')}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {(['comfortable', 'compact'] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDensity(d)}
                        aria-pressed={density === d}
                        className={`p-3 rounded-xl border text-center transition cursor-pointer select-none ${
                          density === d
                            ? `${optionActiveCls} font-bold`
                            : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-xs font-semibold">
                          {d === 'comfortable'
                            ? tr(lang, 'settings.appearance.comfortable')
                            : tr(lang, 'settings.appearance.compact')}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Math Rendering Engine (global, auto-applied) ── */}
                <div className="pt-5 border-t border-slate-100">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 uppercase tracking-wide mb-1.5">
                    <Sigma className="w-4 h-4 text-indigo-600" />
                    {tr(lang, 'settings.math.title')}
                  </label>
                  <p className="text-xs text-slate-500 leading-relaxed mb-3 max-w-2xl">
                    {tr(lang, 'settings.math.desc')}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    <button
                      type="button"
                      onClick={() => setMathMode('standard')}
                      aria-pressed={mathMode === 'standard'}
                      className={`p-4 rounded-xl border text-start transition cursor-pointer select-none ${
                        mathMode === 'standard'
                          ? optionActiveCls
                          : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2 mb-1.5">
                        <Calculator className="w-4 h-4 text-slate-500" />
                        <span
                          className={`text-xs font-bold ${mathMode === 'standard' ? 'text-indigo-700' : 'text-slate-700'}`}
                        >
                          {tr(lang, 'settings.math.standard')}
                        </span>
                        {mathMode === 'standard' && (
                          <span className="ms-auto text-[9px] font-bold bg-indigo-600 text-white px-1.5 py-0.5 rounded">
                            {tr(lang, 'settings.activeBadge')}
                          </span>
                        )}
                      </span>
                      <span className="block text-[11px] text-slate-500 leading-relaxed">
                        {tr(lang, 'settings.math.standardDesc')}
                      </span>
                      <span
                        className="mt-2 block text-center text-sm text-slate-800 bg-slate-50 border border-slate-100 rounded-lg py-1.5"
                        dir="ltr"
                      >
                        x = (−b ± √(b²−4ac)) / 2a
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMathMode('arabic')}
                      aria-pressed={mathMode === 'arabic'}
                      className={`p-4 rounded-xl border text-start transition cursor-pointer select-none ${
                        mathMode === 'arabic'
                          ? optionActiveCls
                          : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2 mb-1.5">
                        <Sigma className="w-4 h-4 text-amber-600" />
                        <span
                          className={`text-xs font-bold ${mathMode === 'arabic' ? 'text-indigo-700' : 'text-slate-700'}`}
                        >
                          {tr(lang, 'settings.math.arabic')}
                        </span>
                        {mathMode === 'arabic' && (
                          <span className="ms-auto text-[9px] font-bold bg-indigo-600 text-white px-1.5 py-0.5 rounded">
                            {tr(lang, 'settings.activeBadge')}
                          </span>
                        )}
                      </span>
                      <span className="block text-[11px] text-slate-500 leading-relaxed">
                        {tr(lang, 'settings.math.arabicDesc')}
                      </span>
                      <span className="mt-2 block text-center text-sm text-slate-800 bg-amber-50/60 border border-amber-100 rounded-lg py-1.5 font-arabic">
                        س = (−ب ± √(ب²−٤أج)) / ٢أ
                      </span>
                    </button>
                  </div>

                  {/* Arabic-Indic numerals toggle (only relevant in Arabic mode) */}
                  {mathMode === 'arabic' && (
                    <ToggleRow
                      title={tr(lang, 'settings.math.numerals')}
                      desc={tr(lang, 'settings.math.numeralsDesc')}
                      checked={mathArabicNumerals}
                      onChange={(checked) => setMathArabicNumerals(checked)}
                      labelAr={lang === 'ar'}
                    />
                  )}

                  {/* Live preview of the selected engine */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {tr(lang, 'settings.math.preview')}
                    </span>
                    <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {tr(lang, 'settings.math.appliedNote')}
                    </span>
                  </div>
                  <MathPreview mode={mathMode} arabicNumerals={mathArabicNumerals} />
                </div>
              </div>
            </div>
          </section>

          {/* PERSISTENT CHILD SECTIONS — mount on first visit, never unmount.
              `shouldMount` gates the initial render (lazy chunks for heavy
              views are only fetched when the section is actually opened);
              after that the hidden-class toggle preserves draft state. */}
          {shouldMount('aiModels') && (
            <section id="section-aimodels" className={sectionCls('aiModels')}>
              <ModelSettingsView />
            </section>
          )}

          {shouldMount('providers') && (
            <section id="section-providers" className={sectionCls('providers')}>
              <ProvidersView lang={lang} />
            </section>
          )}

          {shouldMount('apiKeys') && (
            <section id="section-apikeys" className={sectionCls('apiKeys')}>
              <ApiKeysView lang={lang} />
            </section>
          )}

          {shouldMount('members') && (
            <section id="section-members" className={sectionCls('members')}>
              <MembersView lang={lang} />
            </section>
          )}

          {shouldMount('sso') && (
            <section id="section-sso" className={sectionCls('sso')}>
              <SsoSettingsView lang={lang} />
            </section>
          )}

          {shouldMount('plans') && (
            <section id="section-plans" className={sectionCls('plans')}>
              <PlansView lang={lang} />
            </section>
          )}

          {shouldMount('storage') && (
            <section id="section-storage" className={sectionCls('storage')}>
              <StorageView lang={lang} />
            </section>
          )}

          {shouldMount('ingestion') && (
            <section id="section-ingestion" className={sectionCls('ingestion')}>
              <IngestionSettingsView lang={lang} />
            </section>
          )}

          {shouldMount('envVars') && (
            <section id="section-envvars" className={sectionCls('envVars')}>
              <EnvVariablesManager lang={lang} onOpenWizard={() => setShowFirstLaunchWizard(true)} />
            </section>
          )}

          {shouldMount('diagnostics') && (
            <section id="section-diagnostics" className={sectionCls('diagnostics')}>
              <DiagnosticUtility lang={lang} autoRunOnMount={activeTab === 'diagnostics'} />
            </section>
          )}

          <FirstLaunchEnvModal
            lang={lang}
            isOpen={showFirstLaunchWizard}
            onClose={() => setShowFirstLaunchWizard(false)}
          />

          {/* DANGER CONTROL ZONE */}
          <div
            className="bg-rose-50/50 border border-rose-200 rounded-2xl shadow-3xs overflow-hidden"
            id="settings-danger-zone"
          >
            <div className="px-6 py-5 border-b border-rose-200 bg-rose-50/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LogOut className="w-5 h-5 text-rose-700" />
                <h2 className="text-lg font-bold text-rose-900">{tr(lang, 'settings.profile.dangerZone')}</h2>
              </div>
              <span className="text-[10px] font-mono font-bold bg-rose-100 text-rose-800 px-2 py-0.5 rounded border border-rose-200">
                CRITICAL
              </span>
            </div>
            <div className="p-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-center sm:text-start">
                  <h3 className="font-bold text-slate-900 text-xs">{tr(lang, 'settings.profile.logOut')}</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-md leading-relaxed">
                    {tr(lang, 'settings.profile.logOutDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onLogOut}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center justify-center gap-2 transition duration-200 shadow-2xs cursor-pointer select-none"
                  id="logout-danger-btn"
                >
                  <LogOut className="w-4 h-4" />
                  {tr(lang, 'settings.profile.logOut')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small sun/moon placeholders keep the theme picker dependency-light. */
function SunPlaceholder() {
  return <span className="w-5 h-5 mb-2 rounded-full bg-amber-400 border-2 border-amber-300 block" aria-hidden="true" />;
}
function MoonPlaceholder() {
  return (
    <span
      className="w-5 h-5 mb-2 rounded-full bg-indigo-400 border-2 border-indigo-300 block relative"
      aria-hidden="true"
    >
      <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-white block" />
    </span>
  );
}

/**
 * Accessible toggle row used by appearance options. The identical ~200-char
 * peer-class switch markup was copy-pasted five times before this primitive
 * existed — one place now owns the RTL-correct behavior and aria wiring.
 */
function ToggleRow({
  title,
  desc,
  checked,
  onChange,
  labelAr,
}: {
  title: string;
  desc?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelAr?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 mb-4">
      <div className="space-y-1">
        <h3 className="font-semibold text-slate-900 text-xs">{title}</h3>
        {desc && <p className="text-xs text-slate-500 leading-relaxed max-w-xl">{desc}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition shrink-0 cursor-pointer ${checked ? 'bg-indigo-600' : 'bg-slate-300'}`}
      >
        <span
          className={`absolute top-[2px] h-5 w-5 rounded-full bg-white border border-slate-300 shadow-xs transition-all ${
            checked ? 'left-[22px]' : 'left-[2px]'
          }`}
        />
      </button>
      {labelAr !== undefined ? null : null}
    </div>
  );
}
