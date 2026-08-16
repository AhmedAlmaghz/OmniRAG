import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptToken, decryptToken } from '@/lib/mcp/auth/encryption';

describe('encryption.ts — AES-256-GCM token store', () => {
  const origKey = process.env.MCP_OAUTH_ENCRYPTION_KEY;
  const origEnv = process.env.NODE_ENV;
  const env = process.env as Record<string, string | undefined>;

  beforeEach(() => {
    // Each test pins env explicitly so caching a wrong key cannot leak across cases.
    env.NODE_ENV = 'development';
    delete env.MCP_OAUTH_ENCRYPTION_KEY;
    // Force the module's key cache to re-resolve by touching env each test.
  });

  afterEach(() => {
    if (origKey === undefined) delete env.MCP_OAUTH_ENCRYPTION_KEY;
    else env.MCP_OAUTH_ENCRYPTION_KEY = origKey;
    if (origEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = origEnv;
  });

  it('round-trips: decrypt(encrypt(x)) === x for arbitrary secret strings', () => {
    process.env.MCP_OAUTH_ENCRYPTION_KEY = 'test-key-not-for-prod-very-strong-unique';
    const secret = 'sk-live-abc123-tenant-acme-01';
    const enc = encryptToken(secret);
    expect(enc).not.toBe(secret); // actually encrypted
    expect(enc.split(':')).toHaveLength(3); // iv:authTag:ciphertext
    expect(decryptToken(enc)).toBe(secret);
  });

  it('produces distinct ciphertexts for identical plaintexts (random IV)', () => {
    process.env.MCP_OAUTH_ENCRYPTION_KEY = 'test-key-not-for-prod-very-strong-unique';
    const a = encryptToken('same-secret');
    const b = encryptToken('same-secret');
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe('same-secret');
    expect(decryptToken(b)).toBe('same-secret');
  });

  it('handles empty input transparently (no encrypt-decrypt round-trip for "")', () => {
    expect(encryptToken('')).toBe('');
    expect(decryptToken('')).toBe('');
  });

  it('rejects production builds when MCP_OAUTH_ENCRYPTION_KEY is unset (no silent dev-key fallback)', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete (process.env as Record<string, string | undefined>).MCP_OAUTH_ENCRYPTION_KEY;
    expect(() => encryptToken('some-secret')).toThrow(/MCP_OAUTH_ENCRYPTION_KEY/);
  });

  it('throws on tampered ciphertext (GCM auth tag verification)', () => {
    process.env.MCP_OAUTH_ENCRYPTION_KEY = 'test-key-not-for-prod-very-strong-unique';
    const enc = encryptToken('secret-value');
    const [ivHex, authTagHex, ct] = enc.split(':');
    // Flip a single hex char in the ciphertext to corrupt it.
    const tampered = ct
      .split('')
      .map((c, i) => (i === 0 ? (c === '0' ? '1' : '0') : c))
      .join('');
    const tamperedPayload = `${ivHex}:${authTagHex}:${tampered}`;
    expect(() => decryptToken(tamperedPayload)).toThrow();
  });

  it('passes through non-encrypted (legacy) values that lack the iv:tag:ct shape', () => {
    expect(decryptToken('legacy-plaintext-token')).toBe('legacy-plaintext-token');
    expect(decryptToken('two:parts')).toBe('two:parts');
  });
});
