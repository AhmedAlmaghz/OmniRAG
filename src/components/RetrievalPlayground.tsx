'use client';

import React, { useState } from 'react';
import {
  Search,
  Sliders,
  Layers,
  Sparkles,
  Zap,
  BarChart3,
  BookOpen,
  Code2,
} from 'lucide-react';
import { SearchResult } from '@/lib/types/omnirag';

interface RetrievalPlaygroundProps {
  tenantId: string;
  lang: 'ar' | 'en';
}

export default function RetrievalPlayground({ tenantId, lang }: RetrievalPlaygroundProps) {
  const [query, setQuery] = useState('شروط اتفاقية عدم الإفصاح والسرية NDA');
  const [semanticWeight, setSemanticWeight] = useState(0.7);
  const [lexicalWeight, setLexicalWeight] = useState(0.3);
  const [topK, setTopK] = useState(4);
  const [useHyde, setUseHyde] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          query,
          topK,
          semanticWeight,
          lexicalWeight,
          useHyde,
        }),
      });

      const data = await res.json();
      setSearchResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Search className="w-5 h-5 text-indigo-600" />
          <span>{lang === 'ar' ? 'مختبر الاسترجاع الهجين والمعجمي (RAG Retrieval Playground)' : 'Hybrid Search Playground'}</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          {lang === 'ar'
            ? 'اختبار وتحليل أداء الخوارزميات: المتجهية (Qdrant) + المعجمية (Neon BM25) + الدمج بواسطة RRF مع ميزة HyDE'
            : 'Test Semantic + Lexical BM25 + Reciprocal Rank Fusion (RRF) with HyDE generator.'}
        </p>
      </div>

      {/* Control Panel & Query Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Sidebar */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-5">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
            <Sliders className="w-4 h-4 text-indigo-600" />
            <span>{lang === 'ar' ? 'معايير الخوارزمية' : 'Search Parameters'}</span>
          </h3>

          {/* Semantic vs Lexical Weight Slider */}
          <div>
            <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
              <span>وزن المتجهي (Semantic): {(semanticWeight * 100).toFixed(0)}%</span>
              <span>وزن المعجمي (Lexical): {(lexicalWeight * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={semanticWeight}
              onChange={(e) => {
                const sem = parseFloat(e.target.value);
                setSemanticWeight(sem);
                setLexicalWeight(parseFloat((1 - sem).toFixed(2)));
              }}
              className="w-full accent-indigo-600 cursor-pointer"
            />
          </div>

          {/* Top-K Results */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              عدد القطع المسترجعة (Top-K): {topK}
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={topK}
              onChange={(e) => setTopK(parseInt(e.target.value))}
              className="w-full accent-indigo-600 cursor-pointer"
            />
          </div>

          {/* HyDE Toggle */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-900 block">توليد HyDE الافتراضي</span>
              <span className="text-[11px] text-slate-500">Hypothetical Document Embeddings</span>
            </div>
            <input
              type="checkbox"
              checked={useHyde}
              onChange={(e) => setUseHyde(e.target.checked)}
              className="w-4 h-4 accent-indigo-600 cursor-pointer"
            />
          </div>

          <button
            onClick={() => handleSearch()}
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center gap-2 transition shadow-xs cursor-pointer"
          >
            <Zap className="w-4 h-4" />
            <span>{isLoading ? 'جاري التشغيل...' : 'تشغيل الاستعلام الهجين'}</span>
          </button>
        </div>

        {/* Results Area */}
        <div className="lg:col-span-2 space-y-4">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="اكتب استعلام البحث الهجين..."
              className="flex-1 px-4 py-3 rounded-xl bg-white border border-slate-300 text-xs focus:outline-none focus:border-indigo-500 shadow-2xs"
            />
            <button
              type="submit"
              className="px-5 py-3 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition"
            >
              بحث
            </button>
          </form>

          {/* Search Performance Stats */}
          {searchResult && (
            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-[11px] text-slate-500 block">زمن الاستجابة (P95)</span>
                  <span className="text-base font-bold font-mono text-indigo-600">{searchResult.latencyMs} ms</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-[11px] text-slate-500 block">إجمالي القطع المندمجة</span>
                  <span className="text-base font-bold font-mono text-emerald-600">{searchResult.chunks.length}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-[11px] text-slate-500 block">مطابقات المتجهي</span>
                  <span className="text-base font-bold font-mono text-violet-600">
                    {searchResult.distribution.semanticMatches}
                  </span>
                </div>
              </div>

              {/* HyDE Prompt Generated if used */}
              {searchResult.hydePrompt && (
                <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-xs">
                  <span className="font-bold text-indigo-900 block mb-1 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    المستند الافتراضي المولّد (HyDE expansion):
                  </span>
                  <p className="text-indigo-800 italic leading-relaxed">"{searchResult.hydePrompt}"</p>
                </div>
              )}

              {/* List of Retrieved Chunks with Score Breakdown */}
              <div className="space-y-3 pt-2">
                <span className="text-xs font-bold text-slate-800 block">نتائج الترتيب النهائي RRF:</span>
                {searchResult.chunks.map((chunk, idx) => (
                  <div key={chunk.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900">
                        [{idx + 1}] {chunk.documentTitle}
                      </span>
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-bold">
                          Fused: {chunk.score}
                        </span>
                        <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded">
                          Sem: {chunk.semanticScore}
                        </span>
                        <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded">
                          Lex: {chunk.lexicalScore}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed font-sans">{chunk.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
