export interface AIModelConfig {
  chatModel: string;
  analysisModel: string;
  hydeModel: string;
  documentParseModel: string;
  chatStreamModel: string;
  embeddingModel: string;
  updatedAt?: string;
}

export const DEFAULT_AI_MODELS: AIModelConfig = {
  chatModel: 'gemini-3.6-flash',
  analysisModel: 'gemini-3.1-pro-preview',
  hydeModel: 'gemini-3.6-flash',
  documentParseModel: 'gemini-3.6-flash',
  chatStreamModel: 'gemini-3.6-flash',
  embeddingModel: 'text-embedding-004',
};

export interface ModelPreset {
  id: string;
  name: string;
  descriptionAr: string;
  descriptionEn: string;
  type: 'general' | 'reasoning' | 'embedding';
  recommendedFor?: string[];
}

export const PRESET_MODELS: ModelPreset[] = [
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    descriptionAr: 'النموذج الأحدث والسرع للأداء اليومي والمحادثات واستدعاء الأدوات بذكاء عالي وسعة فائقة.',
    descriptionEn: 'Fastest latest model for daily performance, agentic tool calls, and high capacity.',
    type: 'general',
    recommendedFor: ['chatModel', 'hydeModel', 'documentParseModel', 'chatStreamModel'],
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    descriptionAr: 'نموذج التفكير المتقدم والمنطق المعقد للتحليلات الطويلة ومقارنة المستندات الحساسة.',
    descriptionEn: 'Advanced reasoning and complex logic model for deep analysis and doc comparison.',
    type: 'reasoning',
    recommendedFor: ['analysisModel', 'chatModel'],
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    descriptionAr: 'نموذج خفيف وموثوق للمهام السريعة والمعالجات القياسية.',
    descriptionEn: 'Lightweight and reliable model for fast tasks.',
    type: 'general',
    recommendedFor: ['chatStreamModel', 'hydeModel'],
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    descriptionAr: 'نموذج احترافي مستقر للتفكير التحليلي.',
    descriptionEn: 'Stable professional model for analytical reasoning.',
    type: 'reasoning',
    recommendedFor: ['analysisModel'],
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    descriptionAr: 'نموذج النافذة السياقية الضخمة معالجة للملفات الكبيرة جداً.',
    descriptionEn: 'Ultra-large context window model for massive files.',
    type: 'reasoning',
    recommendedFor: ['documentParseModel'],
  },
  {
    id: 'text-embedding-004',
    name: 'Text Embedding 004',
    descriptionAr: 'النموذج المعتمد رسمياً لبناء متجهات البحث الدلالي (768/3072 dimension).',
    descriptionEn: 'Official embedding model for semantic vector search.',
    type: 'embedding',
    recommendedFor: ['embeddingModel'],
  },
  {
    id: 'text-embedding-005',
    name: 'Text Embedding 005',
    descriptionAr: 'الإصدار المطور لمتجهات التضمين عالية الدقة.',
    descriptionEn: 'Upgraded version for high-precision embedding vectors.',
    type: 'embedding',
    recommendedFor: ['embeddingModel'],
  },
  {
    id: 'embedding-001',
    name: 'Embedding 001 (Legacy)',
    descriptionAr: 'نموذج متجهات افتراضي تقليدي.',
    descriptionEn: 'Legacy embedding model.',
    type: 'embedding',
    recommendedFor: ['embeddingModel'],
  },
];

const LOCAL_STORAGE_KEY = 'omnirag_ai_model_config_v1';
export const MODEL_CONFIG_CHANGE_EVENT = 'omnirag_model_config_changed';

/**
 * Retrieves the currently active AI model configuration.
 * Reads from localStorage if on client, fallback to defaults on server.
 */
export function getAiModelConfig(): AIModelConfig {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_AI_MODELS };
  }

  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        chatModel: parsed.chatModel || DEFAULT_AI_MODELS.chatModel,
        analysisModel: parsed.analysisModel || DEFAULT_AI_MODELS.analysisModel,
        hydeModel: parsed.hydeModel || DEFAULT_AI_MODELS.hydeModel,
        documentParseModel: parsed.documentParseModel || DEFAULT_AI_MODELS.documentParseModel,
        chatStreamModel: parsed.chatStreamModel || DEFAULT_AI_MODELS.chatStreamModel,
        embeddingModel: parsed.embeddingModel || DEFAULT_AI_MODELS.embeddingModel,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    }
  } catch (e) {
    console.error('Failed to parse AI model settings from localStorage:', e);
  }

  return { ...DEFAULT_AI_MODELS };
}

/**
 * Retrieves a specific AI model name by operation key.
 */
export function getAiModel(key: keyof AIModelConfig): string {
  const config = getAiModelConfig();
  return config[key] || DEFAULT_AI_MODELS[key as keyof typeof DEFAULT_AI_MODELS] || 'gemini-3.6-flash';
}

/**
 * Saves updated AI model configuration.
 * Persists to localStorage and dispatches a global window event for reactive updates.
 */
export function saveAiModelConfig(newConfig: Partial<AIModelConfig>): AIModelConfig {
  const current = getAiModelConfig();
  const updated: AIModelConfig = {
    ...current,
    ...newConfig,
    updatedAt: new Date().toISOString(),
  };

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
