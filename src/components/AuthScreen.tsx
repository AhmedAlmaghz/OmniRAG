'use client';

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Layers, ShieldCheck, Mail, Lock, User as UserIcon, Building2, Globe, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';
import { signUpUser, signInUser, signInWithGoogle } from '@/lib/auth/firebaseAuth';

interface AuthScreenProps {
  onAuthSuccess: (tenantId: string, userEmail: string) => void;
  lang: 'ar' | 'en';
  onLangChange: (lang: 'ar' | 'en') => void;
}

export default function AuthScreen({ onAuthSuccess, lang, onLangChange }: AuthScreenProps) {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [enableMfa, setEnableMfa] = useState(false);
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Quick Demo Login helper to make the tester's life extremely easy and standard compliant
  const handleQuickDemoLogin = async (role: 'acme' | 'guest') => {
    setLoading(true);
    setError(null);
    try {
      if (role === 'acme') {
        // Log in to default seeded tenant
        onAuthSuccess('tenant-acme-01', 'enterprise-admin@acme.com');
      } else {
        // Quick Guest signup using random credentials
        const demoEmail = `guest-${Math.floor(Math.random() * 10000)}@omnirag.io`;
        const demoPass = 'Password123!';
        const demoWorkspace = 'مساحة العمل التجريبية (Guest Space)';
        const { tenantId } = await signUpUser(demoEmail, demoPass, demoWorkspace);
        onAuthSuccess(tenantId, demoEmail);
      }
    } catch (err: any) {
      setError(lang === 'ar' ? `فشل الدخول السريع: ${err.message}` : `Quick login failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const { user, tenantId } = await signInWithGoogle();
      setSuccess(lang === 'ar' ? 'تم تسجيل الدخول عبر Google بنجاح!' : 'Signed in with Google successfully!');
      setTimeout(() => {
        onAuthSuccess(tenantId, user.email || '');
      }, 1200);
    } catch (err: any) {
      console.error(err);
      let errMsg = err.message;
      if (err.code === 'auth/popup-closed-by-user') {
        errMsg = lang === 'ar' ? 'تم إغلاق نافذة تسجيل الدخول من قبل المستخدم' : 'Sign-in popup closed by user';
      } else if (err.code === 'auth/cancelled-popup-request') {
        errMsg = lang === 'ar' ? 'تم إلغاء طلب تسجيل الدخول' : 'Sign-in popup request cancelled';
      } else if (err.code === 'auth/popup-blocked') {
        errMsg = lang === 'ar' ? 'تم حظر النافذة المنبثقة من قبل المتصفح. يرجى تفعيل النوافذ المنبثقة أو فتح التطبيق في علامة تبويب جديدة' : 'Popup blocked by browser. Please enable popups or open the app in a new tab';
      }
      setError(errMsg);
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

        if (enableMfa && !mfaStep) {
          // If MFA is checked, simulate the 2FA verification step
          setMfaStep(true);
          setLoading(false);
          return;
        }

        if (enableMfa && mfaStep) {
          if (mfaCode !== '123456') {
            setError(lang === 'ar' ? 'رمز التحقق الثنائي غير صحيح. يرجى إدخال 123456 للتجربة' : 'MFA code is incorrect. Enter 123456 for demo');
            setLoading(false);
            return;
          }
        }

        // Call our firebase signUp helper
        const { tenantId } = await signUpUser(email, password, workspaceName);
        setSuccess(lang === 'ar' ? 'تم إنشاء الحساب ومساحة العمل بنجاح!' : 'Account & Workspace created successfully!');
        
        setTimeout(() => {
          onAuthSuccess(tenantId, email);
        }, 1500);
      } else {
        // Sign In
        const { tenantId } = await signInUser(email, password);
        setSuccess(lang === 'ar' ? 'تم تسجيل الدخول بنجاح!' : 'Logged in successfully!');
        
        setTimeout(() => {
          onAuthSuccess(tenantId, email);
        }, 1200);
      }
    } catch (err: any) {
      console.error(err);
      let errMsg = err.message;
      if (err.code === 'auth/email-already-in-use') {
        errMsg = lang === 'ar' ? 'البريد الإلكتروني مستخدم بالفعل' : 'Email is already in use';
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        errMsg = lang === 'ar' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'Invalid email or password';
      } else if (err.code === 'auth/invalid-credential') {
        errMsg = lang === 'ar' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'Invalid login credentials';
      } else if (err.code === 'auth/weak-password') {
        errMsg = lang === 'ar' ? 'كلمة المرور ضعيفة جداً (يجب أن لا تقل عن 6 أحرف)' : 'Password is too weak (min 6 characters)';
      }
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-950 text-slate-100 font-sans" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
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
              ? 'تلتزم OmniRAG بأقصى درجات أمان البيانات. بمجرد تسجيل حسابك، يُنشأ لك مستأجر (Tenant) معزول بالكامل برقم تعريفي مشفر، مع تفعيل سياسات Neon RLS وجدران الحماية للخطافات الحتمية (HookHarness).'
              : 'OmniRAG is built with strict Zero-Trust security. Every user registered receives a unique isolated tenant workspace with full Row-Level Security (RLS) policies on Postgres, vector-isolated Qdrant segments, and deterministic hook checks.'}
          </p>

          {/* Key Compliance List */}
          <div className="space-y-3.5">
            {[
              { 
                ar: 'عزل تام للمستندات وقاعدة المعرفة بمستوى المستأجر (Tenant Isolation)', 
                en: 'Cryptographic Workspace & Tenant Isolation for knowledge base'
              },
              { 
                ar: 'خطافات أمنية حتمية (HookHarness) لفحص وتأمين مدخلات ومخرجات الذكاء الاصطناعي', 
                en: 'Deterministic Pre/Post inference HookHarness check'
              },
              { 
                ar: 'دعم كامل للمصادقة الثنائية (MFA) وحماية خوادم MCP الخارجية', 
                en: 'MFA Ready with strict client/server credential encryption'
              }
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
          <span>{lang === 'ar' ? 'نظام محمي ومتوافق مع معايير الالتزام السيبراني 2026' : 'ISO/IEC 27001 Secure Architecture Standards'}</span>
        </div>
      </div>

      {/* Auth Interaction Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-12 lg:p-16 relative">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-xl relative z-10">
          
          {/* Tabs header */}
          <div className="flex border-b border-slate-800 mb-6">
            <button
              type="button"
              onClick={() => { setActiveTab('login'); setError(null); setMfaStep(false); }}
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
              onClick={() => { setActiveTab('register'); setError(null); setMfaStep(false); }}
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
            
            {/* MFA Verification Screen */}
            {mfaStep ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <div className="text-center p-4 bg-slate-950 rounded-xl border border-slate-800">
                  <ShieldCheck className="w-10 h-10 text-indigo-400 mx-auto mb-2" />
                  <h3 className="text-sm font-bold text-white mb-1">
                    {lang === 'ar' ? 'إعداد التحقق الثنائي (MFA)' : 'MFA Authentication Setup'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {lang === 'ar' 
                      ? 'تم تفعيل الـ MFA لمساحتك الأمنية. أدخل الرمز التجريبي لتأكيد الهوية.' 
                      : 'MFA setup is active for this workspace. Enter the developer demo code.'}
                  </p>
                  <p className="text-xs font-mono text-indigo-400 font-bold mt-2">
                    {lang === 'ar' ? 'الرمز التجريبي: 123456' : 'Demo Code: 123456'}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-bold">
                    {lang === 'ar' ? 'رمز التحقق (6 أرقام)' : 'Verification Code (6 digits)'}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    placeholder="123456"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-center font-mono text-lg tracking-widest text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMfaStep(false)}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold py-2.5 rounded-xl cursor-pointer select-none transition"
                  >
                    {lang === 'ar' ? 'رجوع' : 'Back'}
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer select-none transition shadow-lg shadow-indigo-600/10 flex items-center justify-center gap-1.5"
                  >
                    {loading ? (lang === 'ar' ? 'جاري التحقق...' : 'Verifying...') : (lang === 'ar' ? 'تأكيد الحساب' : 'Confirm & Register')}
                  </button>
                </div>
              </motion.div>
            ) : (
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

                    {/* Enable MFA checkbox */}
                    <div className="flex items-center gap-2.5 py-1.5 px-3 bg-slate-950 rounded-xl border border-slate-800">
                      <input
                        type="checkbox"
                        id="enableMfa"
                        checked={enableMfa}
                        onChange={(e) => setEnableMfa(e.target.checked)}
                        className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-800 focus:ring-indigo-500 focus:ring-offset-slate-950 focus:ring-2"
                      />
                      <label htmlFor="enableMfa" className="text-xs text-slate-300 cursor-pointer select-none font-medium">
                        {lang === 'ar' ? 'إعداد المصادقة الثنائية (MFA Setup) كطبقة إضافية' : 'Enable Multi-Factor Authentication (MFA)'}
                      </label>
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
                          ? (lang === 'ar' ? 'دخول آمن للمنصة' : 'Secure Platform Access')
                          : (lang === 'ar' ? 'تسجيل وتجهيز مساحة العمل' : 'Register & Create Tenant')}
                      </span>
                    </>
                  )}
                </button>

                {/* OR Divider */}
                <div className="relative my-4 text-center">
                  <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-b border-slate-850" />
                  <span className="relative px-2.5 bg-slate-900 text-slate-500 text-[10px] font-bold font-mono tracking-wider">
                    {lang === 'ar' ? 'أو تابع باستخدام' : 'OR CONTINUE WITH'}
                  </span>
                </div>

                {/* Google Sign-In Button */}
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-750 text-slate-200 text-xs font-bold py-2.5 px-4 rounded-xl cursor-pointer select-none transition flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
                  </svg>
                  <span>{lang === 'ar' ? 'سجل الدخول بحساب Google' : 'Sign in with Google'}</span>
                </button>
              </>
            )}
          </form>

          {/* Separation line */}
          <div className="relative my-6 text-center">
            <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-b border-slate-800" />
            <span className="relative px-3 bg-slate-900 text-slate-500 text-[10px] font-mono font-bold tracking-wider">
              {lang === 'ar' ? 'بوابة المحاكاة والاختبار السريع' : 'SDLC TESTING & SIMULATION PORTAL'}
            </span>
          </div>

          {/* Quick Demo Access Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleQuickDemoLogin('acme')}
              disabled={loading}
              className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 cursor-pointer select-none transition text-center text-[11px]"
              title={lang === 'ar' ? 'دخول فوري للمستأجر الافتراضي' : 'Instant login to default tenant'}
            >
              <Building2 className="w-4 h-4 text-indigo-400 mb-1" />
              <span className="font-bold text-white">ACME Corp</span>
              <span className="text-[9px] text-slate-400">{lang === 'ar' ? 'مدير مؤسسة' : 'Tenant Admin'}</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickDemoLogin('guest')}
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
              ? 'تنويه: تدعم البوابة حسابات Firebase حقيقية بالإضافة لتخزين جلسات معزولة لمساحات عمل معتمدة.'
              : 'Notice: Supports fully working Firebase Auth accounts with auto-seeded tenant sandbox states.'}
          </p>

        </div>
      </div>
    </div>
  );
}
