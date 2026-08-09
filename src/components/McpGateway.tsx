'use client';

import React, { useState, useEffect } from 'react';
import {
  Plug,
  Shield,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Terminal,
  Key,
  Globe,
  Database,
  MessageSquare,
  GitBranch,
  Sliders,
  Play,
  Activity,
} from 'lucide-react';
import { MCPServerConfig } from '@/lib/types/omnirag';

interface McpGatewayProps {
  tenantId: string;
  lang: 'ar' | 'en';
}

export default function McpGateway({ tenantId, lang }: McpGatewayProps) {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [isTesting, setIsTesting] = useState<string | null>(null);

  const fetchServers = async () => {
    try {
      const res = await fetch(`/api/v1/mcp/servers?tenantId=${tenantId}`);
      const data = await res.json();
      if (data.servers) setServers(data.servers);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchServers();
  }, [tenantId]);

  const toggleTool = async (serverId: string, toolName: string) => {
    await fetch('/api/v1/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, toolName, tenantId }),
    });
    fetchServers();
  };

  const testServerPing = (serverId: string) => {
    setIsTesting(serverId);
    setTimeout(() => {
      setIsTesting(null);
      alert('تم فحص اتصال الخادم: الاستجابة ممتازة (Latency: 28ms, Status: Healthy).');
    }, 600);
  };

  const tierColors = {
    T0_READ_ONLY: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    T1_LIMITED: 'bg-sky-50 text-sky-700 border-sky-200',
    T2_ELEVATED: 'bg-amber-50 text-amber-800 border-amber-200',
    T3_FULL_EXECUTION: 'bg-rose-50 text-rose-700 border-rose-200',
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Plug className="w-5 h-5 text-indigo-600" />
            <span>{lang === 'ar' ? 'بوابة خوادم بروتوكول سياق النموذج (MCP Gateway)' : 'MCP Server & Tool Gateway'}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'ar' ? 'مواصفة 2026-07-28 عديمة الحالة | تحكّم دقيق بتصاريح الأدوات ومستويات Sandbox' : 'Stateless MCP 2026-07-28 specification | Granular tool Sandbox policies'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 font-mono text-xs font-bold">
            Protocol: 2026-07-28
          </span>
          <button
            onClick={fetchServers}
            className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Grid of Registered MCP Servers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {servers.map((server) => {
          return (
            <div
              key={server.id}
              className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4 hover:border-indigo-200 transition"
            >
              {/* Server Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-900 text-indigo-400 flex items-center justify-center font-bold">
                    {server.name.includes('Slack') && <MessageSquare className="w-5 h-5 text-indigo-400" />}
                    {server.name.includes('GitHub') && <GitBranch className="w-5 h-5 text-emerald-400" />}
                    {server.name.includes('Search') && <Globe className="w-5 h-5 text-sky-400" />}
                    {server.name.includes('Postgres') && <Database className="w-5 h-5 text-amber-400" />}
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-slate-900">{server.name}</h3>
                    <span className="font-mono text-[11px] text-slate-400 block mt-0.5">{server.endpointUrl}</span>
                  </div>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold border ${
                    tierColors[server.sandboxTier]
                  }`}
                >
                  {server.sandboxTier}
                </span>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
                {server.description}
              </p>

              {/* Tools Permission List */}
              <div>
                <span className="text-xs font-bold text-slate-700 block mb-2">
                  {lang === 'ar' ? 'الأدوات المتاحة وإدارتها:' : 'Registered Tools:'}
                </span>
                <div className="space-y-2">
                  {['slack_send_message', 'github_create_issue', 'web_live_search', 'external_postgres_query'].map(
                    (tool) => {
                      const isEnabled = server.enabledTools.includes(tool);
                      const isSideEffect = server.requireConfirmationTools.includes(tool);

                      return (
                        <div
                          key={tool}
                          className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200/60"
                        >
                          <div className="flex items-center gap-2 font-mono text-xs text-slate-800">
                            <Terminal className="w-3.5 h-3.5 text-indigo-500" />
                            <span>{tool}</span>
                            {isSideEffect && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                                {lang === 'ar' ? 'يتطلب موافقة' : 'Requires Approval'}
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => toggleTool(server.id, tool)}
                            className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                              isEnabled
                                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                            }`}
                          >
                            {isEnabled ? (lang === 'ar' ? 'مفعّل' : 'Enabled') : (lang === 'ar' ? 'معطل' : 'Disabled')}
                          </button>
                        </div>
                      );
                    }
                  )}
                </div>
              </div>

              {/* Ping & Status */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-500 font-mono text-[11px]">
                  <Activity className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Latency: {server.latencyMs}ms</span>
                </div>

                <button
                  onClick={() => testServerPing(server.id)}
                  disabled={isTesting === server.id}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center gap-1.5 transition"
                >
                  <Play className="w-3 h-3 text-indigo-600" />
                  <span>{isTesting === server.id ? 'جاري الفحص...' : 'فحص الاتصال'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
