import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/storage/db';
import { generateApiKeyMaterial, toApiKeyPublicView } from '@/lib/auth/apiKeys';
import { requirePermission } from '@/lib/auth/permissions';
import { serverErrorResponse } from '@/lib/api/safeError';
import { guardQuota } from '@/lib/services/planService';
import type { ApiKeyRecord } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

/**
 * Tenant API key management.
 *
 * GET    — list the tenant's keys (public view; never keyHash).
 * POST   — create a key. The plaintext key is returned exactly once in
 *          `plainKey`; only its SHA-256 hash is persisted.
 * DELETE — revoke a key by id (body: { id }). Revocation is immediate.
 */

export const GET = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const gate = await requirePermission(authCtx, 'apiKeys:manage');
    if (!gate.allowed) {
      return NextResponse.json({ error: 'غير مصرح (Forbidden)', code: '403_FORBIDDEN' }, { status: 403 });
    }
    const keys = await db.listApiKeys(authCtx.tenantId);
    return NextResponse.json({ success: true, keys: keys.map(toApiKeyPublicView) });
  } catch (error: any) {
    return serverErrorResponse('api-keys GET', error);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const gate = await requirePermission(authCtx, 'apiKeys:manage');
    if (!gate.allowed) {
      return NextResponse.json({ error: 'غير مصرح (Forbidden)', code: '403_FORBIDDEN' }, { status: 403 });
    }

    // Plan quota (Phase 7): API key ceiling for the workspace's plan.
    const quotaDenied = await guardQuota(authCtx.tenantId, 'maxApiKeys');
    if (quotaDenied) return quotaDenied;

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : 'مفتاح API';
    const scopes: string[] = Array.isArray(body?.scopes)
      ? body.scopes.filter((s: unknown): s is string => typeof s === 'string' && s.length > 0).slice(0, 50)
      : [];

    // Optional expiry: accept an ISO string or a days-from-now count.
    let expiresAt: string | null = null;
    if (typeof body?.expiresInDays === 'number' && body.expiresInDays > 0) {
      expiresAt = new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    } else if (typeof body?.expiresAt === 'string' && body.expiresAt) {
      const parsed = new Date(body.expiresAt).getTime();
      if (Number.isFinite(parsed) && parsed > Date.now()) expiresAt = new Date(parsed).toISOString();
    }

    // Optional per-key ceiling (requests/minute). null = tenant default only.
    let rateLimitPerMinute: number | null = null;
    if (body?.rateLimitPerMinute !== undefined && body?.rateLimitPerMinute !== null) {
      const parsedLimit = Number(body.rateLimitPerMinute);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100000) {
        return NextResponse.json(
          {
            error: 'حد المعدل يجب أن يكون عددا صحيحا بين 1 و100000 (rateLimitPerMinute must be an integer 1–100000)',
            code: '400_BAD_RATE_LIMIT',
          },
          { status: 400 },
        );
      }
      rateLimitPerMinute = parsedLimit;
    }

    // Optional outbound MCP tool whitelist. null = expose all tenant tools.
    let mcpTools: string[] | null = null;
    if (body?.mcpTools !== undefined && body?.mcpTools !== null) {
      if (!Array.isArray(body.mcpTools) || body.mcpTools.some((t: unknown) => typeof t !== 'string' || !t.trim())) {
        return NextResponse.json(
          {
            error: 'قائمة أدوات MCP يجب أن تكون مصفوفة نصوص (mcpTools must be a string array)',
            code: '400_BAD_MCP_TOOLS',
          },
          { status: 400 },
        );
      }
      mcpTools = Array.from(new Set((body.mcpTools as unknown[]).map((t) => String(t).trim()))).slice(0, 200);
    }

    const { plainKey, prefix, keyHash } = generateApiKeyMaterial();
    const now = new Date().toISOString();
    const record: ApiKeyRecord = {
      id: `key-${randomUUID()}`,
      tenantId: authCtx.tenantId,
      userId: authCtx.userId,
      name,
      prefix,
      keyHash,
      scopes,
      rateLimitPerMinute,
      mcpTools,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
    };

    await db.createApiKey(record);

    return NextResponse.json({
      success: true,
      message: 'تم إنشاء مفتاح API. انسخه الآن — لن يظهر مرة أخرى.',
      // Shown once. The persisted row holds only the hash.
      plainKey,
      key: toApiKeyPublicView(record),
    });
  } catch (error: any) {
    return serverErrorResponse('api-keys POST', error);
  }
});

export const DELETE = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const gate = await requirePermission(authCtx, 'apiKeys:manage');
    if (!gate.allowed) {
      return NextResponse.json({ error: 'غير مصرح (Forbidden)', code: '403_FORBIDDEN' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) {
      return NextResponse.json(
        { error: 'معرّف المفتاح مطلوب (id is required)', code: '400_BAD_REQUEST' },
        { status: 400 },
      );
    }

    await db.revokeApiKey(id, authCtx.tenantId);
    return NextResponse.json({ success: true, message: 'تم إبطال مفتاح API فورا.' });
  } catch (error: any) {
    return serverErrorResponse('api-keys DELETE', error);
  }
});
