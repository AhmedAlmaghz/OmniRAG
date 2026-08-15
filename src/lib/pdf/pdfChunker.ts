import { PDFDocument } from 'pdf-lib';
import { generateContentWithResilience } from '../gemini/resilientGemini';

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
  pagesPerChunk: number = 25
): Promise<{ totalPages: number; chunks: PdfChunkInfo[] }> {
  try {
    const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const totalPages = srcDoc.getPageCount();
    const chunks: PdfChunkInfo[] = [];

    if (totalPages === 0) {
      throw new Error('ملف PDF فارغ ولا يحتوي على أي صفحات.');
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
  apiKey?: string
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
        model: 'mistral-ocr-latest',
        document: {
          type: 'document_url',
          document_url: `data:application/pdf;base64,${chunk.base64Data}`,
        },
        include_image_base64: false,
      }),
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
  apiKey?: string
): Promise<{ text: string } | null> {
  const token = apiKey || process.env.UNSTRUCTURED_API_KEY;
  const apiUrl = process.env.UNSTRUCTURED_API_URL || 'https://api.unstructuredapp.io/general/v0/general';
  if (!token) return null;

  try {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(chunk.pdfBuffer)]);
    formData.append('files', blob, `chunk_${chunk.chunkIndex}.pdf`);
    formData.append('strategy', 'hi_res');

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'unstructured-api-key': token,
      },
      body: formData,
    });

    if (!res.ok) {
      console.warn(`[Unstructured API] HTTP ${res.status} on chunk ${chunk.chunkIndex}`);
      return null;
    }

    const elements = await res.json();
    if (Array.isArray(elements)) {
      const extracted = elements.map((el: any) => el.text).filter(Boolean).join('\n\n');
      return { text: extracted };
    }
    return null;
  } catch (err: any) {
    console.warn(`[Unstructured API] Execution failed on chunk ${chunk.chunkIndex}:`, err?.message || err);
    return null;
  }
}

/**
 * Gemini Multimodal Document Parser
 */
export async function parsePdfChunkWithGemini(
  chunk: PdfChunkInfo,
  model: string = 'gemini-3.7-flash'
): Promise<{ text: string } | null> {
  try {
    const response = await generateContentWithResilience({
      model: model || 'gemini-3.7-flash',
      fallbackModels: ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.1-pro-preview'],
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
 * Native pdf-parse node module parser with stream text extraction fallback
 */
export async function parsePdfChunkWithNativePdfParse(
  chunk: PdfChunkInfo
): Promise<{ text: string } | null> {
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
      const parsePdfFunc = typeof pdfModule === 'function' 
        ? pdfModule 
        : (pdfModule as any).default || pdfModule;
      if (typeof parsePdfFunc === 'function') {
        const parsedPdf = await parsePdfFunc(chunk.pdfBuffer);
        if (parsedPdf && parsedPdf.text) {
          extracted = parsedPdf.text.trim();
        }
      }
    }

    if (extracted && extracted.length > 0) {
      return { text: extracted };
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
      const cleaned = m.replace(/^\(/, '').replace(/\)\s*T[jJ]$/, '').trim();
      if (cleaned.length >= 2 && !/^[\x00-\x1F]+$/.test(cleaned)) {
        extractedWords.push(cleaned);
      }
    }
    
    if (extractedWords.length > 0) {
      return { text: extractedWords.join(' ') };
    }
  } catch (e) {
    // Ignore stream extraction errors
  }

  return null;
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
  } = {}
): Promise<DocumentParseResult> {
  const {
    preferredEngine = 'auto',
    pagesPerChunk = 25,
    mistralApiKey,
    unstructuredApiKey,
  } = options;

  // 1. Adaptive pages per chunk based on PDF file size to prevent 413 Request Entity Too Large errors
  let resolvedPagesPerChunk = pagesPerChunk;
  const fileMb = pdfBuffer.length / (1024 * 1024);
  if (fileMb > 15) {
    resolvedPagesPerChunk = Math.min(pagesPerChunk, 5); // 5 pages per chunk for huge files (>15MB)
    console.log(`[Knowledge Pipeline] Huge PDF detected (${fileMb.toFixed(2)} MB). Reducing pagesPerChunk dynamically to 5 to avoid 413 errors.`);
  } else if (fileMb > 5) {
    resolvedPagesPerChunk = Math.min(pagesPerChunk, 10); // 10 pages per chunk for medium-large files (>5MB)
    console.log(`[Knowledge Pipeline] Medium-large PDF detected (${fileMb.toFixed(2)} MB). Reducing pagesPerChunk dynamically to 10 to avoid 413 errors.`);
  }

  // 2. Slice PDF into optimized chunks
  const { totalPages, chunks } = await slicePdfIntoChunks(pdfBuffer, resolvedPagesPerChunk);
  console.log(`[Knowledge Pipeline] Processing PDF (${totalPages} pages) sliced into ${chunks.length} sequential chunks (${resolvedPagesPerChunk} pages/chunk)...`);

  const accumulatedTexts: string[] = [];
  let primaryEngineUsed = 'native-pdf-parse';

  for (const chunk of chunks) {
    console.log(`[Knowledge Pipeline] Ingesting Chunk ${chunk.chunkIndex}/${chunk.totalChunks} (Pages ${chunk.startPage} - ${chunk.endPage})...`);
    let chunkText = '';

    // Step A: Fast native PDF extraction (instant, zero network, zero API quota)
    if (preferredEngine === 'auto') {
      const nativeRes = await parsePdfChunkWithNativePdfParse(chunk);
      if (nativeRes && nativeRes.text && nativeRes.text.trim().length > 0) {
        chunkText = nativeRes.text.trim();
        primaryEngineUsed = 'Native High-Speed PDF Parser';
      }
    }

    // Step B: Mistral Document AI API
    if (
      !chunkText &&
      (preferredEngine === 'mistral' ||
        ((preferredEngine === 'auto' || preferredEngine === 'unstructured') && (mistralApiKey || process.env.MISTRAL_API_KEY)))
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
        ((preferredEngine === 'auto' || preferredEngine === 'mistral') && (unstructuredApiKey || process.env.UNSTRUCTURED_API_KEY)))
    ) {
      const unstructuredRes = await parsePdfChunkWithUnstructured(chunk, unstructuredApiKey);
      if (unstructuredRes && unstructuredRes.text && unstructuredRes.text.trim().length > 0) {
        chunkText = unstructuredRes.text.trim();
        primaryEngineUsed = 'Unstructured.io MCP Transform';
      }
    }

    // Step D: Gemini Multimodal Document Parser (Vision / OCR for scanned PDFs)
    if (!chunkText) {
      const geminiRes = await parsePdfChunkWithGemini(chunk);
      if (geminiRes && geminiRes.text && geminiRes.text.trim().length > 0) {
        chunkText = geminiRes.text.trim();
        primaryEngineUsed = 'Gemini Multimodal AI';
      }
    }

    // Step E: Final native fallback if auto was skipped or preferred non-auto failed
    if (!chunkText) {
      const nativeRes = await parsePdfChunkWithNativePdfParse(chunk);
      if (nativeRes && nativeRes.text) {
        chunkText = nativeRes.text.trim();
        primaryEngineUsed = 'Native High-Speed PDF Parser';
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
