import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { getEnv } from '@/lib/env/runtimeEnv';
import { mergeAndEncryptSourceConfig, redactSourceConfig } from '@/lib/storage/sourceConfigCrypto';
import { guardPermission } from '@/lib/auth/permissions';

export const GET = withAuthAndRateLimit(async (req, authCtx, { params }: { params: Promise<{ id: string }> }) => {
  // Load client-supplied dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  const denied = await guardPermission(authCtx, 'sources:read');
  if (denied) return denied;

  const { id } = await params;
  const tenantId = authCtx.tenantId;

  const source = await db.getSourceById(id, tenantId);
  if (!source) {
    return NextResponse.json({ error: 'Source connector not found' }, { status: 404 });
  }

  const logs = await db.getSyncLogs(tenantId, id);
  const documents = (await db.getDocuments(tenantId)).filter((d) => d.metadata?.sourceId === id);

  return NextResponse.json({
    source: { ...source, config: redactSourceConfig(source.config) },
    logs,
    documents,
  });
});

export const PUT = withAuthAndRateLimit(async (req, authCtx, { params }: { params: Promise<{ id: string }> }) => {
  // Load client-supplied dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  const denied = await guardPermission(authCtx, 'sources:write');
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();
  const tenantId = authCtx.tenantId;

  // Merge + encrypt credential fields. Secrets round-tripped as the redaction
  // placeholder (edit modal seeded from a redacted GET) keep their stored
  // value instead of being overwritten with the mask.
  if (body?.config && typeof body.config === 'object') {
    const existing = await db.getSourceById(id, tenantId);
    if (!existing) {
      return NextResponse.json({ error: 'Source connector not found' }, { status: 404 });
    }
    // getSourceById returns the config as stored (encrypted at rest) — exactly
    // what mergeAndEncryptSourceConfig expects for placeholder substitution.
    body.config = mergeAndEncryptSourceConfig(existing.config, body.config);
    body.configEncrypted = true;
  }

  const updated = await db.updateSource(id, body, tenantId);
  if (!updated) {
    return NextResponse.json({ error: 'Source connector not found' }, { status: 404 });
  }

  return NextResponse.json({
    message: 'Source config updated',
    source: { ...updated, config: redactSourceConfig(updated.config) },
  });
});

export const DELETE = withAuthAndRateLimit(async (req, authCtx, { params }: { params: Promise<{ id: string }> }) => {
  // Load client-supplied dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  const denied = await guardPermission(authCtx, 'sources:delete');
  if (denied) return denied;

  const { id } = await params;
  const tenantId = authCtx.tenantId;

  await db.deleteSource(id, tenantId, true);

  return NextResponse.json({ message: 'Source deleted and documents purged', id });
});
