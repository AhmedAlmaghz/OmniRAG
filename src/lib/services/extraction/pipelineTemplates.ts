import { getTenantConfig } from '../tenantConfigService';

/**
 * Pipeline templates — preset ingestion recipes (fast / balanced / accurate)
 * that bundle the knobs a tenant otherwise had to set one by one: the preferred
 * extraction engine, and the chunking size/overlap. A tenant picks one template
 * (persisted as `settings.pipelineTemplateId`); ingestion resolves it via
 * resolveTenantPipeline() and applies the values where no explicit override is
 * supplied.
 *
 * The templates are deliberately honest about degradation: a preferred engine
 * that lacks an API key simply falls through the extraction chain (see the
 * extraction-engine registry), so picking "accurate" without an Unstructured
 * key never breaks ingestion — it degrades to the next best engine.
 */

export type PipelineTemplateId = 'fast' | 'balanced' | 'accurate';

export interface PipelineTemplate {
  id: PipelineTemplateId;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  /** Preferred extraction engine id (from the extraction-engine registry). */
  preferredEngine: 'auto' | 'mistral' | 'unstructured' | 'gemini' | 'local';
  /** Chunking size (characters/tokens) applied when not overridden. */
  chunkSize: number;
  /** Chunk overlap applied when not overridden. */
  chunkOverlap: number;
}

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    id: 'fast',
    nameAr: 'سريع',
    nameEn: 'Fast',
    descriptionAr: 'أعلى سرعة استيعاب: محرك OCR سريع وقطع أكبر لتقليل عدد التضمينات.',
    descriptionEn: 'Fastest ingestion: a fast OCR engine and larger chunks to reduce embedding count.',
    preferredEngine: 'mistral',
    chunkSize: 800,
    chunkOverlap: 40,
  },
  {
    id: 'balanced',
    nameAr: 'متوازن',
    nameEn: 'Balanced',
    descriptionAr: 'توازن بين السرعة والدقة: توجيه تلقائي للمحركات وتجزئة قياسية.',
    descriptionEn: 'Speed/quality balance: automatic engine routing and standard chunking.',
    preferredEngine: 'auto',
    chunkSize: 500,
    chunkOverlap: 50,
  },
  {
    id: 'accurate',
    nameAr: 'دقيق',
    nameEn: 'Accurate',
    descriptionAr: 'أعلى دقة استخراج: تقسيم عالي الدقة وقطع أصغر بتداخل أكبر لاسترجاع أدق.',
    descriptionEn: 'Highest extraction fidelity: hi-res partitioning and smaller, higher-overlap chunks.',
    preferredEngine: 'unstructured',
    chunkSize: 300,
    chunkOverlap: 60,
  },
];

export const DEFAULT_PIPELINE_TEMPLATE_ID: PipelineTemplateId = 'balanced';

export function listPipelineTemplates(): PipelineTemplate[] {
  return [...PIPELINE_TEMPLATES];
}

export function getPipelineTemplate(id: string | undefined | null): PipelineTemplate | undefined {
  return PIPELINE_TEMPLATES.find((t) => t.id === id);
}

/** Client-safe catalog (plain data only). */
export function toPipelineTemplateCatalog() {
  return PIPELINE_TEMPLATES.map((t) => ({ ...t }));
}

/** The effective pipeline settings for a tenant (template resolved + stored id). */
export interface ResolvedPipeline {
  templateId: PipelineTemplateId;
  preferredEngine: PipelineTemplate['preferredEngine'];
  chunkSize: number;
  chunkOverlap: number;
}

/**
 * Resolves the effective pipeline config for a tenant. Falls back to the
 * default (balanced) template when the tenant has not chosen one or chose an
 * unknown id — never throws into request handlers.
 */
export async function resolveTenantPipeline(tenantId: string): Promise<ResolvedPipeline> {
  const config = await getTenantConfig(tenantId);
  const template = getPipelineTemplate(config.pipelineTemplateId) ?? getPipelineTemplate(DEFAULT_PIPELINE_TEMPLATE_ID)!;
  return {
    templateId: template.id,
    preferredEngine: template.preferredEngine,
    chunkSize: template.chunkSize,
    chunkOverlap: template.chunkOverlap,
  };
}
