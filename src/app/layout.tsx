import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OmniRAG - Enterprise Agentic RAG Platform',
  description: 'Enterprise Agentic RAG Platform with Hybrid Retrieval, MCP Gateway, Multi-Tenancy, and Deterministic Security Guardrails',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" className="h-full">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900 antialiased selection:bg-indigo-500 selection:text-white">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
