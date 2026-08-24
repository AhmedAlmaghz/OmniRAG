import { describe, it, expect } from 'vitest';

/**
 * Registry integrity contract:
 * 1. Every tool name referenced by seeded tenant MCP servers (including legacy
 *    aliases) resolves to a real definition — no more dangling references that
 *    silently produced fabricated "success" results.
 * 2. Every definition carries a valid JSON-ish schema and the honesty flag.
 */
import { MCP_TOOLS_REGISTRY, getToolDefinition } from '../lib/mcp/registry/tools';
import { INITIAL_MCP_SERVERS } from '../lib/storage/constants';

const SEED_TENANT_ACTION_CORE_TOOLS = [
  'search_knowledge_base',
  'knowledge_ingest_document',
  'web_live_search',
  'fetch_url_content',
  'external_postgres_query',
];

describe('MCP tools registry', () => {
  it('resolves every tool enabled on seed servers (legacy aliases included)', () => {
    const referenced = new Set<string>();
    INITIAL_MCP_SERVERS.forEach((s) => s.enabledTools.forEach((t) => referenced.add(t)));
    SEED_TENANT_ACTION_CORE_TOOLS.forEach((t) => referenced.add(t));
    // Legacy names persisted in existing tenants' rows must keep resolving.
    referenced.add('unstructured_transform_document');
    referenced.add('unstructured_chunk_document');

    const missing = Array.from(referenced).filter((name) => !getToolDefinition(name));
    expect(missing).toEqual([]);
  });

  it('maps legacy aliases onto canonical definitions', () => {
    expect(getToolDefinition('unstructured_transform_document')?.name).toBe('unstructured_parse_document');
    expect(getToolDefinition('unstructured_chunk_document')?.name).toBe('unstructured_parse_document');
  });

  it('gives every definition a valid schema and an explicit honesty flag', () => {
    const entries = Object.entries(MCP_TOOLS_REGISTRY);
    expect(entries.length).toBeGreaterThanOrEqual(14);

    for (const [key, def] of entries) {
      expect(def.name).toBe(key);
      expect(typeof def.description).toBe('string');
      expect(def.description.length).toBeGreaterThan(5);
      expect(typeof def.simulated).toBe('boolean');
      expect(def.parameters.type).toBe('object');
      expect(Array.isArray(def.parameters.required)).toBe(true);

      const propNames = Object.keys(def.parameters.properties || {});
      for (const req of def.parameters.required) {
        expect(propNames).toContain(req);
      }
      for (const prop of Object.values(def.parameters.properties)) {
        expect(['string', 'number', 'boolean', 'array', 'object']).toContain(prop.type);
        expect(typeof prop.description).toBe('string');
      }
      expect(typeof def.execute).toBe('function');
    }
  });

  it('declares side-effecting knowledge ingestion as confirmation-required', () => {
    const ingest = getToolDefinition('knowledge_ingest_document')!;
    expect(ingest.hasSideEffect).toBe(true);
    expect(ingest.requireConfirmation).toBe(true);

    const search = getToolDefinition('search_knowledge_base')!;
    expect(search.hasSideEffect).toBe(false);
    expect(search.requireConfirmation).toBe(false);
  });
});
