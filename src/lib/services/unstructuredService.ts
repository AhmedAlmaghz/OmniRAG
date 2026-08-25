import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { generateText, transcribe, uploadFile } from 'ai';
import { getAiModel, getFallbackModels } from '../config/aiModels';
import { google, getGoogleProvider, resolveGeminiApiKey } from '../rag/googleProvider';
import { generateTextResilient } from '../ai/resilientGenerate';
import {
  groqTranscriptionModel,
  mistralTranscriptionModel,
  resolveGroqApiKey,
  resolveMistralApiKey,
} from '../ai/providers';
import { ensureLongHttpTimeouts } from '../http/longHttpTimeouts';

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
export function detectFileType(
  fileName: string,
  mimeType: string = 'application/octet-stream',
): FileTypeClassification {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();

  const isWord =
    /\.(docx|doc|dotx|dot)$/i.test(lowerName) ||
    lowerMime.includes('wordprocessingml') ||
    lowerMime.includes('msword') ||
    lowerMime.includes('officedocument.word');

  const isSpreadsheet =
    /\.(xlsx|xls|csv|tsv)$/i.test(lowerName) ||
    lowerMime.includes('spreadsheet') ||
    lowerMime.includes('excel') ||
    lowerMime === 'text/csv';

  const isPowerPoint =
    /\.(pptx|ppt)$/i.test(lowerName) || lowerMime.includes('presentationml') || lowerMime.includes('powerpoint');

  const isPdf = /\.pdf$/i.test(lowerName) || lowerMime === 'application/pdf';

  const isAudio = lowerMime.startsWith('audio/') || /\.(mp3|wav|flac|aac|ogg|m4a|mpga|opus|pcm)$/i.test(lowerName);

  const isVideo = lowerMime.startsWith('video/') || /\.(mp4|mov|avi|webm|mpeg|mpg|quicktime|3gpp)$/i.test(lowerName);

  const isImage = lowerMime.startsWith('image/') || /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(lowerName);

  // Text is only true if it's NOT a binary document format (not Word, not PDF, not PowerPoint, not Excel)
  const isText =
    !isWord &&
    !isPdf &&
    !isPowerPoint &&
    !isAudio &&
    !isVideo &&
    !isImage &&
    (lowerMime.startsWith('text/') ||
      /\.(txt|md|markdown|json|csv|tsv|py|js|ts|tsx|jsx|html|xml|log|env|yaml|yml|sql|sh|c|cpp|java|go|rb|php|cs|ini|conf|rst|tex|srt|vtt)$/i.test(
        lowerName,
      ));

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
export function archiveUploadedFile(fileBuffer: Buffer, fileName: string, tenantId: string, fileHash: string): string {
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

/**
 * Server-side high-precision Word document (.docx / .doc) parser using mammoth.js.
 * Converts Word document structures to semantic Markdown, while preserving UTF-8 / Arabic
 * character encoding, headings, bold/italic, lists, and tables without mojibake.
 */
export async function parseDocxWithMammoth(fileBuffer: Buffer): Promise<string> {
  try {
    const mammothParser = mammoth as any;

    // 1. Primary Extraction: Convert to Markdown preserving structure
    const result = await mammothParser.convertToMarkdown({ buffer: fileBuffer });
    if (result.messages && result.messages.length > 0) {
      console.log('[Mammoth Parser] Messages:', result.messages.map((m: any) => m.message).join(', '));
    }

    let text = result.value || '';

    // If Markdown result is non-empty, normalize and return
    if (text && text.trim().length > 0) {
      // Normalize Arabic UTF-8 characters and whitespace
      text = normalizeArabicUtf8Text(text);
      return text.trim();
    }

    // 2. Secondary Extraction: extractRawText if Markdown conversion produced empty text
    const rawResult = await mammothParser.extractRawText({ buffer: fileBuffer });
    let rawText = rawResult.value || '';
    if (rawText && rawText.trim().length > 0) {
      rawText = normalizeArabicUtf8Text(rawText);
      return rawText.trim();
    }

    return '';
  } catch (err: any) {
    console.warn('[Mammoth Parser] Primary extraction failed, trying extractRawText fallback:', err);
    try {
      const mammothParser = mammoth as any;
      const rawResult = await mammothParser.extractRawText({ buffer: fileBuffer });
      let rawText = rawResult.value || '';
      if (rawText && rawText.trim().length > 0) {
        rawText = normalizeArabicUtf8Text(rawText);
        return rawText.trim();
      }
      throw new Error('Mammoth returned empty content');
    } catch (rawErr: any) {
      console.error('[Mammoth Parser] Both convertToMarkdown and extractRawText failed:', rawErr);
      throw new Error(`Mammoth parsing error: ${err.message || err}`);
    }
  }
}

/**
 * Cleans and normalizes Arabic and multilingual UTF-8 strings:
 * - Removes non-printable control characters while preserving RTL Marks (RLM, LRM) and standard Arabic diacritics
 * - Normalizes Unicode combining marks and whitespace
 */
export function normalizeArabicUtf8Text(input: string): string {
  if (!input) return '';
  return (
    input
      .normalize('NFC')
      // Remove control characters (except newline, tab, carriage return)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Replace multiple empty lines with standard double newlines
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

export interface DispatchOptions {
  unstructuredApiKey?: string;
  mistralApiKey?: string;
  geminiApiKey?: string;
  groqApiKey?: string;
  model?: string;
  preferredEngine?: 'mistral' | 'unstructured' | 'gemini' | 'groq_whisper' | 'auto';
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
  apiKey?: string,
): Promise<DispatchResult> {
  const resolvedKey = apiKey || resolveMistralApiKey();
  try {
    if (!resolvedKey) throw new Error('MISTRAL_API_KEY is not configured.');
    const base64Data = fileBuffer.toString('base64');
    const resolvedMime = normalizeMimeType(fileName, mimeType);

    console.log(`[Mistral OCR] Calling mistral-ocr-latest for ${fileName} (${resolvedMime})...`);
    const res = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolvedKey}`,
      },
      body: JSON.stringify({
        model: getAiModel('ocrModel'),
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
/** Converts Unstructured partition elements to clean Markdown. */
function elementsToMarkdown(elements: any[]): string {
  return elements
    .map((e: any) => {
      if (!e.text) return '';
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
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Unstructured rate limit: at least 1 second must pass between job launches.
 */
let lastJobLaunchAt = 0;

/**
 * NEW Unstructured Transform flow (Jobs API) for Platform API keys.
 *
 * The modern platform (UNSTRUCTURED_API_URL=https://platform-api.transform.
 * unstructured.io/api/v1) exposes no synchronous partition endpoint; instead
 * local files are transformed through a short-lived job:
 *
 *   1. POST {apiUrl}/jobs/          → multipart: request_data + input_files
 *   2. GET  {apiUrl}/jobs/{id}      → poll until status COMPLETED
 *   3. GET  {apiUrl}/jobs/{id}/download?file_id=… → partition elements JSON
 *
 * Uses the documented "auto" partitioner (VLM subtype, dynamic, allow_fast):
 * the platform picks the right strategy per document.
 *
 * Platform limits honoured: 10 files/job, 50 MB/file, ≥1 s between launches,
 * max 5 concurrent jobs (we run sequentially).
 */
export async function partitionViaJobsApi(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  apiKey: string,
  apiUrl: string,
): Promise<DispatchResult> {
  const base = apiUrl.replace(/\/+$/, '');
  const headers = {
    'unstructured-api-key': apiKey,
    accept: 'application/json',
  };

  try {
    // Respect the ≥1 s between job launches rule.
    const waitMs = Math.max(0, 1250 - (Date.now() - lastJobLaunchAt));
    if (waitMs > 0) await sleep(waitMs);

    const fd = new FormData();
    fd.append(
      'request_data',
      JSON.stringify({
        job_nodes: [
          {
            name: 'Partitioner',
            type: 'partition',
            subtype: 'vlm',
            settings: { is_dynamic: true, allow_fast: true },
          },
        ],
      }),
    );
    fd.append('input_files', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName);

    const createRes = await fetch(`${base}/jobs/`, {
      method: 'POST',
      headers,
      body: fd,
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    lastJobLaunchAt = Date.now();

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Jobs API create returned ${createRes.status}: ${errText.slice(0, 200)}`);
    }

    const job = await createRes.json();
    const jobId = job?.id;
    if (!jobId) throw new Error('Jobs API response is missing an id');

    // Poll until a terminal state, bounded well inside the route budget.
    const deadline = Date.now() + 9 * 60 * 1000;
    let outputFiles: Array<{ file_id?: string }> = [];
    for (;;) {
      await sleep(5000);
      if (Date.now() > deadline) throw new Error('Jobs API polling timed out');

      const statusRes = await fetch(`${base}/jobs/${jobId}`, {
        headers,
        signal: AbortSignal.timeout(60 * 1000),
      });
      if (!statusRes.ok) throw new Error(`Jobs API status returned ${statusRes.status}`);

      const status = (await statusRes.json()) as any;
      if (status?.status === 'COMPLETED') {
        outputFiles = status.output_node_files || [];
        break;
      }
      if (status?.status === 'FAILED' || status?.status === 'STOPPED') {
        throw new Error(`Job ended with status ${status.status}`);
      }
    }

    const fileIds = outputFiles.map((f) => f?.file_id).filter((id): id is string => !!id);
    if (fileIds.length === 0) throw new Error('Completed job exposed no output files');

    const elementTexts: string[] = [];
    let totalElements = 0;
    for (const fileId of fileIds) {
      const dlRes = await fetch(`${base}/jobs/${jobId}/download?file_id=${encodeURIComponent(fileId)}`, {
        headers,
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      if (!dlRes.ok) continue;
      const raw = await dlRes.text();
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const elements = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.elements) ? parsed.elements : null;
      if (elements) {
        totalElements += elements.length;
        const md = elementsToMarkdown(elements);
        if (md.trim()) elementTexts.push(md.trim());
      }
    }

    if (elementTexts.length === 0) {
      throw new Error('Job output contained no readable elements');
    }

    return {
      text: elementTexts.join('\n\n'),
      engineUsed: 'Unstructured Transform API (Jobs ⚡)',
      success: true,
      metadata: { elementsCount: totalElements, jobId },
    };
  } catch (error: any) {
    console.error('[Unstructured Service] Jobs API partition error:', error.message);
    return {
      text: '',
      engineUsed: 'Unstructured Transform API (Jobs ⚡)',
      success: false,
      metadata: { error: error.message },
    };
  }
}

/**
 * Legacy synchronous partition (works with classic Partition API keys).
 * Returns null so the caller can fall through when it is not applicable.
 */
async function partitionViaLegacyEndpoint(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  apiKey: string,
  apiUrl: string,
  strategy: 'hi_res' | 'fast' | 'ocr_only',
): Promise<DispatchResult> {
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
      // Large multipart uploads + hi_res partitioning outlive Node's ~300 s
      // default headers timeout.
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Unstructured API returned status ${response.status}: ${errText}`);
    }

    const elements = await response.json();
    if (Array.isArray(elements)) {
      return {
        text: elementsToMarkdown(elements),
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

export async function unstructuredPartition(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  apiKey: string,
  strategy: 'hi_res' | 'fast' | 'ocr_only' = 'hi_res',
): Promise<DispatchResult> {
  const apiUrl = process.env.UNSTRUCTURED_API_URL || 'https://api.unstructuredapp.io/general/v0/general';

  // Route by endpoint generation: the legacy partition host accepts classic
  // API keys directly; anything else (the modern Transform platform) goes
  // through the async Jobs API that Platform keys authenticate with.
  const isLegacyHost = /api\.unstructuredapp\.io/i.test(apiUrl);
  if (isLegacyHost) {
    return partitionViaLegacyEndpoint(fileBuffer, fileName, mimeType, apiKey, apiUrl, strategy);
  }
  return partitionViaJobsApi(fileBuffer, fileName, mimeType, apiKey, apiUrl);
}

/**
 * Transcribes audio using Groq Whisper-large-v3.
 * Supported formats: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm.
 */
export async function transcribeWithGroqWhisper(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  apiKey?: string,
): Promise<DispatchResult> {
  const engineUsed = 'Groq Whisper-3 (whisper-large-v3) ⚡';
  try {
    if (!apiKey && !resolveGroqApiKey()) {
      throw new Error('GROQ_API_KEY is not configured.');
    }

    const modelId = getAiModel('whisperModel');
    console.log(`[Groq Whisper] Transcribing ${fileName} via AI SDK (${modelId})...`);

    // AI SDK v7 native transcription over the shared Groq provider — replaces
    // the hand-rolled multipart fetch to api.groq.com.
    const { text } = await transcribe({
      model: groqTranscriptionModel(modelId),
      audio: new Uint8Array(fileBuffer),
      maxRetries: 2,
    });

    if (text && text.trim().length > 0) {
      return {
        text: text.trim(),
        engineUsed,
        success: true,
      };
    }

    throw new Error('Groq Whisper API returned empty transcription text.');
  } catch (error: any) {
    console.error('[Unstructured Service] Groq Whisper transcription error:', error);
    return {
      text: '',
      engineUsed,
      success: false,
      metadata: { error: error.message },
    };
  }
}

/**
 * Transcribes audio with Mistral Voxtral via the AI SDK (`@ai-sdk/mistral`) —
 * an independent second speech-to-text vendor between Groq Whisper and the
 * Gemini multimodal fallback, so a single provider outage never blocks
 * ingestion.
 */
export async function transcribeWithMistralVoxtral(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<DispatchResult> {
  const engineUsed = 'Mistral Voxtral (voxtral-mini-latest) ⚡';
  try {
    if (!resolveMistralApiKey()) {
      throw new Error('MISTRAL_API_KEY is not configured.');
    }

    console.log(`[Mistral Voxtral] Transcribing ${fileName} via AI SDK...`);
    const { text } = await transcribe({
      model: mistralTranscriptionModel(),
      audio: new Uint8Array(fileBuffer),
      maxRetries: 2,
    });

    if (text && text.trim().length > 0) {
      return {
        text: text.trim(),
        engineUsed,
        success: true,
      };
    }

    throw new Error('Mistral Voxtral returned empty transcription text.');
  } catch (error: any) {
    console.error('[Unstructured Service] Mistral Voxtral transcription error:', error);
    return {
      text: '',
      engineUsed,
      success: false,
      metadata: { error: error.message },
    };
  }
}

/**
 * Largest media payload (in bytes) sent inline (base64) in a single Gemini
 * request. The Gemini API caps inline media at 20 MB per request and base64
 * inflates the payload by ~33%, so binary above this threshold goes through
 * the Files API instead.
 */
const GEMINI_INLINE_MEDIA_LIMIT_BYTES = 14 * 1024 * 1024;

const AUDIO_TRANSCRIPTION_INSTRUCTION =
  'You are an expert audio transcription model. Listen carefully to this audio file, and transcribe all spoken words (speech-to-text) verbatim. If the speech is in Arabic, write it exactly as spoken with proper punctuation. Output ONLY the transcribed text directly without adding any commentary, preambles, or explanations.';

const VIDEO_TRANSCRIPTION_INSTRUCTION =
  'You are an expert video transcriber and analyzer. Listen to the audio track and watch the video frames. Transcribe all spoken speech verbatim, and if there is any visible text, subtitles, or slides shown in the video frames, extract and merge them chronologically. If the content is in Arabic, preserve it perfectly. Output ONLY the transcription and extracted text directly without adding any preamble or extra commentary.';

/**
 * Runs a media-transcription prompt through the AI SDK v7 (`generateText` with
 * the shared @ai-sdk/google provider), walking the configured primary model
 * plus fallback chain so one dead/quota-limited model doesn't kill the job.
 * Returns an honest failure result carrying the last underlying error.
 */
async function runTranscriptionWithModelChain(
  mediaPart: {
    type: 'file';
    mediaType: string;
    filename?: string;
    data: { type: 'data'; data: Uint8Array } | { type: 'url'; url: URL } | { type: 'reference'; reference: any };
  },
  systemInstruction: string,
  engineUsed: string,
  options: { model?: string } = {},
): Promise<DispatchResult> {
  if (!resolveGeminiApiKey()) {
    return {
      text: '',
      engineUsed,
      success: false,
      metadata: { error: 'GEMINI_API_KEY is not configured.' },
    };
  }

  const modelsToTry = [options.model || getAiModel('documentParseModel'), ...getFallbackModels()].filter(
    (m, i, arr) => m && arr.indexOf(m) === i,
  );

  let lastError = '';
  for (const modelId of modelsToTry) {
    try {
      console.log(`[Gemini Transcriber] Transcribing via ${modelId} (${mediaPart.mediaType})...`);
      const { text } = await generateText({
        model: google(modelId),
        messages: [
          {
            role: 'user',
            content: [
              mediaPart,
              {
                type: 'text',
                text: systemInstruction,
              },
            ],
          },
        ],
        // AI SDK built-in retry per model; then we move to the next fallback.
        maxRetries: 2,
        // Long recordings take minutes of server-side processing.
        abortSignal: AbortSignal.timeout(10 * 60 * 1000),
      });

      if (text && text.trim().length > 0) {
        return { text: text.trim(), engineUsed, success: true };
      }
      lastError = `${modelId}: returned an empty transcription`;
    } catch (err: any) {
      lastError = `${modelId}: ${err?.message || err}`;
      console.warn(`[Gemini Transcriber] Model ${modelId} failed — trying next fallback:`, lastError);
    }
  }

  console.error('[Gemini Transcriber] All models failed:', lastError);
  return {
    text: '',
    engineUsed,
    success: false,
    metadata: { error: lastError },
  };
}

/**
 * Transcribes audio/video buffers using Gemini multimodal models via the
 * AI SDK v7 — genuine speech-to-text over the real media (never fabricated
 * text).
 *
 * Small files are sent inline; anything above the inline limit is uploaded
 * through the AI SDK Files API and referenced by provider reference, which
 * makes long recordings work too (uploads expire per provider policy).
 */
export async function transcribeWithGemini(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  options: { model?: string; systemInstruction?: string; engineLabel?: string } = {},
): Promise<DispatchResult> {
  const resolvedMime = normalizeMimeType(fileName, mimeType);
  const isVideo = resolvedMime.startsWith('video/');
  const engineUsed =
    options.engineLabel ||
    (isVideo
      ? 'Gemini Multimodal Video Speech & Frames Transcriber'
      : 'Gemini Audio Speech-to-Text Transcription Engine');
  const systemInstruction =
    options.systemInstruction || (isVideo ? VIDEO_TRANSCRIPTION_INSTRUCTION : AUDIO_TRANSCRIPTION_INSTRUCTION);

  if (!resolveGeminiApiKey()) {
    return {
      text: '',
      engineUsed,
      success: false,
      metadata: { error: 'GEMINI_API_KEY is not configured.' },
    };
  }

  if (fileBuffer.length <= GEMINI_INLINE_MEDIA_LIMIT_BYTES) {
    return runTranscriptionWithModelChain(
      {
        type: 'file',
        mediaType: resolvedMime,
        filename: fileName,
        data: { type: 'data', data: new Uint8Array(fileBuffer) },
      },
      systemInstruction,
      engineUsed,
      options,
    );
  }

  // Large media: upload through the AI SDK (`uploadFile` over the shared
  // Google provider's Files API) and reference it by provider reference.
  // Uploaded media expires automatically per the provider retention policy.
  console.log(
    `[Gemini Transcriber] ${fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB) exceeds the inline limit — uploading via AI SDK uploadFile...`,
  );
  try {
    const { providerReference } = await uploadFile({
      api: getGoogleProvider(),
      data: new Uint8Array(fileBuffer),
      mediaType: resolvedMime,
      filename: fileName,
    });

    return await runTranscriptionWithModelChain(
      {
        type: 'file',
        mediaType: resolvedMime,
        filename: fileName,
        data: { type: 'reference', reference: providerReference },
      },
      systemInstruction,
      engineUsed,
      options,
    );
  } catch (err: any) {
    console.error('[Gemini Transcriber] Files API path failed:', err);
    return {
      text: '',
      engineUsed,
      success: false,
      metadata: { error: err?.message },
    };
  }
}

/**
 * Transcribes a YouTube video by passing its URL DIRECTLY to Gemini — no local
 * download involved. Gemini fetches and watches the video itself, which works
 * even when YouTube blocks audio downloads from this host (bot detection /
 * signature changes), making it the robust fallback for caption-less videos.
 */
export async function transcribeYoutubeUrlWithGemini(
  videoUrl: string,
  options: { model?: string } = {},
): Promise<DispatchResult> {
  return runTranscriptionWithModelChain(
    {
      type: 'file',
      mediaType: 'video/mp4',
      filename: 'youtube-video',
      data: { type: 'url', url: new URL(videoUrl) },
    },
    VIDEO_TRANSCRIPTION_INSTRUCTION,
    'Gemini Direct YouTube Video Transcription',
    options,
  );
}

/**
 * Transcribes audio and video streams: Groq Whisper first when a key is
 * configured (fast and cheap), then Gemini multimodal speech-to-text as the
 * universal fallback (handles long files via the Files API).
 */
export async function transcribeAudioVideo(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  // Vendor ladder for uploaded media: Groq Whisper (fastest) → Mistral
  // Voxtral (independent second STT vendor) → Gemini multimodal (universal).
  const groqKey = options.groqApiKey || resolveGroqApiKey();
  if (groqKey) {
    const groqResult = await transcribeWithGroqWhisper(fileBuffer, fileName, mimeType, groqKey);
    if (groqResult.success) {
      return groqResult;
    }
    console.warn('[Unstructured Service] Groq Whisper failed, trying Mistral Voxtral...');
  }

  if (resolveMistralApiKey()) {
    const voxtralResult = await transcribeWithMistralVoxtral(fileBuffer, fileName, mimeType);
    if (voxtralResult.success) {
      return voxtralResult;
    }
    console.warn('[Unstructured Service] Mistral Voxtral failed, falling back to Gemini audio/video transcriber...');
  }

  return transcribeWithGemini(fileBuffer, fileName, mimeType, { model: options.model });
}

export interface FileProcessOptions {
  preferredEngine?: 'auto' | 'mistral' | 'unstructured' | 'gemini' | 'groq_whisper';
  pagesPerChunk?: number;
  mistralApiKey?: string;
  unstructuredApiKey?: string;
  groqApiKey?: string;
  model?: string;
}

export interface FileProcessResult {
  text: string;
  engineUsed: string;
  totalPages: number;
  chunksProcessed: number;
}

/**
 * Single shared entry point for turning an arbitrary file buffer into clean
 * text. PDFs go through the batched page pipeline (Mistral Document AI /
 * Unstructured Transform / Gemini), everything else through dispatchFile
 * (local Word/PowerPoint/text parsers, audio transcription, OCR,
 * partitioning). The upload-studio parse route and the web-file connector
 * both call this, so engine selection behaves identically everywhere.
 */
export async function processFileBuffer(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  options: FileProcessOptions = {},
): Promise<FileProcessResult> {
  const preferredEngine = options.preferredEngine || 'auto';
  const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    const { processPdfWithBatchedPipeline } = await import('../pdf/pdfChunker');
    // groq_whisper is an audio-only engine — meaningless for PDFs.
    const pdfEngine = preferredEngine === 'groq_whisper' ? 'auto' : preferredEngine;
    const pipelineResult = await processPdfWithBatchedPipeline(fileBuffer, {
      preferredEngine: pdfEngine,
      pagesPerChunk: options.pagesPerChunk ?? 25,
      mistralApiKey: options.mistralApiKey,
      unstructuredApiKey: options.unstructuredApiKey,
      model: options.model,
    });
    return {
      text: pipelineResult.text,
      engineUsed: pipelineResult.engineUsed,
      totalPages: pipelineResult.totalPages,
      chunksProcessed: pipelineResult.chunksProcessed,
    };
  }

  const dispatchResult = await dispatchFile(fileBuffer, fileName, mimeType, {
    unstructuredApiKey: options.unstructuredApiKey || process.env.UNSTRUCTURED_API_KEY,
    mistralApiKey: options.mistralApiKey || process.env.MISTRAL_API_KEY,
    groqApiKey: options.groqApiKey || process.env.GROQ_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    model: options.model,
    preferredEngine,
    strategy: 'hi_res',
  });
  return {
    text: dispatchResult.text,
    engineUsed: dispatchResult.engineUsed,
    totalPages: 1,
    chunksProcessed: 1,
  };
}

/**
 * Dispatches any file buffer to the correct logical workflow (Transcription, Partitioning, OCR, or Direct Plain Text Reader).
 */
export async function dispatchFile(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string = 'application/octet-stream',
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const fileClassification = detectFileType(fileName, mimeType);
  const resolvedMime = normalizeMimeType(fileName, mimeType);
  const enginePref = options.preferredEngine || 'auto';

  // Long OCR round-trips outlive Node's default ~300 s fetch headers timeout.
  ensureLongHttpTimeouts();

  // 0. PowerPoint (.pptx) local XML parsing first — instant, key-free, and
  // preserves slide order + speaker notes. Falls through to cloud engines
  // when the deck is mostly images (little text to extract locally).
  if (fileClassification.isPowerPoint && fileName.toLowerCase().endsWith('.pptx')) {
    try {
      const { parsePptxLocally } = await import('./pptxParser');
      const localPptx = await parsePptxLocally(fileBuffer);
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
    } catch (e: any) {
      console.warn('[Document Ingestion] Local PPTX parser failed, falling back to other engines...', e?.message);
    }
  }

  // 1. Word Document (.docx / .doc) local parsing with Mammoth first (ensures perfect Arabic UTF-8 encoding without mojibake/strange characters)
  if (fileClassification.isWord) {
    try {
      console.log(
        `[Document Ingestion] Parsing Word Document (${fileName}) locally using mammoth to preserve perfect Arabic UTF-8 encoding...`,
      );
      const mammothText = await parseDocxWithMammoth(fileBuffer);
      if (mammothText && mammothText.trim().length > 0) {
        return {
          text: mammothText.trim(),
          engineUsed: 'Local Mammoth DOCX Parser (UTF-8 Arabic Safe ⚡)',
          success: true,
        };
      }
    } catch (e: any) {
      console.error('[Document Ingestion] Local Mammoth DOCX parser failed, falling back to other engines...', e);
    }
  }

  // 2. Audio & Video transcription workflow
  if (fileClassification.isAudio || fileClassification.isVideo) {
    return transcribeAudioVideo(fileBuffer, fileName, mimeType, options);
  }

  // 3. Plain Text Fallback (direct extraction for actual plain text files)
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
      options.strategy || 'hi_res',
    );
    if (partitionResult.success) {
      return partitionResult;
    }
    console.warn('[Unstructured Service] Partition workflow failed, falling back to Gemini OCR parser...');
  }

  // 5. Default Fallback / Gemini High-Precision Multimodal OCR / Extraction (AI SDK v7)
  try {
    const model = options.model || getAiModel('documentParseModel');
    let systemInstruction =
      'You are an expert multilingual document extractor. Extract, transcribe, and structure all readable text, tables, slide contents, spreadsheets, audio speech transcription, or visual elements from this file. IMPORTANT: If the file contains Arabic (العربية), extract it perfectly. Maintain correct spelling, grammar, RTL (Right-to-Left) formatting, and paragraphs. Do NOT translate any Arabic text. Output ONLY the extracted text directly without adding preamble or extra commentary.';
    let engineUsed = 'Gemini Multimodal Document Extractor Fallback';

    if (fileClassification.isImage) {
      systemInstruction =
        'You are an expert high-precision visual OCR model. Perform OCR on this image. Extract all text, labels, titles, tables, or annotations visible in the image. If there is Arabic text, extract it perfectly with RTL (Right-to-Left) alignment. Output ONLY the extracted text directly without adding any preamble or extra commentary.';
      engineUsed = 'Gemini High-Precision Visual OCR';
    } else if (fileClassification.isSpreadsheet) {
      systemInstruction =
        'You are an expert spreadsheet parser. Extract all data from this spreadsheet file and format it as beautifully structured Markdown tables. Preserve all column names, row indices, values, and cell relationships. Keep the structure perfect. Output ONLY the formatted tables without adding any preamble or extra commentary.';
      engineUsed = 'Gemini Excel-to-Markdown Tabular Parser';
    } else if (fileClassification.isWord) {
      systemInstruction =
        'You are an expert Word document parser. Extract all text, paragraphs, headings, bullet points, numbered lists, and tables. Format the output elegantly in standard Markdown. Output ONLY the extracted markdown content directly without adding any preamble or extra commentary.';
      engineUsed = 'Gemini Word Document Structure Parser';
    } else if (fileClassification.isPowerPoint) {
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
              mediaType: resolvedMime,
              filename: fileName,
              data: { type: 'data', data: new Uint8Array(fileBuffer) },
            },
            { type: 'text', text: systemInstruction },
          ],
        },
      ],
      maxRetries: 2,
    });

    if (result?.text) {
      return {
        text: result.text,
        engineUsed,
        success: true,
      };
    }
  } catch (err: any) {
    console.error('[Unstructured Service] Fallback document extraction failed:', err);
  }

  // 6. FINAL local fallback: offline Tesseract OCR — keeps image-only files
  // working even when no cloud API key is configured.
  if (fileClassification.isImage) {
    try {
      const { ocrImageBuffer } = await import('./localOcr');
      const localText = await ocrImageBuffer(fileBuffer);
      if (localText.length > 0) {
        return {
          text: localText,
          engineUsed: 'Local Tesseract OCR (offline ⚡)',
          success: true,
        };
      }
    } catch (e: any) {
      console.warn('[Unstructured Service] Local Tesseract OCR failed:', e?.message);
    }
  }

  // 6b. FINAL local fallback for image-only PPTX decks (design-tool exports
  // where every slide is a full-bleed picture and the XML carries no text).
  if (fileClassification.isPowerPoint && fileName.toLowerCase().endsWith('.pptx')) {
    try {
      const { extractSlideImagesFromPptx } = await import('./pptxParser');
      const { ocrImageBuffer } = await import('./localOcr');
      const slideImages = await extractSlideImagesFromPptx(fileBuffer);
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
    } catch (e: any) {
      console.warn('[Unstructured Service] Local PPTX slide-image OCR failed:', e?.message);
    }
  }

  // If Mistral or Unstructured was preferred but failed, try Gemini fallback anyway
  return {
    text: '',
    engineUsed: 'None',
    success: false,
    metadata: { error: 'No extraction engine succeeded.' },
  };
}
