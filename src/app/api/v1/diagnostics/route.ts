import { NextRequest, NextResponse } from 'next/server';
import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { getPostgresPool } from '@/lib/storage/postgres';
import { getEnv } from '@/lib/env/runtimeEnv';
import { QdrantClient } from '@qdrant/js-client-rest';

export const dynamic = 'force-dynamic';

function maskConnectionString(connStr: string): string {
  if (!connStr) return '';
  try {
    const url = new URL(connStr);
    const passMasked = url.password ? '••••••••' : '';
    const user = url.username ? url.username : '';
    return `${url.protocol}//${user}${passMasked ? ':' + passMasked : ''}@${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch (e) {
    return connStr.replace(/:([^@]+)@/, ':••••••••@');
  }
}

function maskUrl(urlStr: string): string {
  if (!urlStr) return '';
  try {
    const url = new URL(urlStr);
    return `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}`;
  } catch (e) {
    return urlStr;
  }
}

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

async function runPostgresDiagnostic(req?: any) {
  const startTime = Date.now();
  const connStr = getEnv('DATABASE_URL', req) || getEnv('POSTGRES_URL', req);

  if (!connStr) {
    return {
      service: 'postgresql',
      name: 'PostgreSQL Database',
      status: 'missing_config',
      latencyMs: 0,
      configured: false,
      maskedUrl: null,
      message: 'DATABASE_URL environment variable is not set.',
      details: {
        error: 'DATABASE_URL or POSTGRES_URL missing from process.env',
        recommendation: 'Provide a valid PostgreSQL connection string in .env.example or platform settings.',
      },
    };
  }

  try {
    const pool = getPostgresPool(req);
    if (!pool) {
      return {
        service: 'postgresql',
        name: 'PostgreSQL Database',
        status: 'disconnected',
        latencyMs: Date.now() - startTime,
        configured: true,
        maskedUrl: maskConnectionString(connStr),
        message: 'PostgreSQL pool initialization failed.',
        details: {
          error: 'Could not create pg.Pool client pool.',
        },
      };
    }

    const client = await pool.connect();
    try {
      const pingStart = Date.now();
      const dbRes = await client.query('SELECT version(), current_database(), NOW() as server_time');
      const pingLatency = Date.now() - pingStart;

      const tablesRes = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      const tables = tablesRes.rows.map((r: any) => r.table_name);

      return {
        service: 'postgresql',
        name: 'PostgreSQL Database',
        status: 'connected',
        latencyMs: pingLatency,
        configured: true,
        maskedUrl: maskConnectionString(connStr),
        version: dbRes.rows[0]?.version ? dbRes.rows[0].version.split(' ')[0] : 'PostgreSQL',
        fullVersion: dbRes.rows[0]?.version || '',
        databaseName: dbRes.rows[0]?.current_database || 'default',
        serverTime: dbRes.rows[0]?.server_time,
        activeTablesCount: tables.length,
        tables,
        message: 'PostgreSQL connection verified successfully. Lexical & Metadata tables are operational.',
      };
    } finally {
      client.release();
    }
  } catch (err: any) {
    return {
      service: 'postgresql',
      name: 'PostgreSQL Database',
      status: 'disconnected',
      latencyMs: Date.now() - startTime,
      configured: true,
      maskedUrl: maskConnectionString(connStr),
      message: `PostgreSQL connection error: ${err.message}`,
      details: {
        error: err.message,
        code: err.code,
      },
    };
  }
}

async function runQdrantDiagnostic(req?: any) {
  const startTime = Date.now();
  const url = getEnv('QDRANT_URL', req);
  const apiKey = getEnv('QDRANT_API_KEY', req);

  if (!url) {
    return {
      service: 'qdrant',
      name: 'Qdrant Vector Engine',
      status: 'missing_config',
      latencyMs: 0,
      configured: false,
      maskedUrl: null,
      message: 'QDRANT_URL environment variable is not configured.',
      details: {
        recommendation: 'Configure QDRANT_URL in environment settings to enable semantic vector search.',
      },
    };
  }

  try {
    const qClient = new QdrantClient({
      url,
      apiKey: apiKey || undefined,
    });

    const collectionsRes = await qClient.getCollections();
    const latencyMs = Date.now() - startTime;
    const omniCollection = collectionsRes.collections?.find((c: any) => c.name === 'omnirag_chunks');

    let collectionInfo = null;
    if (omniCollection) {
      try {
        const detailRes = await qClient.getCollection('omnirag_chunks');
        collectionInfo = {
          name: 'omnirag_chunks',
          status: detailRes.status || 'green',
          pointsCount: detailRes.points_count || (detailRes as any).vectors_count || 0,
          vectorSize: (detailRes.config?.params?.vectors as any)?.size || 3072,
          distance: (detailRes.config?.params?.vectors as any)?.distance || 'Cosine',
        };
      } catch (colErr) {
        collectionInfo = { name: 'omnirag_chunks', status: 'exists' };
      }
    }

    return {
      service: 'qdrant',
      name: 'Qdrant Vector Engine',
      status: 'connected',
      latencyMs,
      configured: true,
      maskedUrl: maskUrl(url),
      hasApiKey: !!apiKey,
      collectionsCount: collectionsRes.collections?.length || 0,
      omniCollectionExists: !!omniCollection,
      collectionInfo,
      message: omniCollection
        ? 'Qdrant vector cluster verified. Collection "omnirag_chunks" is active and indexed.'
        : 'Qdrant cluster connected. Ready to provision "omnirag_chunks" collection on first insert.',
    };
  } catch (err: any) {
    return {
      service: 'qdrant',
      name: 'Qdrant Vector Engine',
      status: 'disconnected',
      latencyMs: Date.now() - startTime,
      configured: true,
      maskedUrl: maskUrl(url),
      hasApiKey: !!apiKey,
      message: `Qdrant cluster connection failed: ${err.message}`,
      details: {
        error: err.message,
      },
    };
  }
}

async function runMistralDiagnostic(req?: any) {
  const startTime = Date.now();
  const apiKey = getEnv('MISTRAL_API_KEY', req);

  if (!apiKey) {
    return {
      service: 'mistral',
      name: 'Mistral Document AI',
      status: 'missing_config',
      latencyMs: 0,
      configured: false,
      maskedApiKey: null,
      message: 'MISTRAL_API_KEY environment variable is not configured.',
      details: {
        recommendation: 'Set MISTRAL_API_KEY in environment variables to enable Mistral OCR, Document AI parsing, and embedding capabilities.',
      },
    };
  }

  try {
    const res = await fetch('https://api.mistral.ai/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    const latencyMs = Date.now() - startTime;

    if (res.ok) {
      const data = await res.json();
      const rawModels = data.data || [];
      const modelIds = rawModels.map((m: any) => m.id);

      return {
        service: 'mistral',
        name: 'Mistral Document AI',
        status: 'connected',
        latencyMs,
        configured: true,
        maskedApiKey: maskKey(apiKey),
        modelsCount: rawModels.length,
        availableModels: modelIds.slice(0, 8),
        hasOcrSupport: modelIds.some((id: string) => id.includes('ocr') || id.includes('embed') || id.includes('pixtral')),
        message: 'Mistral API key authenticated successfully. Document AI, OCR & parsing models ready.',
      };
    } else {
      const errBody = await res.text().catch(() => '');
      return {
        service: 'mistral',
        name: 'Mistral Document AI',
        status: 'auth_failed',
        latencyMs,
        configured: true,
        statusCode: res.status,
        maskedApiKey: maskKey(apiKey),
        message: `Mistral API returned HTTP ${res.status}: ${res.statusText}`,
        details: {
          httpStatus: res.status,
          bodySnippet: errBody.slice(0, 150),
          recommendation: 'Verify that MISTRAL_API_KEY is active and has sufficient quotas.',
        },
      };
    }
  } catch (err: any) {
    return {
      service: 'mistral',
      name: 'Mistral Document AI',
      status: 'disconnected',
      latencyMs: Date.now() - startTime,
      configured: true,
      maskedApiKey: maskKey(apiKey),
      message: `Failed to reach Mistral API endpoint: ${err.message}`,
      details: {
        error: err.message,
      },
    };
  }
}

function runEnvAudit(req?: any) {
  const envVars = [
    { name: 'DATABASE_URL', category: 'Storage', desc: 'PostgreSQL Lexical & Metadata DB', required: true },
    { name: 'QDRANT_URL', category: 'Vector DB', desc: 'Qdrant Cluster Endpoint', required: true },
    { name: 'QDRANT_API_KEY', category: 'Vector DB', desc: 'Qdrant Authentication Key', required: false },
    { name: 'MISTRAL_API_KEY', category: 'Document AI', desc: 'Mistral OCR & Embeddings API Key', required: true },
    { name: 'GEMINI_API_KEY', category: 'AI Reasoning', desc: 'Google Gemini Pro / Flash API Key', required: true },
    { name: 'APP_URL', category: 'Ingress', desc: 'Production Application Public Host', required: true },
    { name: 'UNSTRUCTURED_API_KEY', category: 'Document AI', desc: 'Unstructured.io Parsing Key', required: false },
  ];

  return envVars.map(v => {
    const val = getEnv(v.name, req);
    const present = !!val && val !== 'null' && val !== 'undefined' && val.trim() !== '';
    let preview = 'Not Set';

    if (present && val) {
      if (v.name.includes('URL')) {
        preview = maskUrl(val);
      } else if (v.name.includes('KEY') || v.name.includes('SECRET')) {
        preview = maskKey(val);
      } else {
        preview = val.slice(0, 12) + '...';
      }
    }

    return {
      ...v,
      present,
      preview,
    };
  });
}

export const GET = withAuthAndRateLimit(async (req, authCtx) => {
  const [postgres, qdrant, mistral] = await Promise.all([
    runPostgresDiagnostic(req),
    runQdrantDiagnostic(req),
    runMistralDiagnostic(req),
  ]);

  const envAudit = runEnvAudit(req);

  // Calculate System Production Readiness Score
  let score = 0;
  if (postgres.status === 'connected') score += 35;
  else if (postgres.status === 'missing_config') score += 10; // Fallback mock storage available

  if (qdrant.status === 'connected') score += 35;
  else if (qdrant.status === 'missing_config') score += 10;

  if (mistral.status === 'connected') score += 20;

  if (getEnv('GEMINI_API_KEY', req)) score += 10;

  let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
  if (score < 50) overallStatus = 'critical';
  else if (score < 85) overallStatus = 'degraded';

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    overallStatus,
    readinessScore: Math.min(100, score),
    diagnostics: {
      postgresql: postgres,
      qdrant: qdrant,
      mistral: mistral,
    },
    envAudit,
  });
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const body = await req.json().catch(() => ({}));
    const target = body.target || 'all';

    let result: any = {};

    if (target === 'postgres' || target === 'postgresql') {
      result.postgresql = await runPostgresDiagnostic();
    } else if (target === 'qdrant') {
      result.qdrant = await runQdrantDiagnostic();
    } else if (target === 'mistral') {
      result.mistral = await runMistralDiagnostic();
    } else {
      const [postgres, qdrant, mistral] = await Promise.all([
        runPostgresDiagnostic(),
        runQdrantDiagnostic(),
        runMistralDiagnostic(),
      ]);
      result = { postgresql: postgres, qdrant, mistral };
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      target,
      result,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Diagnostic execution failed' }, { status: 500 });
  }
});
