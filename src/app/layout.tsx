export const dynamic = 'force-dynamic';
import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic, Cairo, Tajawal, Amiri } from 'next/font/google';
import 'katex/dist/katex.min.css';
import './globals.css';
import { headers } from 'next/headers';

// Self-hosted Arabic fonts (next/font): no render-blocking Google Fonts
// @import, files are bundled + preloaded at build time with display=swap.
const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans-arabic',
  display: 'swap',
});
const cairo = Cairo({
  subsets: ['arabic'],
  weight: ['400', '600', '700'],
  variable: '--font-cairo-next',
  display: 'swap',
});
const tajawal = Tajawal({
  subsets: ['arabic'],
  weight: ['400', '500', '700'],
  variable: '--font-tajawal-next',
  display: 'swap',
});
const amiri = Amiri({
  subsets: ['arabic'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-amiri-next',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'OmniRAG - Enterprise Agentic RAG Platform',
  description:
    'Enterprise Agentic RAG Platform with Hybrid Retrieval, MCP Gateway, Multi-Tenancy, and Deterministic Security Guardrails',
  icons: {
    // SVG favicon (≈1KB) replaces a 1MB JPEG/ICO pair that slowed first-byte
    // render for every visitor. The stacked-layers glyph matches MainApp's
    // <Layers> brand mark.
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const forwardedHost = headersList.get('x-forwarded-host');
  const host = forwardedHost || headersList.get('host') || 'localhost:3000';
  const proto = headersList.get('x-forwarded-proto') || 'https';
  const firstProto = proto.split(',')[0].trim();
  const isSecure = firstProto === 'https' || host.includes('run.app');

  const origin = `${isSecure ? 'https' : 'http'}://${host}`;

  // Language + theme from the preference cookies (written by the client
  // store): <html lang/dir> is then correct on the FIRST byte — English users
  // get an English-declared document (screen readers, font shaping) and the
  // dark class ships in the initial HTML (no dark-mode flash).
  const cookieHeader = headersList.get('cookie') || '';
  const cookieValue = (name: string): string => {
    const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : '';
  };
  const lang: 'ar' | 'en' = cookieValue('omnirag_lang') === 'en' ? 'en' : 'ar';
  const theme: 'light' | 'dark' = cookieValue('omnirag_theme') === 'dark' ? 'dark' : 'light';

  // Per-request CSP nonce stamped by the middleware; the inline origin script
  // below is the only inline script in the app.
  const nonce = headersList.get('x-csp-nonce') || '';

  return (
    <html
      lang={lang}
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className={`h-full ${theme === 'dark' ? 'dark' : ''} ${ibmPlexSansArabic.variable} ${cairo.variable} ${tajawal.variable} ${amiri.variable}`}
    >
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `window.__APP_ORIGIN__ = ${JSON.stringify(origin)};`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900 antialiased selection:bg-indigo-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
