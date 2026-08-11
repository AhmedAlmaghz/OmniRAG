import crypto from 'crypto';

/**
 * PKCE (Proof Key for Code Exchange - RFC 7636) Utility
 */

export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  state: string;
}

export function generatePKCEPair(): PKCEPair {
  // Generate random 64-byte code verifier
  const verifierBuffer = crypto.randomBytes(32);
  const codeVerifier = verifierBuffer.toString('hex');

  // Generate SHA-256 code challenge base64url encoded
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Generate secure random state token
  const state = crypto.randomBytes(16).toString('hex');

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
    state,
  };
}
