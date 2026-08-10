import React, { useState } from 'react';
import { 
  FileText, 
  Layout, 
  Code, 
  CheckCircle2, 
  ShieldAlert, 
  Cloud, 
  Activity, 
  Check, 
  Loader2, 
  AlertTriangle, 
  Sparkles,
  ShieldCheck,
  Search
} from 'lucide-react';
import { SDLC_PHASES } from '../data/sdlcData';
import { CodeBlock } from '../components/ui/CodeBlock';
import { CodeAnalysisResult, Language } from '../types';

interface SdlcPageProps {
  lang: Language;
}

const iconMap: Record<string, React.ElementType> = {
  FileText,
  Layout,
  Code,
  CheckCircle2,
  ShieldAlert,
  Cloud,
  Activity,
};

export const SdlcPage: React.FC<SdlcPageProps> = ({ lang }) => {
  const [activeStepId, setActiveStepId] = useState(SDLC_PHASES[0].id);
  const [completedChecklist, setCompletedChecklist] = useState<Record<string, boolean>>({
    'req-1': true,
    'req-2': true,
    'req-3': true,
    'arch-1': true,
    'arch-2': true,
    'arch-3': true,
    'dev-1': true,
    'dev-2': true,
    'dev-3': true,
    'test-1': true,
    'test-2': true,
    'test-3': true,
    'sec-1': true,
    'sec-2': true,
    'sec-3': true,
    'dep-1': true,
    'dep-2': true,
    'dep-3': true,
    'mon-1': true,
    'mon-2': true,
    'mon-3': true,
  });

  // Code Audit Scanner State
  const [codeToAudit, setCodeToAudit] = useState(`'use client';

import { useState } from 'react';

export default function UserCard({ userData }: { userData: any }) {
  const [title, setTitle] = useState(userData.title);
  const secretApiKey = "AIzaSyD-FakeSecretKey-ForTesting";

  return (
    <div className="p-4 border">
      <h2>{title}</h2>
      <button onClick={() => setTitle("Updated")}>Update</button>
    </div>
  );
}`);

  const [auditLoading, setAuditLoading] = useState(false);
  const [auditResult, setAuditResult] = useState<CodeAnalysisResult | null>(null);

  const activePhase = SDLC_PHASES.find((p) => p.id === activeStepId) || SDLC_PHASES[0];

  const handleToggleChecklist = (id: string) => {
    setCompletedChecklist((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleRunAudit = async () => {
    setAuditLoading(true);
    setAuditResult(null);
    try {
      const res = await fetch('/api/sdlc-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeToAudit, focus: 'security-and-types' }),
      });
      const data = await res.json();
      setAuditResult(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setAuditLoading(false);
    }
  };

  return (
    <div className="space-y-10">
      
      {/* Title Header */}
      <div className="p-8 rounded-3xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold border border-emerald-500/20">
          <ShieldCheck className="w-4 h-4" />
          <span>{lang === 'ar' ? 'معايير SDLC ودليل جودة نظام Next.js' : 'Enterprise SDLC Governance Hub'}</span>
        </div>

        <h1 className="text-3xl font-black text-white">
          {lang === 'ar' ? 'دورة حياة تطوير البرمجيات المعيارية (SDLC)' : 'Software Development Life Cycle Governance'}
        </h1>

        <p className="text-slate-300 text-sm max-w-3xl leading-relaxed">
          {lang === 'ar'
            ? 'تطبيق القواعد السبع لدورة التكويد: التخطيط، التصميم المعماري، التطوير النظيف، اختبار الجودة، الأمان وحماية الأسرار، النشر، والرصد المستمر.'
            : 'Adhering to the 7 pillars of SDLC: Requirements, System Architecture, Clean Coding, Quality Verification, OWASP Security, Deployment, and Telemetry.'}
        </p>
      </div>

      {/* SDLC Steps Stepper Navigation */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {SDLC_PHASES.map((phase) => {
          const IconComponent = iconMap[phase.iconName] || Code;
          const isSelected = phase.id === activeStepId;
          return (
            <button
              key={phase.id}
              onClick={() => setActiveStepId(phase.id)}
              className={`p-3.5 rounded-2xl border text-right transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                isSelected
                  ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-600/20'
                  : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800/80'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold opacity-80 font-mono">STEP 0{phase.stepNumber}</span>
                <IconComponent className="w-4 h-4" />
              </div>
              <div className="text-xs font-bold leading-tight line-clamp-2">
                {lang === 'ar' ? phase.titleAr.split(' ')[0] : phase.titleEn.split(' ')[1]}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Phase Detail Card */}
      <div className="p-8 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="text-xs font-mono text-cyan-400 mb-1">
              SDLC PHASE {activePhase.stepNumber} / 07
            </div>
            <h2 className="text-2xl font-bold text-white">
              {lang === 'ar' ? activePhase.titleAr : activePhase.titleEn}
            </h2>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">
            {lang === 'ar' ? 'مرحلة حيوية' : 'Critical Milestone'}
          </span>
        </div>

        <p className="text-slate-300 text-sm leading-relaxed">
          {lang === 'ar' ? activePhase.descriptionAr : activePhase.descriptionEn}
        </p>

        {/* Phase Checklist */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{lang === 'ar' ? 'قائمة الفحص والمطابقة لهذه المرحلة:' : 'Phase Compliance Checklist:'}</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {activePhase.checklist.map((item: any) => {
              const isChecked = !!completedChecklist[item.id];
              return (
                <div
                  key={item.id}
                  onClick={() => handleToggleChecklist(item.id)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                    isChecked
                      ? 'bg-emerald-950/20 border-emerald-500/40 text-slate-200'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
                      isChecked ? 'bg-emerald-500 text-slate-950 font-bold' : 'border border-slate-700'
                    }`}
                  >
                    {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                  <div className="text-xs font-medium space-y-1">
                    <div>{lang === 'ar' ? item.labelAr : item.labelEn}</div>
                    <span className="inline-block text-[9px] font-mono px-1.5 py-0.2 bg-slate-800 rounded text-slate-300">
                      {item.importance}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Best Practices */}
        <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800/80 space-y-3">
          <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            {lang === 'ar' ? 'أفضل الممارسات الموصى بها في الكود:' : 'Architectural Best Practices:'}
          </h4>
          <ul className="space-y-2 text-xs text-slate-300 list-disc list-inside leading-relaxed">
            {(lang === 'ar' ? activePhase.bestPracticesAr : activePhase.bestPracticesEn).map((bp: string, i: number) => (
              <li key={i}>{bp}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Interactive Automated SDLC Code Auditor Section */}
      <section className="p-8 rounded-3xl bg-slate-900 border border-indigo-500/30 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-indigo-600 text-white">
            <Search className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">
              {lang === 'ar' ? 'مُدقق الشفرة المصدرية المباشر (SDLC Automated Auditor)' : 'Automated SDLC Code Audit Scanner'}
            </h2>
            <p className="text-xs text-slate-400">
              {lang === 'ar'
                ? 'قم بفحص أي كود للتأكد من خلوه من الثغرات، تسريبات الأسرار، وأخطاء أنواع TypeScript.'
                : 'Audit TypeScript code for OWASP security flaws, type leaks, and Next.js App Router compliance.'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="dir-ltr text-left">
            <textarea
              rows={7}
              value={codeToAudit}
              onChange={(e) => setCodeToAudit(e.target.value)}
              className="w-full p-4 rounded-2xl bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <button
            onClick={handleRunAudit}
            disabled={auditLoading}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-indigo-600/20 cursor-pointer disabled:opacity-50"
          >
            {auditLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{lang === 'ar' ? 'جاري فحص الكود وفق معايير SDLC...' : 'Auditing Code...'}</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>{lang === 'ar' ? 'بدء الفحص المعياري للكود' : 'Run SDLC Audit Scan'}</span>
              </>
            )}
          </button>

          {/* Audit Results View */}
          {auditResult && (
            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 space-y-5 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div className="space-y-1">
                  <div className="text-xs text-slate-400">
                    {lang === 'ar' ? 'نتيجة تقييم جودة الكود' : 'Code Health Score'}
                  </div>
                  <div className="text-3xl font-black text-emerald-400 font-mono">
                    {auditResult.score} / 100
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    Rating: {auditResult.securityRating}
                  </span>
                </div>
              </div>

              <p className="text-sm text-slate-200">
                {lang === 'ar' ? auditResult.summaryAr : auditResult.summaryEn}
              </p>

              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {lang === 'ar' ? 'التوصيات والإصلاحات المقترحة:' : 'Security & Architecture Fixes:'}
                </h4>

                {auditResult.recommendations.map((rec: any, idx: number) => (
                  <div key={idx} className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                      <AlertTriangle className="w-4 h-4" />
                      <span>{rec.type.toUpperCase()} RECOMMENDATION</span>
                    </div>
                    <p className="text-xs text-slate-300">
                      {lang === 'ar' ? rec.messageAr : rec.messageEn}
                    </p>
                    {rec.codeFix && (
                      <CodeBlock code={rec.codeFix} language="typescript" title="Suggested Fix" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

    </div>
  );
};
