import type { DispatchResult } from '../unstructuredService';
import type { ExtractionContext, IExtractionEngine } from './types';
import { EXTRACTION_ENGINES } from './engines';

/**
 * Extraction-engine registry. Sorted once by descending priority — the chain
 * walks this order, identical to the legacy waterfall's step numbering.
 */
export const EXTRACTION_ENGINE_REGISTRY: IExtractionEngine[] = [...EXTRACTION_ENGINES].sort(
  (a, b) => b.priority - a.priority,
);

export function listExtractionEngines(): IExtractionEngine[] {
  return [...EXTRACTION_ENGINE_REGISTRY];
}

export function getExtractionEngine(id: string): IExtractionEngine | undefined {
  return EXTRACTION_ENGINE_REGISTRY.find((engine) => engine.id === id);
}

/**
 * Runs the extraction chain for a file: first engine whose canHandle() passes
 * AND whose extract() returns a non-null result wins. Engines returning null
 * decline and the chain continues. Exhausting the chain is an honest failure —
 * no engine is allowed to invent text.
 */
export async function runExtractionChain(ctx: ExtractionContext): Promise<DispatchResult> {
  for (const engine of EXTRACTION_ENGINE_REGISTRY) {
    if (!engine.canHandle(ctx)) continue;
    const result = await engine.extract(ctx);
    if (result) return result;
  }
  return {
    text: '',
    engineUsed: 'None',
    success: false,
    metadata: { error: 'No extraction engine succeeded.' },
  };
}

/** Client-safe catalog entry — no functions. */
export interface ExtractionEngineCatalogEntry {
  id: string;
  nameAr: string;
  nameEn: string;
  priority: number;
  supportedCategories: IExtractionEngine['supportedCategories'];
  requiresCloud: boolean;
}

/** Serializes the registry for UI catalog / pipeline-template pickers. */
export function toExtractionEngineCatalog(): ExtractionEngineCatalogEntry[] {
  return EXTRACTION_ENGINE_REGISTRY.map((engine) => ({
    id: engine.id,
    nameAr: engine.nameAr,
    nameEn: engine.nameEn,
    priority: engine.priority,
    supportedCategories: [...engine.supportedCategories],
    requiresCloud: engine.requiresCloud,
  }));
}
