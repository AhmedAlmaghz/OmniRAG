'use client';

/**
 * `/` — the public landing page.
 *
 * Legacy `?tab=` links (the pre-routing SPA persisted its tab in the query
 * string) are permanently redirected to the equivalent real route so old
 * bookmarks and shared links keep working.
 */

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import LandingPage from '@/components/LandingPage';
import { useUserPreferences } from '@/lib/preferences/userPreferences';

const LEGACY_TAB_ROUTES: Record<string, string> = {
  chat: '/chat',
  knowledge: '/knowledge',
  mcp: '/mcp',
  analytics: '/analytics',
  settings: '/settings',
};

function LandingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { preferences, update } = useUserPreferences();
  const lang = preferences.language;
  const setLang = (next: 'ar' | 'en') => update({ language: next });

  // Back-compat: /?tab=chat → /chat (permanent, client-side redirect keeps the
  // landing page statically renderable for everyone else).
  const legacyTab = searchParams.get('tab') || '';
  useEffect(() => {
    const target = LEGACY_TAB_ROUTES[legacyTab];
    if (target) router.replace(target);
  }, [legacyTab, router]);

  return (
    <LandingPage
      lang={lang}
      setLang={setLang}
      onEnterApp={() => router.push('/chat')}
      onNavigateTab={(tab) => router.push(tab === 'landing' ? '/' : `/${tab}`)}
    />
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <LandingInner />
    </Suspense>
  );
}
