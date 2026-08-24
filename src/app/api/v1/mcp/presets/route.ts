import { NextRequest, NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { db } from '@/lib/storage/db';
import { getEnv } from '@/lib/env/runtimeEnv';
import { MCP_SERVER_PRESETS, getPresetById } from '@/lib/mcp/presets';
import { MCPServerConfig } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

/**
 * Curated MCP server catalog. GET lists famous/useful server presets with
 * live-availability and per-tenant installation state; POST installs a preset
 * as a tenant MCP server in one click.
 */

function presetAvailability(preset: (typeof MCP_SERVER_PRESETS)[number]) {
  if (!preset.anyOfEnv || preset.anyOfEnv.length === 0) {
    return { ready: true, missingEnv: [] as string[] };
  }
  const present = preset.anyOfEnv.some((key) => !!getEnv(key));
  return {
    ready: present,
    // Report ALL alternatives so the UI can tell the user which keys WOULD work.
    missingEnv: present ? [] : [...preset.anyOfEnv],
  };
}

export const GET = withAuthAndRateLimit(async (req: NextRequest, authCtx) => {
  try {
    getEnv('TAVILY_API_KEY', req);
    getEnv('SERPER_API_KEY', req);
    getEnv('BRAVE_API_KEY', req);
    getEnv('UNSTRUCTURED_API_KEY', req);
    getEnv('MISTRAL_API_KEY', req);
    getEnv('GEMINI_API_KEY', req);

    const tenantId = authCtx.tenantId;
    const servers = await db.getMcpServers(tenantId);
    const installedPresetIds = new Set(servers.map((s) => (s.config as any)?.presetId).filter(Boolean));

    const catalog = MCP_SERVER_PRESETS.map((preset) => ({
      ...preset,
      ...presetAvailability(preset),
      installed: installedPresetIds.has(preset.id),
      toolsRegistered: preset.enabledTools.every((t) => !!servers.some((s) => s.enabledTools.includes(t))),
    }));

    return NextResponse.json({
      success: true,
      totalPresets: catalog.length,
      presets: catalog,
    });
  } catch (err: any) {
    console.error('[api/v1/mcp/presets] GET error:', err);
    return NextResponse.json({ success: false, error: 'فشل جلب كتالوج خوادم MCP' }, { status: 500 });
  }
});

export const POST = withAuthAndRateLimit(async (req: NextRequest, authCtx) => {
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = authCtx.tenantId;
    const presetId = body?.presetId;

    const preset = getPresetById(String(presetId || ''));
    if (!preset) {
      return NextResponse.json({ success: false, error: 'قالب خادم MCP غير معروف' }, { status: 404 });
    }

    const servers = await db.getMcpServers(tenantId);
    if (servers.some((s) => (s.config as any)?.presetId === preset.id)) {
      return NextResponse.json(
        { success: false, error: `خادم (${preset.name}) مسجّل مسبقاً لهذا المستأجر`, code: 'ALREADY_INSTALLED' },
        { status: 409 },
      );
    }

    const availability = presetAvailability(preset);
    const newServer: MCPServerConfig = {
      id: `mcp-${preset.id}-${Math.random().toString(36).slice(2, 6)}`,
      tenantId,
      name: preset.name,
      description: preset.description,
      endpointUrl: preset.endpointUrl,
      protocolVersion: '2026-07-28',
      sandboxTier: preset.sandboxTier,
      transportType: preset.transportType,
      enabledTools: [...preset.enabledTools],
      requireConfirmationTools: [...preset.requireConfirmationTools],
      headers: {},
      status: 'healthy',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      config: { presetId: preset.id },
    };

    await db.addMcpServer(newServer);

    await db.addAuditLog({
      id: `audit-${Date.now()}-preset`,
      tenantId,
      actorId: authCtx.userId || 'mcp_gateway_admin',
      action: 'MCP_PRESET_INSTALLED',
      resourceType: 'mcp_server',
      resourceId: newServer.id,
      status: 'success',
      details: `تم تثبيت خادم (${preset.name}) من كتالوج MCP بأدوات: ${preset.enabledTools.join(', ')}.${availability.ready ? '' : ` تنبيه: المفاتيح المطلوبة للتشغيل الحي غير مهيأة (${availability.missingEnv.join(' أو ')}).`}`,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        success: true,
        server: newServer,
        availability,
        servers: await db.getMcpServers(tenantId),
      },
      { status: 201 },
    );
  } catch (err: any) {
    console.error('[api/v1/mcp/presets] POST error:', err);
    return NextResponse.json({ success: false, error: 'فشل تثبيت قالب خادم MCP' }, { status: 500 });
  }
});
