export interface AIModelConfig {
  chatModel: string;
  analysisModel: string;
  hydeModel: string;
  documentParseModel: string;
  chatStreamModel: string;
  embeddingModel: string;
  whisperModel: string;
  ocrModel: string;
  fallbackModels?: string[];
  updatedAt?: string;
}

/**
 * Resilience fallback chain applied when a primary model call fails with a
 * transient error. Single source of truth for every Gemini call site that
 * opts into model fallback — no route hardcodes its own chain anymore.
 */
export const DEFAULT_FALLBACK_MODELS: string[] = [
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.1-pro-preview',
];

export const DEFAULT_AI_MODELS: AIModelConfig = {
  chatModel: 'gemini-3.7-flash',
  analysisModel: 'gemini-3.1-pro-preview',
  hydeModel: 'gemini-3.7-flash',
  documentParseModel: 'gemini-3.7-flash',
  chatStreamModel: 'gemini-3.7-flash',
  embeddingModel: 'text-embedding-004',
  whisperModel: 'whisper-large-v3',
  ocrModel: 'mistral-ocr-latest',
  fallbackModels: [...DEFAULT_FALLBACK_MODELS],
};

export interface ModelPreset {
  id: string;
  name: string;
  descriptionAr: string;
  descriptionEn: string;
  type: 'general' | 'reasoning' | 'embedding' | 'audio' | 'ocr';
  recommendedFor?: string[];
}

export const PRESET_MODELS: ModelPreset[] = [
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    descriptionAr: 'النموذج الأحدث والأسرع للأداء اليومي والمحادثات واستدعاء الأدوات بذكاء عالي وسرعة فائقة.',
    descriptionEn: 'Fastest latest model for daily performance, agentic tool calls, and high speed.',
    type: 'general',
    recommendedFor: ['chatModel', 'hydeModel', 'documentParseModel', 'chatStreamModel'],
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    descriptionAr: 'نموذج التفكير المتقدم والمنطق المعقد للتحليلات العميقة ومقارنة المستندات وتوليد الاستنتاجات.',
    descriptionEn: 'Advanced reasoning and complex logic model for deep analysis and doc comparison.',
    type: 'reasoning',
    recommendedFor: ['analysisModel', 'chatModel'],
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    descriptionAr: 'نموذج فائق الخفة والسرعة مناسب لمعالجة التدفق اللحظي والمهام ذات الحجم الضخم.',
    descriptionEn: 'Ultra-lightweight and fast model for streaming and high-volume tasks.',
    type: 'general',
    recommendedFor: ['chatStreamModel', 'hydeModel'],
  },
  {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash Latest',
    descriptionAr: 'الإصدار القياسي لنموذج Flash السريع للمهام العامة.',
    descriptionEn: 'Standard latest Flash alias for general tasks.',
    type: 'general',
    recommendedFor: ['chatModel', 'documentParseModel'],
  },
  {
    id: 'text-embedding-004',
    name: 'Text Embedding 004',
    descriptionAr: 'النموذج المعتمد رسمياً لبناء متجهات البحث الدلالي (768 dimensions).',
    descriptionEn: 'Official embedding model for semantic vector search.',
    type: 'embedding',
    recommendedFor: ['embeddingModel'],
  },
  {
    id: 'gemini-embedding-2-preview',
    name: 'Gemini Embedding 2 Preview',
    descriptionAr: 'نموذج متجهات التضمين متعدد اللغات عالي الدقة.',
    descriptionEn: 'Advanced multilingual embedding model for semantic retrieval.',
    type: 'embedding',
    recommendedFor: ['embeddingModel'],
  },
  {
    id: 'whisper-large-v3',
    name: 'Whisper Large v3 (Groq)',
    descriptionAr: 'نموذج تفريغ الصوت والفيديو عبر Groq لتحويل الكلام إلى نص بدقة عالية وسرعة فائقة.',
    descriptionEn: 'Audio/video transcription model via Groq for high-accuracy speech-to-text.',
    type: 'audio',
    recommendedFor: ['whisperModel'],
  },
  {
    id: 'mistral-ocr-latest',
    name: 'Mistral OCR Latest',
    descriptionAr: 'نموذج استخراج النصوص من PDF والصور عبر Mistral Document AI بدقة تخطيط عالية.',
    descriptionEn: 'Mistral Document AI model for high-precision PDF/image text extraction.',
    type: 'ocr',
    recommendedFor: ['ocrModel'],
  },
];

const LOCAL_STORAGE_KEY = 'omnirag_ai_model_config_v1';
export const MODEL_CONFIG_CHANGE_EVENT = 'omnirag_model_config_changed';
export const MODEL_CONFIG_COOKIE = 'omnirag_ai_model_config';
export const MODEL_CONFIG_HEADER = 'x-ai-model-config';

/**
 * Per-request model config resolution.
 *
 * Server routes wrap their handler in `runWithModelConfig(config, () => ...)`
 * so that `getAiModel(...)` downstream resolves the client's configured models
 * instead of DEFAULT_AI_MODELS. The AsyncLocalStorage instance lives in
 * `aiModelsServer.ts` (server-only), because `node:async_hooks` cannot be
 * bundled into the client graph — Turbopack refuses to write a browser
 * endpoint that includes an external Node-only module. On import,
 * `aiModelsServer.ts` registers an active-config getter here via
 * `registerServerModelConfigGetter`, so this browser-safe module can return
 * the per-request config without being able to touch `node:async_hooks`
 * directly. When no server module has registered (pure client path), this
 * resolves to undefined and `getAiModelConfig` falls back to localStorage
 * or DEFAULT_AI_MODELS.
 */
let serverActiveConfigGetter: (() => AIModelConfig | undefined) | null = null;

/**
 * Registers the server-side active-config getter (backed by AsyncLocalStorage).
 * Called once at module load from `aiModelsServer.ts`. Safe to call multiple
 * times — the last registration wins, but in practice there is one.
 */
export function registerServerModelConfigGetter(getter: () => AIModelConfig | undefined): void {
  serverActiveConfigGetter = getter;
}

/**
 * Returns the per-request config bound by the server's
 * `runWithModelConfig(...)`, if any. Undefined outside a server request and
 * always undefined in the browser (no getter is ever registered client-side).
 */
export function getActiveModelConfig(): AIModelConfig | undefined {
  return serverActiveConfigGetter ? serverActiveConfigGetter() : undefined;
}

/**
 * Normalizes a partial config into a complete AIModelConfig, filling any
 * missing/invalid field from DEFAULT_AI_MODELS. Guarantees every key exists.
 */
export function normalizeModelConfig(partial?: Partial<AIModelConfig> | null): AIModelConfig {
  return {
    chatModel: partial?.chatModel || DEFAULT_AI_MODELS.chatModel,
    analysisModel: partial?.analysisModel || DEFAULT_AI_MODELS.analysisModel,
    hydeModel: partial?.hydeModel || DEFAULT_AI_MODELS.hydeModel,
    documentParseModel: partial?.documentParseModel || DEFAULT_AI_MODELS.documentParseModel,
    chatStreamModel: partial?.chatStreamModel || DEFAULT_AI_MODELS.chatStreamModel,
    embeddingModel: partial?.embeddingModel || DEFAULT_AI_MODELS.embeddingModel,
    whisperModel: partial?.whisperModel || DEFAULT_AI_MODELS.whisperModel,
    ocrModel: partial?.ocrModel || DEFAULT_AI_MODELS.ocrModel,
    fallbackModels:
      partial?.fallbackModels && partial.fallbackModels.length > 0
        ? partial.fallbackModels
        : [...DEFAULT_FALLBACK_MODELS],
    updatedAt: partial?.updatedAt || new Date().toISOString(),
  };
}

/**
 * Parses the client-supplied model configuration from an incoming server
 * request. Resolution order: `x-ai-model-config` header → `omnirag_ai_model_config`
 * cookie → DEFAULT_AI_MODELS. Despite multi-tenant isolation, model names are
 * not tenant-scoped — any client may override which models the server invokes.
 */
export function parseModelConfigFromRequest(req: Request): AIModelConfig {
  // Step 1: header (freshly attached per request by fetchWithAuth)
  const headerValue = req.headers.get(MODEL_CONFIG_HEADER);
  if (headerValue) {
    try {
      return normalizeModelConfig(JSON.parse(headerValue));
    } catch {
      // fall through to cookie
    }
  }

  // Step 2: cookie (persisted by /api/v1/settings/models POST)
  try {
    // Headers API exposes Set-Cookie via getSetCookie(); for inbound cookies
    // on Node NextRequest, fall back to the 'cookie' header.
    const cookieHeader = req.headers.get('cookie') || '';
    const match = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${MODEL_CONFIG_COOKIE}=`));
    if (match) {
      const value = decodeURIComponent(match.slice(MODEL_CONFIG_COOKIE.length + 1));
      return normalizeModelConfig(JSON.parse(value));
    }
  } catch {
    // fall through to defaults
  }

  // Step 3: defaults
  return { ...DEFAULT_AI_MODELS };
}

/**
 * Retrieves the currently active AI model configuration.
 *
 * Resolution order:
 *  1. Per-request AsyncLocalStorage context (`runWithModelConfig`) — server.
 *  2. localStorage (`omnirag_ai_model_config_v1`) — client.
 *  3. DEFAULT_AI_MODELS — fallback.
 */
export function getAiModelConfig(): AIModelConfig {
  // 1. Server per-request context (set by route handlers via runWithModelConfig)
  const active = getActiveModelConfig();
  if (active) {
    return active;
  }

  // 2. Client-side localStorage
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        return normalizeModelConfig(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to parse AI model settings from localStorage:', e);
    }
  }

  // 3. Defaults (also the server fallback when no request context is active)
  return { ...DEFAULT_AI_MODELS };
}

/**
 * Model operation keys that resolve to a single model name (string), as opposed
 * to `fallbackModels` which is an array. `getAiModel` only accepts scalar keys.
 */
export type ScalarModelKey = Exclude<keyof AIModelConfig, 'fallbackModels' | 'updatedAt'>;

/**
 * Retrieves a specific AI model name by operation key.
 * Use only for scalar (single-model) keys — chatModel, analysisModel, hydeModel,
 * documentParseModel, chatStreamModel, embeddingModel, whisperModel, ocrModel.
 */
export function getAiModel(key: ScalarModelKey): string {
  const config = getAiModelConfig();
  return config[key] || DEFAULT_AI_MODELS[key] || DEFAULT_AI_MODELS.chatModel;
}

/**
 * Retrieves the fallback model chain for transient-failure resilience.
 * Defaults to DEFAULT_FALLBACK_MODELS when unset/empty.
 */
export function getFallbackModels(): string[] {
  const config = getAiModelConfig();
  return config.fallbackModels && config.fallbackModels.length > 0
    ? [...config.fallbackModels]
    : [...DEFAULT_FALLBACK_MODELS];
}

/**
 * Saves updated AI model configuration.
 * Persists to localStorage and dispatches a global window event for reactive updates.
 */
export function saveAiModelConfig(newConfig: Partial<AIModelConfig>): AIModelConfig {
  const current = getAiModelConfig();
  const updated: AIModelConfig = normalizeModelConfig({
    ...current,
    ...newConfig,
    updatedAt: new Date().toISOString(),
  });

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent(MODEL_CONFIG_CHANGE_EVENT, { detail: updated }));
    } catch (e) {
      console.error('Failed to save AI model settings to localStorage:', e);
    }
  }

  return updated;
}

/**
 * Resets AI model configurations back to factory defaults.
 */
export function resetAiModelConfig(): AIModelConfig {
  return saveAiModelConfig(DEFAULT_AI_MODELS);
}
