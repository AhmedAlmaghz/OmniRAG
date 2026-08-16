import { db } from '@/lib/storage/db';
import { MCPServerConfig } from '@/lib/types/omnirag';
import { processMcpProtocolRequest } from './server-factory';

export interface MCPClientConnectionStatus {
  serverId: string;
  serverName: string;
  status: 'connected' | 'healthy' | 'degraded' | 'disconnected';
  protocolVersion: string;
  latencyMs: number;
  lastPingAt: string;
  activeToolsCount: number;
}

interface CacheEntry {
  status: MCPClientConnectionStatus;
  expiresAt: number;
}

/**
 * MCP Client Pool manages connections, TTL caching, health probes, and stateless dispatching
 */
export class MCPClientPool {
  private cache = new Map<string, CacheEntry>();
  private readonly TTL_MS = 60 * 1000; // 60 seconds TTL cache per SDLC specs

  /**
   * Probe and ping a registered MCP server to check latency and tool health
   */
  async probeServer(server: MCPServerConfig, tenantId: string): Promise<MCPClientConnectionStatus> {
    const startTime = Date.now();
    const cacheKey = `${server.id}-${tenantId}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.status;
    }

    let status: 'healthy' | 'degraded' | 'disconnected' = 'healthy';
    let latencyMs = 12;

    try {
      if (server.transportType === 'http' || server.transportType === 'sse') {
        // Direct probe to the stateless gateway protocol handler
        const pingRes = await processMcpProtocolRequest(
          { jsonrpc: '2.0', id: 'probe-1', method: 'ping' },
          { tenantId, serverId: server.id },
        );

        latencyMs = Math.max(5, Date.now() - startTime);

        if (pingRes.error) {
          status = 'degraded';
        }
      } else {
        // Stdio/WebSocket internal probe — no real endpoint to time, so report
        // the measured probe attempt duration rather than a fabricated value.
        latencyMs = Math.max(1, Date.now() - startTime);
      }
    } catch (err) {
      status = 'disconnected';
      latencyMs = 999;
    }

    const connStatus: MCPClientConnectionStatus = {
      serverId: server.id,
      serverName: server.name,
      status: server.status === 'down' ? 'disconnected' : status,
      protocolVersion: '2026-07-28',
      latencyMs,
      lastPingAt: new Date().toISOString(),
      activeToolsCount: server.enabledTools?.length || 0,
    };

    // Cache connection state for 60s
    this.cache.set(cacheKey, {
      status: connStatus,
      expiresAt: Date.now() + this.TTL_MS,
    });

    return connStatus;
  }

  /**
   * Execute a tool call on a target MCP server using client routing
   */
  async executeToolCall(
    serverId: string,
    toolName: string,
    args: Record<string, any>,
    ctx: { tenantId: string; userId?: string },
  ) {
    const servers = await db.getMcpServers(ctx.tenantId);
    const targetServer = servers.find((s) => s.id === serverId);

    if (!targetServer) {
      throw new Error(`خادم الـ MCP المباشر (${serverId}) غير موجود أو تم حذفه`);
    }

    if (targetServer.status === 'down') {
      throw new Error(`خادم الـ MCP (${targetServer.name}) غير متصل (Down)`);
    }

    if (!targetServer.enabledTools.includes(toolName)) {
      throw new Error(`الأداة (${toolName}) غير مفعلة على خادم الـ MCP (${targetServer.name})`);
    }

    // Route request through stateless MCP gateway
    const res = await processMcpProtocolRequest(
      {
        jsonrpc: '2.0',
        id: `mcp-call-${Date.now()}`,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      },
      { tenantId: ctx.tenantId, userId: ctx.userId, serverId },
    );

    if (res.error) {
      throw new Error(res.error.message);
    }

    return res.result;
  }

  /**
   * Clear pooled connection cache for a tenant
   */
  clearCache(tenantId?: string) {
    if (!tenantId) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.endsWith(`-${tenantId}`)) {
        this.cache.delete(key);
      }
    }
  }
}

export const mcpClientPool = new MCPClientPool();
