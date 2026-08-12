export const dynamic = "force-dynamic";
import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';
import { headers } from 'next/headers';

export const metadata: Metadata = {
  title: 'OmniRAG - Enterprise Agentic RAG Platform',
  description: 'Enterprise Agentic RAG Platform with Hybrid Retrieval, MCP Gateway, Multi-Tenancy, and Deterministic Security Guardrails',
  icons: {
    icon: '/icon.jpg',
    shortcut: '/favicon.ico',
    apple: '/icon.jpg',
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = await headers();
  const forwardedHost = headersList.get('x-forwarded-host');
  const host = forwardedHost || headersList.get('host') || 'localhost:3000';
  const proto = headersList.get('x-forwarded-proto') || 'http';
  const firstProto = proto.split(',')[0].trim();
  const isSecure = firstProto === 'https' || host.includes('run.app') || host.includes('europe-west1.run.app');
  
  let origin = `${isSecure ? 'https' : 'http'}://${host}`;

  return (
    <html lang="ar" dir="rtl" className="h-full">
      <head>
        <link rel="icon" href="/icon.jpg" type="image/jpeg" />
        <link rel="apple-touch-icon" href="/icon.jpg" />
        <script
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
