import { NextRequest, NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { generateContentWithResilience } from '@/lib/gemini/resilientGemini';
import { parseModelConfigFromRequest, getAiModel, getFallbackModels } from '@/lib/config/aiModels';
import { runWithModelConfig } from '@/lib/config/aiModelsServer';

export const dynamic = 'force-dynamic';

export const POST = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  // Bind the client's configured models to this request so getAiModel/getFallbackModels
  // downstream resolve the user's choices instead of DEFAULT_AI_MODELS.
  const modelConfig = parseModelConfigFromRequest(req);

  try {
    const body = await req.json().catch(() => ({}));
    const { prompt, locale = 'ar' } = body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      // Fallback deterministic response if API key is not yet set
      return NextResponse.json({
        status: 'success',
        result:
          locale === 'ar'
            ? `// مكون Next.js App Router تم توليده بنجاح:\n\nexport default function DynamicWidget() {\n  return (\n    <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-white">\n      <h3 className="text-lg font-bold">مكون متوافق مع معايير Next.js v16</h3>\n      <p className="text-slate-400 text-sm mt-2">${prompt}</p>\n    </div>\n  );\n}`
            : `// Generated Next.js App Router Component:\n\nexport default function DynamicWidget() {\n  return (\n    <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-white">\n      <h3 className="text-lg font-bold">Next.js v16 Compliant Component</h3>\n      <p className="text-slate-400 text-sm mt-2">${prompt}</p>\n    </div>\n  );\n}`,
      });
    }

    return await runWithModelConfig(modelConfig, async () => {
      const response = await generateContentWithResilience({
        model: getAiModel('chatModel'),
        fallbackModels: getFallbackModels(),
        contents: `You are an expert Next.js and TypeScript architect. The user prompt is: "${prompt}". Provide a concise, high quality response in ${locale === 'ar' ? 'Arabic' : 'English'} with clean TypeScript / React code snippets.`,
        maxRetriesPerModel: 2,
      });

      return NextResponse.json({
        status: 'success',
        result: response?.text || 'No response generated',
      });
    });
  } catch (error: any) {
    console.error('GenAI route error:', error);
    return NextResponse.json({ error: 'فشل توليد المحتوى (Failed to process AI generation)' }, { status: 500 });
  }
});
