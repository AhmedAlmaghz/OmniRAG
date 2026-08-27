import { generateImage } from 'ai';
import { providersWithCapability } from '@/lib/ai/registry/registry';
import { isProviderConfigured } from '@/lib/ai/registry/credentials';
import { resolveImageModel } from '@/lib/ai/registry/resolve';
import { storeSkillArtifact, type StoredArtifact } from './artifactStore';

/**
 * Image generation skill engine — resolves an image-capable provider from the
 * Phase-1 provider registry, generates the image through the AI SDK, and
 * stores the result in the tenant's object store (served via /api/v1/files).
 *
 * Honest degradation: when no image provider is configured the caller gets a
 * structured failure naming the providers that would work and the env vars /
 * credential entries they need — never a fabricated image.
 */

/** Fallback image model id per provider when its catalog lists no image model. */
const DEFAULT_IMAGE_MODEL: Record<string, string> = {
  google: 'imagen-4.0-generate-001',
  openai: 'dall-e-3',
};

export interface ImageGenerationSuccess {
  success: true;
  simulated: false;
  artifact: StoredArtifact;
  modelUsed: string;
  promptUsed: string;
}

export interface ImageGenerationFailure {
  success: false;
  simulated: false;
  error: string;
  availableProviders?: string[];
}

/**
 * Finds the first image-capable provider with configured credentials and
 * returns a qualified model ref, or null when none is usable.
 */
export async function resolveAvailableImageModelRef(explicitRef?: string): Promise<string | null> {
  if (explicitRef?.trim()) return explicitRef.trim();

  for (const descriptor of providersWithCapability('image')) {
    if (!(await isProviderConfigured(descriptor.id))) continue;
    const catalogModel = descriptor.models.find((m) => m.capabilities.includes('image'));
    const modelId = catalogModel?.id || DEFAULT_IMAGE_MODEL[descriptor.id];
    if (!modelId) continue;
    return `${descriptor.id}/${modelId}`;
  }
  return null;
}

/** Human-readable list of image-capable providers + how to enable them. */
export function describeImageProviders(): string[] {
  return providersWithCapability('image').map((d) => {
    const envVars = d.credentialFields
      .filter((f) => f.secret)
      .map((f) => f.envVar)
      .filter(Boolean);
    return `${d.nameEn} (${envVars.length > 0 ? `متغير البيئة ${envVars.join('، ')} أو` : ''} إضافة الاعتمادات من صفحة المزودين)`;
  });
}

export async function generateSkillImage(params: {
  tenantId: string;
  prompt: string;
  modelRef?: string;
  size?: string;
  aspectRatio?: string;
}): Promise<ImageGenerationSuccess | ImageGenerationFailure> {
  const { tenantId, prompt, modelRef, size, aspectRatio } = params;

  const ref = await resolveAvailableImageModelRef(modelRef);
  if (!ref) {
    return {
      success: false,
      simulated: false,
      error: 'لا يوجد مزود توليد صور مهيأ لهذا المستأجر. هيّئ أحد المزودين الداعمين للصور ثم أعد المحاولة.',
      availableProviders: describeImageProviders(),
    };
  }

  const model = await resolveImageModel(ref);
  if (!model) {
    return {
      success: false,
      simulated: false,
      error: `المزود في المرجع (${ref}) لا يدعم توليد الصور.`,
      availableProviders: describeImageProviders(),
    };
  }

  try {
    // The AI SDK types size/aspectRatio as template literals; only pass them
    // through when they actually match those shapes.
    const validSize = typeof size === 'string' && /^\d+x\d+$/.test(size) ? (size as `${number}x${number}`) : undefined;
    const validRatio =
      typeof aspectRatio === 'string' && /^\d+:\d+$/.test(aspectRatio)
        ? (aspectRatio as `${number}:${number}`)
        : undefined;
    const result = await generateImage({
      model,
      prompt,
      ...(validSize ? { size: validSize } : {}),
      ...(validRatio ? { aspectRatio: validRatio } : {}),
    });

    const image = result.image;
    if (!image || image.uint8Array.byteLength === 0) {
      return {
        success: false,
        simulated: false,
        error: 'لم يُرجع المزود أي صورة قابلة للحفظ. حاول بصياغة وصف مختلفة.',
      };
    }

    const mediaType = image.mediaType || 'image/png';
    const extension =
      mediaType.includes('jpeg') || mediaType.includes('jpg') ? 'jpg' : mediaType.split('/')[1] || 'png';
    const artifact = await storeSkillArtifact(
      tenantId,
      `generated-image-${Date.now()}.${extension}`,
      mediaType,
      image.uint8Array,
    );

    return { success: true, simulated: false, artifact, modelUsed: ref, promptUsed: prompt };
  } catch (err: any) {
    return {
      success: false,
      simulated: false,
      error: `فشل توليد الصورة عبر (${ref}): ${err?.message || err}`,
    };
  }
}
