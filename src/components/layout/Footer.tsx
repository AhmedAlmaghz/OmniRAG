import React from 'react';
import { ShieldCheck, Cpu, Code2, Heart, Sparkles, CheckCircle2 } from 'lucide-react';
import { Language } from '../../types';

interface FooterProps {
  lang: Language;
}

export const Footer: React.FC<FooterProps> = ({ lang }) => {
  return (
    <footer className="bg-slate-950 border-t border-slate-800/80 mt-16 text-slate-400 text-xs">
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-xs">
                N
              </div>
              <span className="font-bold text-slate-200 text-sm">Next.js v16 App Router</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-xs">
              {lang === 'ar'
                ? 'تطبيق متكامل مبني بدقة إحترافية عالية وبأحدث أساليب تطوير البرمجيات المعيارية (SDLC) بإستخدام Next.js v16 و Tailwind CSS و TypeScript.'
                : 'Enterprise reference implementation built according to SDLC best practices using Next.js v16, Tailwind CSS v4, and TypeScript.'}
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-slate-200 mb-3 text-xs uppercase tracking-wider">
              {lang === 'ar' ? 'التقنيات المستخدمة' : 'Tech Stack'}
            </h4>
            <ul className="space-y-2 text-slate-400">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Next.js v16 App Router & RSC</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
                <span>React 19 & React Compiler</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-violet-400" />
                <span>Tailwind CSS v4 & Motion</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>TypeScript Strict Type Safety</span>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-slate-200 mb-3 text-xs uppercase tracking-wider">
              {lang === 'ar' ? 'معايير SDLC بالحوكمة' : 'SDLC Governance'}
            </h4>
            <ul className="space-y-2 text-slate-400">
              <li className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>OWASP Security & Secret Protection</span>
              </li>
              <li className="flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-amber-400" />
                <span>Zero Build Errors & Strict Types</span>
              </li>
              <li className="flex items-center gap-2">
                <Code2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Server-Side GenAI Lazy Init</span>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-slate-200 mb-3 text-xs uppercase tracking-wider">
              {lang === 'ar' ? 'بيئة التشغيل' : 'Runtime Container'}
            </h4>
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5 font-mono text-[11px] text-slate-300">
              <div>Host: 0.0.0.0</div>
              <div>Port: 3000 (Cloud Run)</div>
              <div>Node.js ESM + ESBuild</div>
              <div className="text-emerald-400 font-semibold">● Production Ready</div>
            </div>
          </div>

        </div>

        <div className="pt-6 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-4 text-slate-400 text-xs">
          <div>
            © {new Date().getFullYear()} Next.js v16 App Router & SDLC Reference Standard.
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Built with Google AI Studio & Gemini GenAI</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
