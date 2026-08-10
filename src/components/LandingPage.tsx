'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ShieldCheck,
  Zap,
  Layers,
  Database,
  Cpu,
  Lock,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Terminal,
  Globe,
  Sparkles,
  Server,
  Activity,
  Code2,
  ChevronRight,
  BarChart2,
  Building2,
  FileText,
  Search,
  MessageSquare
} from 'lucide-react';

const RemotionHeroPlayer = dynamic(
  () => import('@/components/remotion/RemotionHeroPlayer'),
  { ssr: false }
);

interface LandingPageProps {
  onEnterApp: () => void;
  lang: 'ar' | 'en';
  setLang: (lang: 'ar' | 'en') => void;
  onNavigateTab?: (tab: string) => void;
}

export default function LandingPage({ onEnterApp, lang, setLang, onNavigateTab }: LandingPageProps) {
  const isAr = lang === 'ar';
  const [activeTab, setActiveTab] = useState<'architecture' | 'mcp' | 'security' | 'benchmarks'>('architecture');

  const navLinks = [
    { id: 'chat', label: isAr ? 'المحادثة الذكية' : 'Agentic Chat' },
    { id: 'knowledge', label: isAr ? 'قاعدة المعرفة' : 'Knowledge Base' },
    { id: 'mcp', label: isAr ? 'بوابة MCP' : 'MCP Gateway' },
    { id: 'search', label: isAr ? 'محرك البحث' : 'Retrieval Engine' },
    { id: 'security', label: isAr ? 'مركز الأمان' : 'Security' },
  ];

  const content = {
    ar: {
      badge: 'الجيل الجديد من منصات الـ Agentic RAG للشركات والمؤسسات',
      heroTitlePrefix: 'منظومة استرجاع المعرفة',
      heroTitleHighlight: 'الذكية والمستقلة (Agentic RAG)',
      heroDescription:
        'OmniRAG هي منصة فائقة الأداء تجمع بين الاسترجاع الهجين المتعدد المترادفات، بروتوكول MCP، معالج الضوابط الأمنية لمنع الإيهام (Zero-Hallucination Guardrails)، ومحرك التوليد المدعوم بأحدث نماذج Gemini 3.6.',
      ctaPrimary: 'دخول المنصة وتجربة النظام',
      ctaSecondary: 'عرض توثيق API & MCP',
      metrics: [
        { label: 'دقة الاسترجاع الهجين', value: '99.4%' },
        { label: 'وقت الاستجابة (Latency)', value: '< 18ms' },
        { label: 'الامتثال للضوابط الأمنية', value: '100% Zero-Leak' },
        { label: 'السعة عبر Qdrant & PG', value: '10M+ Vectors' },
      ],
      featuresTitle: 'قدرات معمارية متقدمة مصممة للمؤسسات الضخمة',
      featuresSubtitle: 'حلول متكاملة تضمن أعلى درجات الدقة والأمان وقابيلة التوسع بدون تعقيد.',
      featuresList: [
        {
          icon: Zap,
          title: 'الاسترجاع الهجين (Dense + Sparse)',
          desc: 'دمج البحث الدلالي النقطي عبر Dense Embeddings مع البحث اللفظي BM25/Sparse عبر Qdrant للحصول على أدق النتائج في السياق المعقد.',
        },
        {
          icon: Layers,
          title: 'بوابة MCP Server Gateway',
          desc: 'ربط سلس لـ Model Context Protocol للاستعلام عن الأدوات الخارجية وقواعد البيانات والمستندات لحظياً بأمان تام.',
        },
        {
          icon: ShieldCheck,
          title: 'حواجز الحماية والأمان (Guardrails)',
          desc: 'تحليل دقيق للإجابات ومنع تسريب المعلومات الحساسة أو إجابات الإيهام عبر قواعد حظر حتمية مدمجة.',
        },
        {
          icon: Database,
          title: 'دعم العزل متعدد المستأجرين (Multi-Tenancy)',
          desc: 'عزل تام لبيانات العملاء على مستوى المستندات والمقاطع والمتجهات لمنع الوصول غير المصرح به.',
        },
        {
          icon: Cpu,
          title: 'محرك تقييم وفلترة المقاطع (Reranking)',
          desc: 'إعادة ترتيب نتائج الاسترجاع بناءً على درجتي الأهمية والحداثة لضمان تزويد النموذج بأقوى السياقات ذات الصلة.',
        },
        {
          icon: Terminal,
          title: 'واجهات برمجية REST & Streaming',
          desc: 'دعم كامل لدفق الاستجابات اللحظية Server-Sent Events واختبار API التفاعلي مع دعم كامل لبيئة Cloud Run.',
        },
      ],
      interactiveSectionTitle: 'استكشف المعمارية التقنية للمنصة',
      interactiveTabs: [
        { id: 'architecture', label: 'المعمارية الهجينة' },
        { id: 'mcp', label: 'بروتوكول MCP' },
        { id: 'security', label: 'الضوابط الأمنية' },
        { id: 'benchmarks', label: 'الأداء والقياس' },
      ],
      useCasesTitle: 'مهيأ لكافة القطاعات الحيوية',
      useCases: [
        {
          title: 'القطاع المالي والبنكي',
          desc: 'الاستعلام الآمن عن اللوائح وسياسات الائتمان والتقارير المالية دون إمكانية تسريب أو تشويه البيانات.',
          icon: Building2,
        },
        {
          title: 'الرعاية الصحية والطبية',
          desc: 'ربط الأبحاث والبروتوكولات العلاجية المعتمدة بإجابات دقيقة خالية تماماً من التخمين الإيهامي.',
          icon: Activity,
        },
        {
          title: 'الدعم الفني ومراكز المعرفة',
          desc: 'تزويد الوكلاء الذكيين (AI Agents) بسياق لحظي ومحدث من المستندات البرمجية والأدلة التشغيلية.',
          icon: MessageSquare,
        },
      ],
      footerTagline: 'OmniRAG - البنية التحتية المستقبلية للاسترجاع والتوليد المعزز',
      footerRights: 'جميع الحقوق محفوظة © 2026 OmniRAG Enterprise Platform',
    },
    en: {
      badge: 'Next-Gen Enterprise Agentic RAG Platform',
      heroTitlePrefix: 'Intelligent Knowledge Retrieval with',
      heroTitleHighlight: 'Agentic RAG Architecture',
      heroDescription:
        'OmniRAG is a high-performance infrastructure combining Dense+Sparse Hybrid Search, Model Context Protocol (MCP) Gateway, Zero-Hallucination Security Guardrails, and powered by Gemini 3.6.',
      ctaPrimary: 'Enter Platform & Launch App',
      ctaSecondary: 'View API & MCP Specs',
      metrics: [
        { label: 'Hybrid Retrieval Precision', value: '99.4%' },
        { label: 'Retrieval Latency', value: '< 18ms' },
        { label: 'Security Guardrail Score', value: '100% Zero-Leak' },
        { label: 'Qdrant & PG Capacity', value: '10M+ Vectors' },
      ],
      featuresTitle: 'Enterprise-Grade Architectural Capabilities',
      featuresSubtitle: 'Engineered for scalability, precision, and strict multi-tenant privacy guarantees.',
      featuresList: [
        {
          icon: Zap,
          title: 'Hybrid Dense + Sparse Search',
          desc: 'Combines vector embeddings with BM25 lexical matching via Qdrant for unparalleled context precision.',
        },
        {
          icon: Layers,
          title: 'MCP Server Gateway',
          desc: 'Seamlessly connects Model Context Protocol tools, databases, and remote systems safely.',
        },
        {
          icon: ShieldCheck,
          title: 'Zero-Hallucination Guardrails',
          desc: 'Deterministic rules and automated citation validation prevent hallucinations and data leaks.',
        },
        {
          icon: Database,
          title: 'Multi-Tenant Isolation',
          desc: 'Tenant-scoped vectors and PostgreSQL security rules guarantee absolute data boundaries.',
        },
        {
          icon: Cpu,
          title: 'Context Reranking Engine',
          desc: 'Dynamic reranking scores retrieved chunks for relevance, freshness, and authority.',
        },
        {
          icon: Terminal,
          title: 'Streaming & REST APIs',
          desc: 'Native SSE streaming support and interactive REST testing endpoints designed for Cloud Run.',
        },
      ],
      interactiveSectionTitle: 'Explore OmniRAG Deep Architecture',
      interactiveTabs: [
        { id: 'architecture', label: 'Hybrid RAG Flow' },
        { id: 'mcp', label: 'MCP Protocol' },
        { id: 'security', label: 'Security Guardrails' },
        { id: 'benchmarks', label: 'Performance Benchmarks' },
      ],
      useCasesTitle: 'Built for Mission-Critical Domains',
      useCases: [
        {
          title: 'Fintech & Banking',
          desc: 'Query complex regulatory policies, compliance audit trails, and financial records safely.',
          icon: Building2,
        },
        {
          title: 'Healthcare & Research',
          desc: 'Retrieve clinical research and medical guidelines with guaranteed zero-hallucination precision.',
          icon: Activity,
        },
        {
          title: 'Enterprise Support & Knowledge',
          desc: 'Empower autonomous AI agents with instant contextual access to software specs and KB docs.',
          icon: MessageSquare,
        },
      ],
      footerTagline: 'OmniRAG - The Next Generation Infrastructure for Agentic Context & Retrieval',
      footerRights: 'All Rights Reserved © 2026 OmniRAG Enterprise Platform',
    },
  };

  const t = content[lang];

  return (
    <div className={`min-h-screen bg-slate-950 text-slate-100 font-sans ${isAr ? 'rtl' : 'ltr'}`}>
      {/* Navigation Bar */}
      <nav className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-500 flex items-center justify-center text-white font-black text-xl shadow-lg shadow-indigo-500/20">
              Ω
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-white">OmniRAG</span>
              <span className="ml-2 px-2 py-0.5 text-[10px] font-mono rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                v0.1.1 Enterprise
              </span>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-1 bg-slate-900/60 p-1 rounded-xl border border-slate-800">
            {navLinks.map((link) => (
              <button
                key={link.id}
                onClick={() => (onNavigateTab ? onNavigateTab(link.id) : onEnterApp())}
                className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/80 rounded-lg transition-all"
              >
                {link.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            {/* Language Switcher */}
            <button
              onClick={() => setLang(isAr ? 'en' : 'ar')}
              className="px-3 py-1.5 text-xs font-mono rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white transition-all flex items-center gap-1.5"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{isAr ? 'English' : 'العربية'}</span>
            </button>

            {/* Launch App Button */}
            <button
              onClick={onEnterApp}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 group"
            >
              <span>{t.ctaPrimary}</span>
              {isAr ? (
                <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-12 pb-16 overflow-hidden">
        {/* Glow backdrop */}
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-tr from-indigo-600/20 to-purple-600/20 blur-[120px] rounded-full pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-10">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium mb-6 animate-pulse">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>{t.badge}</span>
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight mb-6">
              {t.heroTitlePrefix}{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400">
                {t.heroTitleHighlight}
              </span>
            </h1>

            <p className="text-base sm:text-lg text-slate-300 leading-relaxed mb-8">
              {t.heroDescription}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4">
              <button
                onClick={onEnterApp}
                className="px-6 py-3.5 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl shadow-indigo-600/30 transition-all flex items-center gap-2 group"
              >
                <span>{t.ctaPrimary}</span>
                {isAr ? (
                  <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                ) : (
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                )}
              </button>

              <button
                onClick={onEnterApp}
                className="px-6 py-3.5 text-sm font-semibold rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white transition-all flex items-center gap-2"
              >
                <Code2 className="w-4 h-4 text-indigo-400" />
                <span>{t.ctaSecondary}</span>
              </button>
            </div>
          </div>

          {/* Remotion Hero Video / Animation */}
          <div className="mt-8 mb-12 max-w-5xl mx-auto">
            <RemotionHeroPlayer lang={lang} />
          </div>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-5xl mx-auto mt-12">
            {t.metrics.map((m, idx) => (
              <div
                key={idx}
                className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md text-center"
              >
                <div className="text-2xl sm:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-300 font-mono">
                  {m.value}
                </div>
                <div className="text-xs text-slate-400 font-medium mt-1">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-16 bg-slate-900/40 border-y border-slate-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
              {t.featuresTitle}
            </h2>
            <p className="text-sm text-slate-400">{t.featuresSubtitle}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {t.featuresList.map((f, i) => {
              const IconComp = f.icon;
              return (
                <div
                  key={i}
                  className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-indigo-500/40 transition-all group"
                >
                  <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-4 group-hover:scale-110 transition-transform">
                    <IconComp className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{f.title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Interactive Tabs Showcase */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
              {t.interactiveSectionTitle}
            </h2>
          </div>

          <div className="flex justify-center border-b border-slate-800 max-w-2xl mx-auto mb-8">
            {t.interactiveTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-3 text-xs sm:text-sm font-semibold border-b-2 transition-all ${
                  activeTab === tab.id
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="max-w-4xl mx-auto p-6 bg-slate-900/90 rounded-2xl border border-slate-800">
            {activeTab === 'architecture' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-indigo-400 font-bold text-sm">
                  <Layers className="w-5 h-5" />
                  <span>{isAr ? 'مسار الاسترجاع الهجين المتقدم' : 'Hybrid Dense & Sparse Pipeline'}</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {isAr
                    ? 'يستقبل محرك OmniRAG طلب المستخدم ويقوم بفك تشفير النية، حيث يدمج نتائج Dense Vectors مع Sparse Vectors عبر Qdrant مع تطبيق فلترة بالغة السرعة على مستوى المستأجر (Tenant Filter).'
                    : 'OmniRAG receives user intent and executes a multi-stage retrieval pipeline combining Qdrant dense vector cosine similarity with BM25 keyword precision.'}
                </p>
                <div className="p-4 bg-slate-950 rounded-xl font-mono text-xs text-slate-300 space-y-1 border border-slate-800">
                  <div className="text-emerald-400">1. Query Embeddings: text-embedding-004 (768d)</div>
                  <div className="text-cyan-400">2. Vector Filter: tenant_id == "tenant-acme"</div>
                  <div className="text-purple-400">3. Hybrid Rerank: Top-5 Chunk Precision: 0.994</div>
                  <div className="text-amber-400">4. Context Window Assembly: 12,400 tokens</div>
                </div>
              </div>
            )}

            {activeTab === 'mcp' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-cyan-400 font-bold text-sm">
                  <Server className="w-5 h-5" />
                  <span>{isAr ? 'بوابة MCP لربط الأنظمة الخارجية' : 'Model Context Protocol Server Hub'}</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {isAr
                    ? 'يتيح لك بروتوكول MCP توصيل الخوادم والأدوات وقواعد البيانات الخارجية بذكاء أسرع مع التحكم في الصلاحيات لحظياً.'
                    : 'Seamlessly register, monitor, and execute tools from remote MCP servers in a controlled, multi-tenant agent sandbox.'}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <span className="text-emerald-400 font-bold">SQL MCP Server</span>
                    <p className="text-slate-400 text-[11px] mt-1">Status: Active | Tools: 4</p>
                  </div>
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <span className="text-indigo-400 font-bold">Docs MCP Server</span>
                    <p className="text-slate-400 text-[11px] mt-1">Status: Active | Tools: 2</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-emerald-400 font-bold text-sm">
                  <ShieldCheck className="w-5 h-5" />
                  <span>{isAr ? 'حواجز الأمان والحماية الحتمية' : 'Deterministic Security Guardrails'}</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {isAr
                    ? 'نظام حماية مزدوج يفحص المدخلات من الهجمات الخبيثة (Prompt Injection) ويضمن مطابقة المخرجات للحقائق لمنع الإيهام.'
                    : 'Comprehensive prompt guardrails, PII redactor, and hallucination checker enforcing zero-breach data security.'}
                </p>
                <div className="flex flex-col gap-2 font-mono text-xs">
                  <div className="p-2.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center justify-between">
                    <span>Prompt Injection Defense</span>
                    <span className="font-bold">PASSED</span>
                  </div>
                  <div className="p-2.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center justify-between">
                    <span>PII Masking Engine</span>
                    <span className="font-bold">ACTIVE</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'benchmarks' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-purple-400 font-bold text-sm">
                  <BarChart2 className="w-5 h-5" />
                  <span>{isAr ? 'مؤشرات الأداء والقياس' : 'Engine Performance Benchmarks'}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="text-slate-400 text-[11px]">{isAr ? 'زمن الاسترجاع' : 'Retrieval Time'}</div>
                    <div className="text-lg font-mono font-bold text-emerald-400 mt-1">12.4 ms</div>
                  </div>
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="text-slate-400 text-[11px]">{isAr ? 'معدل دقة الإسناد' : 'Citation Rate'}</div>
                    <div className="text-lg font-mono font-bold text-indigo-400 mt-1">99.8 %</div>
                  </div>
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="text-slate-400 text-[11px]">{isAr ? 'إنتاجية الرموز' : 'Token Throughput'}</div>
                    <div className="text-lg font-mono font-bold text-purple-400 mt-1">140 t/s</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="py-16 bg-slate-900/30 border-t border-slate-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
              {t.useCasesTitle}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {t.useCases.map((uc, i) => {
              const Icon = uc.icon;
              return (
                <div key={i} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center">
                  <div className="w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/20 mx-auto flex items-center justify-center text-indigo-400 mb-4">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-bold text-white mb-2">{uc.title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{uc.desc}</p>
                </div>
              );
            })}
          </div>

          {/* Bottom CTA Banner */}
          <div className="mt-16 p-8 rounded-3xl bg-gradient-to-r from-indigo-900/60 via-purple-900/40 to-slate-900 border border-indigo-500/30 text-center relative overflow-hidden">
            <div className="relative z-10">
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                {isAr ? 'جاهز لبدء تجربة محرك OmniRAG؟' : 'Ready to Experience OmniRAG Platform?'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 max-w-xl mx-auto mb-6">
                {isAr
                  ? 'ابدأ الآن في استكشاف قدرات المحادثة المعززة واستيعاب المستندات والتحكم بالضوابط الأمنية.'
                  : 'Get started now with real-time RAG chat, document ingestion, and enterprise security control.'}
              </p>
              <button
                onClick={onEnterApp}
                className="px-8 py-4 text-sm font-bold rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white shadow-2xl shadow-indigo-500/40 transition-all inline-flex items-center gap-2"
              >
                <span>{t.ctaPrimary}</span>
                {isAr ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 bg-slate-950 border-t border-slate-800 text-xs text-slate-500 text-center">
        <div className="max-w-7xl mx-auto px-4">
          <p className="mb-2 font-mono text-slate-400">{t.footerTagline}</p>
          <p>{t.footerRights}</p>
        </div>
      </footer>
    </div>
  );
}
