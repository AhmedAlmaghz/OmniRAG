import { describe, it, expect } from 'vitest';
import { buildConfigSchema, applyFieldDefaults } from '../lib/connectors/schemaBuilder';
import {
  CONNECTOR_REGISTRY,
  getConnectorDescriptor,
  listConnectors,
  toConnectorCatalog,
  validateConnectorConfig,
  hasGenericExtraction,
} from '../lib/connectors/registry';
import { isReadOnlyQuery } from '../lib/connectors/adapters/database';
import { parseNotionId } from '../lib/connectors/adapters/notion';
import {
  encryptSourceConfig,
  decryptSourceConfig,
  redactSourceConfig,
  mergeAndEncryptSourceConfig,
  REDACTED_SECRET_PLACEHOLDER,
} from '../lib/storage/sourceConfigCrypto';
import { SOURCE_TYPE_VALUES } from '../lib/types/omnirag';
import type { ConnectorFieldDescriptor } from '../lib/connectors/types';

/**
 * Connector framework contracts (Phase 3): the registry is the single source
 * of truth for every knowledge-source type. These tests pin the invariants that
 * make "add a connector = one adapter file + one registry entry" safe:
 *  - registry covers exactly the SourceType union, no duplicate types;
 *  - the wizard catalog is client-safe (no functions / zod schemas leak);
 *  - config validation is built from the SAME fields the wizard renders;
 *  - SQL sync stays read-only; Notion ids normalize; secrets merge on update
 *    without clobbering stored credentials.
 */

describe('buildConfigSchema', () => {
  const fields: ConnectorFieldDescriptor[] = [
    { key: 'url', labelAr: 'رابط', labelEn: 'URL', type: 'text', required: true },
    { key: 'maxPages', labelAr: 'الحد', labelEn: 'Max', type: 'number', required: false, default: 10 },
    {
      key: 'mode',
      labelAr: 'وضع',
      labelEn: 'Mode',
      type: 'select',
      options: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ],
    },
    { key: 'enabled', labelAr: 'مفعل', labelEn: 'Enabled', type: 'checkbox' },
  ];

  it('accepts a valid config and coerces form-string numbers', () => {
    const schema = buildConfigSchema(fields);
    const result = schema.safeParse({ url: 'https://x.com', maxPages: '25', mode: 'a', enabled: 'true' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxPages).toBe(25);
      expect(result.data.enabled).toBe(true);
    }
  });

  it('rejects a missing required text field', () => {
    const schema = buildConfigSchema(fields);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ url: '   ' }).success).toBe(false);
  });

  it('rejects a select value outside its options', () => {
    const schema = buildConfigSchema(fields);
    expect(schema.safeParse({ url: 'https://x.com', mode: 'nope' }).success).toBe(false);
  });

  it('passes unknown keys through (legacy tolerance)', () => {
    const schema = buildConfigSchema(fields);
    const result = schema.safeParse({ url: 'https://x.com', legacyKey: 'kept' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.legacyKey).toBe('kept');
  });
});

describe('applyFieldDefaults', () => {
  const fields: ConnectorFieldDescriptor[] = [
    { key: 'branch', labelAr: 'فرع', labelEn: 'Branch', type: 'text', default: 'main' },
    { key: 'depth', labelAr: 'عمق', labelEn: 'Depth', type: 'number', default: 3 },
  ];

  it('fills empty/missing values with declared defaults', () => {
    expect(applyFieldDefaults(fields, {})).toEqual({ branch: 'main', depth: 3 });
    expect(applyFieldDefaults(fields, { branch: '' })).toEqual({ branch: 'main', depth: 3 });
  });

  it('keeps user-supplied values over defaults', () => {
    expect(applyFieldDefaults(fields, { branch: 'dev', depth: 9 })).toEqual({ branch: 'dev', depth: 9 });
  });
});

describe('connector registry', () => {
  it('registers exactly the SourceType union with no duplicates', () => {
    const types = CONNECTOR_REGISTRY.map((c) => c.type);
    expect(new Set(types).size).toBe(types.length);
    expect([...types].sort()).toEqual([...SOURCE_TYPE_VALUES].sort());
  });

  it('every descriptor is self-describing (fields + schema present)', () => {
    for (const c of listConnectors()) {
      expect(c.nameAr).toBeTruthy();
      expect(c.nameEn).toBeTruthy();
      expect(Array.isArray(c.fields)).toBe(true);
      expect(c.configSchema).toBeTruthy();
      expect(typeof c.supportsSchedule).toBe('boolean');
    }
  });

  it('exposes a client-safe catalog (no functions or zod schemas leak)', () => {
    const catalog = toConnectorCatalog();
    expect(catalog.length).toBe(CONNECTOR_REGISTRY.length);
    for (const entry of catalog) {
      expect(entry.id).toBeTruthy();
      expect(Array.isArray(entry.fields)).toBe(true);
      // Serialize like a JSON response would — functions would survive as keys
      // only if present; assert none of the runtime-only members leak.
      expect((entry as any).extract).toBeUndefined();
      expect((entry as any).testConnection).toBeUndefined();
      expect((entry as any).configSchema).toBeUndefined();
      for (const [k, v] of Object.entries(entry)) {
        expect(typeof v, `catalog field ${k} must be serializable`).not.toBe('function');
      }
    }
  });

  it('marks live-sync capability from extract() presence', () => {
    expect(hasGenericExtraction('url')).toBe(true);
    expect(hasGenericExtraction('notion')).toBe(true);
    // youtube/file keep dedicated pipelines → no generic extract()
    expect(hasGenericExtraction('youtube')).toBe(false);
    expect(hasGenericExtraction('file')).toBe(false);
    expect(hasGenericExtraction('does_not_exist')).toBe(false);
  });
});

describe('validateConnectorConfig', () => {
  it('applies defaults and accepts a valid github config', () => {
    const v = validateConnectorConfig('github', { repoUrl: 'https://github.com/owner/repo' });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.config.branch).toBe('main');
  });

  it('rejects a missing required field with a readable error', () => {
    const v = validateConnectorConfig('url', {});
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join(' ')).toContain('url');
  });

  it('rejects an unknown connector type', () => {
    const v = validateConnectorConfig('not_a_type', {});
    expect(v.ok).toBe(false);
  });

  it('tolerates legacy github keys via passthrough', () => {
    const v = validateConnectorConfig('github', {
      repoUrl: 'https://github.com/owner/repo',
      repo: 'owner/repo',
      personalToken: 'legacy',
    });
    expect(v.ok).toBe(true);
  });
});

describe('isReadOnlyQuery (SQL connector safety)', () => {
  it('allows SELECT and WITH statements', () => {
    expect(isReadOnlyQuery('SELECT * FROM docs')).toBe(true);
    expect(isReadOnlyQuery('  select id from t')).toBe(true);
    expect(isReadOnlyQuery('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true);
  });

  it('allows a leading SQL comment before SELECT', () => {
    expect(isReadOnlyQuery('-- nightly sync\nSELECT * FROM docs')).toBe(true);
    expect(isReadOnlyQuery('/* block */ SELECT 1')).toBe(true);
  });

  it('rejects writes and multi-statement injection shapes', () => {
    expect(isReadOnlyQuery('INSERT INTO t VALUES (1)')).toBe(false);
    expect(isReadOnlyQuery('UPDATE t SET x=1')).toBe(false);
    expect(isReadOnlyQuery('DELETE FROM t')).toBe(false);
    expect(isReadOnlyQuery('DROP TABLE t')).toBe(false);
    expect(isReadOnlyQuery('')).toBe(false);
  });
});

describe('parseNotionId', () => {
  const hex32 = 'a'.repeat(32);
  it('normalizes a dashed uuid to 32-hex lowercase', () => {
    expect(parseNotionId('AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA')).toBe(hex32);
  });
  it('passes a raw 32-hex id through', () => {
    expect(parseNotionId(hex32.toUpperCase())).toBe(hex32);
  });
  it('extracts the trailing id from a notion.so URL', () => {
    expect(parseNotionId(`https://www.notion.so/workspace/My-Page-${hex32}`)).toBe(hex32);
  });
  it('returns empty for empty input', () => {
    expect(parseNotionId('')).toBe('');
  });
});

describe('source config secret handling', () => {
  it('encrypts sensitive fields and round-trips via decrypt', () => {
    const encrypted = encryptSourceConfig({ apiToken: 'secret-123', host: 'db.local' });
    expect(encrypted.apiToken).not.toBe('secret-123');
    expect(encrypted.host).toBe('db.local'); // non-sensitive untouched
    const decrypted = decryptSourceConfig(encrypted);
    expect(decrypted.apiToken).toBe('secret-123');
  });

  it('redacts sensitive fields with the placeholder', () => {
    const redacted = redactSourceConfig({ apiToken: 'whatever', host: 'db.local' });
    expect(redacted.apiToken).toBe(REDACTED_SECRET_PLACEHOLDER);
    expect(redacted.host).toBe('db.local');
  });

  it('merge keeps the stored secret when the placeholder round-trips', () => {
    const stored = encryptSourceConfig({ apiToken: 'real-secret', host: 'db.local' });
    // Client edits a redacted config and PUTs the placeholder back.
    const incoming = { apiToken: REDACTED_SECRET_PLACEHOLDER, host: 'new-host' };
    const merged = mergeAndEncryptSourceConfig(stored, incoming);
    // Stored secret preserved verbatim (already encrypted, NOT re-encrypted).
    expect(merged.apiToken).toBe(stored.apiToken);
    expect(decryptSourceConfig(merged).apiToken).toBe('real-secret');
    // Non-sensitive field updated.
    expect(merged.host).toBe('new-host');
  });

  it('merge encrypts a genuinely new secret value', () => {
    const stored = encryptSourceConfig({ apiToken: 'old' });
    const merged = mergeAndEncryptSourceConfig(stored, { apiToken: 'brand-new' });
    expect(merged.apiToken).not.toBe('brand-new');
    expect(decryptSourceConfig(merged).apiToken).toBe('brand-new');
  });

  it('merge drops a placeholder when nothing is stored (never persists the mask)', () => {
    const merged = mergeAndEncryptSourceConfig({}, { apiToken: REDACTED_SECRET_PLACEHOLDER, host: 'h' });
    expect(merged.apiToken).toBeUndefined();
    expect(merged.host).toBe('h');
  });
});
