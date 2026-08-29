export const dynamic = 'force-dynamic';
import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';
import { headers } from 'next/headers';

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

  // Per-request CSP nonce stamped by the middleware; the inline origin script
  // below is the only inline script in the app.
  const nonce = headersList.get('x-csp-nonce') || '';

  return (
    <html lang="ar" dir="rtl" className="h-full">
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
