import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { verifyApiAuth } from '@/lib/auth/apiAuth';
import { checkRateLimit } from '@/lib/security/rateLimiter';

export const dynamic = 'force-dynamic';

let aiClient: GoogleGenAI | null = null;
function getAi(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/octet-stream',
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  // Rate limiting
  const rateLimit = checkRateLimit(req, 20, 60000);
  if (!rateLimit.success && rateLimit.response) {
    return rateLimit.response;
  }

  // Auth verification
  const auth = await verifyApiAuth(req);
  if (!auth.authenticated && auth.response) {
    return auth.response;
  }

  try {
    const { fileName = 'document.txt', fileData, mimeType = 'text/plain', model: requestedModel } = await req.json();

    if (!fileData || typeof fileData !== 'string') {
      return NextResponse.json({ error: 'محتوى الملف مطلوب (File data is required)', code: '400_MISSING_DATA' }, { status: 400 });
    }

    // Size limit check
    const approximateSizeBytes = (fileData.length * 3) / 4;
    if (approximateSizeBytes > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'حجم الملف يتجاوز الحد المسموح به (10 ميجابايت)', code: '413_FILE_TOO_LARGE' },
        { status: 413 }
      );
    }

    // MIME type check
    if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
      return NextResponse.json(
        { error: 'نوع الملف غير مدعوم (Unsupported MIME type)', code: '415_UNSUPPORTED_TYPE' },
        { status: 415 }
      );
    }

    let parseModel = requestedModel || 'gemini-3.6-flash';
    let extractedText = '';

    const ai = getAi();
    const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

    if (isPdf && ai) {
      const cleanBase64 = fileData.replace(/^data:application\/pdf;base64,/, '');

      const response = await ai.models.generateContent({
        model: parseModel,
        contents: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: cleanBase64,
            },
          },
          'Extract and transcribe the full text content from this document. Preserve the logical document layout, headings, tables, paragraphs, list items, and order. If the content is in Arabic, extract it carefully with perfect Arabic spelling and punctuation without any scrambled characters or errors. Output only the extracted document text directly.',
        ],
      });

      extractedText = response.text || '';
    } else {
      const isText = mimeType.startsWith('text/') || 
                     fileName.toLowerCase().endsWith('.txt') || 
                     fileName.toLowerCase().endsWith('.md') || 
                     fileName.toLowerCase().endsWith('.json') ||
                     fileName.toLowerCase().endsWith('.csv');

      if (isText) {
        const cleanBase64 = fileData.split(',')[1] || fileData;
        extractedText = Buffer.from(cleanBase64, 'base64').toString('utf-8');
      } else if (ai) {
        const cleanBase64 = fileData.split(',')[1] || fileData;
        const response = await ai.models.generateContent({
          model: parseModel,
          contents: [
            {
              inlineData: {
                mimeType: mimeType || 'application/octet-stream',
                data: cleanBase64,
              },
            },
            'Extract and transcribe all readable text from this file. Output only the extracted document text directly.',
          ],
        });
        extractedText = response.text || '';
      } else {
        extractedText = 'تعذر معالجة الملف لعدم توفر مفتاح Gemini API.';
      }
    }

    return NextResponse.json({ text: extractedText });
  } catch (error: any) {
    console.error('Error parsing document in /api/v1/documents/parse:', error);
    return NextResponse.json(
      { error: 'فشل استخراج النص من المستند', code: '500_PARSE_FAILED' },
      { status: 500 }
    );
  }
});
