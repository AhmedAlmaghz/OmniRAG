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
  Trash2,
  Plus,
} from 'lucide-react';
import { MCPServerConfig } from '@/lib/types/omnirag';

interface McpGatewayProps {
  tenantId: string;
  lang: 'ar' | 'en';
}

export default function McpGateway({ tenantId, lang }: McpGatewayProps) {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [pingNotice, setPingNotice] = useState<string | null>(null);

  // New MCP Server Modal State
  const [showAddServerModal, setShowAddServerModal] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newEndpointUrl, setNewEndpointUrl] = useState('');
  const [newSandboxTier, setNewSandboxTier] = useState<string>('T1_LIMITED');
  const [newDescription, setNewDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Custom tool registration per server state
  const [customToolInputs, setCustomToolInputs] = useState<Record<string, string>>({});

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

  const handleAddServerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerName.trim() || !newEndpointUrl.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/v1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          name: newServerName,
          endpointUrl: newEndpointUrl,
          sandboxTier: newSandboxTier,
          description: newDescription || 'خادم MCP مخصص للمؤسسة',
        }),
      });

      if (res.ok) {
        setNewServerName('');
        setNewEndpointUrl('');
        setNewDescription('');
        setShowAddServerModal(false);
        fetchServers();
        setPingNotice(lang === 'ar' ? 'تم تسجيل خادم MCP الجديد وفحصه بنجاح!' : 'New MCP Server registered successfully!');
        setTimeout(() => setPingNotice(null), 4000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleTool = async (serverId: string, toolName: string) => {
    await fetch('/api/v1/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, toolName, tenantId }),
    });
    fetchServers();
  };

  const handleCustomToolInputChange = (serverId: string, value: string) => {
    setCustomToolInputs((prev) => ({ ...prev, [serverId]: value }));
  };

  const handleAddCustomTool = async (serverId: string) => {
    const toolName = customToolInputs[serverId]?.trim();
    if (!toolName) return;

    await fetch('/api/v1/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, toolName, tenantId }),
    });

    setCustomToolInputs((prev) => ({ ...prev, [serverId]: '' }));
    fetchServers();
    setPingNotice(lang === 'ar' ? `تم تسجيل وتفعيل الأداة المخصصة (${toolName})` : `Custom tool ${toolName} registered!`);
    setTimeout(() => setPingNotice(null), 3000);
  };

  const testServerPing = async (serverId: string) => {
    setIsTesting(serverId);
    try {
      const res = await fetch('/api/v1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ping', serverId, tenantId }),
      });
      const data = await res.json();
      if (data.success) {
        setPingNotice(
          lang === 'ar'
            ? `تم فحص الاتصال الخادم بنجاح! زمن الاستجابة: ${data.latencyMs}ms، الحالة: ${
                data.status === 'healthy' ? 'نشط وآمن (Healthy)' : 'مستجيب مع قيود'
              }`
            : `Ping succeeded! Latency: ${data.latencyMs}ms, Status: ${data.status}`
        );
        fetchServers();
      } else {
        setPingNotice(
          lang === 'ar'
            ? `فشل فحص الاتصال بالخادم: ${data.error || 'غير مستجيب'}`
            : `Ping failed: ${data.error || 'Server unreachable'}`
        );
      }
    } catch (e) {
      console.error(e);
      setPingNotice(lang === 'ar' ? 'خطأ في الشبكة أثناء الاتصال بالخادم' : 'Network error during ping check');
    } finally {
      setIsTesting(null);
      setTimeout(() => setPingNotice(null), 5000);
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    const confirmMsg =
      lang === 'ar'
        ? 'هل أنت متأكد من رغبتك في إلغاء تسجيل وحذف خادم الـ MCP هذا؟ ستفقد القدرة على تشغيل أدواته.'
        : 'Are you sure you want to delete this MCP server?';
    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await fetch('/api/v1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', serverId, tenantId }),
      });
      if (res.ok) {
        setPingNotice(lang === 'ar' ? 'تم حذف الخادم وإلغاء تسجيله بنجاح.' : 'Server deleted successfully.');
        fetchServers();
        setTimeout(() => setPingNotice(null), 4000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getToolsForServer = (server: MCPServerConfig) => {
    // Unique union set of all tools
    const toolsSet = new Set<string>([
      ...(server.enabledTools || []),
      ...(server.requireConfirmationTools || []),
    ]);

    // Populate standard tools depending on category just for ease of demo/use
    const nameLower = server.name.toLowerCase();
    if (nameLower.includes('slack') || nameLower.includes('تواصل')) {
      toolsSet.add('slack_send_message');
      toolsSet.add('slack_read_channel');
      toolsSet.add('slack_post_alert');
    } else if (nameLower.includes('github') || nameLower.includes('كود') || nameLower.includes('برمجة')) {
      toolsSet.add('github_search_code');
      toolsSet.add('github_create_issue');
      toolsSet.add('github_read_repo');
    } else if (nameLower.includes('search') || nameLower.includes('web') || nameLower.includes('بحث') || nameLower.includes('ويب')) {
      toolsSet.add('web_live_search');
      toolsSet.add('fetch_url_content');
    } else if (nameLower.includes('postgres') || nameLower.includes('sql') || nameLower.includes('db') || nameLower.includes('قاعدة')) {
      toolsSet.add('external_postgres_query');
      toolsSet.add('get_table_schema');
    } else {
      toolsSet.add('custom_action_execute');
      toolsSet.add('read_server_resource');
    }

    return Array.from(toolsSet);
  };

  const tierColors = {
    T0_READ_ONLY: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    T1_LIMITED: 'bg-sky-50 text-sky-700 border-sky-200',
    T2_ELEVATED: 'bg-amber-50 text-amber-800 border-amber-200',
    T3_FULL_EXECUTION: 'bg-rose-50 text-rose-700 border-rose-200',
  };

  const statusIndicators = {
    healthy: 'bg-emerald-500 ring-emerald-100',
    degraded: 'bg-amber-500 ring-amber-100',
    down: 'bg-rose-500 ring-rose-100',
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
          <button
            type="button"
            onClick={() => setShowAddServerModal(true)}
            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'ar' ? 'تسجيل خادم جديد' : 'Register Server'}</span>
          </button>

          <span className="px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 font-mono text-xs font-bold">
            Protocol: 2026-07-28
          </span>
          <button
            type="button"
            onClick={fetchServers}
            className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 transition cursor-pointer"
            title="تحديث البيانات"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Ping Status Toast */}
      {pingNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs font-medium flex items-center gap-2 animate-fadeIn">
          <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{pingNotice}</span>
        </div>
      )}

      {/* Grid of Registered MCP Servers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {servers.map((server) => {
          const availableTools = getToolsForServer(server);
          return (
            <div
              key={server.id}
              className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4 hover:border-indigo-200 transition flex flex-col justify-between"
            >
              <div className="space-y-4">
                {/* Server Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-900 text-indigo-400 flex items-center justify-center font-bold relative">
                      {server.name.toLowerCase().includes('slack') && <MessageSquare className="w-5 h-5 text-indigo-400" />}
                      {server.name.toLowerCase().includes('github') && <GitBranch className="w-5 h-5 text-emerald-400" />}
                      {server.name.toLowerCase().includes('search') && <Globe className="w-5 h-5 text-sky-400" />}
                      {server.name.toLowerCase().includes('postgres') && <Database className="w-5 h-5 text-amber-400" />}
                      {!server.name.toLowerCase().includes('slack') &&
                        !server.name.toLowerCase().includes('github') &&
                        !server.name.toLowerCase().includes('search') &&
                        !server.name.toLowerCase().includes('postgres') && <Plug className="w-5 h-5 text-indigo-400" />}
                      
                      {/* Live status dot */}
                      <span className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ring-4 ${statusIndicators[server.status || 'healthy']}`} />
                    </div>

                    <div>
                      <h3 className="text-xs font-bold text-slate-900">{server.name}</h3>
                      <span className="font-mono text-[11px] text-slate-400 block mt-0.5">{server.endpointUrl}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold border ${
                        tierColors[server.sandboxTier]
                      }`}
                    >
                      {server.sandboxTier}
                    </span>
                    <button
                      onClick={() => handleDeleteServer(server.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                      title={lang === 'ar' ? 'حذف الخادم' : 'Delete Server'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
                  {server.description}
                </p>

                {/* Tools Permission List */}
                <div>
                  <span className="text-xs font-bold text-slate-700 block mb-2">
                    {lang === 'ar' ? 'الأدوات المتاحة وإدارتها:' : 'Registered Tools:'}
                  </span>
                  <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                    {availableTools.map((tool) => {
                      const isEnabled = server.enabledTools?.includes(tool);
                      const isSideEffect = server.requireConfirmationTools?.includes(tool);

                      return (
                        <div
                          key={tool}
                          className="flex items-center justify-between p-2 bg-slate-50 rounded-xl border border-slate-200/60 hover:bg-slate-100/50 transition"
                        >
                          <div className="flex items-center gap-2 font-mono text-xs text-slate-800">
                            <Terminal className="w-3.5 h-3.5 text-indigo-500" />
                            <span>{tool}</span>
                            {isSideEffect && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-bold">
                                {lang === 'ar' ? 'موافقة بشرية' : 'Needs Approval'}
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => toggleTool(server.id, tool)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                              isEnabled
                                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                            }`}
                          >
                            {isEnabled ? (lang === 'ar' ? 'مفعّل' : 'Enabled') : (lang === 'ar' ? 'معطل' : 'Disabled')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Add Custom Tool Input */}
                <div className="pt-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={lang === 'ar' ? 'أضف أداة مخصصة (مثال: clear_cache)' : 'Add custom tool...'}
                      value={customToolInputs[server.id] || ''}
                      onChange={(e) => handleCustomToolInputChange(server.id, e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={() => handleAddCustomTool(server.id)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{lang === 'ar' ? 'إضافة' : 'Add'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Ping & Status */}
              <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-500 font-mono text-[11px]">
                  <Activity className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Latency: {server.latencyMs}ms</span>
                  <span className="text-slate-300">|</span>
                  <span>Checked: {server.lastChecked ? new Date(server.lastChecked).toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US', {hour: '2-digit', minute: '2-digit'}) : 'Never'}</span>
                </div>

                <button
                  onClick={() => testServerPing(server.id)}
                  disabled={isTesting === server.id}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Play className="w-3 h-3 text-indigo-600" />
                  <span>{isTesting === server.id ? (lang === 'ar' ? 'جاري الفحص...' : 'Checking...') : (lang === 'ar' ? 'فحص الاتصال والنشاط' : 'Ping Server')}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal: Register New MCP Server */}
      {showAddServerModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full border border-slate-200 shadow-xl space-y-4 animate-in fade-in-50 zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Plug className="w-5 h-5 text-indigo-600" />
              <span>{lang === 'ar' ? 'تسجيل خادم MCP جديد' : 'Register New MCP Server'}</span>
            </h3>

            <form onSubmit={handleAddServerSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'اسم الخادم:' : 'Server Name:'}
                </label>
                <input
                  type="text"
                  required
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  placeholder="مثال: Internal Jira MCP Connector"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'رابط Endpoint:' : 'Endpoint URL:'}
                </label>
                <input
                  type="text"
                  required
                  value={newEndpointUrl}
                  onChange={(e) => setNewEndpointUrl(e.target.value)}
                  placeholder="https://mcp.internal.company.com/v1"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'مستوى الحماية (Sandbox Tier):' : 'Sandbox Tier:'}
                </label>
                <select
                  value={newSandboxTier}
                  onChange={(e) => setNewSandboxTier(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                >
                  <option value="T0_READ_ONLY">T0_READ_ONLY (قراءة فقط - آمن جداً)</option>
                  <option value="T1_LIMITED">T1_LIMITED (محدود الصلاحيات)</option>
                  <option value="T2_ELEVATED">T2_ELEVATED (مستوى عالٍ - يتطلب تأكيد)</option>
                  <option value="T3_FULL_EXECUTION">T3_FULL_EXECUTION (تنفيذ كامل - للأنظمة الحرجة)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'الوصف والغرض:' : 'Description:'}
                </label>
                <textarea
                  rows={3}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="شرح موجز لأدوات هذا الخادم ودواعيه..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition cursor-pointer"
                >
                  {isSubmitting ? 'جاري التسجيل...' : 'تسجيل واختبار'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddServerModal(false)}
                  className="py-2.5 px-4 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
