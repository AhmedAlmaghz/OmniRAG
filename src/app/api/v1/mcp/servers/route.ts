import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { MCPServerConfig } from '@/lib/types/omnirag';
import { serverErrorResponse } from '@/lib/api/safeError';
import { probeEndpoint } from '@/lib/mcp/net';
import { mcpClientPool } from '@/lib/mcp/client-pool';
import { isStdioTransportAllowed, listRemoteTools } from '@/lib/mcp/remoteClient';
import { encryptToken } from '@/lib/mcp/auth/encryption';
import { guardPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  const denied = await guardPermission(authCtx, 'mcp:manage');
  if (denied) return denied;

  const tenantId = authCtx.tenantId;
  const servers = await db.getMcpServers(tenantId);
  return NextResponse.json({ servers, stdioEnabled: isStdioTransportAllowed() });
});

/**
 * Normalizes the operator-provided server config for stdio transports:
 * requires a command, and encrypts env values at rest (AES-256-GCM). Masked
 * placeholder values (••••) mean "keep existing" and fall back to the
 * previously stored encrypted value on edit.
 */
function buildStdioConfig(
  rawConfig: Record<string, any> | undefined,
  existingConfig?: Record<string, any>,
): { ok: true; config: Record<string, any> } | { ok: false; error: string } {
  const command = String(rawConfig?.command || '').trim();
  if (!command) {
    return { ok: false, error: 'أمر التشغيل (command) مطلوب لخوادم stdio المحلية.' };
  }
  const rawArgs = rawConfig?.args;
  const args = Array.isArray(rawArgs)
    ? rawArgs.map((a) => String(a)).filter((a) => a.trim() !== '')
    : typeof rawArgs === 'string' && rawArgs.trim() !== ''
      ? rawArgs.split(/\s+/).map((a) => a.trim())
      : [];
  const env: Record<string, string> = {};
  if (rawConfig?.env && typeof rawConfig.env === 'object') {
    for (const [key, value] of Object.entries(rawConfig.env as Record<string, unknown>)) {
      const strValue = String(value ?? '');
      if (!key.trim()) continue;
      if (strValue.includes('•')) {
        const kept = existingConfig?.env?.[key];
        if (kept) env[key] = String(kept); // keep existing encrypted value
        continue;
      }
      if (strValue.trim() === '') continue;
      env[key] = encryptToken(strValue);
    }
  }
  return { ok: true, config: { command, args, env } };
}

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    const denied = await guardPermission(authCtx, 'mcp:manage');
    if (denied) return denied;

    const body = await req.json();
    const tenantId = authCtx.tenantId;

    // Action 1: Add/Register Server
    if ((body.action === 'add' && body.server) || (body.endpointUrl && body.name && !body.action)) {
      const serverData = body.server || body;

      // Determine default tools based on server name
      const nameLower = (serverData.name || '').toLowerCase();
      let defaultEnabled: string[] = [];
      let defaultRequired: string[] = [];

      if (nameLower.includes('slack') || nameLower.includes('تواصل')) {
        defaultEnabled = ['slack_send_message', 'slack_read_channel'];
        defaultRequired = ['slack_send_message'];
      } else if (nameLower.includes('github') || nameLower.includes('كود') || nameLower.includes('برمجة')) {
        defaultEnabled = ['github_search_code', 'github_create_issue', 'github_read_repo'];
        defaultRequired = ['github_create_issue'];
      } else if (
        nameLower.includes('search') ||
        nameLower.includes('web') ||
        nameLower.includes('بحث') ||
        nameLower.includes('ويب')
      ) {
        defaultEnabled = ['web_live_search', 'fetch_url_content'];
      } else if (
        nameLower.includes('postgres') ||
        nameLower.includes('sql') ||
        nameLower.includes('db') ||
        nameLower.includes('قاعدة')
      ) {
        defaultEnabled = ['external_postgres_query', 'get_table_schema'];
        defaultRequired = ['external_postgres_query'];
      } else {
        defaultEnabled = ['custom_action_execute', 'read_server_resource'];
      }

      const requestedTransport: MCPServerConfig['transportType'] =
        serverData.transportType === 'stdio' ||
        serverData.transportType === 'sse' ||
        serverData.transportType === 'websocket'
          ? serverData.transportType
          : 'http';

      if (requestedTransport === 'stdio' && !isStdioTransportAllowed()) {
        return NextResponse.json(
          {
            success: false,
            error: 'نقل stdio (الخوادم المحلية) متاح فقط في النشر الذاتي (self-hosted) ولا تدعمه بيئات Vercel المدارة.',
          },
          { status: 400 },
        );
      }

      let stdioConfig: Record<string, any> | undefined;
      if (requestedTransport === 'stdio') {
        const built = buildStdioConfig(serverData.config);
        if (!built.ok) {
          return NextResponse.json({ success: false, error: built.error }, { status: 400 });
        }
        stdioConfig = built.config;
      }

      const newServer: MCPServerConfig = {
        id: serverData.id || `mcp-${Date.now()}`,
        tenantId,
        name: serverData.name,
        endpointUrl: requestedTransport === 'stdio' ? 'stdio://local' : serverData.endpointUrl,
        description: serverData.description || 'خادم MCP مخصص للمؤسسة',
        sandboxTier: serverData.sandboxTier || 'T1_LIMITED',
        protocolVersion: serverData.protocolVersion || '2026-07-28',
        enabledTools: serverData.enabledTools || defaultEnabled,
        requireConfirmationTools: serverData.requireConfirmationTools || defaultRequired,
        headers: serverData.headers || {},
        authType:
          serverData.authType === 'basic' || serverData.authType === 'bearer' || serverData.authType === 'oauth2'
            ? serverData.authType
            : 'none',
        transportType: requestedTransport,
        config: stdioConfig || serverData.config || {},
        status: 'healthy',
        latencyMs: 0,
        lastChecked: new Date().toISOString(),
      };

      await db.addMcpServer(newServer);

      // Audit Log for adding a server
      await db.addAuditLog({
        id: `audit-${Date.now()}`,
        tenantId,
        actorId: 'mcp_gateway_admin',
        action: 'MCP_SERVER_REGISTERED',
        resourceType: 'mcp_server',
        resourceId: newServer.id,
        status: 'success',
        details: `تم تسجيل خادم MCP جديد باسم (${newServer.name}) بنجاح بمستوى حماية ${newServer.sandboxTier}.`,
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json(
        {
          success: true,
          server: newServer,
          servers: await db.getMcpServers(tenantId),
        },
        { status: 201 },
      );
    }

    // Action 1.5: Edit/Update Server Configuration
    if (body.action === 'edit' && body.server) {
      const serverData = body.server;
      const servers = await db.getMcpServers(tenantId);
      const existing = servers.find((s) => s.id === serverData.id);

      if (!existing) {
        return NextResponse.json({ error: 'خادم MCP غير موجود للتعديل' }, { status: 404 });
      }

      const requestedTransport: MCPServerConfig['transportType'] =
        serverData.transportType === 'stdio' ||
        serverData.transportType === 'sse' ||
        serverData.transportType === 'websocket'
          ? serverData.transportType
          : serverData.transportType === 'http'
            ? 'http'
            : existing.transportType || 'http';

      if (requestedTransport === 'stdio' && !isStdioTransportAllowed()) {
        return NextResponse.json(
          {
            success: false,
            error: 'نقل stdio (الخوادم المحلية) متاح فقط في النشر الذاتي (self-hosted) ولا تدعمه بيئات Vercel المدارة.',
          },
          { status: 400 },
        );
      }

      let nextConfig: Record<string, any> = serverData.config ?? existing.config ?? {};
      if (requestedTransport === 'stdio') {
        const built = buildStdioConfig(serverData.config ?? existing.config, existing.config);
        if (!built.ok) {
          return NextResponse.json({ success: false, error: built.error }, { status: 400 });
        }
        nextConfig = built.config;
      }

      const updatedServer: MCPServerConfig = {
        ...existing,
        name: serverData.name ?? existing.name,
        endpointUrl:
          requestedTransport === 'stdio' ? 'stdio://local' : (serverData.endpointUrl ?? existing.endpointUrl),
        description: serverData.description ?? existing.description,
        sandboxTier: serverData.sandboxTier ?? existing.sandboxTier,
        protocolVersion: serverData.protocolVersion ?? existing.protocolVersion,
        enabledTools: serverData.enabledTools ?? existing.enabledTools,
        requireConfirmationTools: serverData.requireConfirmationTools ?? existing.requireConfirmationTools,
        headers: serverData.headers ?? existing.headers ?? {},
        authType:
          serverData.authType === 'basic' || serverData.authType === 'bearer' || serverData.authType === 'oauth2'
            ? serverData.authType
            : serverData.authType === 'none'
              ? 'none'
              : existing.authType,
        transportType: requestedTransport,
        config: nextConfig,
        lastChecked: new Date().toISOString(),
      };

      await db.addMcpServer(updatedServer);

      // Audit Log for editing
      await db.addAuditLog({
        id: `audit-${Date.now()}`,
        tenantId,
        actorId: 'mcp_gateway_admin',
        action: 'MCP_SERVER_UPDATED',
        resourceType: 'mcp_server',
        resourceId: updatedServer.id,
        status: 'success',
        details: `تم تحديث بيانات وترويسات أمان خادم MCP (${updatedServer.name}) بنجاح.`,
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        server: updatedServer,
        servers: await db.getMcpServers(tenantId),
      });
    }

    // Action 2: Ping/Test Connection
    if (body.action === 'ping' && body.serverId) {
      const { serverId } = body;
      const servers = await db.getMcpServers(tenantId);
      const server = servers.find((s) => s.id === serverId);
      if (!server) {
        return NextResponse.json({ error: 'Server not found' }, { status: 404 });
      }

      // Shared probe with the MCP client pool (lib/mcp/net.probeEndpoint):
      // real network round-trip with timeout, SSRF guard, and honest
      // measured-latency reporting for dummy/seeded endpoints. stdio servers
      // have no URL — they are probed through a REAL protocol handshake
      // (spawn + initialize + tools/list) instead.
      let status: 'healthy' | 'degraded' | 'down';
      let latencyMs: number;
      let errorMsg = '';

      if (server.transportType === 'stdio') {
        const started = Date.now();
        try {
          await listRemoteTools(tenantId, server);
          status = 'healthy';
          latencyMs = Date.now() - started;
        } catch (err: any) {
          status = 'down';
          latencyMs = Date.now() - started;
          errorMsg = err?.message || 'فشل تشغيل خادم stdio المحلي';
        }
      } else {
        const probe = await probeEndpoint(server.endpointUrl, server.headers || {});
        status = probe.status;
        latencyMs = probe.latencyMs;
        errorMsg = probe.error || '';
      }

      const updatedServer = {
        ...server,
        status,
        latencyMs,
        lastChecked: new Date().toISOString(),
      };
      await db.addMcpServer(updatedServer);

      // Refresh the pooled health cache so subsequent probes don't serve the
      // stale pre-ping status for up to a minute.
      mcpClientPool.clearCache(tenantId);

      // Add to audit logs
      await db.addAuditLog({
        id: `audit-${Date.now()}`,
        tenantId,
        actorId: 'mcp_gateway_monitor',
        action: 'MCP_PING_CHECK',
        resourceType: 'mcp_server',
        resourceId: serverId,
        status: status === 'healthy' ? 'success' : 'error',
        details:
          status === 'healthy'
            ? `تم فحص الاتصال بـ ${server.name} بنجاح. زمن الاستجابة: ${latencyMs}ms.`
            : `فشل الاتصال بـ ${server.name}. الخطأ: ${errorMsg}.`,
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        status,
        latencyMs,
        lastChecked: updatedServer.lastChecked,
        error: errorMsg || undefined,
        servers: await db.getMcpServers(tenantId),
      });
    }

    // Action 3: Delete Server
    if (body.action === 'delete' && body.serverId) {
      const { serverId } = body;
      const servers = await db.getMcpServers(tenantId);
      const server = servers.find((s) => s.id === serverId);
      if (!server) {
        return NextResponse.json({ error: 'Server not found' }, { status: 404 });
      }

      await db.deleteMcpServer(serverId, tenantId);

      // Audit Log for deleting a server
      await db.addAuditLog({
        id: `audit-${Date.now()}`,
        tenantId,
        actorId: 'mcp_gateway_admin',
        action: 'MCP_SERVER_DELETED',
        resourceType: 'mcp_server',
        resourceId: serverId,
        status: 'success',
        details: `تم إلغاء تسجيل وحذف خادم MCP باسم (${server.name}) من النظام.`,
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        servers: await db.getMcpServers(tenantId),
      });
    }

    // Action 4: Toggle Tool (Legacy support & dynamic tool addition)
    const { serverId, toolName } = body;
    if (serverId && toolName) {
      // Toggle or Add Tool to enabledTools list
      const servers = await db.getMcpServers(tenantId);
      const server = servers.find((s) => s.id === serverId);
      if (server) {
        let updatedTools = [...server.enabledTools];
        if (updatedTools.includes(toolName)) {
          updatedTools = updatedTools.filter((t) => t !== toolName);
        } else {
          updatedTools.push(toolName);
        }

        const updatedServer = {
          ...server,
          enabledTools: updatedTools,
        };
        await db.addMcpServer(updatedServer);

        // Audit Log
        await db.addAuditLog({
          id: `audit-${Date.now()}`,
          tenantId,
          actorId: 'mcp_gateway_admin',
          action: 'MCP_TOOL_TOGGLED',
          resourceType: 'mcp_server',
          resourceId: serverId,
          status: 'success',
          details: `تم تعديل حالة تفعيل الأداة (${toolName}) على الخادم ${server.name}.`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({ success: true, servers: await db.getMcpServers(tenantId) });
  } catch (err: any) {
    return serverErrorResponse('mcp/servers POST', err);
  }
});
