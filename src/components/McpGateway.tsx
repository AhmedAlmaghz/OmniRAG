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
  Wand2,
  Sparkles,
  Code2,
  CheckCircle2,
  X,
  Bot,
  Cpu,
  Loader2,
  Copy,
  Layers,
  Edit3,
  Lock,
  Pencil,
  KeyRound,
} from 'lucide-react';
import { MCPServerConfig } from '@/lib/types/omnirag';

interface HeaderPair {
  key: string;
  value: string;
}

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
  const [addHeaders, setAddHeaders] = useState<HeaderPair[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit MCP Server Modal State
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [editServerName, setEditServerName] = useState('');
  const [editEndpointUrl, setEditEndpointUrl] = useState('');
  const [editSandboxTier, setEditSandboxTier] = useState<string>('T1_LIMITED');
  const [editDescription, setEditDescription] = useState('');
  const [editHeaders, setEditHeaders] = useState<HeaderPair[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Custom tool registration per server state
  const [customToolInputs, setCustomToolInputs] = useState<Record<string, string>>({});

  // AI Tool Builder State
  const [showToolBuilderModal, setShowToolBuilderModal] = useState(false);
  const [builderTargetServerId, setBuilderTargetServerId] = useState('');
  const [builderPrompt, setBuilderPrompt] = useState('');
  const [isGeneratingTool, setIsGeneratingTool] = useState(false);
  const [generatedToolSchema, setGeneratedToolSchema] = useState<{
    toolName: string;
    description: string;
    properties: Record<string, { type: string; description: string }>;
    required: string[];
    sampleResponse?: any;
  } | null>(null);
  const [isSavingTool, setIsSavingTool] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);

  const fetchServers = async () => {
    try {
      const res = await fetch(`/api/v1/mcp/servers?tenantId=${tenantId}`);
      const data = await res.json();
      if (data.servers) {
        setServers(data.servers);
        if (data.servers.length > 0 && !builderTargetServerId) {
          setBuilderTargetServerId(data.servers[0].id);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchServers();
  }, [tenantId]);

  const handleGenerateTool = async () => {
    if (!builderPrompt.trim()) return;
    setIsGeneratingTool(true);
    setBuilderError(null);

    try {
      const res = await fetch('/api/v1/mcp/generate-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          prompt: builderPrompt,
          serverId: builderTargetServerId,
          tenantId,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'فشل توليد مخطط الأداة بالذكاء الاصطناعي');
      }

      setGeneratedToolSchema(data.toolSchema);
    } catch (err: any) {
      setBuilderError(err.message || 'حدث خطأ أثناء الاتصال بالمساعد الاصطناعي لبناء الأداة');
    } finally {
      setIsGeneratingTool(false);
    }
  };

  const handleSaveTool = async () => {
    if (!generatedToolSchema || !builderTargetServerId) return;
    setIsSavingTool(true);
    setBuilderError(null);

    try {
      const res = await fetch('/api/v1/mcp/generate-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          serverId: builderTargetServerId,
          toolSchema: generatedToolSchema,
          tenantId,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'فشل حفظ وحفظ الأداة في الخادم');
      }

      setPingNotice(
        lang === 'ar'
          ? `تم اعتماد وتخزين الأداة الذكية (${generatedToolSchema.toolName}) على الخادم بنجاح!`
          : `Tool ${generatedToolSchema.toolName} created & saved successfully!`
      );
      setShowToolBuilderModal(false);
      setBuilderPrompt('');
      setGeneratedToolSchema(null);
      fetchServers();
      setTimeout(() => setPingNotice(null), 4000);
    } catch (err: any) {
      setBuilderError(err.message || 'حدث خطأ أثناء حفظ الأداة');
    } finally {
      setIsSavingTool(false);
    }
  };

  const formatHeadersObject = (pairs: HeaderPair[]): Record<string, string> => {
    const obj: Record<string, string> = {};
    pairs.forEach((p) => {
      if (p.key.trim() && p.value.trim()) {
        obj[p.key.trim()] = p.value.trim();
      }
    });
    return obj;
  };

  const handleOpenEditModal = (server: MCPServerConfig) => {
    setEditingServer(server);
    setEditServerName(server.name);
    setEditEndpointUrl(server.endpointUrl);
    setEditSandboxTier(server.sandboxTier);
    setEditDescription(server.description || '');
    const existingHeaders = Object.entries(server.headers || {}).map(([k, v]) => ({ key: k, value: v }));
    setEditHeaders(existingHeaders);
  };

  const handleEditServerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingServer || !editServerName.trim() || !editEndpointUrl.trim()) return;

    setIsSavingEdit(true);
    try {
      const formattedHeaders = formatHeadersObject(editHeaders);
      const res = await fetch('/api/v1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit',
          tenantId,
          server: {
            id: editingServer.id,
            name: editServerName,
            endpointUrl: editEndpointUrl,
            sandboxTier: editSandboxTier,
            description: editDescription,
            headers: formattedHeaders,
          },
        }),
      });

      if (res.ok) {
        setEditingServer(null);
        fetchServers();
        setPingNotice(
          lang === 'ar'
            ? `تم تعديل وتحديث بيانات خادم MCP (${editServerName}) وترويسات الأمان بنجاح!`
            : `MCP Server ${editServerName} & security headers updated successfully!`
        );
        setTimeout(() => setPingNotice(null), 4000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleAddServerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerName.trim() || !newEndpointUrl.trim()) return;

    setIsSubmitting(true);
    try {
      const formattedHeaders = formatHeadersObject(addHeaders);
      const res = await fetch('/api/v1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          tenantId,
          server: {
            name: newServerName,
            endpointUrl: newEndpointUrl,
            sandboxTier: newSandboxTier,
            description: newDescription || 'خادم MCP مخصص للمؤسسة',
            headers: formattedHeaders,
          },
        }),
      });

      if (res.ok) {
        setNewServerName('');
        setNewEndpointUrl('');
        setNewDescription('');
        setAddHeaders([]);
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

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              if (servers.length > 0 && !builderTargetServerId) {
                setBuilderTargetServerId(servers[0].id);
              }
              setShowToolBuilderModal(true);
            }}
            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 via-indigo-600 to-indigo-700 hover:from-amber-600 hover:to-indigo-800 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-indigo-600/20"
          >
            <Wand2 className="w-4 h-4 text-amber-200 animate-pulse" />
            <span>{lang === 'ar' ? 'منشئ الأدوات بالذكاء الاصطناعي' : 'AI Tool Builder'}</span>
          </button>

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
                      type="button"
                      onClick={() => handleOpenEditModal(server)}
                      className="p-1.5 text-slate-500 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 border border-slate-200/80 hover:border-indigo-200 transition cursor-pointer"
                      title={lang === 'ar' ? 'تعديل بيانات الخادم وترويسات الأمان' : 'Edit Server & Headers'}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteServer(server.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                      title={lang === 'ar' ? 'حذف الخادم' : 'Delete Server'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
                  {server.description}
                </p>

                {/* Security Headers / API Key Badge */}
                {server.headers && Object.keys(server.headers).length > 0 ? (
                  <div className="flex items-center gap-2 p-2.5 bg-slate-900 text-amber-300 rounded-xl font-mono text-[11px] border border-slate-800">
                    <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="font-sans font-bold text-[10px] text-slate-300">
                      {lang === 'ar' ? 'ترويسات الأمان مفعّلة:' : 'Active Headers:'}
                    </span>
                    <span className="truncate text-slate-200">
                      {Object.entries(server.headers)
                        .map(([k, v]) => `${k}: ${v.length > 8 ? v.substring(0, 6) + '...' : '••••'}`)
                        .join(' | ')}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-2 bg-slate-50 rounded-xl border border-slate-200/60 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                      <span>{lang === 'ar' ? 'لا توجد ترويسات أمان أو مفاتيح API_KEY مخصصة' : 'No custom security headers attached'}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(server)}
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
                    >
                      {lang === 'ar' ? '+ أضف ترويسة' : '+ Add Header'}
                    </button>
                  </div>
                )}

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
                  {lang === 'ar' ? 'الوصف وغرض الخادم:' : 'Description:'}
                </label>
                <textarea
                  rows={2}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="شرح موجز لأدوات هذا الخادم ودواعيه..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Security Headers Editor */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-amber-600" />
                    <span>{lang === 'ar' ? 'ترويسات الأمان ومفاتيح الـ API (Headers / Auth Tokens):' : 'Security Headers & API Keys:'}</span>
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setAddHeaders([...addHeaders, { key: 'Authorization', value: 'Bearer ' }])}
                      className="text-[10px] bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold px-2 py-0.5 rounded transition cursor-pointer"
                    >
                      + Authorization
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddHeaders([...addHeaders, { key: 'X-API-Key', value: '' }])}
                      className="text-[10px] bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-bold px-2 py-0.5 rounded transition cursor-pointer"
                    >
                      + X-API-Key
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 leading-tight">
                  {lang === 'ar'
                    ? 'أضف ترويسات أمان لتمرير مفاتيح API_KEY أو Bearer tokens تلقائياً عند الاتصال بخدمة الـ MCP.'
                    : 'Include custom auth headers or API keys forwarded with each MCP request.'}
                </p>

                {addHeaders.map((header, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Header Name (e.g., Authorization)"
                      value={header.key}
                      onChange={(e) => {
                        const updated = [...addHeaders];
                        updated[idx].key = e.target.value;
                        setAddHeaders(updated);
                      }}
                      className="w-1/2 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono focus:outline-none focus:border-indigo-500 bg-white"
                    />
                    <input
                      type="text"
                      placeholder="Header Value / API Key"
                      value={header.value}
                      onChange={(e) => {
                        const updated = [...addHeaders];
                        updated[idx].value = e.target.value;
                        setAddHeaders(updated);
                      }}
                      className="w-1/2 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono focus:outline-none focus:border-indigo-500 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => setAddHeaders(addHeaders.filter((_, i) => i !== idx))}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => setAddHeaders([...addHeaders, { key: '', value: '' }])}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 mt-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{lang === 'ar' ? 'إضافة ترويسة أمان مخصصة' : 'Add Custom Header'}</span>
                </button>
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

      {/* Modal: Edit Existing MCP Server */}
      {editingServer && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full border border-slate-200 shadow-xl space-y-4 animate-in fade-in-50 zoom-in-95 duration-150 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Pencil className="w-5 h-5 text-indigo-600" />
                <span>{lang === 'ar' ? 'تعديل خادم MCP وترويسات الأمان' : 'Edit MCP Server & Headers'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditingServer(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditServerSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'اسم الخادم:' : 'Server Name:'}
                </label>
                <input
                  type="text"
                  required
                  value={editServerName}
                  onChange={(e) => setEditServerName(e.target.value)}
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
                  value={editEndpointUrl}
                  onChange={(e) => setEditEndpointUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'مستوى الحماية (Sandbox Tier):' : 'Sandbox Tier:'}
                </label>
                <select
                  value={editSandboxTier}
                  onChange={(e) => setEditSandboxTier(e.target.value)}
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
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Security Headers Editor */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-amber-600" />
                    <span>{lang === 'ar' ? 'ترويسات الأمان ومفاتيح الـ API (Headers / Auth Tokens):' : 'Security Headers & API Keys:'}</span>
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setEditHeaders([...editHeaders, { key: 'Authorization', value: 'Bearer ' }])}
                      className="text-[10px] bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold px-2 py-0.5 rounded transition cursor-pointer"
                    >
                      + Authorization
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditHeaders([...editHeaders, { key: 'X-API-Key', value: '' }])}
                      className="text-[10px] bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-bold px-2 py-0.5 rounded transition cursor-pointer"
                    >
                      + X-API-Key
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 leading-tight">
                  {lang === 'ar'
                    ? 'تعديل أو إزالة ترويسات الأمان المسجلة لخادم الـ MCP هذا.'
                    : 'Modify or remove security headers attached to this MCP server.'}
                </p>

                {editHeaders.map((header, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Header Name"
                      value={header.key}
                      onChange={(e) => {
                        const updated = [...editHeaders];
                        updated[idx].key = e.target.value;
                        setEditHeaders(updated);
                      }}
                      className="w-1/2 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono focus:outline-none focus:border-indigo-500 bg-white"
                    />
                    <input
                      type="text"
                      placeholder="Header Value / API Key"
                      value={header.value}
                      onChange={(e) => {
                        const updated = [...editHeaders];
                        updated[idx].value = e.target.value;
                        setEditHeaders(updated);
                      }}
                      className="w-1/2 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono focus:outline-none focus:border-indigo-500 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => setEditHeaders(editHeaders.filter((_, i) => i !== idx))}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => setEditHeaders([...editHeaders, { key: '', value: '' }])}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 mt-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{lang === 'ar' ? 'إضافة ترويسة أمان مخصصة' : 'Add Custom Header'}</span>
                </button>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition cursor-pointer flex items-center justify-center gap-2"
                >
                  {isSavingEdit ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>جاري الحفظ والتحديث...</span>
                    </>
                  ) : (
                    <span>{lang === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingServer(null)}
                  className="py-2.5 px-4 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
                >
                  {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: AI Tool Builder */}
      {showToolBuilderModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full border border-slate-200 shadow-2xl space-y-5 animate-in fade-in-50 zoom-in-95 duration-150 my-8">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-indigo-600 text-white flex items-center justify-center shadow-md">
                  <Wand2 className="w-5 h-5 text-amber-100" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <span>{lang === 'ar' ? 'منشئ الأدوات بالذكاء الاصطناعي (AI Tool Builder)' : 'AI Tool Schema Builder'}</span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
                      MCP 2026-07-28
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {lang === 'ar'
                      ? 'اكتب وصفاً نصياً لما تريده من الأداة، وسيقوم الذكاء الاصطناعي بتحويله تلقائياً إلى مخطط رسم المعاملات JSON Schema وتخزينه في خادم MCP.'
                      : 'Describe the tool in natural language, and Gemini will generate a valid JSON Schema & register it to the MCP configuration.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowToolBuilderModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Message */}
            {builderError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{builderError}</span>
              </div>
            )}

            {/* Step 1: Configuration Form */}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {lang === 'ar' ? 'اختر خادم الـ MCP المستهدف لحفظ الأداة فيه:' : 'Target MCP Server:'}
                </label>
                <select
                  value={builderTargetServerId}
                  onChange={(e) => setBuilderTargetServerId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500 bg-white"
                >
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.endpointUrl}) - Tier: {s.sandboxTier}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 block">
                    {lang === 'ar' ? 'الوصف النصي المطلوب للأداة (باللغة العربية أو الإنجليزية):' : 'Tool Natural Language Requirement:'}
                  </label>
                  <span className="text-[10px] text-indigo-600 font-semibold flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    <span>Gemini 3.6 Flash</span>
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={builderPrompt}
                  onChange={(e) => setBuilderPrompt(e.target.value)}
                  placeholder={
                    lang === 'ar'
                      ? 'مثال: أريد أداة تفحص حالة شحنة العميل باستخدام رقم التتبع ورقم الجوال وتسترجع الموقع الحالي وزمن الوصول المتوقع.'
                      : 'Example: Tool to check customer order tracking status given tracking_number and phone_number.'
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-indigo-500 leading-relaxed"
                />

                {/* Quick Prompts Suggestions */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="text-[10px] font-bold text-slate-400 self-center">
                    {lang === 'ar' ? 'أفكار سريعة:' : 'Quick Ideas:'}
                  </span>
                  {[
                    'أداة الاستعلام عن المخزون بالمنتج والفرع',
                    'أداة فحص حالة الدفع المالي بالفاتورة',
                    'أداة إرسال إشعار SMS للعميل',
                    'أداة تحويل العملات واسترجاع سعر الصرف',
                  ].map((presetPrompt) => (
                    <button
                      key={presetPrompt}
                      type="button"
                      onClick={() => setBuilderPrompt(presetPrompt)}
                      className="px-2.5 py-1 rounded-lg bg-indigo-50/80 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 text-[10px] font-medium transition cursor-pointer"
                    >
                      + {presetPrompt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleGenerateTool}
                  disabled={isGeneratingTool || !builderPrompt.trim()}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  {isGeneratingTool ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-amber-200" />
                      <span>{lang === 'ar' ? 'جاري التوليد بالذكاء الاصطناعي...' : 'Generating Tool Schema...'}</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4 text-amber-200" />
                      <span>{lang === 'ar' ? 'توليد كود ومخطط الأداة' : 'Generate Schema'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Step 2: Generated Schema Preview & Review */}
            {generatedToolSchema && (
              <div className="p-4 bg-slate-900 rounded-2xl text-slate-100 space-y-4 border border-slate-800 animate-in fade-in duration-200">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>{lang === 'ar' ? 'تم توليد مخطط الأداة بنجاح' : 'Schema Generated Successfully'}</span>
                  </div>
                  <span className="text-[10px] bg-slate-800 text-slate-300 font-mono px-2 py-0.5 rounded border border-slate-700">
                    JSON Schema Validated
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      {lang === 'ar' ? 'اسم الأداة البرمجي (Tool Name):' : 'Tool Identifier:'}
                    </label>
                    <input
                      type="text"
                      value={generatedToolSchema.toolName}
                      onChange={(e) =>
                        setGeneratedToolSchema({ ...generatedToolSchema, toolName: e.target.value })
                      }
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 font-mono text-xs text-amber-300 focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      {lang === 'ar' ? 'الوصف الوظيفي للأداة:' : 'Description:'}
                    </label>
                    <input
                      type="text"
                      value={generatedToolSchema.description}
                      onChange={(e) =>
                        setGeneratedToolSchema({ ...generatedToolSchema, description: e.target.value })
                      }
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-400"
                    />
                  </div>
                </div>

                {/* Parameters List */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                    {lang === 'ar' ? 'المعاملات والمدخلات (Parameters Schema):' : 'Parameters:'}
                  </label>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {Object.entries(generatedToolSchema.properties || {}).map(([paramKey, paramVal]) => {
                      const isRequired = generatedToolSchema.required?.includes(paramKey);
                      return (
                        <div
                          key={paramKey}
                          className="flex items-center justify-between p-2 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-indigo-300 font-bold">{paramKey}</span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-700 text-[10px] text-amber-300 font-mono">
                              {paramVal.type}
                            </span>
                            {isRequired && (
                              <span className="px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-300 text-[9px] font-bold">
                                {lang === 'ar' ? 'إجباري' : 'Required'}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 max-w-[200px] truncate">
                            {paramVal.description}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Sample JSON Response */}
                {generatedToolSchema.sampleResponse && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      {lang === 'ar' ? 'نموذج النتيجة المتوقعة (Sample JSON Output):' : 'Sample Output:'}
                    </label>
                    <pre className="p-2.5 rounded-lg bg-slate-950 text-emerald-400 font-mono text-[11px] overflow-x-auto border border-slate-800">
                      {JSON.stringify(generatedToolSchema.sampleResponse, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Save Button */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={handleSaveTool}
                    disabled={isSavingTool}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-md shadow-emerald-600/20"
                  >
                    {isSavingTool ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{lang === 'ar' ? 'جاري حفظ الأداة...' : 'Persisting Tool...'}</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-100" />
                        <span>{lang === 'ar' ? 'اعتماد وحفظ الأداة في الـ MCP' : 'Persist Tool to MCP'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
