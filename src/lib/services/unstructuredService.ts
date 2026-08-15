import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { generateContentWithResilience } from '../gemini/resilientGemini';

export interface FileTypeClassification {
  isText: boolean;
  isAudio: boolean;
  isVideo: boolean;
  isImage: boolean;
  isSpreadsheet: boolean;
  isWord: boolean;
  isPowerPoint: boolean;
  isPdf: boolean;
}

/**
 * Detects the logical category and properties of a file based on its name and MIME type.
 */
export function detectFileType(fileName: string, mimeType: string = 'application/octet-stream'): FileTypeClassification {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();

  const isText =
    lowerMime.startsWith('text/') ||
    /\.(txt|md|markdown|json|csv|tsv|py|js|ts|tsx|jsx|html|xml|log|env|yaml|yml|sql|sh|c|cpp|java|go|rb|php|cs|ini|conf|rst|tex|srt|vtt|rtf|sub)$/i.test(
      lowerName
    );

  const isAudio =
    lowerMime.startsWith('audio/') ||
    /\.(mp3|wav|flac|aac|ogg|m4a|mpga|opus|pcm)$/i.test(lowerName);

  const isVideo =
    lowerMime.startsWith('video/') ||
    /\.(mp4|mov|avi|webm|mpeg|mpg|quicktime|3gpp)$/i.test(lowerName);

  const isImage =
    lowerMime.startsWith('image/') ||
    /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(lowerName);

  const isSpreadsheet =
    /\.(xlsx|xls|csv|tsv)$/i.test(lowerName) ||
    lowerMime.includes('spreadsheet') ||
    lowerMime.includes('excel') ||
    lowerMime === 'text/csv';

  const isWord =
    /\.(docx|doc)$/i.test(lowerName) ||
    lowerMime.includes('wordprocessingml') ||
    lowerMime.includes('msword');

  const isPowerPoint =
    /\.(pptx|ppt)$/i.test(lowerName) ||
    lowerMime.includes('presentationml') ||
    lowerMime.includes('powerpoint');

  const isPdf =
    /\.pdf$/i.test(lowerName) ||
    lowerMime === 'application/pdf';

  return {
    isText,
    isAudio,
    isVideo,
    isImage,
    isSpreadsheet,
    isWord,
    isPowerPoint,
    isPdf,
  };
}

/**
 * Normlizes MIME types to correct standard strings.
 */
export function normalizeMimeType(fileName: string, mimeType: string = ''): string {
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

/**
 * Archives an uploaded file to a dedicated, highly-organized local directory structure:
 * uploads/archive/{tenantId}/{date}/{fileHash}_{fileName}
 * Returns the absolute path of the saved file on disk.
 */
export function archiveUploadedFile(
  fileBuffer: Buffer,
  fileName: string,
  tenantId: string,
  fileHash: string
): string {
  try {
    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    // Sanitize fileName to prevent directory traversal
    const safeFileName = path.basename(fileName).replace(/[^a-zA-Z0-9_.-]/g, '_');
    
    // Target directory: uploads/archive/{tenantId}/{date}
    const archiveDir = path.join(process.cwd(), 'uploads', 'archive', tenantId, todayStr);
    
    // Ensure parent directory recursively exists
    fs.mkdirSync(archiveDir, { recursive: true });
    
    const archiveFilePath = path.join(archiveDir, `${fileHash.substring(0, 16)}_${safeFileName}`);
    
    // Write raw file to disk
    fs.writeFileSync(archiveFilePath, fileBuffer);
    console.log(`[File Archiver] Successfully archived file to disk: ${archiveFilePath}`);
    
    return archiveFilePath;
  } catch (error) {
    console.error('[File Archiver] Error writing file to archive directory:', error);
    return '';
  }
}

export interface DispatchOptions {
  unstructuredApiKey?: string;
  mistralApiKey?: string;
  geminiApiKey?: string;
  model?: string;
  preferredEngine?: 'mistral' | 'unstructured' | 'gemini' | 'auto';
  strategy?: 'hi_res' | 'fast' | 'ocr_only';
}

export interface DispatchResult {
  text: string;
  engineUsed: string;
  success: boolean;
  metadata?: any;
}

/**
 * Direct interface with Mistral OCR API to extract texts and layouts as Markdown.
 * Supports PDF and images (PNG, JPEG, WEBP, etc.)
 */
export async function mistralOcr(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  apiKey: string
): Promise<DispatchResult> {
  try {
    const base64Data = fileBuffer.toString('base64');
    const resolvedMime = normalizeMimeType(fileName, mimeType);

    console.log(`[Mistral OCR] Calling mistral-ocr-latest for ${fileName} (${resolvedMime})...`);
    const res = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'mistral-ocr-latest',
        document: {
          type: 'document_url',
          document_url: `data:${resolvedMime};base64,${base64Data}`,
        },
        include_image_base64: false,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Mistral OCR API returned HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const pagesList = data.pages || [];
    const textSections: string[] = [];

    pagesList.forEach((p: any, idx: number) => {
      const pageText = p.markdown || p.text || '';
      if (pagesList.length > 1) {
        textSections.push(`### [صفحة ${idx + 1}]\n${pageText}`);
      } else {
        textSections.push(pageText);
      }
    });

    const fullText = textSections.join('\n\n');
    if (fullText.trim().length > 0) {
      return {
        text: fullText,
        engineUsed: 'Mistral Document AI (OCR)',
        success: true,
        metadata: { pagesCount: pagesList.length },
      };
    }

    throw new Error('Mistral OCR API returned empty text.');
  } catch (error: any) {
    console.error('[Unstructured Service] Mistral OCR error:', error);
    return {
      text: '',
      engineUsed: 'Mistral Document AI (OCR)',
      success: false,
      metadata: { error: error.message },
    };
  }
}

/**
 * Interfaces directly with the Unstructured Partition API to extract structured layout elements as Markdown.
 */
export async function unstructuredPartition(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  apiKey: string,
  strategy: 'hi_res' | 'fast' | 'ocr_only' = 'hi_res'
): Promise<DispatchResult> {
  const apiUrl = process.env.UNSTRUCTURED_API_URL || 'https://api.unstructuredapp.io/general/v0/general';

  try {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)]);
    formData.append('files', blob, fileName);
    formData.append('strategy', strategy);
    formData.append('coordinates', 'false');
    formData.append('output_format', 'application/json');

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'unstructured-api-key': apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Unstructured API returned status ${response.status}: ${errText}`);
    }

    const elements = await response.json();
    if (Array.isArray(elements)) {
      const markdownText = elements
        .map((e: any) => {
          if (!e.text) return '';
          // Simple heuristic conversion of element types to Markdown headings/paragraphs
          if (e.type === 'Title') return `## ${e.text}`;
          if (e.type === 'Heading') return `### ${e.text}`;
          if (e.type === 'ListItem') return `* ${e.text}`;
          if (e.type === 'Table') {
            return e.metadata?.text_as_html || e.text;
          }
          return e.text;
        })
        .filter(Boolean)
        .join('\n\n');

      return {
        text: markdownText,
        engineUsed: 'Unstructured.io Partition Engine',
        success: true,
        metadata: { elementsCount: elements.length, strategy },
      };
    }

    throw new Error('Unstructured API returned invalid elements format.');
  } catch (error: any) {
    console.error('[Unstructured Service] Partition error:', error);
    return {
      text: '',
      engineUsed: 'Unstructured.io Partition Engine',
      success: false,
      metadata: { error: error.message },
    };
  }
}

/**
 * Transcribes audio and video streams using Gemini's multimodal and temporal alignment models.
 */
export async function transcribeAudioVideo(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  options: DispatchOptions = {}
): Promise<DispatchResult> {
  const model = options.model || 'gemini-3.5-flash';
  const resolvedMime = normalizeMimeType(fileName, mimeType);
  const base64Data = fileBuffer.toString('base64');
  const isVideo = resolvedMime.startsWith('video/');

  let systemInstruction = 'You are an expert audio transcription model. Listen carefully to this audio file, and transcribe all spoken words (speech-to-text) verbatim. If the speech is in Arabic, write it exactly as spoken with proper punctuation. Output ONLY the transcribed text directly without adding any commentary, preambles, or explanations.';
  let engineUsed = 'Gemini Audio Speech-to-Text Transcription Engine';

  if (isVideo) {
    systemInstruction = 'You are an expert video transcriber and analyzer. Listen to the audio track and watch the video frames. Transcribe all spoken speech verbatim, and if there is any visible text, subtitles, or slides shown in the video frames, extract and merge them chronologically. If the content is in Arabic, preserve it perfectly. Output ONLY the transcription and extracted text directly without adding any preamble or extra commentary.';
    engineUsed = 'Gemini Multimodal Video Speech & Frames Transcriber';
  }

  try {
    const response = await generateContentWithResilience({
      model,
      contents: [
        {
          inlineData: {
            mimeType: resolvedMime,
            data: base64Data,
          },
        },
        systemInstruction,
      ],
      maxRetriesPerModel: 2,
    });

    if (response?.text && response.text.trim().length > 0) {
      return {
        text: response.text.trim(),
        engineUsed,
        success: true,
      };
    }

    throw new Error('Gemini returned an empty transcription.');
  } catch (err: any) {
    console.error('[Unstructured Service] Transcription failed:', err);
    return {
      text: '',
      engineUsed,
      success: false,
      metadata: { error: err.message },
    };
  }
}

/**
 * Dispatches any file buffer to the correct logical workflow (Transcription, Partitioning, OCR, or Direct Plain Text Reader).
 */
export async function dispatchFile(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string = 'application/octet-stream',
  options: DispatchOptions = {}
): Promise<DispatchResult> {
  const fileClassification = detectFileType(fileName, mimeType);
  const resolvedMime = normalizeMimeType(fileName, mimeType);
  const enginePref = options.preferredEngine || 'auto';

  // 1. Plain Text Fallback (direct extraction)
  if (fileClassification.isText) {
    try {
      const text = fileBuffer.toString('utf-8');
      return {
        text,
        engineUsed: 'Direct UTF-8 Text Reader',
        success: true,
      };
    } catch (e: any) {
      console.warn('[Unstructured Service] Failed to read as plain text:', e);
    }
  }

  // 2. Audio & Video transcription workflow
  if (fileClassification.isAudio || fileClassification.isVideo) {
    return transcribeAudioVideo(fileBuffer, fileName, mimeType, options);
  }

  // 3. Prioritized Mistral Document AI (OCR) workflow (PDFs and Images)
  const mistralKey = options.mistralApiKey || process.env.MISTRAL_API_KEY;
  if (
    mistralKey &&
    (fileClassification.isPdf || fileClassification.isImage) &&
    (enginePref === 'mistral' || enginePref === 'auto')
  ) {
    const mistralResult = await mistralOcr(fileBuffer, fileName, resolvedMime, mistralKey);
    if (mistralResult.success) {
      return mistralResult;
    }
    console.warn('[Unstructured Service] Mistral OCR workflow failed, falling back to other engines...');
  }

  // 4. Document Partitioning workflow (PDF, Word, Excel, PowerPoint)
  const unstructuredKey = options.unstructuredApiKey || process.env.UNSTRUCTURED_API_KEY;
  if (
    unstructuredKey &&
    (fileClassification.isPdf ||
      fileClassification.isWord ||
      fileClassification.isPowerPoint ||
      fileClassification.isSpreadsheet) &&
    (enginePref === 'unstructured' || enginePref === 'auto')
  ) {
    const partitionResult = await unstructuredPartition(
      fileBuffer,
      fileName,
      resolvedMime,
      unstructuredKey,
      options.strategy || 'hi_res'
    );
    if (partitionResult.success) {
      return partitionResult;
    }
    console.warn('[Unstructured Service] Partition workflow failed, falling back to Gemini OCR parser...');
  }

  // 5. Default Fallback / Gemini High-Precision Multimodal OCR / Extraction
  try {
    const model = options.model || 'gemini-3.5-flash';
    const base64Data = fileBuffer.toString('base64');
    let systemInstruction = 'You are an expert multilingual document extractor. Extract, transcribe, and structure all readable text, tables, slide contents, spreadsheets, audio speech transcription, or visual elements from this file. IMPORTANT: If the file contains Arabic (العربية), extract it perfectly. Maintain correct spelling, grammar, RTL (Right-to-Left) formatting, and paragraphs. Do NOT translate any Arabic text. Output ONLY the extracted text directly without adding preamble or extra commentary.';
    let engineUsed = 'Gemini Multimodal Document Extractor Fallback';

    if (fileClassification.isImage) {
      systemInstruction = 'You are an expert high-precision visual OCR model. Perform OCR on this image. Extract all text, labels, titles, tables, or annotations visible in the image. If there is Arabic text, extract it perfectly with RTL (Right-to-Left) alignment. Output ONLY the extracted text directly without adding any preamble or extra commentary.';
      engineUsed = 'Gemini High-Precision Visual OCR';
    } else if (fileClassification.isSpreadsheet) {
      systemInstruction = 'You are an expert spreadsheet parser. Extract all data from this spreadsheet file and format it as beautifully structured Markdown tables. Preserve all column names, row indices, values, and cell relationships. Keep the structure perfect. Output ONLY the formatted tables without adding any preamble or extra commentary.';
      engineUsed = 'Gemini Excel-to-Markdown Tabular Parser';
    } else if (fileClassification.isWord) {
      systemInstruction = 'You are an expert Word document parser. Extract all text, paragraphs, headings, bullet points, numbered lists, and tables. Format the output elegantly in standard Markdown. Output ONLY the extracted markdown content directly without adding any preamble or extra commentary.';
      engineUsed = 'Gemini Word Document Structure Parser';
    } else if (fileClassification.isPowerPoint) {
      systemInstruction = 'You are an expert slide presentation parser. Extract and structure the content of this presentation slide-by-slide. Format each slide with a clear header (e.g., "### Slide 1: [Title]") followed by bullet points, text, and visual descriptions. Output ONLY the structured text directly without adding any preamble or extra commentary.';
      engineUsed = 'Gemini PowerPoint Slide Parser';
    }

    const response = await generateContentWithResilience({
      model,
      contents: [
        {
          inlineData: {
            mimeType: resolvedMime,
            data: base64Data,
          },
        },
        systemInstruction,
      ],
      maxRetriesPerModel: 2,
    });

    if (response?.text && response.text.trim().length > 0) {
      return {
        text: response.text.trim(),
        engineUsed,
        success: true,
      };
    }
  } catch (err: any) {
    console.error('[Unstructured Service] Fallback document extraction failed:', err);
  }

  // If Mistral or Unstructured was preferred but failed, try Gemini fallback anyway
  return {
    text: '',
    engineUsed: 'None',
    success: false,
    metadata: { error: 'No extraction engine succeeded.' },
  };
}
