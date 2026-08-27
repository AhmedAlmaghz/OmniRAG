import crypto from 'crypto';
import { decryptToken } from '@/lib/mcp/auth/encryption';
import type { SsoOidcConfig } from '@/lib/services/tenantConfigService';

/**
 * OIDC Authorization-Code + PKCE client for tenant SSO (Phase 5).
 *
 * Standards-compliant only — no provider SDKs. Works against any issuer that
 * publishes `/.well-known/openid-configuration` (Azure AD, Okta, Google
 * Workspace, Keycloak, Auth0, …).
 *
 * Security posture:
 *  - PKCE (S256) is always used, even for confidential clients, so an
 *    intercepted authorization code is useless without the verifier.
 *  - `state` is a single-use server-side row (sso_flows) binding the callback
 *    to the initiating tenant; it is consumed exactly once.
 *  - The `id_token` signature is verified against the issuer's JWKS with
 *    RS256, and iss / aud / exp are validated before any claim is trusted.
 *  - The client secret is decrypted only at the token-exchange step and never
 *    logged.
 */

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

export interface OidcIdTokenClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Discovery + JWKS caching                                           */
/* ------------------------------------------------------------------ */

const discoveryCache = new Map<string, { at: number; doc: OidcDiscovery }>();
const jwksCache = new Map<string, { at: number; keys: JsonWebKey[] }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, '');
}

/** Fetches (and caches) the OpenID Connect discovery document for an issuer. */
export async function discoverOidc(issuer: string): Promise<OidcDiscovery> {
  const base = normalizeIssuer(issuer);
  const cached = discoveryCache.get(base);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.doc;

  const url = `${base}/.well-known/openid-configuration`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed for ${base} (HTTP ${res.status}).`);
  }
  const doc = (await res.json()) as OidcDiscovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error('OIDC discovery document is missing required endpoints.');
  }
  discoveryCache.set(base, { at: Date.now(), doc });
  return doc;
}

interface JsonWebKey {
  kty: string;
  use?: string;
  alg?: string;
  kid?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

async function fetchJwks(jwksUri: string): Promise<JsonWebKey[]> {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.keys;
  const res = await fetch(jwksUri, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Failed to fetch JWKS (HTTP ${res.status}).`);
  const body = (await res.json()) as { keys?: JsonWebKey[] };
  const keys = body.keys || [];
  jwksCache.set(jwksUri, { at: Date.now(), keys });
  return keys;
}

/* ------------------------------------------------------------------ */
/* PKCE                                                               */
/* ------------------------------------------------------------------ */

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generates a PKCE pair: a high-entropy verifier and its S256 challenge. */
export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(crypto.randomBytes(48));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

/** Generates an unguessable single-use `state` value. */
export function generateState(): string {
  return base64url(crypto.randomBytes(32));
}

/* ------------------------------------------------------------------ */
/* Authorization request                                              */
/* ------------------------------------------------------------------ */

/** Builds the provider authorization URL the browser popup is pointed at. */
export async function buildAuthorizationUrl(params: {
  config: SsoOidcConfig;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): Promise<string> {
  const discovery = await discoverOidc(params.config.issuer);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('client_id', params.config.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* Token exchange                                                     */
/* ------------------------------------------------------------------ */

/** Exchanges an authorization code (+ PKCE verifier) for tokens. */
export async function exchangeCodeForTokens(params: {
  config: SsoOidcConfig;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ id_token?: string; access_token?: string }> {
  const discovery = await discoverOidc(params.config.issuer);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.config.clientId,
    code_verifier: params.codeVerifier,
  });
  // Confidential clients send the secret; public clients (PKCE-only) omit it.
  if (params.config.clientSecret) {
    body.set('client_secret', decryptToken(params.config.clientSecret));
  }

  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OIDC token exchange failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as { id_token?: string; access_token?: string };
}

/* ------------------------------------------------------------------ */
/* id_token verification                                              */
/* ------------------------------------------------------------------ */

function decodeJwtPart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
}

/**
 * Verifies an id_token's RS256 signature against the issuer JWKS and validates
 * iss / aud / exp. Returns the claims only when every check passes; throws a
 * descriptive error otherwise (the caller must treat that as auth failure).
 */
export async function verifyIdToken(params: {
  idToken: string;
  config: SsoOidcConfig;
  expectedNonce?: string;
}): Promise<OidcIdTokenClaims> {
  const segments = params.idToken.split('.');
  if (segments.length !== 3) throw new Error('Malformed id_token.');
  const [headerB64, payloadB64, signatureB64] = segments;

  const header = decodeJwtPart<{ alg: string; kid?: string; typ?: string }>(headerB64);
  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported id_token algorithm: ${header.alg} (expected RS256).`);
  }

  const discovery = await discoverOidc(params.config.issuer);
  const keys = await fetchJwks(discovery.jwks_uri);
  const jwk = keys.find((k) => (header.kid ? k.kid === header.kid : true) && k.kty === 'RSA');
  if (!jwk) throw new Error('No matching RSA key found in the issuer JWKS.');

  const publicKey = crypto.createPublicKey({ key: jwk as any, format: 'jwk' });
  const signedData = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(signatureB64, 'base64url');
  const valid = crypto.verify('RSA-SHA256', Buffer.from(signedData), publicKey, signature);
  if (!valid) throw new Error('id_token signature verification failed.');

  const claims = decodeJwtPart<OidcIdTokenClaims>(payloadB64);

  // iss must match the configured issuer (normalized).
  if (normalizeIssuer(String(claims.iss || '')) !== normalizeIssuer(params.config.issuer)) {
    throw new Error('id_token issuer mismatch.');
  }
  // aud must include our client id.
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(params.config.clientId)) {
    throw new Error('id_token audience mismatch.');
  }
  // exp must be in the future (allow 60s clock skew).
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + 60 < now) {
    throw new Error('id_token is expired.');
  }
  if (params.expectedNonce && claims.nonce !== params.expectedNonce) {
    throw new Error('id_token nonce mismatch.');
  }
  return claims;
}

/** Extracts a lowercase email from verified claims, or null when absent. */
export function emailFromClaims(claims: OidcIdTokenClaims): string | null {
  const raw = claims.email || claims.preferred_username;
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Test helper — clears discovery/JWKS caches. */
export function resetOidcCaches(): void {
  discoveryCache.clear();
  jwksCache.clear();
}
