import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { verifyApiAuth } from '@/lib/auth/apiAuth';
import { checkRateLimit } from '@/lib/security/rateLimiter';

export const dynamic = 'force-dynamic';

let aiClient: GoogleGenAI | null = null;
function getAi(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
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

const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'docx', 'doc', 'txt', 'md', 'markdown', 'json', 'csv',
  'py', 'js', 'jsx', 'ts', 'tsx', 'go', 'html', 'css', 'xml',
  'yaml', 'yml', 'sql', 'c', 'cpp', 'h'
]);

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

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
        { error: 'حجم الملف يتجاوز الحد المسموح به (15 ميجابايت)', code: '413_FILE_TOO_LARGE' },
        { status: 413 }
      );
    }

    // Extension & MIME type check
    const fileExt = fileName.split('.').pop()?.toLowerCase() || '';
    if (fileExt && !ALLOWED_EXTENSIONS.has(fileExt) && mimeType && !ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
      return NextResponse.json(
        {
          error: `صيغة الملف (.${fileExt}) غير مدعومة. الصيغ المدعومة هي: PDF, DOCX, TXT, Markdown, JSON, CSV, وشفرات البرمجة.`,
          code: '415_UNSUPPORTED_TYPE',
        },
        { status: 415 }
      );
    }

    let parseModel = requestedModel || 'gemini-2.5-flash';
    let extractedText = '';

    const ai = getAi();
    const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
    const cleanBase64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
    const fileBuffer = Buffer.from(cleanBase64, 'base64');

    if (isPdf) {
      // Step 1: Try fast native node-pdf extraction via pdf-parse
      try {
        const pdfModule = await import('pdf-parse');
        const parsePdfFunc = (pdfModule as any).default || pdfModule;
        const parsedPdf = await parsePdfFunc(fileBuffer);
        if (parsedPdf && parsedPdf.text && parsedPdf.text.trim().length > 30) {
          extractedText = parsedPdf.text.trim();
          console.log(`[PDF Parser] Successfully extracted ${extractedText.length} chars from PDF using native pdf-parse`);
        }
      } catch (pdfErr) {
        console.warn('[PDF Parser] Native pdf-parse failed or PDF is image-based, trying Gemini AI OCR fallback:', (pdfErr as Error)?.message);
      }

      // Step 2: Fallback to Gemini Multimodal OCR if native pdf-parse produced insufficient text
      if ((!extractedText || extractedText.length <= 30) && ai) {
        try {
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
        } catch (geminiErr: any) {
          console.warn('Primary Gemini model failed for PDF extraction, attempting gemini-1.5-flash fallback:', geminiErr?.message);
          try {
            const fallbackResponse = await ai.models.generateContent({
              model: 'gemini-1.5-flash',
              contents: [
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: cleanBase64,
                  },
                },
                'Extract all readable text from this PDF document.',
              ],
            });
            extractedText = fallbackResponse.text || '';
          } catch (fbErr) {
            console.error('All Gemini PDF parsing models failed:', fbErr);
          }
        }
      }

      if (!extractedText || extractedText.trim().length === 0) {
        return NextResponse.json(
          {
            error: 'تعذر استخراج النصوص من ملف PDF. يرجى التأكد من أن الملف يحتوي على نصوص قابلة للقراءة أو ليس محميًا بكلمة مرور.',
            code: '422_PDF_UNREADABLE',
          },
          { status: 422 }
        );
      }
    } else {
      const isText = mimeType.startsWith('text/') || 
                     fileName.toLowerCase().endsWith('.txt') || 
                     fileName.toLowerCase().endsWith('.md') || 
                     fileName.toLowerCase().endsWith('.json') ||
                     fileName.toLowerCase().endsWith('.csv') ||
                     fileName.toLowerCase().endsWith('.py') ||
                     fileName.toLowerCase().endsWith('.js') ||
                     fileName.toLowerCase().endsWith('.ts') ||
                     fileName.toLowerCase().endsWith('.html') ||
                     fileName.toLowerCase().endsWith('.xml');

      if (isText) {
        extractedText = fileBuffer.toString('utf-8');
      } else if (ai) {
        try {
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
        } catch (geminiErr) {
          console.warn('Gemini multimodal extraction failed for non-text file, attempting UTF-8 raw read fallback');
          extractedText = fileBuffer.toString('utf-8');
        }
      } else {
        extractedText = fileBuffer.toString('utf-8');
      }
    }

    return NextResponse.json({
      text: extractedText,
      charCount: extractedText.length,
      wordCount: extractedText.trim().split(/\s+/).length,
    });
  } catch (error: any) {
    console.error('Error parsing document in /api/v1/documents/parse:', error);
    return NextResponse.json(
      { error: error.message || 'فشل استخراج النص من المستند', code: '500_PARSE_FAILED' },
      { status: 500 }
    );
  }
});
