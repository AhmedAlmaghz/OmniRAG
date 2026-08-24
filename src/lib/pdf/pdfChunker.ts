import { PDFDocument } from 'pdf-lib';
import { generateContentWithResilience } from '../gemini/resilientGemini';
import { getAiModel, getFallbackModels } from '../config/aiModels';
import { ensureLongHttpTimeouts } from '../http/longHttpTimeouts';

export interface PdfChunkInfo {
  chunkIndex: number;
  totalChunks: number;
  startPage: number;
  endPage: number;
  pdfBuffer: Buffer;
  base64Data: string;
}

export interface DocumentParseResult {
  text: string;
  totalPages: number;
  chunksProcessed: number;
  engineUsed: string;
  charCount: number;
  wordCount: number;
  pagesInfo?: { pageNumber: number; text: string }[];
}

/**
 * Loads a PDF buffer and splits it into discrete sub-PDFs of `pagesPerChunk` pages each (default 25 pages).
 */
export async function slicePdfIntoChunks(
  pdfBuffer: Buffer,
  pagesPerChunk: number = 25,
): Promise<{ totalPages: number; chunks: PdfChunkInfo[] }> {
  try {
    const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const totalPages = srcDoc.getPageCount();
    const chunks: PdfChunkInfo[] = [];

    if (totalPages === 0) {
      throw new Error('ملف PDF فارغ ولا يحتوي على أي صفحات.');
    }

    // Single-chunk fast path: when every page fits one request, hand back
    // the ORIGINAL buffer. Re-saving via copyPages duplicates shared
    // resource dictionaries into each chunk — a scanned PDF with all images
    // in one shared dict re-serialises at ~full size per chunk, so slicing
    // a 15 MB / 58-page file into 6 chunks would upload ~90 MB total.
    if (totalPages <= pagesPerChunk) {
      return {
        totalPages,
        chunks: [
          {
            chunkIndex: 1,
            totalChunks: 1,
            startPage: 1,
            endPage: totalPages,
            pdfBuffer,
            base64Data: pdfBuffer.toString('base64'),
          },
        ],
      };
    }

    const totalChunks = Math.ceil(totalPages / pagesPerChunk);

    for (let i = 0; i < totalPages; i += pagesPerChunk) {
      const end = Math.min(i + pagesPerChunk, totalPages);
      const subDoc = await PDFDocument.create();
      const pageIndices = Array.from({ length: end - i }, (_, idx) => i + idx);
      const copiedPages = await subDoc.copyPages(srcDoc, pageIndices);

      copiedPages.forEach((page) => subDoc.addPage(page));

      const subPdfBytes = await subDoc.save();
      const subBuffer = Buffer.from(subPdfBytes);
      const chunkIdx = Math.floor(i / pagesPerChunk) + 1;

      chunks.push({
        chunkIndex: chunkIdx,
        totalChunks,
        startPage: i + 1,
        endPage: end,
        pdfBuffer: subBuffer,
        base64Data: subBuffer.toString('base64'),
      });
    }

    return { totalPages, chunks };
  } catch (error: any) {
    console.warn('[PDF Chunker] pdf-lib slice fallback to single chunk:', error?.message || error);
    // Fallback: return as single chunk
    return {
      totalPages: 1,
      chunks: [
        {
          chunkIndex: 1,
          totalChunks: 1,
          startPage: 1,
          endPage: 1,
          pdfBuffer,
          base64Data: pdfBuffer.toString('base64'),
        },
      ],
    };
  }
}

/**
 * Mistral Document AI (OCR) API implementation
 * Supports `mistral-ocr-latest` for document understanding, tables, mathematical formulas, and layout analysis.
 */
export async function parsePdfChunkWithMistral(
  chunk: PdfChunkInfo,
  apiKey?: string,
): Promise<{ text: string; pages: { pageNumber: number; text: string }[] } | null> {
  const token = apiKey || process.env.MISTRAL_API_KEY;
  if (!token) return null;

  try {
    const res = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: getAiModel('ocrModel'),
        document: {
          type: 'document_url',
          document_url: `data:application/pdf;base64,${chunk.base64Data}`,
        },
        include_image_base64: false,
      }),
      // Uploading a 15 MB base64 document plus server-side OCR of dozens of
      // pages routinely exceeds Node's ~300 s default headers timeout.
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Mistral OCR] HTTP ${res.status} error on chunk ${chunk.chunkIndex}:`, errText);
      return null;
    }

    const data = await res.json();
    const pagesList = data.pages || [];
    const pagesResult: { pageNumber: number; text: string }[] = [];
    const textSections: string[] = [];

    pagesList.forEach((p: any, idx: number) => {
      const pageNum = chunk.startPage + idx;
      const pageText = p.markdown || p.text || '';
      pagesResult.push({ pageNumber: pageNum, text: pageText });
      textSections.push(`### [صفحة ${pageNum}]\n${pageText}`);
    });

    return {
      text: textSections.join('\n\n'),
      pages: pagesResult,
    };
  } catch (err: any) {
    console.warn(`[Mistral OCR] Execution failed on chunk ${chunk.chunkIndex}:`, err?.message || err);
    return null;
  }
}

/**
 * Unstructured.io Document Transform API
 * Transforms complex PDFs, DOCX, PPTX into structured text and elements with hi-res partition strategies.
 */
export async function parsePdfChunkWithUnstructured(
  chunk: PdfChunkInfo,
  apiKey?: string,
): Promise<{ text: string } | null> {
  const token = apiKey || process.env.UNSTRUCTURED_API_KEY;
  if (!token) return null;

  // Delegates to the shared engine, which routes by UNSTRUCTURED_API_URL:
  // legacy partition host → synchronous POST; modern Transform platform →
  // the async Jobs API (create job → poll → download elements).
  try {
    const { unstructuredPartition } = await import('../services/unstructuredService');
    const result = await unstructuredPartition(
      chunk.pdfBuffer,
      `chunk_${chunk.chunkIndex}.pdf`,
      'application/pdf',
      token,
      'fast',
    );
    if (result.success && result.text.trim().length > 0) {
      return { text: result.text.trim() };
    }
    console.warn(`[Unstructured API] Chunk ${chunk.chunkIndex}: ${result.metadata?.error || 'no text'}`);
    return null;
  } catch (err: any) {
    console.warn(`[Unstructured API] Chunk ${chunk.chunkIndex} error:`, err?.message);
    return null;
  }
}

/**
 * Gemini Multimodal Document Parser
 */
export async function parsePdfChunkWithGemini(chunk: PdfChunkInfo, model?: string): Promise<{ text: string } | null> {
  // Resolve the model: explicit per-call override > request-bound config
  // (via AsyncLocalStorage set by parse/route.ts) > DEFAULT_AI_MODELS.
  const resolvedModel = model || getAiModel('documentParseModel');
  try {
    const response = await generateContentWithResilience({
      model: resolvedModel,
      fallbackModels: getFallbackModels(),
      contents: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: chunk.base64Data,
          },
        },
        `Extract and transcribe the complete text content from pages ${chunk.startPage} to ${chunk.endPage} of this document.
Preserve the logical document structure, headings, markdown tables, code snippets, lists, and order.
Maintain accurate Arabic text if present. Output ONLY the extracted text with clear section headers.`,
      ],
      maxRetriesPerModel: 2,
      initialDelayMs: 400,
    });

    if (response?.text && response.text.trim().length > 0) {
      return { text: response.text.trim() };
    }
  } catch (err: any) {
    console.warn(`[Gemini PDF Parser] Chunk ${chunk.chunkIndex} error:`, err?.message || err);
  }
  return null;
}

/**
 * Native pdf-parse node module parser with stream text extraction fallback.
 *
 * Returns a confidence level alongside the text:
 *  - `high`: real text layer from pdf-parse (trusted for auto routing).
 *  - `low`: heuristic latin1 stream-operator scrape — often word-soup or
 *    mojibake for embedded-font/Arabic/scanned PDFs, so it must NOT suppress
 *    the OCR engines; it is only acceptable as a last resort.
 */
export async function parsePdfChunkWithNativePdfParse(
  chunk: PdfChunkInfo,
): Promise<{ text: string; confidence: 'high' | 'low' } | null> {
  // 1. Primary: Try pdf-parse module (v2 class PDFParse or v1 function)
  try {
    const pdfModule = await import('pdf-parse');
    let extracted: string | null = null;

    if (pdfModule && (pdfModule as any).PDFParse) {
      // pdf-parse v2+
      const PDFParseClass = (pdfModule as any).PDFParse;
      const parser = new PDFParseClass({ data: chunk.pdfBuffer });
      await parser.load();
      const result = await parser.getText();
      await parser.destroy().catch(() => {});
      if (result && result.text) {
        extracted = result.text.replace(/-- \d+ of \d+ --/g, '').trim();
      }
    } else {
      // pdf-parse v1
      const parsePdfFunc = typeof pdfModule === 'function' ? pdfModule : (pdfModule as any).default || pdfModule;
      if (typeof parsePdfFunc === 'function') {
        const parsedPdf = await parsePdfFunc(chunk.pdfBuffer);
        if (parsedPdf && parsedPdf.text) {
          extracted = parsedPdf.text.trim();
        }
      }
    }

    if (extracted && extracted.length > 0) {
      return { text: extracted, confidence: 'high' };
    }
  } catch (err: any) {
    console.warn(`[Native pdf-parse] Chunk ${chunk.chunkIndex} warning:`, err?.message || err);
  }

  // Stream text operator extraction fallback for text-based PDFs
  try {
    const rawString = chunk.pdfBuffer.toString('latin1');
    const textMatches = rawString.match(/\(([^()]{2,})\)\s*T[jJ]/g) || [];
    const extractedWords: string[] = [];

    for (const m of textMatches) {
      const cleaned = m
        .replace(/^\(/, '')
        .replace(/\)\s*T[jJ]$/, '')
        .trim();
      if (cleaned.length >= 2 && !/^[\x00-\x1F]+$/.test(cleaned)) {
        extractedWords.push(cleaned);
      }
    }

    if (extractedWords.length > 0) {
      return { text: extractedWords.join(' '), confidence: 'low' };
    }
  } catch (e) {
    // Ignore stream extraction errors
  }

  return null;
}

/** Minimum characters per page expected from a healthy text-layer extraction. */
const NATIVE_MIN_CHARS_PER_PAGE = 120;
/** Minimum fraction of letters/digits among non-whitespace characters. */
const NATIVE_MIN_MEANINGFUL_RATIO = 0.5;

/**
 * Quality gate for native (non-OCR) PDF text extraction.
 *
 * Step A used to accept ANY non-empty string from pdf-parse — including
 * near-empty layers and mojibake from scanned/embedded-font files — which then
 * short-circuited Mistral OCR / Unstructured / Gemini vision and indexed
 * garbage as ground truth. A native extraction now counts as usable only when
 * it has plausible density for the page count and mostly real characters.
 */
export function assessNativePdfTextQuality(text: string, pageCount: number): boolean {
  const compact = (text || '').replace(/\s+/g, ' ').trim();
  if (compact.length < 100) return false;

  const pages = Math.max(1, pageCount || 1);
  if (compact.length < Math.min(pages * NATIVE_MIN_CHARS_PER_PAGE, 250)) return false;

  const meaningful = (compact.match(/[\p{L}\p{N}]/gu) || []).length;
  if (meaningful / compact.length < NATIVE_MIN_MEANINGFUL_RATIO) return false;

  // Unresolved glyph references indicate a broken CMap/font mapping.
  const cidJunk = (compact.match(/\(cid:\d+\)/gi) || []).length;
  if (cidJunk > 5) return false;

  return true;
}

/**
 * Sequential Knowledge Pipeline Document Processor:
 * Slices PDF into 25-page batches and processes each chunk sequentially.
 */
export async function processPdfWithBatchedPipeline(
  pdfBuffer: Buffer,
  options: {
    preferredEngine?: 'mistral' | 'unstructured' | 'gemini' | 'auto';
    pagesPerChunk?: number;
    mistralApiKey?: string;
    unstructuredApiKey?: string;
    model?: string;
  } = {},
): Promise<DocumentParseResult> {
  const { preferredEngine = 'auto', pagesPerChunk = 25, mistralApiKey, unstructuredApiKey, model } = options;

  // Long OCR round-trips (15 MB uploads + dozens of pages) outlive Node's
  // default ~300 s fetch headers timeout — raise it before any engine call.
  ensureLongHttpTimeouts();

  // 1. Adaptive pages per chunk based on PDF file size to prevent 413 Request Entity Too Large errors
  let resolvedPagesPerChunk = pagesPerChunk;
  const fileMb = pdfBuffer.length / (1024 * 1024);

  // Files small enough to fit a single OCR request (Mistral caps at 50 MB;
  // 30 MB binary ≈ 40 MB base64) go out WHOLE — one request, zero slicing.
  // Slicing is counterproductive for shared-resource PDFs: copyPages
  // duplicates the shared dictionaries, so every chunk re-serialises at
  // roughly full-file size (6 chunks of a 15 MB file ≈ 90 MB uploaded).
  const SINGLE_REQUEST_BYTES = 30 * 1024 * 1024;
  if (pdfBuffer.length <= SINGLE_REQUEST_BYTES) {
    resolvedPagesPerChunk = Number.MAX_SAFE_INTEGER;
    console.log(`[Knowledge Pipeline] PDF (${fileMb.toFixed(2)} MB) fits a single OCR request — skipping slicing.`);
  } else if (fileMb > 15) {
    resolvedPagesPerChunk = Math.min(pagesPerChunk, 5); // 5 pages per chunk for huge files (>15MB)
    console.log(
      `[Knowledge Pipeline] Huge PDF detected (${fileMb.toFixed(2)} MB). Reducing pagesPerChunk dynamically to 5 to avoid 413 errors.`,
    );
  } else if (fileMb > 5) {
    resolvedPagesPerChunk = Math.min(pagesPerChunk, 10); // 10 pages per chunk for medium-large files (>5MB)
    console.log(
      `[Knowledge Pipeline] Medium-large PDF detected (${fileMb.toFixed(2)} MB). Reducing pagesPerChunk dynamically to 10 to avoid 413 errors.`,
    );
  }

  // 2. Slice PDF into optimized chunks
  const { totalPages, chunks } = await slicePdfIntoChunks(pdfBuffer, resolvedPagesPerChunk);
  console.log(
    `[Knowledge Pipeline] Processing PDF (${totalPages} pages) sliced into ${chunks.length} sequential chunks (${resolvedPagesPerChunk} pages/chunk)...`,
  );

  const accumulatedTexts: string[] = [];
  let primaryEngineUsed = 'native-pdf-parse';

  for (const chunk of chunks) {
    console.log(
      `[Knowledge Pipeline] Ingesting Chunk ${chunk.chunkIndex}/${chunk.totalChunks} (Pages ${chunk.startPage} - ${chunk.endPage})...`,
    );
    let chunkText = '';

    // Step A: Fast native PDF extraction (instant, zero network, zero API
    // quota). Gated by the quality assessment: a thin text layer or mojibake
    // scrape must fall through to the OCR engines instead of poisoning the
    // document with garbage that then blocks better extraction.
    if (preferredEngine === 'auto') {
      const nativeRes = await parsePdfChunkWithNativePdfParse(chunk);
      if (
        nativeRes &&
        nativeRes.confidence === 'high' &&
        assessNativePdfTextQuality(nativeRes.text, chunk.endPage - chunk.startPage + 1)
      ) {
        chunkText = nativeRes.text.trim();
        primaryEngineUsed = 'Native High-Speed PDF Parser';
      } else if (nativeRes) {
        console.log(
          `[Knowledge Pipeline] Native extraction for chunk ${chunk.chunkIndex} failed the quality gate — deferring to OCR engines.`,
        );
      }
    }

    // Step B: Mistral Document AI API
    if (
      !chunkText &&
      (preferredEngine === 'mistral' ||
        ((preferredEngine === 'auto' || preferredEngine === 'unstructured') &&
          (mistralApiKey || process.env.MISTRAL_API_KEY)))
    ) {
      const mistralRes = await parsePdfChunkWithMistral(chunk, mistralApiKey);
      if (mistralRes && mistralRes.text && mistralRes.text.trim().length > 0) {
        chunkText = mistralRes.text.trim();
        primaryEngineUsed = 'Mistral Document AI API';
      }
    }

    // Step C: Unstructured.io MCP Tool / API
    if (
      !chunkText &&
      (preferredEngine === 'unstructured' ||
        ((preferredEngine === 'auto' || preferredEngine === 'mistral') &&
          (unstructuredApiKey || process.env.UNSTRUCTURED_API_KEY)))
    ) {
      const unstructuredRes = await parsePdfChunkWithUnstructured(chunk, unstructuredApiKey);
      if (unstructuredRes && unstructuredRes.text && unstructuredRes.text.trim().length > 0) {
        chunkText = unstructuredRes.text.trim();
        primaryEngineUsed = 'Unstructured.io MCP Transform';
      }
    }

    // Step D: Gemini Multimodal Document Parser (Vision / OCR for scanned PDFs)
    if (!chunkText) {
      const geminiRes = await parsePdfChunkWithGemini(chunk, model);
      if (geminiRes && geminiRes.text && geminiRes.text.trim().length > 0) {
        chunkText = geminiRes.text.trim();
        primaryEngineUsed = 'Gemini Multimodal AI';
      }
    }

    // Step E: Final native fallback if auto was skipped or preferred non-auto
    // failed. Last resort — accept whatever native yields (low-confidence
    // stream scrape included) since every better engine already failed.
    if (!chunkText) {
      const nativeRes = await parsePdfChunkWithNativePdfParse(chunk);
      if (nativeRes && nativeRes.text) {
        chunkText = nativeRes.text.trim();
        primaryEngineUsed =
          nativeRes.confidence === 'high' ? 'Native High-Speed PDF Parser' : 'Native Stream Fallback (low confidence)';
      }
    }

    // Step F: LOCAL offline OCR (Tesseract) — extracts the embedded page
    // images and recognizes them without any cloud API key. Reached only
    // when every engine above failed, i.e. scanned PDFs with no keys set.
    if (!chunkText) {
      try {
        const { ocrPdfLocally } = await import('../services/localOcr');
        const localText = await ocrPdfLocally(chunk.pdfBuffer);
        if (localText.trim().length > 0) {
          chunkText = localText.trim();
          primaryEngineUsed = 'Local Tesseract OCR (offline ⚡)';
        }
      } catch (ocrErr: any) {
        console.warn(`[Knowledge Pipeline] Local OCR failed on chunk ${chunk.chunkIndex}:`, ocrErr?.message);
      }
    }

    if (chunkText) {
      accumulatedTexts.push(`--- [قسم الصفحات ${chunk.startPage} إلى ${chunk.endPage}] ---\n${chunkText}`);
    }
  }

  // If chunking produced no text, attempt direct processing on full PDF buffer with Gemini Multimodal AI
  if (accumulatedTexts.length === 0 && pdfBuffer.length > 0) {
    console.log('[Knowledge Pipeline] Chunks produced no text. Retrying full PDF buffer directly with Gemini AI...');
    const fullGeminiRes = await parsePdfChunkWithGemini({
      chunkIndex: 1,
      totalChunks: 1,
      startPage: 1,
      endPage: totalPages || 1,
      pdfBuffer,
      base64Data: pdfBuffer.toString('base64'),
    });
    if (fullGeminiRes && fullGeminiRes.text && fullGeminiRes.text.trim().length > 0) {
      accumulatedTexts.push(fullGeminiRes.text.trim());
      primaryEngineUsed = 'Gemini Multimodal Direct OCR Parser';
    }
  }

  // Last resort: LOCAL offline OCR on the full buffer (scanned PDFs, no keys)
  if (accumulatedTexts.length === 0 && pdfBuffer.length > 0) {
    try {
      const { ocrPdfLocally } = await import('../services/localOcr');
      const localText = await ocrPdfLocally(pdfBuffer);
      if (localText.trim().length > 0) {
        accumulatedTexts.push(localText.trim());
        primaryEngineUsed = 'Local Tesseract OCR (offline ⚡)';
      }
    } catch (ocrErr: any) {
      console.warn('[Knowledge Pipeline] Local OCR full-buffer fallback failed:', ocrErr?.message);
    }
  }

  const combinedText = accumulatedTexts.join('\n\n');
  const wordCount = combinedText.trim() ? combinedText.trim().split(/\s+/).length : 0;

  return {
    text: combinedText,
    totalPages,
    chunksProcessed: chunks.length,
    engineUsed: primaryEngineUsed,
    charCount: combinedText.length,
    wordCount,
  };
}
