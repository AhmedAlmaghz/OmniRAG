import type { DispatchResult } from '../unstructuredService';
import type { ExtractionContext, IExtractionEngine } from './types';

/**
 * Concrete extraction engines. Each wraps an existing, battle-tested extractor
 * (imported lazily inside extract() to avoid a runtime import cycle with
 * unstructuredService) and encodes the SAME gate + label the legacy waterfall
 * used. Order here is not meaningful — `priority` drives the chain.
 */

const isPptx = (ctx: ExtractionContext) => ctx.fileName.toLowerCase().endsWith('.pptx');

/** Step 0 — instant, key-free PowerPoint XML parse (slide order + notes). */
const localPptxEngine: IExtractionEngine = {
  id: 'local_pptx',
  nameAr: 'محلل PPTX المحلي (XML)',
  nameEn: 'Local PPTX XML Parser',
  priority: 100,
  supportedCategories: ['powerpoint'],
  requiresCloud: false,
  canHandle: (ctx) => ctx.classification.isPowerPoint && isPptx(ctx),
  extract: async (ctx) => {
    const { parsePptxLocally } = await import('../pptxParser');
    try {
      const localPptx = await parsePptxLocally(ctx.fileBuffer);
      if (localPptx.text.trim().length >= 400) {
        console.log(
          `[Document Ingestion] Parsed PowerPoint locally (${localPptx.slideCount} slides) — no cloud engine needed.`,
        );
        return {
          text: localPptx.text.trim(),
          engineUsed: `Local PPTX XML Parser (${localPptx.slideCount} slides ⚡)`,
          success: true,
        };
      }
      console.warn(
        `[Document Ingestion] Local PPTX parse produced only ${localPptx.text.trim().length} chars — falling through to cloud engines.`,
      );
      return null;
    } catch (e: any) {
      console.warn('[Document Ingestion] Local PPTX parser failed, falling back to other engines...', e?.message);
      return null;
    }
  },
};

/** Step 1 — Mammoth DOCX parse for perfect Arabic UTF-8 (no mojibake). */
const mammothDocxEngine: IExtractionEngine = {
  id: 'mammoth_docx',
  nameAr: 'محلل وورد المحلي (Mammoth)',
  nameEn: 'Local Mammoth DOCX Parser',
  priority: 90,
  supportedCategories: ['word'],
  requiresCloud: false,
  canHandle: (ctx) => ctx.classification.isWord,
  extract: async (ctx) => {
    const { parseDocxWithMammoth } = await import('../unstructuredService');
    try {
      console.log(
        `[Document Ingestion] Parsing Word Document (${ctx.fileName}) locally using mammoth to preserve perfect Arabic UTF-8 encoding...`,
      );
      const mammothText = await parseDocxWithMammoth(ctx.fileBuffer);
      if (mammothText && mammothText.trim().length > 0) {
        return {
          text: mammothText.trim(),
          engineUsed: 'Local Mammoth DOCX Parser (UTF-8 Arabic Safe ⚡)',
          success: true,
        };
      }
      return null;
    } catch (e: any) {
      console.error('[Document Ingestion] Local Mammoth DOCX parser failed, falling back to other engines...', e);
      return null;
    }
  },
};

/**
 * Step 1b — the explicit "local libraries only" mode. Terminal: once selected,
 * nothing below ever leaves the machine or bills a cloud API. Handles what the
 * local parsers above did not already serve (PDF via the local pipeline, images
 * via offline Tesseract, plain text), and reports honest unsupported otherwise.
 */
const localOnlyEngine: IExtractionEngine = {
  id: 'local_only',
  nameAr: 'المكتبات المحلية فقط (بدون سحابة)',
  nameEn: 'Local Libraries Only',
  priority: 80,
  supportedCategories: ['pdf', 'image', 'text'],
  requiresCloud: false,
  canHandle: (ctx) => ctx.enginePref === 'local',
  extract: async (ctx) => {
    const c = ctx.classification;
    const localUnsupported = (reason: string): DispatchResult => ({
      text: '',
      engineUsed: 'Local Libraries Only',
      success: false,
      metadata: { error: reason },
    });

    if (c.isPdf) {
      const { processPdfWithBatchedPipeline } = await import('../../pdf/pdfChunker');
      const pipelineResult = await processPdfWithBatchedPipeline(ctx.fileBuffer, { preferredEngine: 'local' });
      if (pipelineResult.text.trim().length > 0) {
        return { text: pipelineResult.text, engineUsed: pipelineResult.engineUsed, success: true };
      }
      return localUnsupported(
        'تعذر استخراج النص محلياُ من ملف PDF (قد يكون مستنداً ممسوحاً ضوئياً بلا طبقة نصية ويفشل الـ OCR المحلي).',
      );
    }

    if (c.isImage) {
      try {
        const { ocrImageBuffer } = await import('../localOcr');
        const localText = await ocrImageBuffer(ctx.fileBuffer);
        if (localText.length > 0) {
          return { text: localText, engineUsed: 'Local Tesseract OCR (offline ⚡)', success: true };
        }
      } catch (e: any) {
        console.warn('[Unstructured Service] Local Tesseract OCR failed:', e?.message);
      }
      return localUnsupported('تعذر التعرف الضوئي على نص داخل الصورة عبر المكتبة المحلية (Tesseract).');
    }

    if (c.isAudio || c.isVideo) {
      return localUnsupported('المكتبة المحلية لا تدعم تفريغ الصوت والفيديو — اختر المحرك التلقائي أو محركاُ سحابياُ.');
    }

    if (c.isText) {
      const text = ctx.fileBuffer.toString('utf-8');
      if (text.trim().length > 0) {
        return { text, engineUsed: 'Direct UTF-8 Text Reader', success: true };
      }
    }

    return localUnsupported('لا تتوفر مكتبة محلية لهذه الصيغة — استخدم الوضع التلقائي أو محركاُ سحابياُ.');
  },
};

/** Step 2 — audio/video vendor ladder (Groq Whisper → Voxtral → Gemini). Terminal. */
const audioVideoEngine: IExtractionEngine = {
  id: 'audio_video',
  nameAr: 'تفريغ الصوت والفيديو',
  nameEn: 'Audio / Video Transcription',
  priority: 70,
  supportedCategories: ['audio', 'video'],
  requiresCloud: true,
  canHandle: (ctx) => ctx.classification.isAudio || ctx.classification.isVideo,
  extract: async (ctx) => {
    const { transcribeAudioVideo } = await import('../unstructuredService');
    // The legacy waterfall passed the RAW mimeType (not the normalized one) to
    // the transcription ladder — preserved verbatim.
    return transcribeAudioVideo(ctx.fileBuffer, ctx.fileName, ctx.rawMimeType, ctx.options);
  },
};

/** Step 3 — direct UTF-8 reader for genuine plain-text files. Terminal. */
const plainTextEngine: IExtractionEngine = {
  id: 'plain_text',
  nameAr: 'قارئ النصوص المباشر (UTF-8)',
  nameEn: 'Direct UTF-8 Text Reader',
  priority: 60,
  supportedCategories: ['text'],
  requiresCloud: false,
  canHandle: (ctx) => ctx.classification.isText,
  extract: async (ctx) => {
    try {
      const text = ctx.fileBuffer.toString('utf-8');
      return { text, engineUsed: 'Direct UTF-8 Text Reader', success: true };
    } catch (e: any) {
      console.warn('[Unstructured Service] Failed to read as plain text:', e);
      return null;
    }
  },
};

/** Step 3' — Mistral Document AI OCR for PDFs and images. */
const mistralOcrEngine: IExtractionEngine = {
  id: 'mistral_ocr',
  nameAr: 'مسترال للمستندات (OCR)',
  nameEn: 'Mistral Document AI',
  priority: 50,
  supportedCategories: ['pdf', 'image'],
  requiresCloud: true,
  canHandle: (ctx) =>
    Boolean(ctx.mistralKey) &&
    (ctx.classification.isPdf || ctx.classification.isImage) &&
    (ctx.enginePref === 'mistral' || ctx.enginePref === 'auto'),
  extract: async (ctx) => {
    const { mistralOcr } = await import('../unstructuredService');
    const result = await mistralOcr(ctx.fileBuffer, ctx.fileName, ctx.mimeType, ctx.mistralKey);
    if (result.success) return result;
    console.warn('[Unstructured Service] Mistral OCR workflow failed, falling back to other engines...');
    return null;
  },
};

/** Step 4 — Unstructured partition for PDF / Word / PowerPoint / spreadsheets. */
const unstructuredEngine: IExtractionEngine = {
  id: 'unstructured',
  nameAr: 'أنستركتشر (Partition)',
  nameEn: 'Unstructured Partition',
  priority: 40,
  supportedCategories: ['pdf', 'word', 'powerpoint', 'spreadsheet'],
  requiresCloud: true,
  canHandle: (ctx) =>
    Boolean(ctx.unstructuredKey) &&
    (ctx.classification.isPdf ||
      ctx.classification.isWord ||
      ctx.classification.isPowerPoint ||
      ctx.classification.isSpreadsheet) &&
    (ctx.enginePref === 'unstructured' || ctx.enginePref === 'auto'),
  extract: async (ctx) => {
    const { unstructuredPartition } = await import('../unstructuredService');
    const result = await unstructuredPartition(
      ctx.fileBuffer,
      ctx.fileName,
      ctx.mimeType,
      ctx.unstructuredKey,
      ctx.options.strategy || 'hi_res',
    );
    if (result.success) return result;
    console.warn('[Unstructured Service] Partition workflow failed, falling back to Gemini OCR parser...');
    return null;
  },
};

/** Step 5 — universal Gemini multimodal fallback with category-specific prompts. */
const geminiEngine: IExtractionEngine = {
  id: 'gemini',
  nameAr: 'جيميناي متعدد الوسائط',
  nameEn: 'Gemini Multimodal Extractor',
  priority: 30,
  supportedCategories: ['pdf', 'image', 'word', 'powerpoint', 'spreadsheet', 'audio', 'video', 'text'],
  requiresCloud: true,
  canHandle: () => true,
  extract: async (ctx) => {
    const { getAiModel } = await import('../../config/aiModels');
    const { generateTextResilient } = await import('../../ai/resilientGenerate');
    const c = ctx.classification;
    try {
      const model = ctx.options.model || getAiModel('documentParseModel');
      let systemInstruction =
        'You are an expert multilingual document extractor. Extract, transcribe, and structure all readable text, tables, slide contents, spreadsheets, audio speech transcription, or visual elements from this file. IMPORTANT: If the file contains Arabic (العربية), extract it perfectly. Maintain correct spelling, grammar, RTL (Right-to-Left) formatting, and paragraphs. Do NOT translate any Arabic text. Output ONLY the extracted text directly without adding preamble or extra commentary.';
      let engineUsed = 'Gemini Multimodal Document Extractor Fallback';

      if (c.isImage) {
        systemInstruction =
          'You are an expert high-precision visual OCR model. Perform OCR on this image. Extract all text, labels, titles, tables, or annotations visible in this image. If there is Arabic text, extract it perfectly with RTL (Right-to-Left) alignment. Output ONLY the extracted text directly without adding any preamble or extra commentary.';
        engineUsed = 'Gemini High-Precision Visual OCR';
      } else if (c.isSpreadsheet) {
        systemInstruction =
          'You are an expert spreadsheet parser. Extract all data from this spreadsheet file and format it as beautifully structured Markdown tables. Preserve all column names, row indices, values, and cell relationships. Keep the structure perfect. Output ONLY the formatted tables without adding any preamble or extra commentary.';
        engineUsed = 'Gemini Excel-to-Markdown Tabular Parser';
      } else if (c.isWord) {
        systemInstruction =
          'You are an expert Word document parser. Extract all text, paragraphs, headings, bullet points, numbered lists, and tables. Format the output elegantly in standard Markdown. Output ONLY the extracted markdown content directly without adding any preamble or extra commentary.';
        engineUsed = 'Gemini Word Document Structure Parser';
      } else if (c.isPowerPoint) {
        systemInstruction =
          'You are an expert slide presentation parser. Extract and structure the content of this presentation slide-by-slide. Format each slide with a clear header (e.g., "### Slide 1: [Title]") followed by bullet points, text, and visual descriptions. Output ONLY the structured text directly without adding any preamble or extra commentary.';
        engineUsed = 'Gemini PowerPoint Slide Parser';
      }

      const result = await generateTextResilient({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'file',
                mediaType: ctx.mimeType,
                filename: ctx.fileName,
                data: { type: 'data', data: new Uint8Array(ctx.fileBuffer) },
              },
              { type: 'text', text: systemInstruction },
            ],
          },
        ],
        maxRetries: 2,
      });

      if (result?.text) {
        return { text: result.text, engineUsed, success: true };
      }
      return null;
    } catch (err: any) {
      console.error('[Unstructured Service] Fallback document extraction failed:', err);
      return null;
    }
  },
};

/** Step 6 — final offline Tesseract OCR for image-only files. */
const tesseractEngine: IExtractionEngine = {
  id: 'tesseract',
  nameAr: 'تيسراكت المحلي (OCR)',
  nameEn: 'Local Tesseract OCR',
  priority: 20,
  supportedCategories: ['image'],
  requiresCloud: false,
  canHandle: (ctx) => ctx.classification.isImage,
  extract: async (ctx) => {
    try {
      const { ocrImageBuffer } = await import('../localOcr');
      const localText = await ocrImageBuffer(ctx.fileBuffer);
      if (localText.length > 0) {
        return { text: localText, engineUsed: 'Local Tesseract OCR (offline ⚡)', success: true };
      }
      return null;
    } catch (e: any) {
      console.warn('[Unstructured Service] Local Tesseract OCR failed:', e?.message);
      return null;
    }
  },
};

/** Step 6b — offline OCR of image-only PPTX slides (design-tool exports). */
const pptxSlideOcrEngine: IExtractionEngine = {
  id: 'pptx_slide_ocr',
  nameAr: 'OCR شرائح PPTX المحلية',
  nameEn: 'Local PPTX Slide-Image OCR',
  priority: 10,
  supportedCategories: ['powerpoint'],
  requiresCloud: false,
  canHandle: (ctx) => ctx.classification.isPowerPoint && isPptx(ctx),
  extract: async (ctx) => {
    try {
      const { extractSlideImagesFromPptx } = await import('../pptxParser');
      const { ocrImageBuffer } = await import('../localOcr');
      const slideImages = await extractSlideImagesFromPptx(ctx.fileBuffer);
      if (slideImages.length > 0) {
        const sections: string[] = [];
        for (let i = 0; i < slideImages.length; i++) {
          const text = await ocrImageBuffer(slideImages[i]);
          if (text) sections.push(`### Slide ${i + 1}\n\n${text}`);
        }
        if (sections.length > 0) {
          return {
            text: sections.join('\n\n'),
            engineUsed: `Local PPTX Slide-Image OCR (offline, ${slideImages.length} slides ⚡)`,
            success: true,
          };
        }
      }
      return null;
    } catch (e: any) {
      console.warn('[Unstructured Service] Local PPTX slide-image OCR failed:', e?.message);
      return null;
    }
  },
};

export const EXTRACTION_ENGINES: IExtractionEngine[] = [
  localPptxEngine,
  mammothDocxEngine,
  localOnlyEngine,
  audioVideoEngine,
  plainTextEngine,
  mistralOcrEngine,
  unstructuredEngine,
  geminiEngine,
  tesseractEngine,
  pptxSlideOcrEngine,
];
