import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

describe('password — Argon2id hash/verify', () => {
  it('hashes a password to a non-empty Argon2id encoded string', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies a plaintext against its own hash', async () => {
    const hash = await hashPassword('s3cret-P@ss');
    expect(await verifyPassword('s3cret-P@ss', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('the-right-one');
    expect(await verifyPassword('the-wrong-one', hash)).toBe(false);
  });

  it('salts each hash so identical passwords produce different hashes', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('never throws on a malformed/empty encoded hash — returns false', async () => {
    expect(await verifyPassword('anything', '')).toBe(false);
    expect(await verifyPassword('anything', 'not-a-real-hash' as string)).toBe(false);
  });
});
