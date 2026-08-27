/**
 * OpenAPI 3.1 document for the public `/api/v1` surface (Phase 6).
 *
 * Hand-maintained by design: the spec is the integration contract for
 * external systems (REST clients, automation, MCP hosts), so it is written
 * explicitly rather than generated, and published read-only at /api/docs.
 *
 * Auth model documented for clients:
 *  - `bearerAuth` — tenant API key (`Authorization: Bearer omnirag_live_…`),
 *    the headless/external path. Keys may carry per-key rate limits and an
 *    outbound-MCP tool whitelist.
 *  - `cookieAuth` — httpOnly session cookie for the browser app.
 */

const VERSION = '0.9.0';

type Operation = Record<string, unknown>;

function json(status: number, description: string, schemaRef?: string): Record<string, unknown> {
  return {
    description,
    content: {
      'application/json': {
        schema: schemaRef ? { $ref: `#/components/schemas/${schemaRef}` } : { type: 'object' },
      },
    },
  };
}

function op(
  summary: string,
  tag: string,
  opts: {
    description?: string;
    security?: Array<Record<string, unknown>>;
    requestBodySchema?: string | Record<string, unknown>;
    requestBodyDescription?: string;
    params?: Array<Record<string, unknown>>;
    okSchema?: string;
    okDescription?: string;
    status?: number;
  },
): Operation {
  const operation: Operation = {
    summary,
    tags: [tag],
    responses: {
      [String(opts.status ?? 200)]: json(opts.status ?? 200, opts.okDescription ?? 'Success', opts.okSchema),
      '401': json(401, 'Missing or invalid credentials', 'Error'),
      '403': json(403, 'Authenticated but not permitted (RBAC)', 'Error'),
      '429': json(429, 'Rate limit exceeded', 'Error'),
      '500': json(500, 'Internal server error (details never leaked)', 'Error'),
    },
  };
  if (opts.description) operation.description = opts.description;
  operation.security = opts.security ?? [{ bearerAuth: [] }, { cookieAuth: [] }];
  if (opts.requestBodySchema) {
    operation.requestBody = {
      required: true,
      description: opts.requestBodyDescription,
      content: {
        'application/json': {
          schema:
            typeof opts.requestBodySchema === 'string'
              ? { $ref: `#/components/schemas/${opts.requestBodySchema}` }
              : opts.requestBodySchema,
        },
      },
    };
  }
  if (opts.params) operation.parameters = opts.params;
  return operation;
}

const idParam = (name: string, description: string): Record<string, unknown> => ({
  name,
  in: 'query',
  required: true,
  schema: { type: 'string' },
  description,
});

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'OmniRAG Platform API',
      version: VERSION,
      summary: 'Enterprise RAG platform — knowledge ingestion, hybrid search, agentic chat, MCP gateway.',
      description:
        'All endpoints live under `/api/v1` and are tenant-scoped: the authenticated identity (API key or session) resolves the workspace, and every query is isolated to it. ' +
        'مصادقة Bearer بمفاتيح API للأنظمة الخارجية، أو كوكي الجلسة للمتصفح. ' +
        'Errors always return `{ error, code }`; internal details are never leaked.',
      contact: { name: 'OmniRAG' },
    },
    servers: [{ url: '/api/v1', description: 'Current deployment' }],
    tags: [
      { name: 'auth', description: 'Sessions, registration, workspaces, SSO' },
      { name: 'documents', description: 'Knowledge document ingestion and lifecycle' },
      { name: 'collections', description: 'Knowledge collections' },
      { name: 'sources', description: 'Source connectors and sync' },
      { name: 'search', description: 'Hybrid semantic + lexical search' },
      { name: 'chat', description: 'Agentic chat (completions + streaming)' },
      { name: 'conversations', description: 'Chat conversation history' },
      { name: 'api-keys', description: 'Tenant API key management' },
      { name: 'webhooks', description: 'Outbound event notifications (HMAC-signed)' },
      { name: 'collaboration', description: 'Members, teams, invitations, sharing' },
      { name: 'config', description: 'Providers, model routing, pipeline templates, settings' },
      { name: 'billing', description: 'Subscription plans and workspace quotas' },
      { name: 'mcp', description: 'Inbound MCP server registry (outbound gateway lives at /api/mcp)' },
    ],
    paths: {
      // --- auth -------------------------------------------------------------
      '/auth/login': {
        post: op('Email + password login (issues session cookie)', 'auth', {
          security: [],
          requestBodySchema: {
            type: 'object',
            required: ['email', 'password'],
            properties: {
              email: { type: 'string', format: 'email' },
              password: { type: 'string' },
            },
          },
          okDescription: 'Session created; httpOnly cookie set',
        }),
      },
      '/auth/register': {
        post: op('Register a user (new workspace, or join via invitation token)', 'auth', {
          security: [],
          requestBodySchema: {
            type: 'object',
            required: ['email', 'password'],
            properties: {
              email: { type: 'string', format: 'email' },
              password: { type: 'string' },
              workspaceName: { type: 'string', description: 'Required unless an inviteToken is provided' },
              inviteToken: { type: 'string', description: 'Join an existing workspace instead of creating one' },
            },
          },
          status: 201,
        }),
      },
      '/auth/logout': { post: op('Revoke the current session', 'auth', { requestBodySchema: { type: 'object' } }) },
      '/auth/session': {
        get: op('Current session info (user, tenant, role, workspaces)', 'auth', { okSchema: 'SessionInfo' }),
      },
      '/auth/workspaces': {
        get: op('List workspaces the caller belongs to', 'auth', {}),
        post: op('Switch active workspace (rotates the session cookie)', 'auth', {
          security: [{ cookieAuth: [] }],
          requestBodySchema: {
            type: 'object',
            required: ['tenantId'],
            properties: { tenantId: { type: 'string' } },
          },
        }),
      },
      '/auth/sso/initiate': {
        post: op('Start an OIDC SSO login (returns the authorization URL)', 'auth', {
          security: [],
          requestBodySchema: {
            type: 'object',
            properties: {
              tenantId: { type: 'string' },
              email: { type: 'string', description: 'Resolves the tenant by bound email domain' },
            },
          },
        }),
      },
      '/auth/sso/config': {
        get: op('SSO OIDC configuration (secrets masked)', 'auth', {
          security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        }),
        post: op('Save SSO OIDC configuration (settings:write)', 'auth', {
          requestBodySchema: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              issuer: { type: 'string' },
              clientId: { type: 'string' },
              clientSecret: { type: 'string', description: 'Mask value keeps the existing secret; empty clears it' },
              emailDomain: { type: 'string' },
              defaultRole: { type: 'string', enum: ['viewer', 'editor', 'admin'] },
            },
          },
        }),
      },

      // --- documents ----------------------------------------------------------
      '/documents': {
        get: op('List tenant documents', 'documents', { okSchema: 'DocumentList' }),
        post: op('Ingest a document (extract → chunk → embed → index)', 'documents', {
          description:
            'Synchronous ingestion pipeline: validates the payload, chunks with the resolved pipeline template, embeds, and indexes into the tenant vector store. Fires the `document.indexed` webhook on success.',
          requestBodySchema: 'DocumentIngestRequest',
          status: 201,
          okSchema: 'DocumentIngestResult',
        }),
        delete: op('Delete a document and its chunks/vectors', 'documents', {
          params: [idParam('id', 'Document id')],
          requestBodySchema: { type: 'object' },
        }),
      },
      '/documents/{id}/reindex': {
        post: op('Re-embed and re-index one document (after model change)', 'documents', {
          params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBodySchema: { type: 'object' },
        }),
      },
      '/documents/status': { get: op('Ingestion/vector-store health for the tenant', 'documents', {}) },
      '/documents/versions': {
        get: op('Document version history', 'documents', { params: [idParam('id', 'Document id')] }),
      },
      '/documents/parse': {
        post: op('Parse/extract file content without indexing', 'documents', {
          requestBodySchema: { type: 'object', description: 'multipart/form-data file upload in practice' },
        }),
      },
      '/documents/web-fetch': {
        post: op('Fetch a public web page and ingest it as a document (SSRF-guarded)', 'documents', {
          requestBodySchema: {
            type: 'object',
            required: ['url'],
            properties: { url: { type: 'string', format: 'uri' }, title: { type: 'string' } },
          },
        }),
      },
      '/documents/upload-token': {
        post: op('Issue a short-lived direct-upload token', 'documents', { requestBodySchema: { type: 'object' } }),
      },
      '/documents/upload-session': {
        post: op('Open a chunked upload session', 'documents', { requestBodySchema: { type: 'object' } }),
      },

      // --- collections ----------------------------------------------------------
      '/collections': {
        get: op('List knowledge collections', 'collections', { okSchema: 'CollectionList' }),
        post: op('Create or update a collection', 'collections', {
          requestBodySchema: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              id: { type: 'string', description: 'Provide to update an existing collection' },
            },
          },
        }),
        delete: op('Delete a collection', 'collections', {
          params: [idParam('id', 'Collection id')],
          requestBodySchema: { type: 'object' },
        }),
      },

      // --- sources ----------------------------------------------------------
      '/sources': {
        get: op('List source connectors', 'sources', { okSchema: 'SourceList' }),
        post: op('Create/update a source connector (config encrypted at rest)', 'sources', {
          requestBodySchema: {
            type: 'object',
            description: 'Connector descriptor; fields depend on connector type (see /sources/types)',
          },
        }),
      },
      '/sources/{id}': {
        get: op('Get one connector', 'sources', {
          params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        }),
        put: op('Update a connector', 'sources', {
          params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBodySchema: { type: 'object' },
        }),
        delete: op('Delete a connector', 'sources', {
          params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBodySchema: { type: 'object' },
        }),
      },
      '/sources/{id}/sync': {
        post: op('Start a background sync (fires `sync.completed` webhook when done)', 'sources', {
          params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBodySchema: { type: 'object' },
          okDescription: 'Sync accepted; runs after the response',
        }),
      },
      '/sources/types': {
        get: op('Connector registry (types + config schemas)', 'sources', {
          security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        }),
      },
      '/sources/capabilities': { get: op('Connector capability matrix', 'sources', {}) },
      '/sources/system-status': { get: op('Connector subsystem health', 'sources', {}) },
      '/sources/api-keys-status': { get: op('Which external service keys are configured', 'sources', {}) },

      // --- search / chat ------------------------------------------------------
      '/search': {
        post: op('Hybrid search (semantic + lexical fusion, optional HyDE/rerank)', 'search', {
          requestBodySchema: 'SearchRequest',
          okSchema: 'SearchResult',
        }),
      },
      '/chat/completions': {
        post: op('Agentic RAG chat (single response, tool loop included)', 'chat', {
          requestBodySchema: {
            type: 'object',
            required: ['message'],
            properties: {
              message: { type: 'string' },
              conversationId: { type: 'string' },
              collectionIds: { type: 'array', items: { type: 'string' } },
              mode: { type: 'string', enum: ['private', 'public'] },
            },
          },
        }),
      },
      '/chat/stream': {
        post: op('Agentic RAG chat — streaming (AI SDK UI-message-stream protocol)', 'chat', {
          description: 'Streams text deltas, tool-call parts and structured data parts. Consumed by `useChat` clients.',
          requestBodySchema: { type: 'object', description: 'AI SDK v7 UseChatRequest body' },
        }),
      },
      '/conversations': {
        get: op('List conversations', 'conversations', {}),
        post: op('Create / save messages / rename (action-based)', 'conversations', {
          requestBodySchema: {
            type: 'object',
            required: ['action'],
            properties: {
              action: { type: 'string', enum: ['create', 'save_message', 'rename', 'delete'] },
            },
          },
        }),
        delete: op('Delete a conversation', 'conversations', {
          params: [idParam('id', 'Conversation id')],
          requestBodySchema: { type: 'object' },
        }),
      },

      // --- api keys / webhooks -------------------------------------------------
      '/api-keys': {
        get: op('List tenant API keys (hashes never returned)', 'api-keys', { okSchema: 'ApiKeyList' }),
        post: op('Create an API key — plaintext returned exactly once', 'api-keys', {
          requestBodySchema: 'ApiKeyCreateRequest',
          okSchema: 'ApiKeyCreateResult',
          status: 200,
        }),
        delete: op('Revoke an API key immediately', 'api-keys', {
          requestBodySchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        }),
      },
      '/webhooks': {
        get: op('List webhook endpoints (secrets never returned)', 'webhooks', { okSchema: 'WebhookList' }),
        post: op('Create a webhook endpoint — signing secret returned once', 'webhooks', {
          description:
            'Deliveries POST JSON `{ id, event, createdAt, data }` with headers `X-OmniRAG-Event`, `X-OmniRAG-Delivery`, `X-OmniRAG-Timestamp` and `X-OmniRAG-Signature: sha256=<HMAC-SHA256(timestamp.body)>`.',
          requestBodySchema: 'WebhookCreateRequest',
          status: 201,
          okSchema: 'WebhookCreateResult',
        }),
        put: op('Update a webhook endpoint (optionally rotate the secret)', 'webhooks', {
          requestBodySchema: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              url: { type: 'string', format: 'uri' },
              events: {
                type: 'array',
                items: { type: 'string', enum: ['document.indexed', 'document.deleted', 'sync.completed'] },
              },
              enabled: { type: 'boolean' },
              regenerateSecret: { type: 'boolean' },
            },
          },
        }),
        delete: op('Delete a webhook endpoint', 'webhooks', {
          requestBodySchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        }),
      },

      // --- collaboration -------------------------------------------------------
      '/members': {
        get: op('List workspace members and roles', 'collaboration', {}),
        post: op('Invite / change role / remove member (action-based)', 'collaboration', {
          requestBodySchema: {
            type: 'object',
            required: ['action'],
            properties: { action: { type: 'string', enum: ['invite', 'setRole', 'remove'] } },
          },
        }),
      },
      '/teams': {
        get: op('List teams with members', 'collaboration', {}),
        post: op('Create/rename/delete teams, add/remove members (action-based)', 'collaboration', {
          requestBodySchema: {
            type: 'object',
            required: ['action'],
            properties: {
              action: { type: 'string', enum: ['create', 'rename', 'delete', 'addMember', 'removeMember'] },
            },
          },
        }),
      },
      '/invitations': {
        get: op('Pending invitations addressed to the caller', 'collaboration', {}),
        post: op('Accept or decline an invitation', 'collaboration', {
          security: [{ cookieAuth: [] }, { bearerAuth: [] }],
          requestBodySchema: {
            type: 'object',
            required: ['action', 'token'],
            properties: { action: { type: 'string', enum: ['accept', 'decline'] }, token: { type: 'string' } },
          },
        }),
      },
      '/shares': {
        get: op('Resource ACL (with ?resourceType&resourceId) or workspace sharing overview', 'collaboration', {}),
        post: op('Share/unshare resources, manage read-only public links (action-based)', 'collaboration', {
          requestBodySchema: {
            type: 'object',
            required: ['action'],
            properties: { action: { type: 'string', enum: ['share', 'unshare', 'setLink'] } },
          },
        }),
      },
      '/share/{token}': {
        get: op('Public read-only shared resource (no auth, rate-limited)', 'collaboration', {
          security: [],
          params: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        }),
      },

      // --- config ---------------------------------------------------------------
      '/providers': {
        get: op('AI provider registry + tenant credential status', 'config', {}),
        post: op('Save/delete tenant provider credentials (encrypted at rest)', 'config', {
          requestBodySchema: {
            type: 'object',
            description: 'action: save | delete; credentials masked value keeps existing',
          },
        }),
      },
      '/settings/models': {
        get: op('Model routing per operation (chat/embedding/rerank/…)', 'config', {}),
        post: op('Update model routing and pipeline weights', 'config', { requestBodySchema: { type: 'object' } }),
      },
      '/pipeline-templates': {
        get: op('Ingestion pipeline templates (fast/balanced/precise + custom)', 'config', {}),
        post: op('Create/update a pipeline template', 'config', { requestBodySchema: { type: 'object' } }),
      },
      '/env-config': { get: op('Which runtime env keys are present (values never returned)', 'config', {}) },
      '/storage': { get: op('Storage backend status (vectors + objects)', 'config', {}) },
      '/analytics': { get: op('Tenant usage analytics summary', 'config', {}) },
      '/diagnostics': { get: op('System diagnostics (admin)', 'config', {}) },
      '/jobs/tick': {
        post: op('Cron tick — scheduled connector syncs (secret-gated in production)', 'config', {
          security: [{ bearerAuth: [] }],
          requestBodySchema: { type: 'object' },
        }),
      },

      // --- billing ---------------------------------------------------------------
      '/plan': {
        get: op('Current subscription plan, quota usage, and catalog', 'billing', {
          okDescription: 'Plan descriptor + per-quota usage + canManage flag',
        }),
        put: op('Switch the workspace plan (billing:manage — owner only)', 'billing', {
          description:
            'Applies immediately; quota enforcement reads the plan on every create. Legacy ids (starter/pro) are normalized forward.',
          requestBodySchema: {
            type: 'object',
            required: ['plan'],
            properties: {
              plan: { type: 'string', enum: ['individual', 'team', 'business', 'enterprise'] },
            },
          },
        }),
      },

      // --- mcp registry -----------------------------------------------------------
      '/mcp/servers': {
        get: op('List registered inbound MCP servers', 'mcp', {}),
        post: op('Register/update an inbound MCP server', 'mcp', { requestBodySchema: { type: 'object' } }),
      },
      '/mcp/servers/{id}': {
        delete: op('Remove an inbound MCP server', 'mcp', {
          params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBodySchema: { type: 'object' },
        }),
      },
      '/mcp/servers/{id}/test': {
        post: op('Probe an inbound MCP server', 'mcp', {
          params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBodySchema: { type: 'object' },
        }),
      },
      '/mcp/health': { get: op('MCP subsystem health', 'mcp', {}) },
      '/mcp/calls': { get: op('Tool-call audit log', 'mcp', {}) },
      '/mcp/presets': { get: op('Curated MCP server presets', 'mcp', {}) },
      '/mcp/generate-tool': {
        post: op('AI-generate a custom tool schema', 'mcp', { requestBodySchema: { type: 'object' } }),
      },
      '/mcp/oauth/initiate': {
        post: op('Start OAuth for a remote MCP server', 'mcp', { requestBodySchema: { type: 'object' } }),
      },
      '/mcp/oauth/callback': { get: op('OAuth callback for remote MCP servers', 'mcp', { security: [] }) },

      // --- misc ---------------------------------------------------------------
      '/files/{key}': {
        get: op('Serve a tenant-generated artifact (tenant prefix enforced)', 'documents', {
          params: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        }),
      },
      '/youtube/transcript': {
        post: op('Fetch and parse a YouTube transcript', 'sources', {
          requestBodySchema: {
            type: 'object',
            required: ['url'],
            properties: { url: { type: 'string', format: 'uri' } },
          },
        }),
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Tenant API key: `Authorization: Bearer omnirag_live_…`. Only the SHA-256 hash is stored; keys may carry scopes, a per-key rate limit (requests/minute) and an outbound-MCP tool whitelist.',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'omnirag-session',
          description: 'httpOnly opaque session cookie (browser path).',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error', 'code'],
          properties: {
            error: { type: 'string', description: 'Human-readable message (Arabic + English)' },
            code: { type: 'string', description: 'Stable machine code, e.g. 429_TOO_MANY_REQUESTS' },
            retryAfterMs: { type: 'number', description: 'Present on rate-limit responses' },
          },
        },
        SessionInfo: {
          type: 'object',
          properties: {
            authenticated: { type: 'boolean' },
            user: { type: 'object' },
            tenantId: { type: 'string' },
            role: { type: 'string', enum: ['owner', 'admin', 'editor', 'viewer'] },
            workspaces: { type: 'array', items: { type: 'object' } },
          },
        },
        DocumentIngestRequest: {
          type: 'object',
          required: ['title', 'content'],
          properties: {
            title: { type: 'string', maxLength: 500 },
            content: { type: 'string', maxLength: 4000000 },
            sourceType: { type: 'string' },
            sourceId: { type: 'string' },
            collectionIds: { type: 'array', items: { type: 'string' } },
            language: { type: 'string', enum: ['ar', 'en', 'auto'] },
            chunkingConfig: { type: 'object', description: 'Optional strategy/size overrides' },
          },
        },
        DocumentIngestResult: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            document: { type: 'object' },
            source: { type: 'object' },
            chunkCount: { type: 'number' },
            indexing: {
              type: 'object',
              properties: { success: { type: 'boolean' }, errors: { type: 'array', items: { type: 'string' } } },
            },
          },
        },
        DocumentList: {
          type: 'object',
          properties: { success: { type: 'boolean' }, documents: { type: 'array', items: { type: 'object' } } },
        },
        CollectionList: {
          type: 'object',
          properties: { success: { type: 'boolean' }, collections: { type: 'array', items: { type: 'object' } } },
        },
        SourceList: {
          type: 'object',
          properties: { success: { type: 'boolean' }, sources: { type: 'array', items: { type: 'object' } } },
        },
        SearchRequest: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string' },
            collectionIds: { type: 'array', items: { type: 'string' } },
            topK: { type: 'number' },
            scoreThreshold: { type: 'number' },
            semanticWeight: { type: 'number' },
            lexicalWeight: { type: 'number' },
            rerank: { type: 'boolean' },
            useHyde: { type: 'boolean' },
          },
        },
        SearchResult: {
          type: 'object',
          properties: {
            chunks: { type: 'array', items: { type: 'object' } },
            totalCount: { type: 'number' },
            latencyMs: { type: 'number' },
            distribution: { type: 'object' },
          },
        },
        ApiKeyCreateRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 200 },
            scopes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Permission strings; empty = full tenant access',
            },
            rateLimitPerMinute: {
              type: 'integer',
              minimum: 1,
              maximum: 100000,
              description: 'Per-key request ceiling; omit for default',
            },
            mcpTools: {
              type: 'array',
              items: { type: 'string' },
              description: 'Outbound MCP tool whitelist; omit for all tenant tools',
            },
            expiresInDays: { type: 'number' },
            expiresAt: { type: 'string', format: 'date-time' },
          },
        },
        ApiKeyList: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            keys: { type: 'array', items: { $ref: '#/components/schemas/ApiKeyPublic' } },
          },
        },
        ApiKeyPublic: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            prefix: { type: 'string', description: 'Non-secret display prefix' },
            scopes: { type: 'array', items: { type: 'string' } },
            rateLimitPerMinute: { type: ['integer', 'null'] },
            mcpTools: { type: ['array', 'null'], items: { type: 'string' } },
            expiresAt: { type: ['string', 'null'] },
            lastUsedAt: { type: ['string', 'null'] },
            revokedAt: { type: ['string', 'null'] },
            createdAt: { type: 'string' },
            active: { type: 'boolean' },
          },
        },
        ApiKeyCreateResult: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            plainKey: { type: 'string', description: 'Shown exactly once — never retrievable again' },
            key: { $ref: '#/components/schemas/ApiKeyPublic' },
          },
        },
        WebhookCreateRequest: {
          type: 'object',
          required: ['url'],
          properties: {
            name: { type: 'string', maxLength: 200 },
            url: {
              type: 'string',
              format: 'uri',
              description: 'Public http(s) URL — private/internal hosts are rejected (SSRF guard)',
            },
            events: {
              type: 'array',
              items: { type: 'string', enum: ['document.indexed', 'document.deleted', 'sync.completed'] },
              description: 'Empty/omitted = subscribe to all events',
            },
            enabled: { type: 'boolean' },
          },
        },
        WebhookList: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            events: { type: 'array', items: { type: 'string' } },
            webhooks: { type: 'array', items: { $ref: '#/components/schemas/WebhookPublic' } },
          },
        },
        WebhookPublic: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            url: { type: 'string' },
            events: { type: 'array', items: { type: 'string' } },
            enabled: { type: 'boolean' },
            lastDeliveryAt: { type: ['string', 'null'] },
            lastDeliveryStatus: { type: ['string', 'null'], enum: ['success', 'failed', null] },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
          },
        },
        WebhookCreateResult: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            plainSecret: { type: 'string', description: 'HMAC signing secret (whsec_…), shown exactly once' },
            signatureHeader: { type: 'string', const: 'X-OmniRAG-Signature' },
            webhook: { $ref: '#/components/schemas/WebhookPublic' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  };
}
