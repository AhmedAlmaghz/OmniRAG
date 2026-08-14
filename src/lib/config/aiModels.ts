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
  chatModel: 'gemini-3.7-flash',
  analysisModel: 'gemini-3.1-pro-preview',
  hydeModel: 'gemini-3.7-flash',
  documentParseModel: 'gemini-3.7-flash',
  chatStreamModel: 'gemini-3.7-flash',
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
  return config[key] || DEFAULT_AI_MODELS[key as keyof typeof DEFAULT_AI_MODELS] || 'gemini-3.7-flash';
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
