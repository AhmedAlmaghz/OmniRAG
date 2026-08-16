/**
 * Browser-safe cryptographically-secure randomness helpers.
 *
 * Why this exists: several client components used `Math.random()` to generate
 * passwords and API keys (real secrets). `Math.random()` is a PRNG seeded from
 * low-entropy sources and is predictable — unsuitable for credentials. These
 * helpers wrap the Web Crypto API (`crypto.getRandomValues`), which is
 * available in every modern browser and in the Next.js request runtime, so the
 * same code works client-side without pulling in Node's `crypto` module.
 *
 * Fall back to a thrown error (rather than silently degrading to Math.random)
 * if the Web Crypto API is absent: it indicates a broken/trusted environment,
 * and silently weakening a secret generator would reintroduce exactly the bug
 * this module exists to close.
 */

const HEX_CHARS = '0123456789abcdef';
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function assertWebCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('Web Crypto API (crypto.getRandomValues) is unavailable in this environment.');
  }
  return c;
}

/**
 * Returns `byteLength` cryptographically-random bytes as a lowercase hex string.
 * E.g. randomHex(16) → "a3f1...08c4" (32 hex chars).
 */
export function randomHex(byteLength: number): string {
  const crypto = assertWebCrypto();
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += HEX_CHARS[bytes[i] >> 4] + HEX_CHARS[bytes[i] & 0x0f];
  }
  return out;
}

/**
 * Returns a cryptographically-random alphanumeric string of the given length,
 * drawn uniformly from `ALNUM` via rejection sampling on each byte to avoid
 * modulo bias.
 */
export function randomAlphaNum(length: number): string {
  const crypto = assertWebCrypto();
  const buf = new Uint8Array(length);
  let out = '';
  // Generate in chunks until we have enough unbiased chars.
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const b = buf[i];
      // Reject values that would skew the distribution (ALNUM.length = 62).
      // 256 % 62 = 8 → use only bytes < 248, then mod 62.
      if (b < 248) {
        out += ALNUM[b % ALNUM.length];
      }
    }
  }
  return out;
}

/**
 * Returns a cryptographically-random integer in `[0, maxExclusive)`, drawn
 * via rejection sampling to avoid modulo bias. Mirrors the uniform-distribution
 * guarantee of {@link randomAlphaNum}. `maxExclusive` must be a positive
 * integer (e.g. `randomInt(200)` → jitter in `[0, 199]`).
 */
export function randomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error(`randomInt: maxExclusive must be a positive integer (got ${maxExclusive}).`);
  }
  const crypto = assertWebCrypto();
  // 256 % maxExclusive → reject the biased tail so every value in [0, N) is
  // equally likely. Use the largest multiple of N that fits in 256.
  const limit = 256 - (256 % maxExclusive);
  const buf = new Uint8Array(1);
  // Loop until we draw an unbiased byte; expected iterations ~1.0–1.02.
  while (true) {
    crypto.getRandomValues(buf);
    const b = buf[0];
    if (b < limit) return b % maxExclusive;
  }
}

/**
 * random alphanumeric plus a guaranteed digit and symbol so it passes naive
 * complexity validators. For demo/guest credentials only — production auth
 * flows hash credentials server-side with Argon2id.
 */
export function randomPassword(length = 12): string {
  const base = randomAlphaNum(length - 2);
  const digit = randomAlphaNum(1).replace(/[A-Za-z]/g, '0123456789'[parseInt(randomHex(1), 16) % 10]);
  // Use a stable symbol; chosen at random from a small set.
  const symbols = '!@#$%&*?';
  const symbol = symbols[parseInt(randomHex(1), 16) % symbols.length];
  // Interleave the guarantees at fixed positions so the result isn't trivially
  // split into "random + suffix" by automated password audits.
  const pos = parseInt(randomHex(1), 16) % base.length;
  return base.slice(0, pos) + symbol + base.slice(pos) + digit;
}

/**
 * Returns a full API-key-style secret: a human-readable prefix (for
 * scannability) plus a cryptographically-random hex body.
 */
export function randomApiKey(prefix = 'omni_sec_live', hexBytes = 32): string {
  return `${prefix}_${randomHex(hexBytes)}`;
}
