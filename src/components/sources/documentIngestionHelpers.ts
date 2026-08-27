import { getIngestionSettings } from '@/lib/config/ingestionSettings';
import { t } from '@/lib/i18n';

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
  /** Localized error message for the requested language. */
  error?: string;
}

export interface YoutubeValidationResult extends ValidationResult {
  videoId?: string;
}

/**
 * Validates an uploaded file against the configured size limit and the
 * supported extension/MIME allowlist. Errors are localized through the i18n
 * dictionary for the given language.
 */
export function validateUploadedFile(file: File, lang: 'ar' | 'en' = 'ar'): ValidationResult {
  if (!file) {
    return { isValid: false, error: t(lang, 'ingest.valNoFile') };
  }

  if (file.size === 0) {
    return {
      isValid: false,
      error: t(lang, 'ingest.valEmptyFile'),
    };
  }

  const userSettings = getIngestionSettings();
  const maxMb = userSettings.maxFileSizeMb || 50;
  const MAX_SIZE_BYTES = maxMb * 1024 * 1024;
  if (file.size > MAX_SIZE_BYTES) {
    return {
      isValid: false,
      error: t(lang, 'ingest.valFileTooLarge', {
        size: (file.size / (1024 * 1024)).toFixed(1),
        limit: maxMb,
      }),
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
      error: t(lang, 'ingest.valUnsupportedFormat', { ext: ext || t(lang, 'ingest.valUnknownExt') }),
    };
  }

  return { isValid: true };
}

/**
 * Validates a YouTube URL and extracts the 11-character video id. Accepts the
 * common youtube.com/watch, youtu.be/, /embed/, /shorts/, and /v/ shapes.
 */
export function validateYoutubeUrl(url: string, lang: 'ar' | 'en' = 'ar'): YoutubeValidationResult {
  const trimmed = url.trim();
  if (!trimmed) {
    return {
      isValid: false,
      error: t(lang, 'ingest.valYtEmpty'),
    };
  }

  const ytRegExp = /^.*(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
  const match = trimmed.match(ytRegExp);
  const videoId = match && match[1] && match[1].length === 11 ? match[1] : null;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return {
      isValid: false,
      error: t(lang, 'ingest.valYtInvalid'),
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
export function validateWebFileUrl(url: string, lang: 'ar' | 'en' = 'ar'): ValidationResult {
  const trimmed = url.trim();
  if (!trimmed) {
    return {
      isValid: false,
      error: t(lang, 'ingest.valWebEmpty'),
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      isValid: false,
      error: t(lang, 'ingest.valWebInvalid'),
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      error: t(lang, 'ingest.valWebProtocol', { protocol: parsed.protocol.replace(':', '') }),
    };
  }

  if (!parsed.hostname) {
    return {
      isValid: false,
      error: t(lang, 'ingest.valWebNoHost'),
    };
  }

  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(parsed.hostname))) {
    return {
      isValid: false,
      error: t(lang, 'ingest.valWebPrivateHost'),
    };
  }

  return { isValid: true };
}
