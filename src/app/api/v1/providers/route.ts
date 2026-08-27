import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/storage/db';
import { toProviderCatalog, getProviderDescriptor, listProviderDescriptors } from '@/lib/ai/registry/registry';
import {
  resolveProviderCredentials,
  clearProviderCredentialCache,
  isProviderConfigured,
} from '@/lib/ai/registry/credentials';
import { encryptToken } from '@/lib/mcp/auth/encryption';
import { requirePermission } from '@/lib/auth/permissions';
import { runWithRequestContext } from '@/lib/config/requestContext';
import { serverErrorResponse } from '@/lib/api/safeError';
import type { ProviderCredentialRecord } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

/**
 * AI provider management.
 *
 * GET    — provider catalog (client-safe) + which providers the tenant has
 *          configured (no secrets returned).
 * POST   — action='save' upserts encrypted credentials for a provider;
 *          action='discover' returns live-discovered models for a provider.
 * DELETE — removes a provider's stored credentials.
 */

function redactCredentialStatus(record: ProviderCredentialRecord | undefined, providerId: string) {
  if (!record) return { providerId, configured: false, stored: false, enabled: false, baseUrl: '' };
  const hasKey = Boolean((record.credentials as any)?.apiKey);
  return {
    providerId,
    configured: hasKey,
    stored: true,
    enabled: record.enabled !== false,
    baseUrl: record.baseUrl || '',
  };
}

export const GET = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const gate = await requirePermission(authCtx, 'providers:manage');
    if (!gate.allowed) {
      return NextResponse.json({ error: 'غير مصرح (Forbidden)', code: '403_FORBIDDEN' }, { status: 403 });
    }

    const stored = await db.listProviderCredentials(authCtx.tenantId);
    const byProvider = new Map(stored.map((s) => [s.providerId, s]));
    // `configured` reflects the REAL resolution order (tenant DB → host env),
    // so providers keyed only via environment still show as usable.
    const status = await Promise.all(
      listProviderDescriptors().map(async (p) => {
        const base = redactCredentialStatus(byProvider.get(p.id), p.id);
        const configured =
          base.configured ||
          (await runWithRequestContext({ tenantId: authCtx.tenantId, userId: authCtx.userId }, () =>
            isProviderConfigured(p.id).catch(() => false),
          ));
        return { ...base, configured };
      }),
    );

    return NextResponse.json({
      success: true,
      providers: toProviderCatalog(),
      status,
    });
  } catch (error: any) {
    return serverErrorResponse('providers GET', error);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const gate = await requirePermission(authCtx, 'providers:manage');
    if (!gate.allowed) {
      return NextResponse.json({ error: 'غير مصرح (Forbidden)', code: '403_FORBIDDEN' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action || 'save';
    const providerId = typeof body?.providerId === 'string' ? body.providerId : '';
    const descriptor = getProviderDescriptor(providerId);
    if (!descriptor) {
      return NextResponse.json(
        { error: 'مزود غير معروف (Unknown provider)', code: '400_BAD_REQUEST' },
        { status: 400 },
      );
    }

    // Discover live models using the tenant's (or just-saved) credentials.
    if (action === 'discover') {
      if (!descriptor.discoverModels) {
        return NextResponse.json({ success: true, models: [] });
      }
      const creds = await runWithRequestContext({ tenantId: authCtx.tenantId, userId: authCtx.userId }, () =>
        resolveProviderCredentials(providerId),
      );
      const models = await descriptor.discoverModels(creds).catch(() => []);
      return NextResponse.json({ success: true, models });
    }

    // Save / upsert credentials.
    if (action === 'save') {
      const incoming = body?.credentials && typeof body.credentials === 'object' ? body.credentials : {};
      const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : '';
      const enabled = body?.enabled !== false;

      // Encrypt secret fields; pass through non-secret fields. Masked (•)
      // placeholders mean "keep existing" — merge over the stored row.
      const existing = await db.getProviderCredentials(authCtx.tenantId, providerId);
      const merged: Record<string, string> = { ...((existing?.credentials as any) || {}) };
      for (const field of descriptor.credentialFields) {
        const val = incoming[field.key];
        if (typeof val !== 'string') continue;
        if (val.includes('•')) continue; // masked placeholder → keep existing
        if (val.trim() === '') {
          delete merged[field.key];
          continue;
        }
        merged[field.key] = field.secret ? encryptToken(val.trim()) : val.trim();
      }

      const now = new Date().toISOString();
      const record: ProviderCredentialRecord = {
        id: existing?.id || `pc-${randomUUID()}`,
        tenantId: authCtx.tenantId,
        providerId,
        credentials: merged,
        baseUrl: baseUrl || existing?.baseUrl || '',
        enabled,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      await db.upsertProviderCredentials(record);
      clearProviderCredentialCache();

      return NextResponse.json({
        success: true,
        message: 'تم حفظ اعتمادات المزود بنجاح.',
        status: redactCredentialStatus(record, providerId),
      });
    }

    return NextResponse.json({ error: 'إجراء غير مدعوم', code: '400_BAD_REQUEST' }, { status: 400 });
  } catch (error: any) {
    return serverErrorResponse('providers POST', error);
  }
});

export const DELETE = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const gate = await requirePermission(authCtx, 'providers:manage');
    if (!gate.allowed) {
      return NextResponse.json({ error: 'غير مصرح (Forbidden)', code: '403_FORBIDDEN' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const providerId = typeof body?.providerId === 'string' ? body.providerId : '';
    if (!providerId) {
      return NextResponse.json({ error: 'معرف المزود مطلوب', code: '400_BAD_REQUEST' }, { status: 400 });
    }
    await db.deleteProviderCredentials(authCtx.tenantId, providerId);
    clearProviderCredentialCache();
    return NextResponse.json({ success: true, message: 'تمت إزالة اعتمادات المزود.' });
  } catch (error: any) {
    return serverErrorResponse('providers DELETE', error);
  }
});
