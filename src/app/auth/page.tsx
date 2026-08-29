'use client';

import AuthScreen from '@/components/AuthScreen';
import { useRouter } from 'next/navigation';
import { useEffect, Suspense } from 'react';
import { useUserPreferences } from '@/lib/preferences/userPreferences';

/**
 * /auth — the login/register screen as a real route. On success the client
 * redirects into the workspace (default /chat). Supports the legacy
 * ?invite=TOKEN deep-link through AuthScreen's existing logic.
 */
function AuthPageInner() {
  const router = useRouter();
  const { preferences, update } = useUserPreferences();
  const lang = preferences.language;
  const setLang = (next: 'ar' | 'en') => update({ language: next });

  // Already signed in? Straight to the workspace.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem('omnirag-auth') !== 'true') return;
        const { getSession } = await import('@/lib/auth/authClient');
        const session = await getSession();
        if (!cancelled && session.authenticated) router.replace('/chat');
      } catch {
        /* not signed in — stay here */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <AuthScreen
      lang={lang}
      onLangChange={setLang}
      onAuthSuccess={() => router.replace('/chat')}
      onBackToLanding={() => router.push('/')}
    />
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthPageInner />
    </Suspense>
  );
}
