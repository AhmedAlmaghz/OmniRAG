'use client';

import React from 'react';
import Link from 'next/link';

export default function ClientNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100 p-4">
      <h2 className="text-2xl font-bold mb-2">404 - الصفحة غير موجودة</h2>
      <p className="text-slate-400">عذراً، المورد الذي تطلبه غير موجود.</p>
      <Link 
        href="/"
        className="mt-6 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-all"
      >
        العودة للرئيسية
      </Link>
    </div>
  );
}
