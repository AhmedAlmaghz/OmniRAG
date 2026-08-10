'use client';

import React, { useState, useEffect } from 'react';
import { Player } from '@remotion/player';
import { RagAnimation } from './RagAnimation';

interface RemotionHeroPlayerProps {
  lang?: 'ar' | 'en';
}

export const RemotionHeroPlayer: React.FC<RemotionHeroPlayerProps> = ({ lang = 'ar' }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-full h-[360px] md:h-[420px] bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-center text-slate-500 text-sm font-mono animate-pulse">
        {lang === 'ar' ? 'جاري تحميل العرض التفاعلي...' : 'Loading Interactive Remotion Animation...'}
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl overflow-hidden border border-slate-800/80 shadow-2xl bg-slate-950 p-2 md:p-3 relative group">
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-700/60 shadow-lg">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
        <span className="text-[11px] font-mono font-medium text-slate-300">
          Remotion 4.0 Live Rendering Engine
        </span>
      </div>

      <div className="w-full h-[340px] sm:h-[380px] md:h-[420px] relative rounded-xl overflow-hidden">
        <Player
          component={RagAnimation}
          inputProps={{ lang }}
          durationInFrames={210}
          compositionWidth={1200}
          compositionHeight={700}
          fps={30}
          controls={true}
          loop={true}
          autoPlay={true}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            borderRadius: '0.75rem',
          }}
        />
      </div>
    </div>
  );
};

export default RemotionHeroPlayer;
