import { createLogger } from '@/lib/logging/logger';

const log = createLogger('AppApiV1McpGenerateTool');

import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/storage/db';
import { getAiModel, parseModelConfigFromRequest } from '@/lib/config/aiModels';
import { runWithModelConfig } from '@/lib/config/aiModelsServer';
import { getEnv } from '@/lib/env/runtimeEnv';
import { resolveLanguageModel } from '@/lib/ai/registry/resolve';
import { guardPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

// Vercel Hobby execution ceiling — without this the platform default
// (~10s for unspecified routes) kills the function before slow provider
// calls finish, surfacing as raw connection errors.
export const maxDuration = 60;

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  // Load client-supplied dynamic environment keys from headers into process.env
  // / global store — required before constructing the Gemini client below,
  // otherwise a runtime-provisioned key would be invisible to this route.
  getEnv('GEMINI_API_KEY', req);
  // Bind the client's configured models to this request so getAiModel('chatModel')
  // resolves the user's choice instead of DEFAULT_AI_MODELS.
  const modelConfig = parseModelConfigFromRequest(req);

  return await runWithModelConfig(modelConfig, async () => {
    try {
      const denied = await guardPermission(authCtx, 'mcp:manage');
      if (denied) return denied;

      const body = await req.json();
      const { action = 'generate', prompt, serverId, toolSchema } = body;
      const tenantId = authCtx.tenantId;

      // Action 1: Generate Tool Schema from Natural Language Prompt
      if (action === 'generate') {
        if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
          return NextResponse.json({ error: 'الوصف النصي للأداة مطلوب' }, { status: 400 });
        }

        const modelName = getAiModel('chatModel');

        const systemInstruction = `أنت مهندس أدوات وأنظمة خوادم بروتوكول MCP (Model Context Protocol) للذكاء الاصطناعي.
مهمتك تحويل الوصف النصي المعطى بلغة طبيعية (عربية أو إنجليزية) إلى مصفوفة تعريف أداة برمجة قياسية (MCP Tool Schema) متوافقة تماماً مع معايير Gemini Function Calling و MCP Protocol.

يجب أن تعبّئ الحقول التالية بدقة:
- toolName: اسم الأداة بلغة البرمجة بصيغة snake_case باللغة الإنجليزية وبصيغة دقيقة تعبر عن الفعل (مثل get_stock_price, check_order_status).
- description: شرح دقيق ومفصل لمهمة الأداة باللغة العربية.
- properties: كائن يحتوي جميع المدخلات/المعاملات المقبولة (parameters) بحيث يحدد نوع كل معامل (STRING / NUMBER / BOOLEAN) وشرحه بالعربية.
- required: مصفوفة بأسماء المعاملات الإلزامية التي لا يمكن للأداة العمل بدونها.
- sampleResponse: كائن JSON يمثل النتيجة المرتجعة المتوقعة من تشغيل الأداة توضيحياً.`;

        // AI SDK v7 structured output — schema-constrained generation replaces
        // the old responseMimeType/responseSchema JSON parsing dance. The key
        // resolves through the shared provider so runtime-provisioned secrets
        // (x-env headers / env-config store) work exactly like host secrets.
        const { object: generatedSchema } = await generateObject({
          model: await resolveLanguageModel(modelName),
          system: systemInstruction,
          prompt: `قم بتحويل وصف الأداة التالي إلى مخطط أداة MCP دقيق ورسمي:

${prompt}`,
          schema: z.object({
            toolName: z.string().describe('اسم الأداة بالإنجليزية بصيغة snake_case'),
            description: z.string().describe('شرح وتوثيق الأداة باللغة العربية'),
            properties: z.record(z.string(), z.any()).describe('خريطة المعاملات والمدخلات مع أنواعها وشرحها'),
            required: z.array(z.string()).describe('أسماء المعاملات الإلزامية'),
            sampleResponse: z.any().optional().describe('استجابة افتراضية توضيحية لنتيجة تنفيذ الأداة'),
          }),
        });

        const parsedSchema = {
          ...generatedSchema,
          sampleResponse: (generatedSchema as any).sampleResponse || { success: true, message: 'تم التنفيذ بنجاح' },
        };

        return NextResponse.json({
          success: true,
          toolSchema: parsedSchema,
          modelUsed: modelName,
        });
      }

      // Action 2: Save & Persist Generated Tool Schema to MCP Server Config
      if (action === 'save') {
        if (!serverId || !toolSchema || !toolSchema.toolName) {
          return NextResponse.json({ error: 'معرف الخادم ومخطط الأداة مطلوبان للحفظ' }, { status: 400 });
        }

        const servers = await db.getMcpServers(tenantId);
        const server = servers.find((s) => s.id === serverId);

        if (!server) {
          return NextResponse.json({ error: 'خادم MCP غير موجود' }, { status: 404 });
        }

        const toolName = toolSchema.toolName.trim();
        const enabledTools = [...(server.enabledTools || [])];
        if (!enabledTools.includes(toolName)) {
          enabledTools.push(toolName);
        }

        // Preserve custom schemas on server
        const customSchemas = (server as any).customToolSchemas || {};
        customSchemas[toolName] = toolSchema;

        const updatedServer = {
          ...server,
          enabledTools,
          customToolSchemas: customSchemas,
        };

        await db.addMcpServer(updatedServer);

        // Audit Log for AI Generated Tool
        await db.addAuditLog({
          id: `audit-${Date.now()}`,
          tenantId,
          actorId: 'ai_tool_builder',
          action: 'MCP_AI_TOOL_CREATED',
          resourceType: 'mcp_tool',
          resourceId: `${serverId}:${toolName}`,
          status: 'success',
          details: `تم بناء واعتماد الأداة الذكية (${toolName}) بالذكاء الاصطناعي على خادم MCP (${server.name}).`,
          timestamp: new Date().toISOString(),
        });

        return NextResponse.json({
          success: true,
          message: `تم اعتماد وحفظ الأداة (${toolName}) بنجاح على خادم ${server.name}`,
          server: updatedServer,
          servers: await db.getMcpServers(tenantId),
        });
      }

      return NextResponse.json({ error: 'إجراء غير مدعوم' }, { status: 400 });
    } catch (error: unknown) {
      log.error('Error in MCP generate-tool API:', error);
      return NextResponse.json({ error: 'فشل توليد الأداة (Failed to generate tool)' }, { status: 500 });
    }
  });
});
