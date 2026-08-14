'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User,
  Bell,
  Shield,
  Key,
  Moon,
  Sun,
  Monitor,
  LogOut,
  CheckCircle2,
  ChevronRight,
  Settings,
  Sparkles,
  Database,
  Smartphone,
  Globe,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  Sliders,
  Type,
  LayoutGrid,
  Activity,
  HardDrive
} from 'lucide-react';
import IngestionSettingsView from './IngestionSettingsView';
import ModelSettingsView from './ModelSettingsView';
import DiagnosticUtility from './diagnostics/DiagnosticUtility';
import EnvVariablesManager from './env/EnvVariablesManager';
import FirstLaunchEnvModal from './env/FirstLaunchEnvModal';

interface SettingsViewProps {
  tenantId: string;
  lang: 'ar' | 'en';
  userEmail?: string | null;
  onLogOut?: () => void;
}

type TabType = 'account' | 'notifications' | 'security' | 'appearance' | 'aiModels' | 'ingestion' | 'diagnostics' | 'envVars';

export default function SettingsView({ tenantId, lang, userEmail, onLogOut }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('account');
  const [showFirstLaunchWizard, setShowFirstLaunchWizard] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // --- Account Info State ---
  const [displayName, setDisplayName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');
  const [organization, setOrganization] = useState('');
  const [avatarColor, setAvatarColor] = useState('indigo');

  // --- Notifications State ---
  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    securityMcp: true,
    systemUpdates: false,
    browserPush: true,
  });

  // --- Security State ---
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [trustedIPs, setTrustedIPs] = useState('127.0.0.1, 192.168.1.1');
  const [activeSessions, setActiveSessions] = useState([
    { id: '1', device: 'Chrome / macOS', ip: '192.168.1.45', location: lang === 'ar' ? 'الرياض، السعودية' : 'Riyadh, KSA', current: true },
    { id: '2', device: 'Safari / iPhone 15 Pro', ip: '172.56.21.90', location: lang === 'ar' ? 'دبي، الإمارات' : 'Dubai, UAE', current: false },
    { id: '3', device: 'Edge / Windows 11', ip: '82.165.12.30', location: lang === 'ar' ? 'لندن، المملكة المتحدة' : 'London, UK', current: false },
  ]);

  // --- Appearance State ---
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [arabicFont, setArabicFont] = useState<'cairo' | 'tajawal' | 'ibm'>('cairo');

  // Load from local storage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedName = localStorage.getItem(`omnirag_profile_name_${userEmail}`);
      const savedTitle = localStorage.getItem(`omnirag_profile_title_${userEmail}`);
      const savedPhone = localStorage.getItem(`omnirag_profile_phone_${userEmail}`);
      const savedBio = localStorage.getItem(`omnirag_profile_bio_${userEmail}`);
      const savedOrg = localStorage.getItem(`omnirag_profile_org_${userEmail}`);
      const savedColor = localStorage.getItem(`omnirag_profile_color_${userEmail}`);
      
      const savedTheme = localStorage.getItem('omnirag_theme');
      const savedFontSize = localStorage.getItem('omnirag_font_size');
      const savedDensity = localStorage.getItem('omnirag_density');
      const savedArabicFont = localStorage.getItem('omnirag_arabic_font');
      const savedApiKey = localStorage.getItem(`omnirag_api_key_${userEmail}`);

      if (savedName) setDisplayName(savedName);
      else setDisplayName(userEmail ? userEmail.split('@')[0] : 'User');

      if (savedTitle) setJobTitle(savedTitle);
      if (savedPhone) setPhone(savedPhone);
      if (savedBio) setBio(savedBio);
      if (savedOrg) setOrganization(savedOrg);
      if (savedColor) setAvatarColor(savedColor);

      if (savedTheme) setTheme(savedTheme as any);
      if (savedFontSize) setFontSize(savedFontSize as any);
      if (savedDensity) setDensity(savedDensity as any);
      if (savedArabicFont) setArabicFont(savedArabicFont as any);
      if (savedApiKey) setApiKey(savedApiKey);
    }
  }, [userEmail]);

  // Save specific settings to local storage
  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        localStorage.setItem(`omnirag_profile_name_${userEmail}`, displayName);
        localStorage.setItem(`omnirag_profile_title_${userEmail}`, jobTitle);
        localStorage.setItem(`omnirag_profile_phone_${userEmail}`, phone);
        localStorage.setItem(`omnirag_profile_bio_${userEmail}`, bio);
        localStorage.setItem(`omnirag_profile_org_${userEmail}`, organization);
        localStorage.setItem(`omnirag_profile_color_${userEmail}`, avatarColor);

        localStorage.setItem('omnirag_theme', theme);
        localStorage.setItem('omnirag_font_size', fontSize);
        localStorage.setItem('omnirag_density', density);
        localStorage.setItem('omnirag_arabic_font', arabicFont);
      }
      setIsSaving(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }, 800);
  };

  const generateNewApiKey = () => {
    const randomHex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const key = `omni_sec_live_${randomHex}`;
    setApiKey(key);
    if (typeof window !== 'undefined') {
      localStorage.setItem(`omnirag_api_key_${userEmail}`, key);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(apiKey);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const removeSession = (id: string) => {
    setActiveSessions(activeSessions.filter((s) => s.id !== id));
  };

  const translations = {
    ar: {
      title: 'الإعدادات والملف الشخصي',
      desc: 'إدارة تفضيلات حسابك المعرفي، وتخصيص الواجهة، ومفاتيح الوصول ومستوى الأمان المتقدم.',
      tabAccount: 'الملف الشخصي',
      tabNotifications: 'الإشعارات',
      tabSecurity: 'الأمان والوصول',
      tabAppearance: 'المظهر والخطوط',
      tabAiModels: 'إعدادات الذكاء الاصطناعي',
      tabIngestion: 'معالجة المستندات والبنية التحتية',
      tabEnvVars: 'متغيرات البيئة والربط',
      tabDiagnostics: 'فحص الاتصال والتشخيص',
      profileDetails: 'بيانات الملف الشخصي',
      displayName: 'الاسم المعروض',
      jobTitle: 'المسمى الوظيفي',
      phoneNumber: 'رقم الهاتف',
      bio: 'نبذة تعريفية',
      organization: 'المؤسسة / الشركة',
      avatarStyle: 'لون الرمز التعريفي',
      emailAddress: 'عنوان البريد الإلكتروني',
      tenantId: 'معرف المستأجر المخصص',
      saveChanges: 'حفظ جميع التغييرات',
      saving: 'جاري الحفظ والتحقق...',
      saved: 'تم حفظ الإعدادات بنجاح!',
      dangerZone: 'منطقة الحطر والتحكم',
      logOut: 'تسجيل الخروج الآمن',
      logOutDesc: 'سيتم إنهاء الجلسة الحالية وتشفير ملفات التخزين المؤقت فوراً.',
      themeTitle: 'سمة النظام الأساسية',
      light: 'نهاري فاتح',
      dark: 'ليلي داكن',
      system: 'تلقائي (حسب النظام)',
      arabicFontTitle: 'نوع الخط العربي',
      fontSizeTitle: 'حجم النصوص',
      densityTitle: 'كثافة عرض الواجهة',
      comfortable: 'عرض متباعد مريح',
      compact: 'عرض مكثف سريع',
      emailAlerts: 'تنبيهات البريد الإلكتروني الفورية',
      emailAlertsDesc: 'استلام تقارير دورية وتنبيهات عند إتمام الفهرسة ومزامنة الملفات.',
      securityMcp: 'تنبيهات جدار الحماية وبوابات MCP',
      securityMcpDesc: 'إشعار فوري عند محاولة وصول مشبوهة أو استدعاء خوادم خارجية.',
      systemUpdates: 'تحديثات المنصة والذكاء الاصطناعي',
      systemUpdatesDesc: 'الحصول على إشعارات دورية عند إضافة نماذج ذكية جديدة.',
      browserPush: 'الإشعارات المنبثقة على المتصفح',
      browserPushDesc: 'عرض ملخصات الاستجابة الفورية خلف كواليس العمل.',
      apiKeyTitle: 'مفاتيح واجهة برمجيات الـ RAG',
      apiKeyDesc: 'استخدم هذا المفتاح للتكامل المباشر مع النظم الخارجية واسترجاع المعرفة المعتمدة.',
      generateKey: 'توليد مفتاح أمان جديد',
      copyKey: 'نسخ المفتاح',
      copied: 'تم النسخ!',
      showKey: 'عرض المفتاح',
      hideKey: 'إخفاء المفتاح',
      trustedIPsTitle: 'عناوين الـ IP الموثوقة والمصرح لها',
      trustedIPsDesc: 'افصل العناوين بفواصل لتقييد الوصول إلى لوحة الـ RAG الخاصة بك.',
      activeSessionsTitle: 'الأجهزة والجلسات النشطة حالياً',
      activeSessionsDesc: 'قائمة بالأجهزة المعتمدة التي تملك حق الوصول والتحقق في الوقت الفعلي.',
      revokeSession: 'إنهاء الجلسة',
      activeNow: 'نشط الآن',
    },
    en: {
      title: 'Settings & Profile',
      desc: 'Manage your cognitive account preferences, interface options, access keys, and advanced security constraints.',
      tabAccount: 'Profile Settings',
      tabNotifications: 'Notifications',
      tabSecurity: 'Security & API Keys',
      tabAppearance: 'Appearance & Font',
      tabAiModels: 'AI Engine Settings',
      tabIngestion: 'Document Ingestion & Infra',
      tabEnvVars: 'Environment Variables',
      tabDiagnostics: 'System Diagnostics',
      profileDetails: 'Profile Details',
      displayName: 'Display Name',
      jobTitle: 'Job Title',
      phoneNumber: 'Phone Number',
      bio: 'Bio / Description',
      organization: 'Organization / Company',
      avatarStyle: 'Avatar Color Theme',
      emailAddress: 'Email Address',
      tenantId: 'Secure Tenant ID',
      saveChanges: 'Save Configuration',
      saving: 'Saving configuration...',
      saved: 'Configuration saved successfully!',
      dangerZone: 'Danger Control Zone',
      logOut: 'Secure Log Out',
      logOutDesc: 'Instantly terminate your current session and encrypt local workspace caches.',
      themeTitle: 'Core Interface Theme',
      light: 'Light Theme',
      dark: 'Dark Theme',
      system: 'System Adaptive',
      arabicFontTitle: 'Arabic Font Family',
      fontSizeTitle: 'Text Sizing',
      densityTitle: 'Display Density Layout',
      comfortable: 'Comfortable Spacing',
      compact: 'Compact Dense Layout',
      emailAlerts: 'Instant Email Alerts',
      emailAlertsDesc: 'Receive reports and logs when document ingestion and indexing finishes.',
      securityMcp: 'MCP Security Firewalls Alerts',
      securityMcpDesc: 'Receive real-time critical warnings upon suspect activities or external calls.',
      systemUpdates: 'AI Models & Features Updates',
      systemUpdatesDesc: 'Stay updated when new models or dynamic tools are added.',
      browserPush: 'Browser Push Notifications',
      browserPushDesc: 'Display immediate generation summaries directly on your screen.',
      apiKeyTitle: 'OmniRAG Integration Credentials',
      apiKeyDesc: 'Use this secure API Key to integrate document extraction tools with external systems.',
      generateKey: 'Generate Access Key',
      copyKey: 'Copy Key',
      copied: 'Copied!',
      showKey: 'Show Key',
      hideKey: 'Hide Key',
      trustedIPsTitle: 'Authorized Firewall IP List',
      trustedIPsDesc: 'List comma-separated IP addresses to restrict RAG access control loops.',
      activeSessionsTitle: 'Current Active Device Sessions',
      activeSessionsDesc: 'Review verified environments accessing your credentials in real-time.',
      revokeSession: 'Revoke',
      activeNow: 'Active Now',
    }
  };

  const t = lang === 'ar' ? translations.ar : translations.en;

  // Set avatar bg color class
  const getAvatarBg = (color: string) => {
    switch (color) {
      case 'rose': return 'bg-rose-100 text-rose-700 border-rose-300';
      case 'teal': return 'bg-teal-100 text-teal-700 border-teal-300';
      case 'emerald': return 'bg-emerald-100 text-emerald-700 border-emerald-300';
      case 'amber': return 'bg-amber-100 text-amber-700 border-amber-300';
      case 'violet': return 'bg-violet-100 text-violet-700 border-violet-300';
      default: return 'bg-indigo-100 text-indigo-700 border-indigo-300';
    }
  };

  const getActiveDotColor = (color: string) => {
    switch (color) {
      case 'rose': return 'bg-rose-500';
      case 'teal': return 'bg-teal-500';
      case 'emerald': return 'bg-emerald-500';
      case 'amber': return 'bg-amber-500';
      case 'violet': return 'bg-violet-500';
      default: return 'bg-indigo-500';
    }
  };

  return (
    <div className={`max-w-6xl mx-auto pb-12 ${lang === 'ar' ? 'font-arabic' : ''}`} id="settings-root">
      {/* Dynamic Saving Notification Status Banner */}
      <AnimatePresence>
        {saveSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 flex items-center gap-2.5 font-medium shadow-xs"
            id="settings-save-success-banner"
          >
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 animate-bounce" />
            <span>{t.saved}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mb-8" id="settings-header">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
          <div className="p-2 bg-indigo-550/10 rounded-xl text-indigo-650 border border-indigo-550/20">
            <Settings className="w-6 h-6 animate-spin-slow text-indigo-600" />
          </div>
          {t.title}
        </h1>
        <p className="text-sm text-slate-500 mt-2 max-w-3xl leading-relaxed">
          {t.desc}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8" id="settings-grid-layout">
        
        {/* Navigation Sidebar */}
        <div className="lg:col-span-1 space-y-1.5" id="settings-sidebar">
          <button
            id="tab-btn-account"
            onClick={() => setActiveTab('account')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-medium text-xs transition duration-200 cursor-pointer ${
              activeTab === 'account'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10 border-l-4 border-l-indigo-400'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 bg-white border border-slate-200'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <User className="w-4 h-4" />
              {t.tabAccount}
            </span>
            <ChevronRight className={`w-4 h-4 transition ${lang === 'ar' ? 'rotate-180' : ''} ${activeTab === 'account' ? 'opacity-100' : 'opacity-40'}`} />
          </button>

          <button
            id="tab-btn-notifications"
            onClick={() => setActiveTab('notifications')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-medium text-xs transition duration-200 cursor-pointer ${
              activeTab === 'notifications'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10 border-l-4 border-l-indigo-400'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 bg-white border border-slate-200'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Bell className="w-4 h-4" />
              {t.tabNotifications}
            </span>
            <ChevronRight className={`w-4 h-4 transition ${lang === 'ar' ? 'rotate-180' : ''} ${activeTab === 'notifications' ? 'opacity-100' : 'opacity-40'}`} />
          </button>

          <button
            id="tab-btn-security"
            onClick={() => setActiveTab('security')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-medium text-xs transition duration-200 cursor-pointer ${
              activeTab === 'security'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10 border-l-4 border-l-indigo-400'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 bg-white border border-slate-200'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Shield className="w-4 h-4" />
              {t.tabSecurity}
            </span>
            <ChevronRight className={`w-4 h-4 transition ${lang === 'ar' ? 'rotate-180' : ''} ${activeTab === 'security' ? 'opacity-100' : 'opacity-40'}`} />
          </button>

          <button
            id="tab-btn-appearance"
            onClick={() => setActiveTab('appearance')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-medium text-xs transition duration-200 cursor-pointer ${
              activeTab === 'appearance'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10 border-l-4 border-l-indigo-400'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 bg-white border border-slate-200'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Monitor className="w-4 h-4" />
              {t.tabAppearance}
            </span>
            <ChevronRight className={`w-4 h-4 transition ${lang === 'ar' ? 'rotate-180' : ''} ${activeTab === 'appearance' ? 'opacity-100' : 'opacity-40'}`} />
          </button>

          <button
            id="tab-btn-aimodels"
            onClick={() => setActiveTab('aiModels')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-medium text-xs transition duration-200 cursor-pointer ${
              activeTab === 'aiModels'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10 border-l-4 border-l-indigo-400'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 bg-white border border-slate-200'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4" />
              {t.tabAiModels}
            </span>
            <ChevronRight className={`w-4 h-4 transition ${lang === 'ar' ? 'rotate-180' : ''} ${activeTab === 'aiModels' ? 'opacity-100' : 'opacity-40'}`} />
          </button>

          <button
            id="tab-btn-ingestion"
            onClick={() => setActiveTab('ingestion')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-medium text-xs transition duration-200 cursor-pointer ${
              activeTab === 'ingestion'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10 border-l-4 border-l-indigo-400'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 bg-white border border-slate-200'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <HardDrive className="w-4 h-4" />
              {t.tabIngestion}
            </span>
            <ChevronRight className={`w-4 h-4 transition ${lang === 'ar' ? 'rotate-180' : ''} ${activeTab === 'ingestion' ? 'opacity-100' : 'opacity-40'}`} />
          </button>

          <button
            id="tab-btn-envvars"
            onClick={() => setActiveTab('envVars')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-medium text-xs transition duration-200 cursor-pointer ${
              activeTab === 'envVars'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10 border-l-4 border-l-indigo-400'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 bg-white border border-slate-200'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Key className="w-4 h-4" />
              {t.tabEnvVars}
            </span>
            <ChevronRight className={`w-4 h-4 transition ${lang === 'ar' ? 'rotate-180' : ''} ${activeTab === 'envVars' ? 'opacity-100' : 'opacity-40'}`} />
          </button>

          <button
            id="tab-btn-diagnostics"
            onClick={() => setActiveTab('diagnostics')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-medium text-xs transition duration-200 cursor-pointer ${
              activeTab === 'diagnostics'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10 border-l-4 border-l-indigo-400'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 bg-white border border-slate-200'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Activity className="w-4 h-4" />
              {t.tabDiagnostics}
            </span>
            <ChevronRight className={`w-4 h-4 transition ${lang === 'ar' ? 'rotate-180' : ''} ${activeTab === 'diagnostics' ? 'opacity-100' : 'opacity-40'}`} />
          </button>
        </div>

        {/* Content Area with Animations */}
        <div className="lg:col-span-3 space-y-6" id="settings-content-area">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: lang === 'ar' ? -15 : 15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: lang === 'ar' ? 15 : -15 }}
              transition={{ duration: 0.15 }}
              className="space-y-6"
            >
              
              {/* ACCOUNT TAB CONTENT */}
              {activeTab === 'account' && (
                <div className="space-y-6" id="section-account">
                  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <User className="w-5 h-5 text-indigo-600" />
                        <h2 className="text-lg font-bold text-slate-900">{t.profileDetails}</h2>
                      </div>
                      <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-600 px-2 py-1 rounded border border-indigo-100 uppercase tracking-wide">
                        {lang === 'ar' ? 'أمان الهوية' : 'Identity Secure'}
                      </span>
                    </div>
                    
                    <div className="p-6 space-y-6">
                      {/* Avatar & Dynamic Customization */}
                      <div className="flex flex-col sm:flex-row items-center gap-6 p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                        <div className="relative">
                          <div className={`w-20 h-20 rounded-2xl ${getAvatarBg(avatarColor)} flex items-center justify-center text-3xl font-extrabold shadow-md border-2 transition-all duration-300 relative`}>
                            {displayName ? displayName.charAt(0).toUpperCase() : 'U'}
                            <span className={`absolute bottom-1.5 right-1.5 w-3.5 h-3.5 rounded-full border-2 border-white ring-1 ring-slate-200 animate-pulse ${getActiveDotColor(avatarColor)}`} />
                          </div>
                        </div>
                        <div className="space-y-3 flex-1 text-center sm:text-left rtl:sm:text-right">
                          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t.avatarStyle}</h4>
                          <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                            {(['indigo', 'teal', 'rose', 'emerald', 'amber', 'violet'] as const).map((color) => (
                              <button
                                key={color}
                                onClick={() => setAvatarColor(color)}
                                className={`w-8 h-8 rounded-lg border-2 transition transform hover:scale-110 active:scale-95 ${
                                  color === 'indigo' ? 'bg-indigo-500' :
                                  color === 'teal' ? 'bg-teal-500' :
                                  color === 'rose' ? 'bg-rose-500' :
                                  color === 'emerald' ? 'bg-emerald-500' :
                                  color === 'amber' ? 'bg-amber-500' : 'bg-violet-500'
                                } ${avatarColor === color ? 'border-indigo-600 ring-2 ring-indigo-300 ring-offset-1' : 'border-white shadow-xs hover:shadow-md'}`}
                                aria-label={`Select ${color} color`}
                              />
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Profile Inputs */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                            {t.displayName}
                          </label>
                          <input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-medium transition duration-150"
                            placeholder="Full Name"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                            {t.jobTitle}
                          </label>
                          <input
                            type="text"
                            value={jobTitle}
                            onChange={(e) => setJobTitle(e.target.value)}
                            className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-medium transition duration-150"
                            placeholder="e.g. Lead Security Architect"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                            {t.phoneNumber}
                          </label>
                          <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-medium transition duration-150 font-mono"
                            placeholder="+966 500 000 000"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                            {t.organization}
                          </label>
                          <input
                            type="text"
                            value={organization}
                            onChange={(e) => setOrganization(e.target.value)}
                            className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-medium transition duration-150"
                            placeholder="Company Name"
                          />
                        </div>

                        <div className="sm:col-span-2 space-y-1.5">
                          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                            {t.bio}
                          </label>
                          <textarea
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
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                              {t.emailAddress}
                            </label>
                            <Lock className="w-3.5 h-3.5 text-slate-400" />
                          </div>
                          <p className="text-xs font-semibold text-slate-600 font-mono break-all">{userEmail || 'N/A'}</p>
                        </div>
                        <div className="space-y-1.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                              {t.tenantId}
                            </label>
                            <Lock className="w-3.5 h-3.5 text-slate-400" />
                          </div>
                          <p className="text-xs font-semibold text-slate-600 font-mono break-all">{tenantId}</p>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              )}

              {/* NOTIFICATIONS TAB CONTENT */}
              {activeTab === 'notifications' && (
                <div className="space-y-6" id="section-notifications">
                  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50">
                      <div className="flex items-center gap-2">
                        <Bell className="w-5 h-5 text-indigo-600" />
                        <h2 className="text-lg font-bold text-slate-900">{t.tabNotifications}</h2>
                      </div>
                    </div>
                    
                    <div className="p-6 divide-y divide-slate-100">
                      
                      {/* Email Alerts Toggle */}
                      <div className="py-4.5 flex items-start justify-between gap-4 first:pt-0">
                        <div className="space-y-1">
                          <h3 className="font-semibold text-slate-900 text-xs">{t.emailAlerts}</h3>
                          <p className="text-xs text-slate-500 leading-relaxed max-w-xl">{t.emailAlertsDesc}</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                          <input
                            type="checkbox"
                            checked={notifications.emailAlerts}
                            onChange={(e) => setNotifications({ ...notifications, emailAlerts: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] rtl:after:right-[2px] rtl:after:left-auto after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
                        </label>
                      </div>

                      {/* Security Audits Toggle */}
                      <div className="py-4.5 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <h3 className="font-semibold text-slate-900 text-xs">{t.securityMcp}</h3>
                          <p className="text-xs text-slate-500 leading-relaxed max-w-xl">{t.securityMcpDesc}</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                          <input
                            type="checkbox"
                            checked={notifications.securityMcp}
                            onChange={(e) => setNotifications({ ...notifications, securityMcp: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] rtl:after:right-[2px] rtl:after:left-auto after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
                        </label>
                      </div>

                      {/* Platform News Toggle */}
                      <div className="py-4.5 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <h3 className="font-semibold text-slate-900 text-xs">{t.systemUpdates}</h3>
                          <p className="text-xs text-slate-500 leading-relaxed max-w-xl">{t.systemUpdatesDesc}</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                          <input
                            type="checkbox"
                            checked={notifications.systemUpdates}
                            onChange={(e) => setNotifications({ ...notifications, systemUpdates: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] rtl:after:right-[2px] rtl:after:left-auto after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
                        </label>
                      </div>

                      {/* Browser Notifications Toggle */}
                      <div className="py-4.5 flex items-start justify-between gap-4 last:pb-0">
                        <div className="space-y-1">
                          <h3 className="font-semibold text-slate-900 text-xs">{t.browserPush}</h3>
                          <p className="text-xs text-slate-500 leading-relaxed max-w-xl">{t.browserPushDesc}</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                          <input
                            type="checkbox"
                            checked={notifications.browserPush}
                            onChange={(e) => setNotifications({ ...notifications, browserPush: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] rtl:after:right-[2px] rtl:after:left-auto after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
                        </label>
                      </div>

                    </div>
                  </div>
                </div>
              )}

              {/* SECURITY & API KEYS TAB CONTENT */}
              {activeTab === 'security' && (
                <div className="space-y-6" id="section-security">
                  
                  {/* API Integration Key */}
                  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Key className="w-5 h-5 text-indigo-600" />
                        <h2 className="text-lg font-bold text-slate-900">{t.apiKeyTitle}</h2>
                      </div>
                      <span className="text-[10px] font-mono font-bold bg-cyan-50 text-cyan-700 px-2.5 py-1 rounded-md border border-cyan-150">
                        {lang === 'ar' ? 'مفتاح مشفر' : 'REST API Token'}
                      </span>
                    </div>
                    <div className="p-6 space-y-4">
                      <p className="text-xs text-slate-500 leading-relaxed">{t.apiKeyDesc}</p>
                      
                      {apiKey ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 bg-slate-900 p-3 rounded-xl border border-slate-800">
                            <input
                              type={showApiKey ? 'text' : 'password'}
                              readOnly
                              value={apiKey}
                              className="bg-transparent border-none text-cyan-300 font-mono text-[11px] w-full focus:outline-none tracking-wide select-all"
                            />
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => setShowApiKey(!showApiKey)}
                                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition"
                                title={showApiKey ? t.hideKey : t.showKey}
                              >
                                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                              <button
                                onClick={copyToClipboard}
                                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition"
                                title={t.copyKey}
                              >
                                {isCopied ? <Check className="w-4 h-4 text-emerald-400 animate-pulse" /> : <Copy className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                          {isCopied && (
                            <p className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                              <Check className="w-3.5 h-3.5" /> {t.copied}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="text-center p-6 border border-dashed border-slate-200 rounded-xl bg-slate-50">
                          <Lock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                          <p className="text-xs font-semibold text-slate-400">{lang === 'ar' ? 'لم يتم توليد مفاتيح أمان بعد' : 'No Access Tokens Generated yet'}</p>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={generateNewApiKey}
                        className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition ml-auto shadow-sm"
                      >
                        <RefreshCw className="w-4 h-4 animate-spin-slow" />
                        {t.generateKey}
                      </button>
                    </div>
                  </div>

                  {/* Trusted IPs */}
                  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50">
                      <div className="flex items-center gap-2">
                        <Globe className="w-5 h-5 text-indigo-600" />
                        <h2 className="text-lg font-bold text-slate-900">{t.trustedIPsTitle}</h2>
                      </div>
                    </div>
                    <div className="p-6 space-y-4">
                      <p className="text-xs text-slate-500 leading-relaxed">{t.trustedIPsDesc}</p>
                      <input
                        type="text"
                        value={trustedIPs}
                        onChange={(e) => setTrustedIPs(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-mono focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-medium transition duration-150"
                        placeholder="e.g. 127.0.0.1, 10.0.0.1"
                      />
                    </div>
                  </div>

                  {/* Active Sessions */}
                  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-5 h-5 text-indigo-600" />
                        <h2 className="text-lg font-bold text-slate-900">{t.activeSessionsTitle}</h2>
                      </div>
                    </div>
                    <div className="p-4 space-y-3">
                      <p className="text-xs text-slate-500 px-2 leading-relaxed">{t.activeSessionsDesc}</p>
                      
                      <div className="overflow-x-auto">
                        <table className="w-full text-left rtl:text-right text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                              <th className="py-2 px-3">{lang === 'ar' ? 'الجهاز والمنصة' : 'Device / OS'}</th>
                              <th className="py-2 px-3">IP Address</th>
                              <th className="py-2 px-3">{lang === 'ar' ? 'الموقع التقريبي' : 'Approximate Location'}</th>
                              <th className="py-2 px-3 text-right rtl:text-left">{lang === 'ar' ? 'الإجراء' : 'Actions'}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {activeSessions.map((session) => (
                              <tr key={session.id} className="hover:bg-slate-50 transition duration-150">
                                <td className="py-3 px-3 font-medium text-slate-800">
                                  <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${session.current ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                                    {session.device}
                                    {session.current && (
                                      <span className="text-[9px] bg-emerald-550/10 text-emerald-700 font-semibold px-1.5 py-0.5 rounded border border-emerald-550/20">
                                        {t.activeNow}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-3 font-mono text-slate-500">{session.ip}</td>
                                <td className="py-3 px-3 text-slate-500">{session.location}</td>
                                <td className="py-3 px-3 text-right rtl:text-left">
                                  {!session.current && (
                                    <button
                                      onClick={() => removeSession(session.id)}
                                      className="text-rose-600 hover:text-rose-800 font-bold transition-all text-[11px]"
                                    >
                                      {t.revokeSession}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* APPEARANCE & FONTS TAB CONTENT */}
              {activeTab === 'appearance' && (
                <div className="space-y-6" id="section-appearance">
                  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50">
                      <div className="flex items-center gap-2">
                        <Sliders className="w-5 h-5 text-indigo-600" />
                        <h2 className="text-lg font-bold text-slate-900">{t.tabAppearance}</h2>
                      </div>
                    </div>
                    <div className="p-6 space-y-6">
                      
                      {/* Theme Selector */}
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-3">
                          {t.themeTitle}
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                          {(['light', 'dark', 'system'] as const).map((tType) => (
                            <button
                              key={tType}
                              onClick={() => setTheme(tType)}
                              className={`flex flex-col items-center justify-center p-4 rounded-xl border transition cursor-pointer select-none ${
                                theme === tType
                                  ? 'border-indigo-650 bg-indigo-555/5 text-indigo-700 ring-2 ring-indigo-200'
                                  : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {tType === 'light' && <Sun className="w-5 h-5 mb-2 text-amber-500" />}
                              {tType === 'dark' && <Moon className="w-5 h-5 mb-2 text-indigo-500" />}
                              {tType === 'system' && <Monitor className="w-5 h-5 mb-2 text-slate-500" />}
                              <span className="text-xs font-semibold">
                                {tType === 'light' ? t.light : tType === 'dark' ? t.dark : t.system}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Font Family Selector (Arabic specific) */}
                      {lang === 'ar' && (
                        <div>
                          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                            <Type className="w-4 h-4 text-indigo-600" />
                            {t.arabicFontTitle}
                          </label>
                          <div className="grid grid-cols-3 gap-3">
                            {(['cairo', 'tajawal', 'ibm'] as const).map((f) => (
                              <button
                                key={f}
                                onClick={() => setArabicFont(f)}
                                className={`p-3 rounded-xl border text-center transition cursor-pointer select-none ${
                                  arabicFont === f
                                    ? 'border-indigo-650 bg-indigo-555/5 text-indigo-700 ring-2 ring-indigo-200 font-bold'
                                    : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                                }`}
                              >
                                <span className={`text-xs block ${
                                  f === 'cairo' ? 'font-cairo' : f === 'tajawal' ? 'font-tajawal' : 'font-mono'
                                }`}>
                                  {f === 'cairo' ? 'خط القاهرة (Cairo)' : f === 'tajawal' ? 'خط تجول (Tajawal)' : 'خط آي بي إم (IBM Arabic)'}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Font Size Selector */}
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-3">
                          {t.fontSizeTitle}
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                          {(['sm', 'md', 'lg'] as const).map((sz) => (
                            <button
                              key={sz}
                              onClick={() => setFontSize(sz)}
                              className={`p-3 rounded-xl border text-center transition cursor-pointer select-none ${
                                fontSize === sz
                                  ? 'border-indigo-650 bg-indigo-555/5 text-indigo-700 ring-2 ring-indigo-200 font-bold'
                                  : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              <span className={`text-xs font-semibold ${
                                sz === 'sm' ? 'text-[11px]' : sz === 'md' ? 'text-xs' : 'text-sm'
                              }`}>
                                {lang === 'ar' ? (sz === 'sm' ? 'صغير' : sz === 'md' ? 'طبيعي' : 'كبير جداً') : (sz === 'sm' ? 'Small' : sz === 'md' ? 'Medium' : 'Large')}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Display Density Layout Selector */}
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                          <LayoutGrid className="w-4 h-4 text-indigo-600" />
                          {t.densityTitle}
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          {(['comfortable', 'compact'] as const).map((d) => (
                            <button
                              key={d}
                              onClick={() => setDensity(d)}
                              className={`p-3 rounded-xl border text-center transition cursor-pointer select-none ${
                                density === d
                                  ? 'border-indigo-650 bg-indigo-555/5 text-indigo-700 ring-2 ring-indigo-200 font-bold'
                                  : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              <span className="text-xs font-semibold">
                                {d === 'comfortable' ? t.comfortable : t.compact}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'aiModels' && (
                <div id="section-aimodels">
                  <ModelSettingsView />
                </div>
              )}

              {activeTab === 'ingestion' && (
                <div id="section-ingestion">
                  <IngestionSettingsView lang={lang} />
                </div>
              )}

              {activeTab === 'envVars' && (
                <div id="section-envvars">
                  <EnvVariablesManager lang={lang} onOpenWizard={() => setShowFirstLaunchWizard(true)} />
                </div>
              )}

              {activeTab === 'diagnostics' && (
                <div id="section-diagnostics">
                  <DiagnosticUtility lang={lang} autoRunOnMount={true} />
                </div>
              )}

              <FirstLaunchEnvModal
                lang={lang}
                isOpen={showFirstLaunchWizard}
                onClose={() => setShowFirstLaunchWizard(false)}
              />
              <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm" id="settings-shared-bar">
                <p className="text-[11px] text-slate-500 text-center sm:text-left rtl:sm:text-right leading-relaxed max-w-md font-medium">
                  {lang === 'ar' 
                    ? 'يتم تخزين الإعدادات وتخصيصات الواجهة محلياً بشكل آمن لضمان التشفير والخصوصية التامة.' 
                    : 'All preferences and localized parameters are securely cryptographically cached on your browser client.'}
                </p>
                <div className="flex gap-2 w-full sm:w-auto shrink-0">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-indigo-650 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold text-xs flex items-center justify-center gap-2 transition duration-150 cursor-pointer shadow-sm select-none"
                    id="save-settings-btn"
                  >
                    {isSaving ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>{t.saving}</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{t.saveChanges}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* DANGER CONTROL ZONE */}
              <div className="bg-rose-50/50 border border-rose-200 rounded-2xl shadow-sm overflow-hidden" id="settings-danger-zone">
                <div className="px-6 py-5 border-b border-rose-200 bg-rose-50/80 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-rose-700 animate-pulse" />
                    <h2 className="text-lg font-bold text-rose-900">{t.dangerZone}</h2>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-rose-100 text-rose-800 px-2 py-0.5 rounded border border-rose-200">
                    CRITICAL
                  </span>
                </div>
                <div className="p-6">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-center sm:text-left rtl:sm:text-right">
                      <h3 className="font-bold text-slate-900 text-xs">{t.logOut}</h3>
                      <p className="text-xs text-slate-500 mt-1 max-w-md leading-relaxed">{t.logOutDesc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={onLogOut}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center justify-center gap-2 transition duration-200 shadow-sm cursor-pointer select-none"
                      id="logout-danger-btn"
                    >
                      <LogOut className="w-4 h-4" />
                      {t.logOut}
                    </button>
                  </div>
                </div>
              </div>

            </motion.div>
          </AnimatePresence>
        </div>

      </div>
    </div>
  );
}
