import type { LanguageModel, EmbeddingModel, ImageModel } from 'ai';

/**
 * Provider registry types — the heart of the multi-provider abstraction.
 *
 * Every selectable AI backend (Google, OpenAI, Anthropic, Groq, Mistral,
 * Ollama, OpenRouter, any OpenAI-compatible endpoint) is described by a
 * `ProviderDescriptor`. The registry is the single source of truth the UI,
 * the credential store, and the model resolver all read from — adding a new
 * provider is "write one adapter file + register it", with no edits to the
 * pipeline, the chat path, or the settings UI.
 *
 * Descriptors are declarative and serializable (names, capabilities,
 * credential field shapes, static model catalog) so the client can render
 * provider cards and forms without importing any provider SDK.
 */

/** What a provider can be used for. Drives which operation pickers list it in. */
export type ModelCapability = 'chat' | 'embedding' | 'image' | 'speech-to-text' | 'text-to-speech' | 'ocr' | 'rerank';

/** A single model in a provider's catalog. */
export interface ModelDescriptor {
  /** Model id as the provider SDK expects it (e.g. `gpt-4o`, `claude-…`). */
  id: string;
  /** Human display name. */
  name: string;
  capabilities: ModelCapability[];
  descriptionAr?: string;
  descriptionEn?: string;
  /** For embedding models: native vector dimension, when known. */
  embeddingDimensions?: number;
  /** Context window in tokens, when known (informational). */
  contextWindow?: number;
}

/** A credential the provider needs (rendered as a form field, encrypted at rest). */
export interface CredentialFieldDescriptor {
  /** Stable key used in the stored credentials map (e.g. `apiKey`). */
  key: string;
  labelAr: string;
  labelEn: string;
  /** Mask the field and encrypt at rest. */
  secret: boolean;
  required: boolean;
  /** Optional fallback environment variable read when no tenant value is set. */
  envVar?: string;
  placeholder?: string;
}

/** Resolved, decrypted credentials handed to adapter factories. */
export interface ProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
  [key: string]: string | undefined;
}

/**
 * A concrete provider entry in the registry. Factory functions build AI SDK
 * model instances from a model id + resolved credentials. Adapters MUST be
 * pure (no network at construction) and cheap; instance caching is handled by
 * the resolver keyed on (provider, apiKey, baseUrl).
 */
export interface ProviderDescriptor {
  /** Stable registry id, used in qualified model refs (`openai/gpt-4o`). */
  id: string;
  nameAr: string;
  nameEn: string;
  /** Union of capabilities across the provider's catalog. */
  capabilities: ModelCapability[];
  credentialFields: CredentialFieldDescriptor[];
  /** Whether the user may override the base URL (self-hosted / proxies). */
  baseUrlConfigurable: boolean;
  defaultBaseUrl?: string;
  /** Static catalog. May be empty if discovery is the primary source. */
  models: ModelDescriptor[];
  /**
   * Optional live model discovery (e.g. GET /v1/models). Returns [] when the
   * endpoint is unreachable — discovery failure must never block the UI.
   */
  discoverModels?: (creds: ProviderCredentials) => Promise<ModelDescriptor[]>;
  /** Build a chat/language model instance. */
  createLanguageModel: (modelId: string, creds: ProviderCredentials) => LanguageModel;
  /** Build an embedding model instance, if the provider supports embeddings. */
  createEmbeddingModel?: (modelId: string, creds: ProviderCredentials) => EmbeddingModel;
  /** Build an image-generation model instance, if supported. */
  createImageModel?: (modelId: string, creds: ProviderCredentials) => ImageModel;
  /** Build a speech-to-text model instance, if supported. */
  createTranscriptionModel?: (modelId: string, creds: ProviderCredentials) => unknown;
}
