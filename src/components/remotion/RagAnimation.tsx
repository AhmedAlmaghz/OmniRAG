'use client';

import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { t } from '@/lib/i18n';

export const RagAnimation: React.FC<{ lang?: 'ar' | 'en' }> = ({ lang = 'ar' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animations timing
  const docScale = spring({ frame, fps, config: { damping: 12 } });
  const docTranslateX = interpolate(frame, [0, 40, 100], [-100, 0, 0], { extrapolateRight: 'clamp' });

  const chunkOpacity = interpolate(frame, [30, 50], [0, 1], { extrapolateRight: 'clamp' });
  const vectorProgress = interpolate(frame, [50, 90], [0, 100], { extrapolateRight: 'clamp' });

  const searchPulse = interpolate(frame % 30, [0, 15, 30], [1, 1.15, 1]);
  const shieldGlow = interpolate(frame, [100, 130], [0, 1], { extrapolateRight: 'clamp' });
  const textOutputProgress = Math.floor(
    interpolate(frame, [120, 180], [0, lang === 'ar' ? 38 : 42], { extrapolateRight: 'clamp' }),
  );

  const currentText = t(lang, 'ragAnim.sampleAnswer').slice(0, textOutputProgress);

  return (
    <div className="w-full h-full bg-slate-950 text-white font-sans p-8 md:p-12 flex flex-col justify-between relative overflow-hidden">
      {/* Background Animated Grid & Radial Glow */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:3rem_3rem] opacity-20" />
      <div
        className="absolute -top-20 -right-20 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl"
        style={{ transform: `scale(${searchPulse})` }}
      />
      <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-emerald-500/15 rounded-full blur-3xl" />

      {/* Header Banner */}
      <div className="relative z-10 flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse" />
          <span className="text-xs font-mono tracking-widest text-indigo-400 uppercase">
            {t(lang, 'ragAnim.pipelineTitle')}
          </span>
        </div>
        <div className="px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-[11px] font-mono text-slate-300">
          FPS: 30 | Frame: {frame}
        </div>
      </div>

      {/* Main Flow Stage */}
      <div className="relative z-10 grid grid-cols-4 gap-3 my-auto items-center">
        {/* Step 1: Document Upload */}
        <div
          className="p-3 bg-slate-900/90 border border-slate-800 rounded-xl flex flex-col items-center text-center shadow-lg"
          style={{
            transform: `scale(${docScale}) translateX(${docTranslateX}px)`,
            opacity: interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' }),
          }}
        >
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold mb-2">
            📄
          </div>
          <span className="text-xs font-semibold text-slate-200">{t(lang, 'ragAnim.stepIngestion')}</span>
          <span className="text-[10px] text-slate-400 mt-1 font-mono">PDF / SQL / Web</span>
        </div>

        {/* Step 2: Chunking & Dense Embeddings */}
        <div
          className="p-3 bg-slate-900/90 border border-indigo-500/30 rounded-xl flex flex-col items-center text-center shadow-lg relative"
          style={{ opacity: chunkOpacity }}
        >
          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-bold mb-2">
            🧬
          </div>
          <span className="text-xs font-semibold text-slate-200">{t(lang, 'ragAnim.stepEmbeddings')}</span>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div className="bg-cyan-400 h-full transition-all duration-75" style={{ width: `${vectorProgress}%` }} />
          </div>
        </div>

        {/* Step 3: Hybrid Retrieval & MCP Gateway */}
        <div
          className="p-3 bg-slate-900/90 border border-purple-500/30 rounded-xl flex flex-col items-center text-center shadow-lg"
          style={{
            opacity: interpolate(frame, [70, 90], [0, 1], { extrapolateRight: 'clamp' }),
            transform: `scale(${interpolate(frame, [80, 100], [0.95, 1], { extrapolateRight: 'clamp' })})`,
          }}
        >
          <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 font-bold mb-2">
            ⚡
          </div>
          <span className="text-xs font-semibold text-slate-200">{t(lang, 'ragAnim.stepRetrieval')}</span>
          <span className="text-[10px] text-purple-300 mt-1 font-mono">Qdrant + BM25</span>
        </div>

        {/* Step 4: Security Guardrails & Agent Response */}
        <div
          className="p-3 bg-slate-900/90 border border-emerald-500/40 rounded-xl flex flex-col items-center text-center shadow-lg relative"
          style={{
            opacity: interpolate(frame, [100, 120], [0, 1], { extrapolateRight: 'clamp' }),
            boxShadow: `0 0 20px rgba(16, 185, 129, ${shieldGlow * 0.2})`,
          }}
        >
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold mb-2">
            🛡️
          </div>
          <span className="text-xs font-semibold text-slate-200">{t(lang, 'ragAnim.stepGuardrails')}</span>
          <span className="text-[10px] text-emerald-400 mt-1 font-mono">Zero Hallucination</span>
        </div>
      </div>

      {/* Bottom Output Display */}
      <div className="relative z-10 bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 backdrop-blur-md min-h-[70px]">
        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1 font-mono">
          <span>{t(lang, 'ragAnim.modelOutputLabel')}</span>
          <span className="text-emerald-400">{t(lang, 'ragAnim.confidence')}</span>
        </div>
        <p className="text-xs text-slate-200 font-sans leading-relaxed min-h-[28px]">
          {currentText}
          <span className="inline-block w-1.5 h-3 bg-indigo-400 ml-1 animate-ping" />
        </p>
      </div>
    </div>
  );
};
