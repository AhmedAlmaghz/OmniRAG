import crypto from 'crypto';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/auth/apiAuth';
import { checkRateLimit } from '@/lib/security/rateLimiter';
import { processPdfWithBatchedPipeline } from '@/lib/pdf/pdfChunker';
import { generateContentWithResilience } from '@/lib/gemini/resilientGemini';

export const dynamic = 'force-dynamic';

interface ServerOcrCacheEntry {
  text: string;
  charCount: number;
  wordCount: number;
  totalPages: number;
  chunksProcessed: number;
  engineUsed: string;
  fileSizeMb: string;
  cachedAt: number;
  hits: number;
}

const SERVER_OCR_CACHE = new Map<string, ServerOcrCacheEntry>();

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'txt', 'md', 'markdown', 'json', 'csv',
  'py', 'js', 'jsx', 'ts', 'tsx', 'go', 'html', 'css', 'xml',
  'yaml', 'yml', 'sql', 'c', 'cpp', 'h',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'
]);

function normalizeMimeType(fileName: string, mimeType: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'txt') return 'text/plain';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'json') return 'application/json';
  if (ext === 'md' || ext === 'markdown') return 'text/markdown';
  return mimeType || 'application/octet-stream';
}

// Default up to 50MB documents for large-scale chunking & ingestion
const DEFAULT_MAX_FILE_SIZE_MB = 50;
const MAX_ALLOWED_FILE_SIZE_MB_CAP = 200;

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  // Rate limiting
  const rateLimit = checkRateLimit(req, 60, 60000);
  if (!rateLimit.success && rateLimit.response) {
    return rateLimit.response;
  }

  // Auth verification
  const auth = await verifyApiAuth(req);
  if (!auth.authenticated && auth.response) {
    return auth.response;
  }

  try {
    let fileName = 'document.txt';
    let fileBuffer: Buffer | null = null;
    let cleanBase64 = '';
    let mimeType = 'text/plain';
    let requestedModel: string | undefined = undefined;
    let requestedEngine = 'auto';
    let mistralApiKey: string | undefined = undefined;
    let unstructuredApiKey: string | undefined = undefined;
    let requestedMaxFileSizeMb = DEFAULT_MAX_FILE_SIZE_MB;
    let requestedPagesPerChunk = 25;

    const contentType = req.headers.get('content-type') || '';
    const headerMaxFileSize = req.headers.get('x-max-file-size-mb');
    const headerPagesPerChunk = req.headers.get('x-pages-per-chunk');

    if (headerMaxFileSize && !isNaN(Number(headerMaxFileSize))) {
      requestedMaxFileSizeMb = Math.min(Math.max(Number(headerMaxFileSize), 1), MAX_ALLOWED_FILE_SIZE_MB_CAP);
    }
    if (headerPagesPerChunk && !isNaN(Number(headerPagesPerChunk))) {
      requestedPagesPerChunk = Math.min(Math.max(Number(headerPagesPerChunk), 1), 200);
    }

    if (contentType.includes('multipart/form-data')) {
      let formDataParsed = false;
      // Clone req BEFORE calling req.formData() so clonedReq remains an untouched stream if req.formData() fails
      const clonedReq = req.clone();

      try {
        const formData = await req.formData();
        if (formData) {
          formDataParsed = true;
          let fileObj = formData.get('file') || formData.get('document') || formData.get('upload');
          if (!fileObj) {
            for (const [key, val] of formData.entries()) {
              if (val && typeof val === 'object' && 'arrayBuffer' in val) {
                fileObj = val;
                break;
              }
            }
          }

          if (fileObj && typeof fileObj === 'object' && 'arrayBuffer' in fileObj) {
            const file = fileObj as File;
            fileName = (formData.get('fileName') as string) || file.name || 'document.txt';
            mimeType = (formData.get('mimeType') as string) || file.type || 'application/octet-stream';
            const arrayBuf = await file.arrayBuffer();
            fileBuffer = Buffer.from(arrayBuf);
            cleanBase64 = fileBuffer.toString('base64');
          } else {
            const fileDataStr = (formData.get('fileData') as string) || (formData.get('file_data') as string);
            if (fileDataStr) {
              fileName = (formData.get('fileName') as string) || 'document.txt';
              mimeType = (formData.get('mimeType') as string) || 'text/plain';
              cleanBase64 = fileDataStr.includes(',') ? fileDataStr.split(',')[1] : fileDataStr;
              fileBuffer = Buffer.from(cleanBase64, 'base64');
            }
          }

          requestedModel = (formData.get('model') as string) || undefined;
          requestedEngine = (formData.get('engine') as string) || 'auto';
          mistralApiKey = (formData.get('mistralApiKey') as string) || undefined;
          unstructuredApiKey = (formData.get('unstructuredApiKey') as string) || undefined;

          const formMaxFile = formData.get('maxFileSizeMb');
          if (formMaxFile && !isNaN(Number(formMaxFile))) {
            requestedMaxFileSizeMb = Math.min(Math.max(Number(formMaxFile), 1), MAX_ALLOWED_FILE_SIZE_MB_CAP);
          }
          const formPagesPerChunk = formData.get('pagesPerChunk');
          if (formPagesPerChunk && !isNaN(Number(formPagesPerChunk))) {
            requestedPagesPerChunk = Math.min(Math.max(Number(formPagesPerChunk), 1), 200);
          }
        }
      } catch (formErr: any) {
        // req.formData() failed (e.g. boundary issue or stream error), safely proceed to clonedReq fallback
      }

      if (!fileBuffer) {
        // Try fallback reading clonedReq as JSON if client sent JSON body despite header
        try {
          const jsonBody = await clonedReq.json();
          if (jsonBody && jsonBody.fileData) {
            fileName = jsonBody.fileName || 'document.txt';
            mimeType = jsonBody.mimeType || 'text/plain';
            cleanBase64 = jsonBody.fileData.includes(',') ? jsonBody.fileData.split(',')[1] : jsonBody.fileData;
            fileBuffer = Buffer.from(cleanBase64, 'base64');
            requestedEngine = jsonBody.engine || 'auto';
          }
        } catch (e) {}
      }

      if (!fileBuffer) {
        return NextResponse.json(
          { error: 'فشل تحليل الملف المرفوع. يرجى التأكد من اختيار ملف صحيح ونشط.', code: '400_BAD_FORM_DATA' },
          { status: 400 }
        );
      }
    } else {
      let body: any = {};
      try {
        body = await req.json();
      } catch (jsonErr: any) {
        return NextResponse.json(
          {
            error: 'تعذر تحليل محتوى ملف JSON. قد يكون حجم الملف كبيراً جداً وتجاوز الحد الأقصى للمحمول. يفضل استخدام الرفع المباشر عبر FormData.',
            code: '400_MALFORMED_JSON',
          },
          { status: 400 }
        );
      }

      fileName = body.fileName || 'document.txt';
      mimeType = body.mimeType || 'text/plain';
      requestedModel = body.model;
      requestedEngine = body.engine || 'auto';
      mistralApiKey = body.mistralApiKey;
      unstructuredApiKey = body.unstructuredApiKey;

      if (body.maxFileSizeMb && !isNaN(Number(body.maxFileSizeMb))) {
        requestedMaxFileSizeMb = Math.min(Math.max(Number(body.maxFileSizeMb), 1), MAX_ALLOWED_FILE_SIZE_MB_CAP);
      }
      if (body.pagesPerChunk && !isNaN(Number(body.pagesPerChunk))) {
        requestedPagesPerChunk = Math.min(Math.max(Number(body.pagesPerChunk), 1), 200);
      }

      if (body.fileData && typeof body.fileData === 'string') {
        cleanBase64 = body.fileData.includes(',') ? body.fileData.split(',')[1] : body.fileData;
        fileBuffer = Buffer.from(cleanBase64, 'base64');
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return NextResponse.json(
        { error: 'محتوى الملف مطلوب (File data is required)', code: '400_MISSING_DATA' },
        { status: 400 }
      );
    }

    // Size limit check
    const maxSizeBytes = requestedMaxFileSizeMb * 1024 * 1024;
    if (fileBuffer.length > maxSizeBytes) {
      return NextResponse.json(
        { error: `حجم الملف يتجاوز الحد الأقصى المسموح به (${requestedMaxFileSizeMb} ميجابايت)`, code: '413_FILE_TOO_LARGE' },
        { status: 413 }
      );
    }

    // Extension & MIME type check
    const fileExt = fileName.split('.').pop()?.toLowerCase() || '';
    if (fileExt && !ALLOWED_EXTENSIONS.has(fileExt) && mimeType && !ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
      return NextResponse.json(
        {
          error: `صيغة الملف (.${fileExt}) غير مدعومة. الصيغ المدعومة هي: PDF, DOCX, PPTX, TXT, Markdown, JSON, CSV, وشفرات البرمجة.`,
          code: '415_UNSUPPORTED_TYPE',
        },
        { status: 415 }
      );
    }

    // Server-side SHA-256 OCR Cache Check
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const skipCache = req.headers.get('x-skip-cache') === 'true';

    if (!skipCache && SERVER_OCR_CACHE.has(fileHash)) {
      const cached = SERVER_OCR_CACHE.get(fileHash)!;
      cached.hits += 1;
      console.log(`[Document Ingestion Cache] Server OCR Cache Hit for ${fileName} (Hash: ${fileHash.substring(0, 10)}..., Hits: ${cached.hits})`);
      return NextResponse.json(
        {
          text: cached.text,
          charCount: cached.charCount,
          wordCount: cached.wordCount,
          totalPages: cached.totalPages,
          chunksProcessed: cached.chunksProcessed,
          engineUsed: `${cached.engineUsed} (Server Cache Hit ⚡)`,
          fileSizeMb: cached.fileSizeMb,
          isCacheHit: true,
          fileHash,
        },
        { headers: { 'X-OCR-Cache': 'HIT' } }
      );
    }

    let extractedText = '';
    let engineUsed = 'native-parser';
    let totalPages = 1;
    let chunksProcessed = 1;

    const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      // Execute batched slicing pipeline with Mistral Document AI & Unstructured MCP tool
      console.log(`[Document Ingestion] Processing PDF (${fileName}, ${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB) via ${requestedPagesPerChunk}-page batched pipeline...`);
      
      const pipelineResult = await processPdfWithBatchedPipeline(fileBuffer, {
        preferredEngine: requestedEngine as any,
        pagesPerChunk: requestedPagesPerChunk,
        mistralApiKey,
        unstructuredApiKey,
      });

      extractedText = pipelineResult.text;
      totalPages = pipelineResult.totalPages;
      chunksProcessed = pipelineResult.chunksProcessed;
      engineUsed = pipelineResult.engineUsed;

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
      const isText =
        mimeType.startsWith('text/') ||
        /\.(txt|md|markdown|json|csv|tsv|py|js|ts|tsx|jsx|html|xml|log|env|yaml|yml|sql|sh|c|cpp|java|go|rb|php|cs|ini|conf|rst|tex|srt|vtt|rtf|sub)$/i.test(
          fileName
        );

      if (isText) {
        extractedText = fileBuffer.toString('utf-8');
        engineUsed = 'utf-8-text-reader';
      } else {
        // High-precision XML / Office (DOCX, PPTX, XLSX) tag extractor fallback
        const lowerName = fileName.toLowerCase();
        if (
          lowerName.endsWith('.docx') ||
          lowerName.endsWith('.pptx') ||
          lowerName.endsWith('.xlsx') ||
          mimeType.includes('officedocument')
        ) {
          try {
            const rawXml = fileBuffer.toString('utf-8');
            const matches = rawXml.match(/<[wva]:t[^>]*>([^<]+)<\/[wva]:t>/gi);
            if (matches && matches.length > 0) {
              const xmlTexts = matches
                .map((m) => m.replace(/<[^>]+>/g, '').trim())
                .filter(Boolean);
              if (xmlTexts.length > 0) {
                extractedText = xmlTexts.join(' ');
                engineUsed = 'Office XML Native Parser';
              }
            }
          } catch (e) {
            // Ignore XML parse errors
          }
        }

        // Try Unstructured.io MCP tool / API first for multi-format support
        if (!extractedText) {
          const unKey = unstructuredApiKey || process.env.UNSTRUCTURED_API_KEY;
          const unUrl = process.env.UNSTRUCTURED_API_URL || 'https://api.unstructuredapp.io/general/v0/general';

          if (unKey) {
            try {
              const formData = new FormData();
              const blob = new Blob([new Uint8Array(fileBuffer)]);
              formData.append('files', blob, fileName);
              formData.append('strategy', 'hi_res');

              const res = await fetch(unUrl, {
                method: 'POST',
                headers: { 'unstructured-api-key': unKey },
                body: formData,
              });

              if (res.ok) {
                const elements = await res.json();
                if (Array.isArray(elements)) {
                  extractedText = elements.map((e: any) => e.text).filter(Boolean).join('\n\n');
                  engineUsed = 'Unstructured.io MCP Multi-Format Transform';
                }
              }
            } catch (unErr) {
              console.warn('[Unstructured API] Multi-format parse error:', unErr);
            }
          }
        }

        // Gemini AI fallback for complex formats (PDFs, images, Office documents)
        if (!extractedText) {
          try {
            const resolvedMime = normalizeMimeType(fileName, mimeType);
            const parseModel = requestedModel || 'gemini-3.7-flash';
            const response = await generateContentWithResilience({
              model: parseModel,
              fallbackModels: ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.1-pro-preview'],
              contents: [
                {
                  inlineData: {
                    mimeType: resolvedMime,
                    data: cleanBase64,
                  },
                },
                'Extract and transcribe all readable text, tables, and content from this document/image. Maintain accurate Arabic text if present. Output ONLY the extracted text directly.',
              ],
              maxRetriesPerModel: 2,
            });
            if (response?.text && response.text.trim().length > 0) {
              extractedText = response.text.trim();
              engineUsed = 'Gemini Multimodal Vision & OCR AI';
            }
          } catch (geminiErr) {
            console.warn('[Gemini Multimodal Parser] Fallback to raw text extraction:', geminiErr);
          }
        }

        // Final fallback: extract printable UTF-8/ASCII words from raw buffer
        if (!extractedText) {
          const rawStr = fileBuffer.toString('utf-8');
          const printable = rawStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim();
          if (printable.length > 20) {
            extractedText = printable;
            engineUsed = 'Raw Printable Buffer Extractor';
          }
        }
      }
    }

    // Sanitize extracted text (strip null bytes and bad control characters)
    if (extractedText) {
      extractedText = extractedText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    }

    if (!extractedText || extractedText.length === 0) {
      return NextResponse.json(
        {
          error: 'لم يتم استخراج أي نص من الملف. يرجى التأكد من أن الملف غير فارغ ويحتوي على نصوص قابلة للقراءة.',
          code: '422_UNREADABLE_DOCUMENT',
        },
        { status: 422 }
      );
    }

    // Cache successful OCR result in server memory
    SERVER_OCR_CACHE.set(fileHash, {
      text: extractedText,
      charCount: extractedText.length,
      wordCount: extractedText.trim().split(/\s+/).length,
      totalPages,
      chunksProcessed,
      engineUsed,
      fileSizeMb: (fileBuffer.length / (1024 * 1024)).toFixed(2),
      cachedAt: Date.now(),
      hits: 0,
    });

    return NextResponse.json({
      text: extractedText,
      charCount: extractedText.length,
      wordCount: extractedText.trim().split(/\s+/).length,
      totalPages,
      chunksProcessed,
      engineUsed,
      fileSizeMb: (fileBuffer.length / (1024 * 1024)).toFixed(2),
      isCacheHit: false,
      fileHash,
    });
  } catch (error: any) {
    console.error('Error parsing document in /api/v1/documents/parse:', error);
    return NextResponse.json(
      { error: error.message || 'فشل استخراج النص من المستند', code: '500_PARSE_FAILED' },
      { status: 500 }
    );
  }
});
