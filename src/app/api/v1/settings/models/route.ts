import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_AI_MODELS,
  AIModelConfig,
  normalizeModelConfig,
  parseModelConfigFromRequest,
  MODEL_CONFIG_COOKIE,
} from '@/lib/config/aiModels';
import { serverErrorResponse } from '@/lib/api/safeError';

export const dynamic = 'force-dynamic';

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    // Read the effective model config for this request: header first, then
    // the persisted cookie, finally DEFAULT_AI_MODELS. Sharing the canonical
    // resolver keeps every server path consistent.
    const config = parseModelConfigFromRequest(req);

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
    // normalizeModelConfig fills any missing field (defaults to DEFAULT_AI_MODELS),
    // so adding new keys (whisper/ocr/fallbackModels) needs no special handling.
    const updatedConfig: AIModelConfig = normalizeModelConfig({
      ...body,
      updatedAt: body?.updatedAt || new Date().toISOString(),
    });

    const response = NextResponse.json({
      success: true,
      message: 'تم حفظ إعدادات نماذج الذكاء الاصطناعي بنجاح',
      config: updatedConfig,
    });

    // Attach as cookie for server-side persistence across requests.
    // parseModelConfigFromRequest reads this as a fallback when the header
    // (attached by fetchWithAuth) is absent.
    response.cookies.set(MODEL_CONFIG_COOKIE, JSON.stringify(updatedConfig), {
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      sameSite: 'lax',
    });

    return response;
  } catch (error: any) {
    return serverErrorResponse('settings/models POST', error);
  }
});
