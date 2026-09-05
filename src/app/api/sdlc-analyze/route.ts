import { createLogger } from '@/lib/logging/logger';

const log = createLogger('AppApiSdlcAnalyze');

import { NextRequest, NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { generateTextResilient } from '@/lib/ai/resilientGenerate';
import { parseModelConfigFromRequest, getAiModel, getFallbackModels } from '@/lib/config/aiModels';
import { runWithModelConfig } from '@/lib/config/aiModelsServer';

export const dynamic = 'force-dynamic';

// Vercel Hobby execution ceiling — without this the platform default
// (~10s for unspecified routes) kills the function before slow provider
// calls finish, surfacing as raw connection errors.
export const maxDuration = 60;

export const POST = withAuthAndRateLimit(async (req: NextRequest, authCtx, props) => {
  const modelConfig = parseModelConfigFromRequest(req);

  try {
    const body = await req.json().catch(() => ({}));
    const { code = '', focus = 'security-and-types' } = body;

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        {
          score: 0,
          securityRating: 'C',
          summaryAr: 'لم يتم تقديم أي كود للتحليل.',
          summaryEn: 'No code provided for analysis.',
          recommendations: [],
        },
        { status: 400 },
      );
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (apiKey) {
      try {
        const prompt = `Analyze the following TypeScript / React code snippet against enterprise SDLC standards, security (no leaked secrets, no dangerous innerHTML), type-safety (no implicit any), and React best practices.
Code:
\`\`\`typescript
${code.slice(0, 3000)}
\`\`\`

Return a strictly valid JSON response without markdown formatting with this schema:
{
  "score": number (0-100),
  "securityRating": "A+" | "A" | "B" | "C",
  "summaryAr": string,
  "summaryEn": string,
  "recommendations": [
    { "type": "security" | "type-safety" | "performance", "messageAr": string, "messageEn": string }
  ]
}`;

        // Bind the request's model config so getAiModel/getFallbackModels inside
        // generateTextResilient resolve to the client's configured models.
        const result = await runWithModelConfig(modelConfig, () =>
          generateTextResilient({
            model: getAiModel('chatModel'),
            fallbackModels: getFallbackModels(),
            prompt,
            maxRetries: 2,
          }),
        );

        const text = result?.text || '';
        if (text) {
          const cleaned = text
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
          const parsed = JSON.parse(cleaned);
          return NextResponse.json(parsed);
        }
      } catch (aiErr) {
        log.warn('AI analysis fallback to static heuristic');
      }
    }

    // Heuristic static analysis fallback
    const hasAny = code.includes(': any') || code.includes('any[]');
    const hasHardcodedSecret =
      /AIza[0-9A-Za-z-_]{35}/.test(code) || /sk-[0-9A-Za-z]{20,}/.test(code) || code.includes('FakeSecretKey');
    const hasDangerouslySetInnerHTML = code.includes('dangerouslySetInnerHTML');
    const hasConsoleLog = code.includes('console.log');

    let score = 95;
    const recommendations = [];

    if (hasHardcodedSecret) {
      score -= 35;
      recommendations.push({
        type: 'security',
        messageAr:
          'تم اكتشاف مفتاح API حساس مسجل بشكل نصي صريح في الكود. انقله فوراً إلى ملف البيئة .env.example وخادم الـ API.',
        messageEn: 'Hardcoded API secret detected. Move it to server-side environment variables immediately.',
      });
    }

    if (hasAny) {
      score -= 15;
      recommendations.push({
        type: 'type-safety',
        messageAr: 'استخدام النوع "any" يضعف متانة النظام. قم بإنشاء واجهة Interface مخصصة لتمثيل الكائن.',
        messageEn: 'Usage of "any" type reduces type-safety. Define explicit TypeScript interfaces.',
      });
    }

    if (hasDangerouslySetInnerHTML) {
      score -= 20;
      recommendations.push({
        type: 'security',
        messageAr: 'استخدام dangerouslySetInnerHTML قد يعرض التطبيق لثغرات XSS. تأكد من تنقية المدخلات.',
        messageEn: 'dangerouslySetInnerHTML may introduce XSS vulnerabilities. Ensure proper sanitization.',
      });
    }

    if (hasConsoleLog) {
      score -= 5;
      recommendations.push({
        type: 'performance',
        messageAr: 'إزالة أو استبدال console.log بنظام تسجيل تدقيق منظم في بيئة الإنتاج.',
        messageEn: 'Remove or replace console.log statements before production deployment.',
      });
    }

    const rating = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 65 ? 'B' : 'C';

    return NextResponse.json({
      score: Math.max(0, score),
      securityRating: rating,
      summaryAr: `تم فحص الكود بنجاح. النتيجة العامة: ${score}/100 بتصنيف أمان (${rating}).`,
      summaryEn: `Code analyzed successfully. Overall score: ${score}/100 with rating (${rating}).`,
      recommendations,
    });
  } catch (error: unknown) {
    // Previously this catch returned HTTP 200 with a hard-coded "B" rating,
    // which fabricated a successful analysis when the route actually failed.
    // Surface the failure honestly with a 500 and an Arabic-safe message that
    // does not leak the underlying error to the client.
    log.error('SDLC analyze error:', error);
    return NextResponse.json(
      {
        score: 0,
        securityRating: 'C',
        summaryAr: 'تعذّر إجراء التحليل بسبب خطأ داخلي. يرجى المحاولة لاحقاً.',
        summaryEn: 'Analysis could not be completed due to an internal error. Please retry later.',
        recommendations: [],
      },
      { status: 500 },
    );
  }
});
