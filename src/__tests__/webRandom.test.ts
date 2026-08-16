import { describe, it, expect } from 'vitest';
import { randomHex, randomAlphaNum, randomPassword, randomApiKey } from '@/lib/crypto/webRandom';

describe('webRandom — cryptographically-secure helpers', () => {
  it('randomHex returns exactly 2*byteLength lowercase hex chars', () => {
    const s = randomHex(16);
    expect(s).toHaveLength(32);
    expect(s).toMatch(/^[0-9a-f]{32}$/);
  });

  it('randomHex(0) returns the empty string', () => {
    expect(randomHex(0)).toBe('');
  });

  it('randomAlphaNum returns the requested length drawn from alnum only', () => {
    const s = randomAlphaNum(64);
    expect(s).toHaveLength(64);
    expect(s).toMatch(/^[A-Za-z0-9]{64}$/);
  });

  it('randomAlphaNum(1) returns a single alphanumeric char (no distribution crash at small N)', () => {
    expect(randomAlphaNum(1)).toMatch(/^[A-Za-z0-9]$/);
  });

  it('randomPassword produces the requested length containing at least one digit and one symbol', () => {
    const p = randomPassword(12);
    expect(p).toHaveLength(12);
    expect(/\d/.test(p)).toBe(true); // guaranteed digit
    expect(/[!@#$%&*?]/.test(p)).toBe(true); // guaranteed symbol
    expect(/^[A-Za-z0-9!@#$%&*?]+$/.test(p)).toBe(true);
  });

  it('randomApiKey carries the prefix and 2*hexBytes hex chars', () => {
    const k = randomApiKey('omni_sec_live', 32);
    expect(k.startsWith('omni_sec_live_')).toBe(true);
    expect(k.slice('omni_sec_live_'.length)).toHaveLength(64);
    expect(k.slice('omni_sec_live_'.length)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('repeated draws differ (not a constant/seeded PRNG returning one value)', () => {
    const a = randomHex(16);
    const b = randomHex(16);
    expect(a).not.toBe(b);
  });

  it('throws (not silently degrades) when Web Crypto is unavailable', () => {
    const realCrypto = globalThis.crypto;
    // @ts-expect-error — intentionally delete to simulate a non-crypto environment
    delete globalThis.crypto;
    try {
      expect(() => randomHex(8)).toThrow(/getRandomValues/);
      expect(() => randomAlphaNum(8)).toThrow(/getRandomValues/);
    } finally {
      // Restore so subsequent tests (and other suites) keep a working crypto.
      Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true, writable: true });
    }
  });
});
