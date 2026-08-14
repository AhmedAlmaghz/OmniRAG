import React, { useState } from 'react';
import { Terminal, Send, CheckCircle2, Play, Loader2, Code2, Server } from 'lucide-react';
import { API_ENDPOINTS_DEMO } from '../data/sdlcData';
import { CodeBlock } from '../components/ui/CodeBlock';
import { Language } from '../types';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';

interface ApiDemoPageProps {
  lang: Language;
}

export const ApiDemoPage: React.FC<ApiDemoPageProps> = ({ lang }) => {
  const [selectedEndpoint, setSelectedEndpoint] = useState(API_ENDPOINTS_DEMO[0]);
  const [requestPayload, setRequestPayload] = useState(selectedEndpoint.requestBodyExample || '');
  const [responseOutput, setResponseOutput] = useState('');
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSelectEndpoint = (endpoint: typeof API_ENDPOINTS_DEMO[0]) => {
    setSelectedEndpoint(endpoint);
    setRequestPayload(endpoint.requestBodyExample || '');
    setResponseOutput('');
    setStatusCode(null);
    setLatencyMs(null);
  };

  const handleSendRequest = async () => {
    setLoading(true);
    setResponseOutput('');
    setStatusCode(null);
    setLatencyMs(null);

    const startTime = performance.now();

    try {
      const options: RequestInit = {
        method: selectedEndpoint.method,
        headers: { 'Content-Type': 'application/json' },
      };

      if (selectedEndpoint.method !== 'GET' && requestPayload) {
        options.body = requestPayload;
      }

      const res = await fetchWithAuth(selectedEndpoint.path, options);
      const endTime = performance.now();
      
      setStatusCode(res.status);
      setLatencyMs(Math.round(endTime - startTime));

      const data = await res.json();
      setResponseOutput(JSON.stringify(data, null, 2));

    } catch (err: any) {
      setStatusCode(500);
      setResponseOutput(JSON.stringify({ error: err.message }, null, 2));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      
      {/* Header Banner */}
      <div className="p-8 rounded-3xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-semibold border border-cyan-500/20">
          <Terminal className="w-4 h-4" />
          <span>{lang === 'ar' ? 'معالجات مسارات Next.js v16 التفاعلية' : 'Next.js v16 Route Handlers Playground'}</span>
        </div>

        <h1 className="text-3xl font-black text-white">
          {lang === 'ar' ? 'اختبار الواجهات البرمجية (API Route Handlers)' : 'Route Handlers & Server Actions Client'}
        </h1>

        <p className="text-slate-300 text-sm max-w-3xl leading-relaxed">
          {lang === 'ar'
            ? 'اختبار واستدعاء مسارات الخادم app/api/route.ts مباشرة في الوقت الفعلي وملاحظة سرعة الاستجابة بالمللي ثانية.'
            : 'Execute live Next.js 16 app/api/route.ts endpoints and inspect real-time JSON responses and server latency.'}
        </p>
      </div>

      {/* Main Endpoint Selector and Client Tester Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Endpoint Selector List (Left 4 cols) */}
        <div className="lg:col-span-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-200 px-1">
            {lang === 'ar' ? 'اختر الواجهة البرمجية للطلب:' : 'Select Target API Route:'}
          </h3>

          {API_ENDPOINTS_DEMO.map((ep) => {
            const isSelected = ep.path === selectedEndpoint.path;
            return (
              <button
                key={ep.path}
                onClick={() => handleSelectEndpoint(ep)}
                className={`w-full text-right p-4 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2 ${
                  isSelected
                    ? 'bg-slate-900 border-cyan-500 shadow-md shadow-cyan-500/10'
                    : 'bg-slate-950/60 border-slate-800 hover:bg-slate-900/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-black font-mono ${
                      ep.method === 'GET'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                    }`}
                  >
                    {ep.method}
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-200">{ep.path}</span>
                </div>
                <p className="text-xs text-slate-400">
                  {lang === 'ar' ? ep.descriptionAr : ep.descriptionEn}
                </p>
              </button>
            );
          })}
        </div>

        {/* API Client Executor (Right 8 cols) */}
        <div className="lg:col-span-8 p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-5">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-2 font-mono text-sm">
              <span className="px-2.5 py-1 rounded-md bg-cyan-500/20 text-cyan-300 font-bold">
                {selectedEndpoint.method}
              </span>
              <span className="font-bold text-white">{selectedEndpoint.path}</span>
            </div>

            <button
              onClick={handleSendRequest}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{lang === 'ar' ? 'جاري الإرسال...' : 'Sending Request...'}</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>{lang === 'ar' ? 'إرسال الطلب الآن' : 'Execute Request'}</span>
                </>
              )}
            </button>
          </div>

          {/* Request Payload Editor (if POST) */}
          {selectedEndpoint.method !== 'GET' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300">
                {lang === 'ar' ? 'حمولة الطلب (Request JSON Payload):' : 'Request Body (JSON):'}
              </label>
              <textarea
                rows={5}
                value={requestPayload}
                onChange={(e) => setRequestPayload(e.target.value)}
                className="w-full p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500 dir-ltr text-left"
              />
            </div>
          )}

          {/* Status Bar */}
          {(statusCode !== null || latencyMs !== null) && (
            <div className="flex items-center gap-4 text-xs font-mono p-3 rounded-xl bg-slate-950 border border-slate-800">
              <div>
                Status:{' '}
                <span className={statusCode === 200 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {statusCode} OK
                </span>
              </div>
              <div>
                Latency: <span className="text-cyan-400 font-bold">{latencyMs} ms</span>
              </div>
            </div>
          )}

          {/* Response Output Viewer */}
          <div>
            <div className="text-xs font-bold text-slate-300 mb-2">
              {lang === 'ar' ? 'مخرجات الاستجابة (Response JSON):' : 'Response Body (JSON):'}
            </div>
            {responseOutput ? (
              <CodeBlock code={responseOutput} language="json" title="Response JSON" />
            ) : (
              <div className="p-8 rounded-xl bg-slate-950 border border-slate-800 text-center text-slate-500 text-xs font-mono">
                {lang === 'ar' ? 'اضغط على "إرسال الطلب الآن" لمعاينة الاستجابة.' : 'Click "Execute Request" to inspect live response.'}
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
};
