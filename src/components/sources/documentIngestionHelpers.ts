import { getIngestionSettings } from '@/lib/config/ingestionSettings';

/**
 * Supported upload file extensions for the Document Ingestion Studio.
 * Kept here (not in ingestionSettings) because it is a formatting/format
 * contract, not a user-tunable setting.
 */
export const SUPPORTED_EXTENSIONS = new Set([
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

export interface ValidationResult {
  isValid: boolean;
  errorAr?: string;
  errorEn?: string;
}

export interface YoutubeValidationResult extends ValidationResult {
  videoId?: string;
}

/**
 * Validates an uploaded file against the configured size limit and the
 * supported extension/MIME allowlist. Returns localized (ar/en) error reasons
 * so the caller can surface the right message without duplicating strings.
 */
export function validateUploadedFile(file: File): ValidationResult {
  if (!file) {
    return { isValid: false, errorAr: 'لم يتم اختيار أي ملف.', errorEn: 'No file selected.' };
  }

  if (file.size === 0) {
    return {
      isValid: false,
      errorAr: 'الملف المختار فارغ (0 بايت). يرجى اختيار ملف يحتوي على بيانات ومحتوى نصي.',
      errorEn: 'The selected file is empty (0 bytes). Please choose a valid file containing text content.',
    };
  }

  const userSettings = getIngestionSettings();
  const maxMb = userSettings.maxFileSizeMb || 50;
  const MAX_SIZE_BYTES = maxMb * 1024 * 1024;
  if (file.size > MAX_SIZE_BYTES) {
    return {
      isValid: false,
      errorAr: `حجم الملف (${(file.size / (1024 * 1024)).toFixed(1)}MB) يتجاوز الحد الأقصى المسموح به (${maxMb} ميجابايت).`,
      errorEn: `File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit (${maxMb} MB).`,
    };
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const isSupportedExt = SUPPORTED_EXTENSIONS.has(ext);
  const isSupportedMime =
    file.type.startsWith('text/') ||
    file.type === 'application/pdf' ||
    file.type === 'application/json' ||
    file.type.includes('spreadsheet') ||
    file.type.includes('wordprocessingml') ||
    file.type === 'application/octet-stream';

  if (!isSupportedExt && !isSupportedMime) {
    return {
      isValid: false,
      errorAr: `صيغة الملف (.${ext || 'غير معروفة'}) غير مدعومة. الصيغ المدعومة حالياً: PDF، DOCX، TXT، Markdown (MD)، JSON، CSV، وشفرات البرمجة (Python, JS, TS).`,
      errorEn: `Unsupported file format (.${ext || 'unknown'}). Supported formats: PDF, DOCX, TXT, Markdown (MD), JSON, CSV, and code files (Python, JS, TS).`,
    };
  }

  return { isValid: true };
}

/**
 * Validates a YouTube URL and extracts the 11-character video id. Accepts the
 * common youtube.com/watch, youtu.be/, /embed/, /shorts/, and /v/ shapes.
 */
export function validateYoutubeUrl(url: string): YoutubeValidationResult {
  const trimmed = url.trim();
  if (!trimmed) {
    return {
      isValid: false,
      errorAr: 'يرجى إدخال رابط فيديو يوتيوب أولاً.',
      errorEn: 'Please enter a YouTube video URL first.',
    };
  }

  const ytRegExp = /^.*(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
  const match = trimmed.match(ytRegExp);
  const videoId = match && match[1] && match[1].length === 11 ? match[1] : null;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return {
      isValid: false,
      errorAr:
        'رابط فيديو يوتيوب غير صالح أو غير مكتمل. النسق المطلوب مثال: https://www.youtube.com/watch?v=dQw4w9WgXcQ أو https://youtu.be/dQw4w9WgXcQ',
      errorEn:
        'Invalid YouTube video URL structure. Required format example: https://www.youtube.com/watch?v=dQw4w9WgXcQ or https://youtu.be/dQw4w9WgXcQ',
    };
  }

  return { isValid: true, videoId };
}

/** Hostname shapes that must never be fetched server-side (SSRF surface). */
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

/**
 * Client-side validation for a web file URL entered in the ingestion studio.
 * Mirrors the authoritative server-side guards in lib/mcp/net.ts so the user
 * gets instant feedback on obviously-blocked targets (non-http schemes,
 * localhost / private-range hosts); the server re-validates everything.
 */
export function validateWebFileUrl(url: string): ValidationResult {
  const trimmed = url.trim();
  if (!trimmed) {
    return {
      isValid: false,
      errorAr: 'يرجى إدخال رابط الملف أولاً.',
      errorEn: 'Please enter a file URL first.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      isValid: false,
      errorAr: 'الرابط غير صالح. النسق المطلوب مثال: https://example.com/files/report.pdf',
      errorEn: 'Invalid URL. Required format example: https://example.com/files/report.pdf',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      errorAr: `يُسمح فقط بروابط http/https (تم رفض ${parsed.protocol.replace(':', '')}).`,
      errorEn: `Only http/https URLs are allowed (${parsed.protocol.replace(':', '')} was rejected).`,
    };
  }

  if (!parsed.hostname) {
    return {
      isValid: false,
      errorAr: 'الرابط لا يحتوي على اسم مضيف صالح.',
      errorEn: 'The URL has no valid host name.',
    };
  }

  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(parsed.hostname))) {
    return {
      isValid: false,
      errorAr:
        'لا يمكن جلب الملفات من عناوين الشبكة الداخلية أو المحلية (حماية SSRF). استخدم رابطاً عاماً على الإنترنت.',
      errorEn:
        'Files cannot be fetched from local or internal network addresses (SSRF protection). Use a public internet URL.',
    };
  }

  return { isValid: true };
}
