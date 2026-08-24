'use client';

import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Layers,
  ShieldCheck,
  Mail,
  Lock,
  User as UserIcon,
  Building2,
  Globe,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { signUpUser, signInUser } from '@/lib/auth/authClient';
import { randomHex, randomPassword } from '@/lib/crypto/webRandom';

interface AuthScreenProps {
  onAuthSuccess: (tenantId: string, userEmail: string) => void;
  lang: 'ar' | 'en';
  onLangChange: (lang: 'ar' | 'en') => void;
  onBackToLanding?: () => void;
}

export default function AuthScreen({ onAuthSuccess, lang, onLangChange, onBackToLanding }: AuthScreenProps) {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Quick Guest Sign-Up: creates a REAL account (cryptographically-secure
  // random credentials) via the Postgres auth API — same path as a normal
  // signup. There is no demo/bypass impersonation.
  const handleGuestSignUp = async () => {
    setLoading(true);
    setError(null);
    try {
      const demoEmail = `guest-${parseInt(randomHex(3), 16)}@omnirag.io`;
      const demoPass = randomPassword(12);
      const demoWorkspace = 'مساحة العمل التجريبية (Guest Space)';
      const { tenantId, userEmail } = await signUpUser(demoEmail, demoPass, demoWorkspace);
      onAuthSuccess(tenantId, userEmail || demoEmail);
    } catch (err: any) {
      setError(lang === 'ar' ? `فشل الدخول السريع: ${err.message}` : `Quick login failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (!email || !password) {
      setError(lang === 'ar' ? 'يرجى ملء جميع الحقول المطلوبة' : 'Please fill in all required fields');
      setLoading(false);
      return;
    }

    try {
      if (activeTab === 'register') {
        if (!workspaceName) {
          setError(lang === 'ar' ? 'يرجى إدخال اسم مساحة العمل' : 'Please enter a workspace name');
          setLoading(false);
          return;
        }

        const { tenantId, userEmail } = await signUpUser(email, password, workspaceName);
        setSuccess(lang === 'ar' ? 'تم إنشاء الحساب ومساحة العمل بنجاح!' : 'Account & Workspace created successfully!');

        setTimeout(() => {
          onAuthSuccess(tenantId, userEmail || email);
        }, 1500);
      } else {
        // Sign In
        const { tenantId, userEmail } = await signInUser(email, password);
        setSuccess(lang === 'ar' ? 'تم تسجيل الدخول بنجاح!' : 'Logged in successfully!');

        setTimeout(() => {
          onAuthSuccess(tenantId, userEmail || email);
        }, 1200);
      }
    } catch (err: any) {
      console.error(err);
      let errMsg = err.message;
      // The Postgres auth API returns generic messages (account-enumeration
      // defense). The server surfaces specific codes for known cases:
      // 409 duplicate email at registration, 400 weak password, 401 bad creds,
      // 403 CSRF guard. Map those to localized strings; otherwise show the
      // server-supplied message verbatim.
      if (err.code === '409_EMAIL_EXISTS') {
        errMsg = lang === 'ar' ? 'البريد الإلكتروني مستخدم بالفعل' : 'Email is already in use';
      } else if (err.code === '400_WEAK_PASSWORD') {
        errMsg =
          lang === 'ar'
            ? 'كلمة المرور ضعيفة جداً (يجب أن لا تقل عن 8 أحرف)'
            : 'Password is too weak (min 8 characters)';
      } else if (err.status === 401) {
        errMsg = lang === 'ar' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'Invalid email or password';
      } else if (err.code === '403_CSRF') {
        errMsg = lang === 'ar' ? 'طلب غير مصرّح به' : 'Unauthorized request';
      }
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row bg-slate-950 text-slate-100 font-sans"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* Brand & Technical Pitch Sidebar (RTL/LTR Adaptive) */}
      <div className="lg:w-5/12 bg-slate-900 border-b lg:border-b-0 lg:border-l border-slate-800 p-8 flex flex-col justify-between relative overflow-hidden shrink-0">
        <div className="absolute inset-0 bg-radial-at-t from-indigo-500/10 via-transparent to-transparent pointer-events-none" />

        {/* Brand Header */}
        <div className="flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-lg tracking-tight text-white">OmniRAG</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  v2.4
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                {lang === 'ar' ? 'منصة استرجاع معزز وحوكمة أمنية' : 'Agentic RAG & MCP Security Gateway'}
              </p>
            </div>
          </div>

          {/* Language Selector */}
          <button
            type="button"
            onClick={() => onLangChange(lang === 'ar' ? 'en' : 'ar')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700 cursor-pointer transition select-none"
          >
            <Globe className="w-3.5 h-3.5 text-indigo-400" />
            <span>{lang === 'ar' ? 'English' : 'العربية'}</span>
          </button>
        </div>

        {/* Core Value Pitch */}
        <div className="my-12 lg:my-0 z-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-800/80 text-indigo-300 text-xs font-semibold mb-4">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            <span>{lang === 'ar' ? 'المصادقة وحوكمة المستأجرين الفاعلة' : 'Deterministic Multi-Tenancy Auth'}</span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-white leading-snug tracking-tight mb-4">
            {lang === 'ar'
              ? 'تفعيل حماية المستأجرين التلقائي وفق مبادئ الـ SDLC'
              : 'Deterministic Access Control & True Data Isolation'}
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-6">
            {lang === 'ar'
              ? 'تلتزم OmniRAG بأقصى درجات أمان البيانات. بمجرد تسجيل حسابك، يُنشأ لك مستأجر (Tenant) معزول بعزل مفروض على مستوى التطبيق عبر فلاتر tenant_id إلزامية في كل استعلام، مع فحوص الخطافات الحتمية (HookHarness).'
              : 'OmniRAG is built with strict security. Every registered user gets an isolated tenant workspace enforced at the APPLICATION layer via mandatory tenant_id predicates on every query, plus deterministic hook checks.'}
          </p>

          {/* Key Compliance List */}
          <div className="space-y-3.5">
            {[
              {
                ar: 'عزل تام للمستندات وقاعدة المعرفة بمستوى المستأجر (Tenant Isolation)',
                en: 'Cryptographic Workspace & Tenant Isolation for knowledge base',
              },
              {
                ar: 'خطافات أمنية حتمية (HookHarness) لفحص وتأمين مدخلات ومخرجات الذكاء الاصطناعي',
                en: 'Deterministic Pre/Post inference HookHarness check',
              },
              {
                ar: 'تشفير كلمات المرور بـ Argon2id وجلسات معزولة عبر httpOnly cookies',
                en: 'Argon2id password hashing with httpOnly secure session cookies',
              },
            ].map((item, idx) => (
              <div key={idx} className="flex gap-3 text-xs leading-relaxed text-slate-300">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{lang === 'ar' ? item.ar : item.en}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer info */}
        <div className="text-[11px] text-slate-500 z-10 flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/60" />
          <span>
            {lang === 'ar'
              ? 'نظام محمي ومتوافق مع معايير الالتزام السيبراني 2026'
              : 'ISO/IEC 27001 Secure Architecture Standards'}
          </span>
        </div>
      </div>

      {/* Auth Interaction Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-12 lg:p-16 relative">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-xl relative z-10">
          {onBackToLanding && (
            <button
              type="button"
              onClick={onBackToLanding}
              className="mb-6 inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-extrabold transition cursor-pointer select-none"
            >
              {lang === 'ar' ? 'العودة للصفحة الرئيسية ←' : '← Back to Landing Page'}
            </button>
          )}

          {/* Tabs header */}
          <div className="flex border-b border-slate-800 mb-6">
            <button
              type="button"
              onClick={() => {
                setActiveTab('login');
                setError(null);
              }}
              className={`flex-1 pb-3 text-sm font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'login'
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {lang === 'ar' ? 'تسجيل الدخول' : 'Sign In'}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('register');
                setError(null);
              }}
              className={`flex-1 pb-3 text-sm font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'register'
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {lang === 'ar' ? 'إنشاء حساب جديد' : 'Sign Up'}
            </button>
          </div>

          {/* Feedback messages */}
          {error && (
            <div className="mb-4 p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs flex gap-2 items-start animate-shake">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="mb-4 p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 text-xs flex gap-2 items-start">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          {/* Core Input Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <>
              {/* Email input */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-bold flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  <span>{lang === 'ar' ? 'البريد الإلكتروني' : 'Email Address'}</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@enterprise.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Password input */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-bold flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-500" />
                  <span>{lang === 'ar' ? 'كلمة المرور' : 'Password'}</span>
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Registration Only Fields */}
              {activeTab === 'register' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="space-y-4 pt-1"
                >
                  {/* Workspace / Tenant Name input */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 font-bold flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-slate-500" />
                      <span>{lang === 'ar' ? 'اسم مساحة العمل / المؤسسة' : 'Workspace / Enterprise Name'}</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={lang === 'ar' ? 'مؤسسة التقنية العالمية' : 'Global Tech Enterprise'}
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </motion.div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white text-xs font-bold py-3 px-4 rounded-xl cursor-pointer select-none transition shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <span>{lang === 'ar' ? 'جاري التحميل...' : 'Please wait...'}</span>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>
                      {activeTab === 'login'
                        ? lang === 'ar'
                          ? 'دخول آمن للمنصة'
                          : 'Secure Platform Access'
                        : lang === 'ar'
                          ? 'تسجيل وتجهيز مساحة العمل'
                          : 'Register & Create Tenant'}
                    </span>
                  </>
                )}
              </button>
            </>
          </form>

          {/* Separation line */}
          <div className="relative my-6 text-center">
            <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-b border-slate-800" />
            <span className="relative px-3 bg-slate-900 text-slate-500 text-[10px] font-mono font-bold tracking-wider">
              {lang === 'ar' ? 'بوابة المحاكاة والاختبار السريع' : 'SDLC TESTING & SIMULATION PORTAL'}
            </span>
          </div>

          {/* Quick Guest Sign-Up (creates a real local auth account) */}
          <div className="grid grid-cols-1 gap-3">
            <button
              type="button"
              onClick={handleGuestSignUp}
              disabled={loading}
              className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 cursor-pointer select-none transition text-center text-[11px]"
              title={lang === 'ar' ? 'إنشاء مستأجر عشوائي معزول تماماً' : 'Create a fresh random tenant'}
            >
              <UserIcon className="w-4 h-4 text-violet-400 mb-1" />
              <span className="font-bold text-white">{lang === 'ar' ? 'مستخدم تجريبي' : 'Sandbox Guest'}</span>
              <span className="text-[9px] text-slate-400">{lang === 'ar' ? 'عزل تلقائي' : 'Isolated Sign-Up'}</span>
            </button>
          </div>

          {/* Help text */}
          <p className="mt-6 text-center text-[10px] text-slate-500 leading-normal">
            {lang === 'ar'
              ? 'تنويه: تدعم البوابة حسابات محلية حقيقية مع جلسات معزولة لمساحات عمل معتمدة.'
              : 'Notice: Supports fully working local auth accounts with auto-seeded tenant sandbox states.'}
          </p>
        </div>
      </div>
    </div>
  );
}
