import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PIPELINE_TEMPLATES,
  listPipelineTemplates,
  getPipelineTemplate,
  toPipelineTemplateCatalog,
  resolveTenantPipeline,
  DEFAULT_PIPELINE_TEMPLATE_ID,
} from '../lib/services/extraction/pipelineTemplates';

/**
 * Pipeline-template contracts (Phase 3): the fast/balanced/accurate presets are
 * self-describing, unique, and resolve per-tenant with a safe default.
 */

describe('pipeline template registry', () => {
  it('defines exactly the three presets with unique ids', () => {
    const ids = PIPELINE_TEMPLATES.map((t) => t.id);
    expect(ids.sort()).toEqual(['accurate', 'balanced', 'fast']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every template is self-describing with valid engine + chunking', () => {
    for (const t of listPipelineTemplates()) {
      expect(t.nameAr).toBeTruthy();
      expect(t.nameEn).toBeTruthy();
      expect(['auto', 'mistral', 'unstructured', 'gemini', 'local']).toContain(t.preferredEngine);
      expect(t.chunkSize).toBeGreaterThan(0);
      expect(t.chunkOverlap).toBeGreaterThanOrEqual(0);
      expect(t.chunkOverlap).toBeLessThan(t.chunkSize);
    }
  });

  it('exposes a client-safe catalog of plain data', () => {
    const catalog = toPipelineTemplateCatalog();
    expect(catalog.length).toBe(3);
    for (const entry of catalog) {
      for (const [k, v] of Object.entries(entry)) {
        expect(typeof v, `catalog field ${k} must be serializable`).not.toBe('function');
      }
    }
  });

  it('looks up by id and returns undefined for unknown', () => {
    expect(getPipelineTemplate('fast')?.id).toBe('fast');
    expect(getPipelineTemplate('nope')).toBeUndefined();
    expect(getPipelineTemplate(null)).toBeUndefined();
  });
});

describe('resolveTenantPipeline', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock('@/lib/services/tenantConfigService'));

  async function loadWithConfig(settings: Record<string, unknown>) {
    vi.doMock('@/lib/services/tenantConfigService', () => ({
      getTenantConfig: vi.fn(async () => settings),
    }));
    const mod = await import('../lib/services/extraction/pipelineTemplates');
    return mod.resolveTenantPipeline('tenant-x');
  }

  it('defaults to the balanced template when unset', async () => {
    const resolved = await loadWithConfig({});
    expect(resolved.templateId).toBe(DEFAULT_PIPELINE_TEMPLATE_ID);
    expect(resolved.preferredEngine).toBe('auto');
  });

  it('applies the selected template', async () => {
    const resolved = await loadWithConfig({ pipelineTemplateId: 'accurate' });
    expect(resolved.templateId).toBe('accurate');
    expect(resolved.preferredEngine).toBe('unstructured');
    expect(resolved.chunkSize).toBe(300);
  });

  it('falls back to the default for an unknown template id', async () => {
    const resolved = await loadWithConfig({ pipelineTemplateId: 'bogus' });
    expect(resolved.templateId).toBe(DEFAULT_PIPELINE_TEMPLATE_ID);
  });
});
