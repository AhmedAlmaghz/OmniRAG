import { createLogger } from '@/lib/logging/logger';

const log = createLogger('LibServicesWebhookService');

import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { db } from '../storage/db';
import { encryptToken, decryptToken } from '../mcp/auth/encryption';
import { assertPublicHttpUrl } from '../mcp/net';
import { checkTenantQuota } from './planService';
import { WEBHOOK_EVENTS, type WebhookEndpoint, type WebhookEventName } from '../types/omnirag';

/**
 * Outbound webhooks (Phase 6) — tenant-configured endpoints receive signed
 * HTTP POST notifications for platform events (document indexed, sync
 * completed, …).
 *
 * Security model:
 * - The HMAC signing secret is generated server-side (`whsec_…`), returned to
 *   the caller exactly once, and persisted ONLY as AES-256-GCM ciphertext
 *   (encryptToken format). It is decrypted solely on the dispatch path to
 *   compute signatures.
 * - Signatures cover `timestamp.body` (HMAC-SHA256 hex) so receivers can
 *   reject replayed or tampered deliveries; the timestamp travels in its own
 *   header.
 * - Endpoint URLs pass the same SSRF guard as connector URLs
 *   (assertPublicHttpUrl) at create/update AND again at dispatch time
 *   (defense against stored internal URLs / DNS changes).
 * - Delivery is best-effort and never throws into the caller: a webhook
 *   failure must not fail document ingestion or sync.
 */

export const WEBHOOK_SECRET_PREFIX = 'whsec_';
/**
 * Absolute hard ceiling per tenant regardless of plan — keeps fan-out bounded
 * even on unlimited plans. Plan-level limits (maxWebhooks) apply on top.
 */
export const MAX_WEBHOOK_ENDPOINTS_PER_TENANT = 50;
const DELIVERY_TIMEOUT_MS = 10000;

export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}

/** HMAC-SHA256 over `${timestamp}.${body}` — receivers recompute and compare. */
export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

/** Constant-time signature comparison for receivers/tests. */
export function verifyWebhookSignature(secret: string, timestamp: number, body: string, signatureHex: string): boolean {
  const expected = signWebhookPayload(secret, timestamp, body);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signatureHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function normalizeEvents(events: unknown): WebhookEventName[] | null {
  if (events === undefined) return [];
  if (!Array.isArray(events)) return null;
  const known = new Set<string>(WEBHOOK_EVENTS);
  const out: WebhookEventName[] = [];
  for (const e of events) {
    if (typeof e !== 'string' || !known.has(e)) return null;
    if (!out.includes(e as WebhookEventName)) out.push(e as WebhookEventName);
  }
  return out;
}

/** Management shape — never includes the secret (encrypted or otherwise). */
export function toWebhookPublicView(endpoint: WebhookEndpoint) {
  return {
    id: endpoint.id,
    name: endpoint.name,
    url: endpoint.url,
    events: endpoint.events,
    enabled: endpoint.enabled,
    lastDeliveryAt: endpoint.lastDeliveryAt,
    lastDeliveryStatus: endpoint.lastDeliveryStatus,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt,
  };
}

export interface WebhookInput {
  name?: unknown;
  url?: unknown;
  events?: unknown;
  enabled?: unknown;
}

export async function createWebhookEndpoint(
  tenantId: string,
  input: WebhookInput,
): Promise<{ endpoint?: WebhookEndpoint; plainSecret?: string; error?: string; code?: string }> {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  try {
    await assertPublicHttpUrl(url);
  } catch (err: any) {
    return { error: err?.message || 'رابط غير صالح (Invalid URL)', code: '400_BAD_URL' };
  }

  const events = normalizeEvents(input.events);
  if (events === null) {
    return {
      error: `أحداث غير معروفة — المسموح: ${WEBHOOK_EVENTS.join(', ')} (Unknown event name)`,
      code: '400_BAD_EVENTS',
    };
  }

  const existing = await db.listWebhookEndpoints(tenantId);
  if (existing.length >= MAX_WEBHOOK_ENDPOINTS_PER_TENANT) {
    return {
      error: `الحد الأقصى ${MAX_WEBHOOK_ENDPOINTS_PER_TENANT} نقاط نهاية لكل مساحة عمل (Endpoint limit reached)`,
      code: '409_LIMIT_REACHED',
    };
  }

  // Plan quota (Phase 7) — null limit (enterprise) always passes.
  const quota = await checkTenantQuota(tenantId, 'maxWebhooks');
  if (!quota.allowed) {
    return {
      error: `تم تجاوز حصة الخطة للويب هوك — الحد ${quota.limit} (Plan quota exceeded for webhooks)`,
      code: '403_QUOTA_EXCEEDED',
    };
  }

  const plainSecret = generateWebhookSecret();
  const now = new Date().toISOString();
  const endpoint: WebhookEndpoint = {
    id: `webhook-${randomUUID()}`,
    tenantId,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 200) : 'Webhook',
    url,
    secretEncrypted: encryptToken(plainSecret),
    events,
    enabled: input.enabled === undefined ? true : input.enabled !== false,
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.createWebhookEndpoint(endpoint);
  return { endpoint, plainSecret };
}

export async function updateWebhookEndpoint(
  tenantId: string,
  id: string,
  input: WebhookInput & { regenerateSecret?: unknown },
): Promise<{ endpoint?: WebhookEndpoint; plainSecret?: string; error?: string; code?: string }> {
  const current = await db.getWebhookEndpointById(id, tenantId);
  if (!current) return { error: 'نقطة النهاية غير موجودة (Webhook not found)', code: '404_NOT_FOUND' };

  const patch: Partial<Pick<WebhookEndpoint, 'name' | 'url' | 'secretEncrypted' | 'events' | 'enabled'>> = {};

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      return { error: 'الاسم مطلوب (name required)', code: '400_BAD_NAME' };
    }
    patch.name = input.name.trim().slice(0, 200);
  }

  if (input.url !== undefined) {
    const url = typeof input.url === 'string' ? input.url.trim() : '';
    try {
      await assertPublicHttpUrl(url);
    } catch (err: any) {
      return { error: err?.message || 'رابط غير صالح (Invalid URL)', code: '400_BAD_URL' };
    }
    patch.url = url;
  }

  if (input.events !== undefined) {
    const events = normalizeEvents(input.events);
    if (events === null) {
      return {
        error: `أحداث غير معروفة — المسموح: ${WEBHOOK_EVENTS.join(', ')} (Unknown event name)`,
        code: '400_BAD_EVENTS',
      };
    }
    patch.events = events;
  }

  if (input.enabled !== undefined) patch.enabled = input.enabled !== false;

  let plainSecret: string | undefined;
  if (input.regenerateSecret === true) {
    plainSecret = generateWebhookSecret();
    patch.secretEncrypted = encryptToken(plainSecret);
  }

  await db.updateWebhookEndpoint(id, tenantId, patch);
  const endpoint = await db.getWebhookEndpointById(id, tenantId);
  return { endpoint, plainSecret };
}

export interface WebhookDeliveryResult {
  ok: boolean;
  status: number | null;
  error?: string;
}

/**
 * Delivers one event to one endpoint. Never throws — every failure mode is
 * captured in the result and stamped onto the endpoint's delivery status.
 * `fetchImpl` is injectable for tests.
 */
export async function deliverToEndpoint(
  endpoint: WebhookEndpoint,
  event: WebhookEventName,
  data: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<WebhookDeliveryResult> {
  const stamp = (status: 'success' | 'failed') =>
    db
      .updateWebhookEndpoint(endpoint.id, endpoint.tenantId, {
        lastDeliveryAt: new Date().toISOString(),
        lastDeliveryStatus: status,
      })
      .catch(() => {});

  // Re-validate at dispatch time — a URL that was public at creation could
  // have been edited around the guard or re-pointed via DNS.
  try {
    await assertPublicHttpUrl(endpoint.url);
  } catch (err: any) {
    await stamp('failed');
    return { ok: false, status: null, error: err?.message || 'URL rejected' };
  }

  let secret: string;
  try {
    secret = decryptToken(endpoint.secretEncrypted);
  } catch {
    await stamp('failed');
    return { ok: false, status: null, error: 'secret decrypt failed' };
  }
  if (!secret) {
    await stamp('failed');
    return { ok: false, status: null, error: 'missing secret' };
  }

  const deliveryId = `whdel-${randomUUID()}`;
  const body = JSON.stringify({
    id: deliveryId,
    event,
    createdAt: new Date().toISOString(),
    data,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signWebhookPayload(secret, timestamp, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetchImpl(endpoint.url, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OmniRAG-Webhook/1.0',
        'X-OmniRAG-Event': event,
        'X-OmniRAG-Delivery': deliveryId,
        'X-OmniRAG-Timestamp': String(timestamp),
        'X-OmniRAG-Signature': `sha256=${signature}`,
      },
      body,
    });
    const ok = res.status >= 200 && res.status < 300;
    await stamp(ok ? 'success' : 'failed');
    return { ok, status: res.status };
  } catch (err: any) {
    await stamp('failed');
    return { ok: false, status: null, error: err?.message || 'delivery failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fans an event out to all of the tenant's subscribed, enabled endpoints.
 * Best-effort by contract: NEVER throws, so callers can fire it from
 * ingestion/sync paths without wrapping in their own try/catch. Returns the
 * per-endpoint results for observability/tests.
 */
export async function dispatchWebhookEvent(
  tenantId: string,
  event: WebhookEventName,
  data: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<WebhookDeliveryResult[]> {
  try {
    const endpoints = await db.listWebhookEndpoints(tenantId);
    const subscribed = endpoints.filter((w) => w.enabled && (w.events.length === 0 || w.events.includes(event)));
    if (subscribed.length === 0) return [];
    const results = await Promise.allSettled(subscribed.map((w) => deliverToEndpoint(w, event, data, fetchImpl)));
    return results.map((r) =>
      r.status === 'fulfilled' ? r.value : { ok: false, status: null, error: 'unexpected dispatch error' },
    );
  } catch (err) {
    log.warn('[webhooks] dispatch failed silently:', (err as Error)?.message);
    return [];
  }
}
