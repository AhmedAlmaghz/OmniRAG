import crypto from 'crypto';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { processPdfWithBatchedPipeline } from '@/lib/pdf/pdfChunker';
import { generateContentWithResilience } from '@/lib/gemini/resilientGemini';
import { getEnv } from '@/lib/env/runtimeEnv';
import { dispatchFile, archiveUploadedFile } from '@/lib/services/unstructuredService';
import { serverErrorResponse } from '@/lib/api/safeError';

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
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'audio/mp3',
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
  'audio/aac',
  'audio/flac',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/ogg',
  'video/avi',
]);

const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'docx',
  'doc',
  'pptx',
  'ppt',
  'xlsx',
  'xls',
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'py',
  'js',
  'jsx',
  'ts',
  'tsx',
  'go',
  'html',
  'css',
  'xml',
  'yaml',
  'yml',
  'sql',
  'c',
  'cpp',
  'h',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'mp3',
  'wav',
  'webm',
  'ogg',
  'aac',
  'flac',
  'mp4',
  'mov',
  'avi',
]);

function normalizeMimeType(fileName: string, mimeType: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (ext === 'ppt') return 'application/vnd.ms-powerpoint';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'xls') return 'application/vnd.ms-excel';
  if (ext === 'mp3') return 'audio/mp3';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'flac') return 'audio/flac';
  if (ext === 'aac') return 'audio/aac';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') {
    if (mimeType && mimeType.startsWith('audio/')) return 'audio/webm';
    return 'video/webm';
  }
  if (ext === 'txt') return 'text/plain';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'json') return 'application/json';
  if (ext === 'md' || ext === 'markdown') return 'text/markdown';
  return mimeType || 'application/octet-stream';
}

// Default 10MB per upload; 50MB is the server-enforced hard cap. The cap is
// intentionally NOT controllable by client headers to prevent DoS abuse.
const DEFAULT_MAX_FILE_SIZE_MB = 10;
const MAX_ALLOWED_FILE_SIZE_MB_CAP = 50;

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  // The wrapper already applied rate limiting and verified auth; authCtx is the
  // single source of identity. No redundant inner checks here.

  // Load client-supplied dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('GROQ_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  try {
    let fileName = 'document.txt';
    let fileBuffer: Buffer | null = null;
    let cleanBase64 = '';
    let mimeType = 'text/plain';
    let requestedModel: string | undefined = undefined;
    let requestedEngine = 'auto';
    let mistralApiKey: string | undefined = undefined;
    let unstructuredApiKey: string | undefined = undefined;
    let groqApiKey: string | undefined = undefined;
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

    if (contentType.includes('application/json')) {
      try {
        const jsonBody = await req.json();
        if (jsonBody && jsonBody.fileData) {
          fileName = jsonBody.fileName || 'document.txt';
          mimeType = jsonBody.mimeType || 'text/plain';
          cleanBase64 = jsonBody.fileData.includes(',') ? jsonBody.fileData.split(',')[1] : jsonBody.fileData;
          fileBuffer = Buffer.from(cleanBase64, 'base64');
          requestedEngine = jsonBody.engine || 'auto';
          requestedModel = jsonBody.model || undefined;
          mistralApiKey = jsonBody.mistralApiKey || undefined;
          unstructuredApiKey = jsonBody.unstructuredApiKey || undefined;
          groqApiKey = jsonBody.groqApiKey || undefined;

          if (jsonBody.maxFileSizeMb && !isNaN(Number(jsonBody.maxFileSizeMb))) {
            requestedMaxFileSizeMb = Math.min(
              Math.max(Number(jsonBody.maxFileSizeMb), 1),
              MAX_ALLOWED_FILE_SIZE_MB_CAP,
            );
          }
          if (jsonBody.pagesPerChunk && !isNaN(Number(jsonBody.pagesPerChunk))) {
            requestedPagesPerChunk = Math.min(Math.max(Number(jsonBody.pagesPerChunk), 1), 200);
          }
        }
      } catch (jsonErr: any) {
        console.error('[Document Ingestion API] Error parsing JSON body:', jsonErr);
      }
    } else if (contentType.includes('multipart/form-data')) {
      try {
        const formData = await req.formData();
        if (formData) {
          let fileObj = formData.get('file') || formData.get('document') || formData.get('upload');
          if (!fileObj) {
            for (const [key, val] of formData.entries()) {
              if (val && typeof val === 'object') {
                fileObj = val;
                break;
              }
            }
          }

          if (fileObj && typeof fileObj === 'object') {
            const file = fileObj as any;
            fileName = (formData.get('fileName') as string) || file.name || 'document.txt';
            mimeType = (formData.get('mimeType') as string) || file.type || 'application/octet-stream';

            if (typeof file.arrayBuffer === 'function') {
              const arrayBuf = await file.arrayBuffer();
              fileBuffer = Buffer.from(arrayBuf);
            } else if (typeof file.stream === 'function') {
              const chunks = [];
              for await (const chunk of file.stream()) {
                chunks.push(chunk);
              }
              fileBuffer = Buffer.concat(chunks);
            } else if (file._buffer) {
              fileBuffer = file._buffer;
            }

            if (fileBuffer) {
              cleanBase64 = fileBuffer.toString('base64');
            }
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
          groqApiKey = (formData.get('groqApiKey') as string) || undefined;

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
        console.error('[Document Ingestion API] Error parsing formData from request:', formErr);
      }
    } else {
      // Fallback for raw stream text
      try {
        const rawBody = await req.text();
        if (rawBody && rawBody.trim().length > 0) {
          fileBuffer = Buffer.from(rawBody);
          cleanBase64 = fileBuffer.toString('base64');
        }
      } catch (e) {}
    }

    if (!fileBuffer) {
      return NextResponse.json(
        { error: 'فشل تحليل الملف المرفوع. يرجى التأكد من اختيار ملف صحيح ونشط.', code: '400_BAD_FORM_DATA' },
        { status: 400 },
      );
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return NextResponse.json(
        { error: 'محتوى الملف مطلوب (File data is required)', code: '400_MISSING_DATA' },
        { status: 400 },
      );
    }

    // Size limit check
    const maxSizeBytes = requestedMaxFileSizeMb * 1024 * 1024;
    if (fileBuffer.length > maxSizeBytes) {
      return NextResponse.json(
        {
          error: `حجم الملف يتجاوز الحد الأقصى المسموح به (${requestedMaxFileSizeMb} ميجابايت)`,
          code: '413_FILE_TOO_LARGE',
        },
        { status: 413 },
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
        { status: 415 },
      );
    }

    // Server-side SHA-256 OCR Cache Check
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const skipCache = req.headers.get('x-skip-cache') === 'true';

    // Meticulously archive the raw uploaded file first
    const tenantId = authCtx.tenantId;
    const archivedPath = archiveUploadedFile(fileBuffer, fileName, tenantId, fileHash);
    console.log(`[Document Ingestion] File meticulously archived to disk: ${archivedPath}`);

    if (!skipCache && SERVER_OCR_CACHE.has(fileHash)) {
      const cached = SERVER_OCR_CACHE.get(fileHash)!;
      cached.hits += 1;
      console.log(
        `[Document Ingestion Cache] Server OCR Cache Hit for ${fileName} (Hash: ${fileHash.substring(0, 10)}..., Hits: ${cached.hits})`,
      );
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
        { headers: { 'X-OCR-Cache': 'HIT' } },
      );
    }

    let extractedText = '';
    let engineUsed = 'native-parser';
    let totalPages = 1;
    let chunksProcessed = 1;

    const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      // Execute batched slicing pipeline with Mistral Document AI & Unstructured MCP tool
      console.log(
        `[Document Ingestion] Processing PDF (${fileName}, ${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB) via ${requestedPagesPerChunk}-page batched pipeline...`,
      );

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
            error:
              'تعذر استخراج النصوص من ملف PDF. يرجى التأكد من أن الملف يحتوي على نصوص قابلة للقراءة أو ليس محميًا بكلمة مرور.',
            code: '422_PDF_UNREADABLE',
          },
          { status: 422 },
        );
      }
    } else {
      console.log(
        `[Document Ingestion] Processing non-PDF document (${fileName}) using Unstructured direct service dispatcher...`,
      );
      const dispatchResult = await dispatchFile(fileBuffer, fileName, mimeType, {
        unstructuredApiKey: unstructuredApiKey || process.env.UNSTRUCTURED_API_KEY,
        mistralApiKey: mistralApiKey || process.env.MISTRAL_API_KEY,
        groqApiKey: groqApiKey || process.env.GROQ_API_KEY,
        geminiApiKey: process.env.GEMINI_API_KEY,
        model: requestedModel,
        preferredEngine: requestedEngine as any,
        strategy: 'hi_res',
      });

      extractedText = dispatchResult.text;
      engineUsed = dispatchResult.engineUsed;
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
        { status: 422 },
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
    return serverErrorResponse('documents/parse POST', error);
  }
});
