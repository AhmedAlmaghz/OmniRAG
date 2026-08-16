import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_AI_MODELS, AIModelConfig } from '@/lib/config/aiModels';
import { serverErrorResponse } from '@/lib/api/safeError';

export const dynamic = 'force-dynamic';

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    // Optionally inspect cookie or header if user provided client model config header
    const customHeader = req.headers.get('x-ai-model-config');
    let config: AIModelConfig = { ...DEFAULT_AI_MODELS };

    if (customHeader) {
      try {
        const parsed = JSON.parse(customHeader);
        config = { ...config, ...parsed };
      } catch {
        // Fallback to defaults
      }
    }

    return NextResponse.json({
      success: true,
      config,
      defaults: DEFAULT_AI_MODELS,
      serverTime: new Date().toISOString(),
    });
  } catch (error: any) {
    return serverErrorResponse('settings/models GET', error);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    const body = await req.json();
    const updatedConfig: AIModelConfig = {
      chatModel: body.chatModel || DEFAULT_AI_MODELS.chatModel,
      analysisModel: body.analysisModel || DEFAULT_AI_MODELS.analysisModel,
      hydeModel: body.hydeModel || DEFAULT_AI_MODELS.hydeModel,
      documentParseModel: body.documentParseModel || DEFAULT_AI_MODELS.documentParseModel,
      chatStreamModel: body.chatStreamModel || DEFAULT_AI_MODELS.chatStreamModel,
      embeddingModel: body.embeddingModel || DEFAULT_AI_MODELS.embeddingModel,
      updatedAt: new Date().toISOString(),
    };

    const response = NextResponse.json({
      success: true,
      message: 'تم حفظ إعدادات نماذج الذكاء الاصطناعي بنجاح',
      config: updatedConfig,
    });

    // Attach as cookie for server-side persistence across requests
    response.cookies.set('omnirag_ai_model_config', JSON.stringify(updatedConfig), {
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      sameSite: 'lax',
    });

    return response;
  } catch (error: any) {
    return serverErrorResponse('settings/models POST', error);
  }
});
