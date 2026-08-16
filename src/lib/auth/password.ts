import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id password hashing (the OWASP-recommended algorithm).
 *
 * `@node-rs/argon2` ships prebuilt napi binaries (linux-x64/musl, darwin,
 * win32) so it runs on Vercel serverless without a native build step.
 *
 * Parameters track OWASP recommendations (memory cost ~19 MiB, time cost 2,
 * parallelism 1) — tuned to stay comfortably under serverless CPU/time limits
 * while resisting offline brute force.
 */
// Algorithm.Argon2id == 2. The library declares this as an ambient `const
// enum`, which `isolatedModules` (Next's bundler mode) can't cross-file inline,
// so we pass the numeric literal directly and let the native binding interpret
// it as Argon2id.
const HASH_OPTIONS = {
  algorithm: 2,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, HASH_OPTIONS);
}

export async function verifyPassword(plain: string, encoded: string): Promise<boolean> {
  if (!encoded) return false;
  try {
    // `await` so a malformed `encoded` rejects here (instead of escaping as an
    // unhandled promise returned out of this function).
    return await verify(encoded, plain);
  } catch {
    return false;
  }
}
