import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { getEnv } from '@/lib/env/runtimeEnv';
import { safeFetchBinary, assertPublicHttpUrl } from '@/lib/mcp/net';
import { detectFileType, normalizeMimeType, processFileBuffer } from '@/lib/services/unstructuredService';
import { fileNameFromUrl, fileNameFromContentDisposition } from '@/lib/connectors/liveConnectors';
import { serverErrorResponse } from '@/lib/api/safeError';

export const dynamic = 'force-dynamic';

// Mirrors the parse route: 60 s on every Vercel plan (Hobby hard ceiling);
// self-hosted / Cloud Run ignore the value entirely.
export const maxDuration = 60;

/** Same server-enforced hard cap as the upload-studio parse route. */
const DEFAULT_MAX_FILE_SIZE_MB = 10;
const MAX_ALLOWED_FILE_SIZE_MB_CAP = 50;
const DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * Body contract for "fetch a file from the web and extract its text".
 * `engine` is the user's explicit choice from the studio tab:
 *  - auto         : app picks the best engine per file type (default)
 *  - mistral      : Mistral Document AI (OCR + visual layout)
 *  - unstructured : Unstructured Transform (MCP Transform platform / partition API)
 *  - local        : offline libraries only (pdf-parse, mammoth, PPTX XML, Tesseract)
 */
const WebFetchBodySchema = z.object({
  url: z.string().trim().min(1, 'رابط الملف مطلوب'),
  engine: z.enum(['auto', 'mistral', 'unstructured', 'local']).default('auto'),
  /** Optional client-provided name override (wins over headers/URL heuristics). */
  fileName: z.string().trim().max(255).optional(),
  maxFileSizeMb: z.number().int().positive().optional(),
});

/** Strips parameters ("text/html; charset=utf-8" → "text/html"). */
function bareContentType(contentType: string): string {
  return (contentType || '').split(';')[0].trim().toLowerCase();
}

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  // Load client-supplied dynamic environment keys so the extraction engines
  // resolve the same per-tenant keys as the upload-studio parse route.
  getEnv('MISTRAL_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('GEMINI_API_KEY', req);
  getEnv('GROQ_API_KEY', req);

  try {
    let bodyJson: unknown;
    try {
      bodyJson = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'جسم الطلب غير صالح — يلزم JSON يحتوي حقل url.', code: '400_INVALID_JSON' },
        { status: 400 },
      );
    }

    const parsedBody = WebFetchBodySchema.safeParse(bodyJson);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: `معطيات الطلب غير صالحة: ${parsedBody.error.issues[0]?.message || 'تحقق من الحقول'}`,
          code: '400_INVALID_BODY',
        },
        { status: 400 },
      );
    }
    const { url, engine, fileName: fileNameOverride, maxFileSizeMb } = parsedBody.data;

    // Early scheme/SSRF validation for a precise error message; safeFetchBinary
    // re-validates (defense in depth) before any byte is downloaded.
    try {
      assertPublicHttpUrl(url);
    } catch (urlErr: any) {
      return NextResponse.json(
        { error: urlErr?.message || 'رابط غير مسموح', code: '400_URL_REJECTED' },
        { status: 400 },
      );
    }

    const maxBytes =
      Math.min(Math.max(maxFileSizeMb || DEFAULT_MAX_FILE_SIZE_MB, 1), MAX_ALLOWED_FILE_SIZE_MB_CAP) * 1024 * 1024;

    console.log(
      `[Web Fetch] Downloading ${url} (engine: ${engine}, cap: ${(maxBytes / 1024 / 1024).toFixed(0)} MB)...`,
    );
    const download = await safeFetchBinary(url, { timeoutMs: DOWNLOAD_TIMEOUT_MS, maxBytes });
    if (!download.ok) {
      return NextResponse.json(
        { error: `فشل جلب الملف من الرابط: ${download.error || `HTTP ${download.status}`}`, code: '502_FETCH_FAILED' },
        { status: 502 },
      );
    }
    if (!download.bytes || download.bytes.length === 0) {
      return NextResponse.json(
        { error: 'الملف المجلوب فارغ — لا يوجد محتوى قابل للمعالجة.', code: '422_EMPTY_DOWNLOAD' },
        { status: 422 },
      );
    }

    // Name resolution order: explicit override → remote Content-Disposition →
    // URL path → generic fallback. MIME follows the resolved name (with the
    // response Content-Type as fallback hint) so a mislabeled header cannot
    // poison engine routing.
    const resolvedFileName =
      fileNameOverride ||
      fileNameFromContentDisposition(download.contentDisposition) ||
      fileNameFromUrl(url) ||
      'downloaded-file';
    const mimeType = normalizeMimeType(resolvedFileName, bareContentType(download.contentType));

    // Reject file types nothing in this app can process (e.g. .exe). Anything
    // classifyable (PDF/Office/text/code/media/images) passes.
    const classification = detectFileType(resolvedFileName, mimeType);
    const isKnownType =
      classification.isPdf ||
      classification.isWord ||
      classification.isPowerPoint ||
      classification.isSpreadsheet ||
      classification.isText ||
      classification.isImage ||
      classification.isAudio ||
      classification.isVideo;
    if (!isKnownType) {
      return NextResponse.json(
        {
          error:
            'صيغة الملف المجلوب غير مدعومة. الصيغ المدعومة: PDF، DOCX، PPTX، XLSX، TXT، Markdown، JSON، CSV، الصور، والوسائط.',
          code: '415_UNSUPPORTED_TYPE',
        },
        { status: 415 },
      );
    }

    console.log(
      `[Web Fetch] Processing ${resolvedFileName} (${(download.bytes.length / 1024 / 1024).toFixed(2)} MB) via ${engine}...`,
    );
    const processed = await processFileBuffer(download.bytes, resolvedFileName, mimeType, { preferredEngine: engine });

    // Same control-character sanitation as the parse route.
    const extractedText = (processed.text || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    if (!extractedText) {
      return NextResponse.json(
        {
          error: `تم جلب الملف بنجاح لكن تعذر استخراج أي نص منه عبر المحرك (${processed.engineUsed}). قد يكون تالفاً أو ممسوحاً ضوئياً أو غير مدعوم.`,
          code: '422_NO_TEXT_EXTRACTED',
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: true,
      text: extractedText,
      charCount: extractedText.length,
      wordCount: extractedText.split(/\s+/).length,
      totalPages: processed.totalPages,
      chunksProcessed: processed.chunksProcessed,
      engineUsed: processed.engineUsed,
      requestedEngine: engine,
      fileName: resolvedFileName,
      mimeType,
      sizeBytes: download.bytes.length,
      sourceUrl: url,
      tenantId: authCtx.tenantId,
    });
  } catch (error: any) {
    return serverErrorResponse('documents/web-fetch POST', error);
  }
});
