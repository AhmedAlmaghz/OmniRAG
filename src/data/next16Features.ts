import { NextFeature } from '../types';

export const NEXT_16_FEATURES: NextFeature[] = [
  {
    id: 'app-router-layouts',
    titleAr: 'تخطيطات متداخلة ورؤوس محددة (App Router Layouts)',
    titleEn: 'Nested Layouts & Parallel Routes',
    descriptionAr: 'هيكلة صفحات فائقة الكفاءة تحافظ على الحالة وتدعم التحميل الجزئي وإعادة الاستخدام التلقائي للمكونات.',
    descriptionEn: 'Efficient UI page structuring that preserves state across navigation, supports partial rendering and seamless layout reuse.',
    category: 'App Router',
    status: 'Stable',
    tags: ['app/layout.tsx', 'Template', 'Parallel Routes'],
    codeSnippet: `// app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Next.js v16 Enterprise App',
  description: 'Built with App Router, Tailwind CSS v4 & TypeScript',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased bg-slate-950 text-slate-100">
        <header className="border-b border-slate-800 p-4">
          <nav>Next.js v16 App Router Nav</nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}`,
  },
  {
    id: 'server-components-react19',
    titleAr: 'مكونات الخادم والعميل (React 19 Server Components)',
    titleEn: 'React 19 Server & Client Components',
    descriptionAr: 'جلب البيانات مباشرة على الخادم بدون إرسال JavaScript زائد للمتصفح، مع تحديد حدود "use client" بدقة.',
    descriptionEn: 'Direct server-side data fetching without sending unnecessary bundle weight to client, with exact "use client" boundary definitions.',
    category: 'React 19',
    status: 'New in v16',
    tags: ['RSC', "'use client'", 'Async Component'],
    codeSnippet: `// app/dashboard/page.tsx (Server Component)
import { fetchMetrics } from '@/lib/db';
import { AnalyticsChart } from '@/components/AnalyticsChart'; // Client Component

export default async function DashboardPage() {
  const metrics = await fetchMetrics(); // Direct DB / API call on Server

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">لوحة التحليلات على الخادم</h1>
      <AnalyticsChart initialData={metrics} />
    </div>
  );
}`,
  },
  {
    id: 'server-actions',
    titleAr: 'إجراءات الخادم المتزامنة (Server Actions & Mutations)',
    titleEn: 'Server Actions & Form Mutations',
    descriptionAr: 'تنفيذ العمليات والتعديلات على الخادم مباشرة مع دعم التحديث التلقائي للحاوية (revalidatePath) والأمان العالي.',
    descriptionEn: 'Execute mutations directly on the server with automated cache invalidation via revalidatePath and built-in CSRF protection.',
    category: 'Server Actions',
    status: 'Enhanced',
    tags: ["'use server'", 'revalidatePath', 'useActionState'],
    codeSnippet: `// app/actions/updateProject.ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const schema = z.object({ title: z.string().min(3) });

export async function updateProjectTitle(formData: FormData) {
  const title = formData.get('title') as string;
  const validated = schema.parse({ title });

  // Update DB record
  await db.project.update({ where: { id: 1 }, data: { title: validated.title } });

  // Revalidate App Router cache for target path
  revalidatePath('/dashboard');
  return { success: true };
}`,
  },
  {
    id: 'route-handlers',
    titleAr: 'معالجات المسارات البرمجية (Route Handlers / API Routes)',
    titleEn: 'Next.js 16 Route Handlers (app/api/route.ts)',
    descriptionAr: 'إنشاء واجهات برمجية RESTful أو GraphQL عالية الأداء باستخدام كائنات Request و Response القياسية في Web API.',
    descriptionEn: 'Build high-performance RESTful APIs using standard Web API Request and Response primitives.',
    category: 'App Router',
    status: 'Stable',
    tags: ['app/api/route.ts', 'NextResponse', 'Edge/Node Runtime'],
    codeSnippet: `// app/api/sdlc-health/route.ts
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'standard';

  return NextResponse.json({
    status: 'healthy',
    framework: 'Next.js v16 (App Router)',
    runtime: 'Node.js / Cloud Run Container',
    timestamp: new Date().toISOString(),
  });
}`,
  },
  {
    id: 'ppr-partial-prerendering',
    titleAr: 'التجميع الجزئي المسبق (Partial Prerendering - PPR)',
    titleEn: 'Partial Prerendering (PPR) & Suspense',
    descriptionAr: 'دمج التحميل الثابت السريع جداً للهيكل الخارجي مع جلب البيانات الديناميكية المباشرة عبر React Suspense.',
    descriptionEn: 'Combine static ultra-fast shell rendering with dynamic streaming data chunks using React Suspense boundaries.',
    category: 'Performance',
    status: 'New in v16',
    tags: ['PPR', 'Suspense', 'Streaming UI'],
    codeSnippet: `// app/analytics/page.tsx
import { Suspense } from 'react';
import { StaticShell } from '@/components/StaticShell';
import { RealtimeFeed } from '@/components/RealtimeFeed';

export const experimental_ppr = true; // Next.js 16 PPR flag

export default function AnalyticsPage() {
  return (
    <StaticShell>
      <Suspense fallback={<div className="animate-pulse h-32 bg-slate-800 rounded-xl" />}>
        <RealtimeFeed />
      </Suspense>
    </StaticShell>
  );
}`,
  },
  {
    id: 'turbopack-react-compiler',
    titleAr: 'محرك TurboPack ومترجم React Compiler v19',
    titleEn: 'TurboPack & React Compiler Integration',
    descriptionAr: 'بناء وتسريع التطبيقات بسرعة أداء قياسية مع إدارة التذكر (Memoization) التلقائي من React Compiler.',
    descriptionEn: 'Ultra-fast incremental builds with automatic component memoization handled by the React 19 Compiler.',
    category: 'SDLC Quality',
    status: 'New in v16',
    tags: ['TurboPack', 'React Compiler', 'HMR'],
    codeSnippet: `// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    reactCompiler: true,
    turbo: {
      rules: {
        '*.svg': { loaders: ['@svgr/webpack'], as: '*.js' },
      },
    },
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

module.exports = nextConfig;`,
  },
];
