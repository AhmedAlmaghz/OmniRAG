'use client';

import React, { useState } from 'react';
import { User, Bell, Shield, Key, Moon, Sun, Monitor, LogOut, CheckCircle2, ChevronRight, Settings } from 'lucide-react';

interface SettingsViewProps {
  tenantId: string;
  lang: 'ar' | 'en';
  userEmail?: string | null;
  onLogOut?: () => void;
}

export default function SettingsView({ tenantId, lang, userEmail, onLogOut }: SettingsViewProps) {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [notifications, setNotifications] = useState({
    email: true,
    security: true,
    updates: false,
  });

  return (
    <div className={`max-w-5xl mx-auto ${lang === 'ar' ? 'font-arabic' : ''}`}>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Settings className="w-6 h-6 text-indigo-600" />
          {lang === 'ar' ? 'الإعدادات والملف الشخصي' : 'Settings & Profile'}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {lang === 'ar' ? 'إدارة تفضيلات حسابك، وتخصيص الواجهة، وإعدادات الأمان' : 'Manage your account preferences, interface customization, and security settings'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        
        {/* Navigation Sidebar */}
        <div className="md:col-span-1 space-y-1">
          <button className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-indigo-50 text-indigo-700 font-semibold text-sm transition">
            <span className="flex items-center gap-2"><User className="w-4 h-4" /> {lang === 'ar' ? 'الحساب' : 'Account'}</span>
            <ChevronRight className="w-4 h-4 rtl:rotate-180" />
          </button>
          <button className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-slate-600 hover:bg-slate-50 font-medium text-sm transition">
            <span className="flex items-center gap-2"><Bell className="w-4 h-4" /> {lang === 'ar' ? 'الإشعارات' : 'Notifications'}</span>
            <ChevronRight className="w-4 h-4 rtl:rotate-180 opacity-0 group-hover:opacity-100" />
          </button>
          <button className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-slate-600 hover:bg-slate-50 font-medium text-sm transition">
            <span className="flex items-center gap-2"><Shield className="w-4 h-4" /> {lang === 'ar' ? 'الأمان' : 'Security'}</span>
          </button>
          <button className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-slate-600 hover:bg-slate-50 font-medium text-sm transition">
            <span className="flex items-center gap-2"><Monitor className="w-4 h-4" /> {lang === 'ar' ? 'المظهر' : 'Appearance'}</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="md:col-span-3 space-y-8">
          
          {/* Profile Section */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">{lang === 'ar' ? 'الملف الشخصي' : 'Profile Information'}</h2>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xl font-bold shadow-inner">
                  {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-lg">
                    {userEmail?.split('@')[0] || 'User'}
                  </h3>
                  <p className="text-slate-500 text-sm">{userEmail}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {lang === 'ar' ? 'البريد الإلكتروني' : 'Email Address'}
                  </label>
                  <input
                    type="email"
                    disabled
                    value={userEmail || ''}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500 cursor-not-allowed"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {lang === 'ar' ? 'معرف المستأجر' : 'Tenant ID'}
                  </label>
                  <input
                    type="text"
                    disabled
                    value={tenantId}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500 font-mono cursor-not-allowed"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Preferences Section */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">{lang === 'ar' ? 'التفضيلات والمظهر' : 'Preferences & Appearance'}</h2>
            </div>
            <div className="p-6">
              
              <div className="mb-6">
                <label className="block text-sm font-semibold text-slate-900 mb-3">
                  {lang === 'ar' ? 'سمة الواجهة' : 'Interface Theme'}
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {(['light', 'dark', 'system'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition ${
                        theme === t
                          ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700'
                          : 'border-slate-200 hover:border-slate-300 text-slate-600'
                      }`}
                    >
                      {t === 'light' && <Sun className="w-5 h-5 mb-2" />}
                      {t === 'dark' && <Moon className="w-5 h-5 mb-2" />}
                      {t === 'system' && <Monitor className="w-5 h-5 mb-2" />}
                      <span className="text-xs font-semibold capitalize">
                        {lang === 'ar' ? (t === 'light' ? 'فاتح' : t === 'dark' ? 'داكن' : 'نظام') : t}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

            </div>
          </div>

          {/* Danger Zone */}
          <div className="bg-rose-50/50 border border-rose-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-rose-200">
              <h2 className="text-lg font-bold text-rose-900">{lang === 'ar' ? 'منطقة الخطر' : 'Danger Zone'}</h2>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">{lang === 'ar' ? 'تسجيل الخروج' : 'Log out of your account'}</h3>
                  <p className="text-sm text-slate-500 mt-1">{lang === 'ar' ? 'سيتعين عليك تسجيل الدخول مرة أخرى للوصول إلى حسابك.' : 'You will need to log back in to access your account.'}</p>
                </div>
                <button
                  type="button"
                  onClick={onLogOut}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-sm flex items-center gap-2 transition"
                >
                  <LogOut className="w-4 h-4" />
                  {lang === 'ar' ? 'خروج' : 'Log out'}
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
