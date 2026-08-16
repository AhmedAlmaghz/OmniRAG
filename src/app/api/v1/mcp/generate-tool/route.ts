import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { db } from '@/lib/storage/db';
import { getAiModel } from '@/lib/config/aiModels';

export const dynamic = 'force-dynamic';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
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

يجب أن ترجع المخرجات بنفس هيكل JSON الموضح أدناه:
- toolName: اسم الأداة بلغة البرمجة بصيغة snake_case باللغة الإنجليزية وبصيغة دقيقة تعبر عن الفعل (مثل get_stock_price, check_order_status).
- description: شرح دقيق ومفصل لمهمة الأداة باللغة العربية.
- properties: كائن يحتوي جميع المدخلات/المعاملات المقبولة (parameters) بحيث يحدد نوع كل معامل (STRING, NUMBER, BOOLEAN) وشرحه بالعربية.
- required: مصفوفة بأسماء المعاملات الإلزامية التي لا يمكن للأداة العمل بدونها.
- sampleResponse: كائن JSON يمثل النتيجة المرتجعة المتوقعة من تشغيل الأداة توضيحياً.`;

      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [{ text: `قم بتحويل وصف الأداة التالي إلى مخطط أداة MCP دقيق ورسمي:\n\n${prompt}` }],
          },
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              toolName: { type: Type.STRING, description: 'اسم الأداة بالإنجليزية بصيغة snake_case' },
              description: { type: Type.STRING, description: 'شرح وتوثيق الأداة باللغة العربية' },
              properties: {
                type: Type.OBJECT,
                description: 'خريطة المعاملات والمدخلات مع أنواعها وشرحها',
              },
              required: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'أسماء المعاملات الإلزامية',
              },
              sampleResponse: {
                type: Type.OBJECT,
                description: 'استجابة افتراضية توضيحية لنتيجة تنفيذ الأداة',
              },
            },
            required: ['toolName', 'description', 'properties', 'required'],
          },
        },
      });

      const responseText = response.text || '{}';
      let parsedSchema: any;
      try {
        parsedSchema = JSON.parse(responseText);
      } catch {
        parsedSchema = {
          toolName: `custom_tool_${Date.now()}`,
          description: prompt,
          properties: { query: { type: 'STRING', description: 'مدخل الاستعلام العام' } },
          required: ['query'],
          sampleResponse: { success: true, message: 'تم التنفيذ بنجاح' },
        };
      }

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
  } catch (error: any) {
    console.error('Error in MCP generate-tool API:', error);
    return NextResponse.json({ error: 'فشل توليد الأداة (Failed to generate tool)' }, { status: 500 });
  }
});
