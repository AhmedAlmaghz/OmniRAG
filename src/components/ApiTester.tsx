'use client';

import { useState } from 'react';
import { Terminal, Play, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export default function ApiTester() {
  const [loading, setLoading] = useState<boolean>(false);
  const [response, setResponse] = useState<string | null>(null);

  const testApi = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setResponse(JSON.stringify(data, null, 2));
    } catch {
      setResponse(JSON.stringify({ error: 'فشل الإتصال بالمسار' }, null, 2));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="api-tester-card" className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">اختبار مسارات API (App Router API Route)</h3>
            <p className="text-xs text-slate-500">مسار خادم حقيقي: <code className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded dir-ltr inline-block">GET /api/health</code></p>
          </div>
        </div>
        <button
          id="fetch-api-btn"
          onClick={testApi}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors shadow-xs cursor-pointer"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current" />
          )}
          <span>تجربة المسار</span>
        </button>
      </div>

      {response ? (
        <div className="bg-slate-900 rounded-xl p-4 text-emerald-400 font-mono text-xs overflow-x-auto border border-slate-800 dir-ltr text-left">
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800 text-slate-400 dir-rtl text-right">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>استجابة خادم Next.js 16 (200 OK)</span>
          </div>
          <pre>{response}</pre>
        </div>
      ) : (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
          <AlertCircle className="w-4 h-4 text-slate-400" />
          <span>اضغط على "تجربة المسار" لإرسال طلب إلى API Route المدمج</span>
        </div>
      )}
    </div>
  );
}
