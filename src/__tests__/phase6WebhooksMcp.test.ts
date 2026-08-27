import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, memoryDb } from '@/lib/storage/db';
import {
  generateWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
  createWebhookEndpoint,
  updateWebhookEndpoint,
  deliverToEndpoint,
  dispatchWebhookEvent,
  toWebhookPublicView,
  WEBHOOK_SECRET_PREFIX,
  MAX_WEBHOOK_ENDPOINTS_PER_TENANT,
} from '@/lib/services/webhookService';
import { buildOutboundToolList, handleOutboundMcpRequest } from '@/lib/mcp/outboundServer';
import { buildOpenApiDocument } from '@/lib/api/openapi';
import { WEBHOOK_EVENTS, type MCPServerConfig } from '@/lib/types/omnirag';

/**
 * Phase 6 — webhooks (HMAC-signed outbound events), the SDK-based outbound
 * MCP gateway, and the OpenAPI document. Runs against the in-memory fallback
 * store (no DATABASE_URL in the test env); each test resets state.
 */

const TENANT = 'tenant-phase6';

function makeMcpServer(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
  return {
    id: 'mcp-test-server',
    tenantId: TENANT,
    name: 'Test tools server',
    description: 'test',
    endpointUrl: 'https://example.invalid/mcp',
    protocolVersion: '2026-07-28',
    sandboxTier: 'T1_LIMITED',
    enabledTools: ['slack_send_message', 'web_live_search'],
    requireConfirmationTools: [],
    status: 'healthy',
    latencyMs: 10,
    lastChecked: new Date().toISOString(),
    ...overrides,
  };
}

function mcpPost(body: Record<string, unknown>): Request {
  return new Request('http://omnirag.local/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  // The wrapper's resetDatabaseState only clears Postgres connection state;
  // in-memory rows are cleared via memoryDb directly.
  memoryDb.resetDatabaseState();
  // Seed the test tenant on the enterprise plan so plan quotas (Phase 7)
  // don't interfere with webhook behavior tests.
  await memoryDb.createTenant({
    id: TENANT,
    name: 'Phase 6 workspace',
    plan: 'enterprise',
    createdAt: new Date().toISOString(),
    settings: {
      chunkSize: 500,
      chunkOverlap: 50,
      hybridWeights: { semantic: 0.7, lexical: 0.3 },
      defaultModel: 'gemini-2.0-flash',
      dataRetentionDays: 90,
      enablePiiRedaction: false,
      enablePromptSanitizer: false,
    },
  });
});

describe('webhooks — signing primitives', () => {
  it('generates prefixed secrets with real entropy', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    expect(a.length).toBeGreaterThanOrEqual(WEBHOOK_SECRET_PREFIX.length + 32);
    expect(a).not.toBe(b);
  });

  it('signs and verifies HMAC-SHA256 over timestamp.body; rejects tampering', () => {
    const secret = generateWebhookSecret();
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: 'whdel-1', event: 'document.indexed', data: { documentId: 'doc-1' } });

    const signature = signWebhookPayload(secret, timestamp, body);
    expect(verifyWebhookSignature(secret, timestamp, body, signature)).toBe(true);

    // Tampered body / wrong secret / shifted timestamp all fail.
    expect(verifyWebhookSignature(secret, timestamp, body + ' ', signature)).toBe(false);
    expect(verifyWebhookSignature('whsec_wrong', timestamp, body, signature)).toBe(false);
    expect(verifyWebhookSignature(secret, timestamp + 1, body, signature)).toBe(false);
    expect(verifyWebhookSignature(secret, timestamp, body, 'deadbeef')).toBe(false);
  });
});

describe('webhooks — endpoint management', () => {
  it('creates an endpoint: secret returned once, stored only as ciphertext', async () => {
    const result = await createWebhookEndpoint(TENANT, {
      name: 'ERP hook',
      url: 'https://hooks.acme-corp.net/omnirag',
      events: ['document.indexed'],
    });
    expect(result.error).toBeUndefined();
    expect(result.endpoint).toBeTruthy();
    expect(result.plainSecret!.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);

    // Ciphertext (iv:tag:data) — never the plaintext secret.
    expect(result.endpoint!.secretEncrypted).not.toBe(result.plainSecret);
    expect(result.endpoint!.secretEncrypted.split(':')).toHaveLength(3);

    const publicView = toWebhookPublicView(result.endpoint!);
    expect(JSON.stringify(publicView)).not.toContain(result.plainSecret!);
    expect((publicView as any).secretEncrypted).toBeUndefined();
  });

  it('rejects private/internal URLs (SSRF guard) and non-http schemes', async () => {
    for (const url of [
      'http://localhost:8080/hook',
      'http://127.0.0.1/hook',
      'http://192.168.1.5/hook',
      'ftp://example.com/x',
      'not a url',
    ]) {
      const result = await createWebhookEndpoint(TENANT, { url });
      expect(result.error, url).toBeTruthy();
      expect(result.code).toBe('400_BAD_URL');
    }
  });

  it('rejects unknown event names', async () => {
    const result = await createWebhookEndpoint(TENANT, {
      url: 'https://hooks.acme-corp.net/x',
      events: ['document.indexed', 'invoice.paid'],
    });
    expect(result.code).toBe('400_BAD_EVENTS');
  });

  it('enforces the per-tenant endpoint cap', async () => {
    for (let i = 0; i < MAX_WEBHOOK_ENDPOINTS_PER_TENANT; i++) {
      const r = await createWebhookEndpoint(TENANT, { url: `https://hooks.acme-corp.net/h${i}` });
      expect(r.endpoint, `endpoint ${i}`).toBeTruthy();
    }
    const overflow = await createWebhookEndpoint(TENANT, { url: 'https://hooks.acme-corp.net/overflow' });
    expect(overflow.code).toBe('409_LIMIT_REACHED');
  });

  it('rotates the signing secret on demand (old secret stops signing)', async () => {
    const created = await createWebhookEndpoint(TENANT, { url: 'https://hooks.acme-corp.net/rotate' });
    // Capture as strings: the in-memory store shares object references, so
    // the update below mutates the same object held by `created.endpoint`.
    const oldSecret = created.plainSecret!;
    const oldCiphertext = created.endpoint!.secretEncrypted;
    const updated = await updateWebhookEndpoint(TENANT, created.endpoint!.id, { regenerateSecret: true });
    expect(updated.plainSecret).toBeTruthy();
    expect(updated.plainSecret).not.toBe(oldSecret);
    expect(updated.endpoint!.secretEncrypted).not.toBe(oldCiphertext);
  });
});

describe('webhooks — delivery', () => {
  async function makeEndpoint(events: (typeof WEBHOOK_EVENTS)[number][] = []) {
    const created = await createWebhookEndpoint(TENANT, {
      url: 'https://hooks.acme-corp.net/deliver',
      events,
    });
    return { endpoint: created.endpoint!, plainSecret: created.plainSecret! };
  }

  it('delivers a signed payload with the documented headers', async () => {
    const { endpoint, plainSecret } = await makeEndpoint();

    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      captured = { url: String(url), init };
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const result = await deliverToEndpoint(endpoint, 'document.indexed', { documentId: 'doc-1' }, fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);

    const headers = captured!.init.headers as Record<string, string>;
    const body = String(captured!.init.body);
    const parsed = JSON.parse(body);
    expect(parsed.event).toBe('document.indexed');
    expect(parsed.data).toEqual({ documentId: 'doc-1' });
    expect(headers['X-OmniRAG-Event']).toBe('document.indexed');
    expect(headers['X-OmniRAG-Delivery']).toMatch(/^whdel-/);

    // The receiver-side check: recompute the HMAC from the delivered parts.
    const timestamp = Number(headers['X-OmniRAG-Timestamp']);
    const signature = headers['X-OmniRAG-Signature'].replace(/^sha256=/, '');
    expect(verifyWebhookSignature(plainSecret, timestamp, body, signature)).toBe(true);

    // Delivery status stamped on the endpoint.
    const stored = await db.getWebhookEndpointById(endpoint.id, TENANT);
    expect(stored?.lastDeliveryStatus).toBe('success');
    expect(stored?.lastDeliveryAt).toBeTruthy();
  });

  it('marks the endpoint failed on non-2xx and on network errors', async () => {
    const { endpoint } = await makeEndpoint();

    const failing = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const r1 = await deliverToEndpoint(endpoint, 'sync.completed', { sourceId: 's1' }, failing);
    expect(r1.ok).toBe(false);
    expect((await db.getWebhookEndpointById(endpoint.id, TENANT))?.lastDeliveryStatus).toBe('failed');

    const throwing = vi.fn(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const r2 = await deliverToEndpoint(endpoint, 'sync.completed', { sourceId: 's1' }, throwing);
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain('connection refused');
  });

  it('dispatch fans out only to enabled+subscribed endpoints and never throws', async () => {
    await makeEndpoint(); // all events
    await makeEndpoint(['document.deleted']); // subscribed to a different event
    const disabled = await makeEndpoint();
    await db.updateWebhookEndpoint(disabled.endpoint.id, TENANT, { enabled: false });

    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const results = await dispatchWebhookEvent(TENANT, 'document.indexed', { documentId: 'doc-9' }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the all-events endpoint
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);

    // Even a throwing fetch never escapes dispatch.
    const throwing = vi.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    await expect(dispatchWebhookEvent(TENANT, 'document.indexed', {}, throwing)).resolves.toBeDefined();
  });
});

describe('outbound MCP gateway — tool list + Streamable HTTP transport', () => {
  it('aggregates tenant tools and intersects with the per-key whitelist', async () => {
    await db.addMcpServer(makeMcpServer());

    const all = await buildOutboundToolList({ tenantId: TENANT });
    const names = all.map((t) => t.name);
    expect(names).toContain('slack_send_message');
    expect(names).toContain('web_live_search');
    const slack = all.find((t) => t.name === 'slack_send_message')!;
    expect(slack.inputSchema).toBeTruthy();
    expect(slack.description).toBeTruthy();

    const restricted = await buildOutboundToolList({ tenantId: TENANT, allowedTools: ['slack_send_message'] });
    expect(restricted.map((t) => t.name)).toEqual(['slack_send_message']);

    // A whitelist can only narrow, never expand.
    const expanding = await buildOutboundToolList({ tenantId: TENANT, allowedTools: ['nonexistent_tool'] });
    expect(expanding).toHaveLength(0);
  });

  it('answers initialize over the real Streamable HTTP transport', async () => {
    await db.addMcpServer(makeMcpServer());

    const res = await handleOutboundMcpRequest(
      mcpPost({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'vitest-client', version: '1.0.0' },
        },
      }),
      { tenantId: TENANT },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe('OmniRAG-MCP-Gateway');
    expect(body.result.capabilities.tools).toBeTruthy();
  });

  it('serves tools/list through the transport, honoring the key whitelist', async () => {
    await db.addMcpServer(makeMcpServer());

    const unrestricted = await handleOutboundMcpRequest(
      mcpPost({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      { tenantId: TENANT },
    );
    const fullBody = await unrestricted.json();
    const fullNames = fullBody.result.tools.map((t: any) => t.name);
    expect(fullNames).toContain('slack_send_message');
    expect(fullNames).toContain('web_live_search');

    const restricted = await handleOutboundMcpRequest(
      mcpPost({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
      { tenantId: TENANT, allowedTools: ['web_live_search'] },
    );
    const restrictedBody = await restricted.json();
    expect(restrictedBody.result.tools.map((t: any) => t.name)).toEqual(['web_live_search']);
  });

  it('refuses tools/call for a tool hidden by the whitelist', async () => {
    await db.addMcpServer(makeMcpServer());

    const res = await handleOutboundMcpRequest(
      mcpPost({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'slack_send_message', arguments: {} },
      }),
      { tenantId: TENANT, allowedTools: ['web_live_search'] },
    );
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(JSON.stringify(body.result.content)).toContain('غير مصرح');
  });
});

describe('OpenAPI document', () => {
  it('is a serializable OpenAPI 3.1 document covering the core surface', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');

    const serialized = JSON.stringify(doc);
    expect(serialized.length).toBeGreaterThan(1000);
    const parsed = JSON.parse(serialized);

    const paths = Object.keys(parsed.paths);
    for (const required of [
      '/documents',
      '/search',
      '/chat/completions',
      '/api-keys',
      '/webhooks',
      '/members',
      '/share/{token}',
    ]) {
      expect(paths, required).toContain(required);
    }

    // Both auth schemes documented.
    expect(parsed.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    expect(parsed.components.securitySchemes.cookieAuth.name).toBe('omnirag-session');

    // Webhook contract documented with its events.
    const webhookCreate = parsed.components.schemas.WebhookCreateRequest;
    expect(webhookCreate.properties.events.items.enum).toEqual([...WEBHOOK_EVENTS]);
  });
});
