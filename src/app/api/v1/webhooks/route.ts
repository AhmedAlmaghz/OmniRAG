import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { guardPermission } from '@/lib/auth/permissions';
import { serverErrorResponse } from '@/lib/api/safeError';
import { createWebhookEndpoint, updateWebhookEndpoint, toWebhookPublicView } from '@/lib/services/webhookService';
import { WEBHOOK_EVENTS } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

/**
 * Outbound webhook management (Phase 6).
 *
 * GET    — list the tenant's endpoints (settings:read; secrets never returned).
 * POST   — create an endpoint (settings:write). The HMAC signing secret is
 *          returned exactly once in `plainSecret`; only ciphertext is stored.
 * PUT    — update name/url/events/enabled (settings:write). Pass
 *          `regenerateSecret: true` to rotate — the new secret is again
 *          returned once and the old one stops signing immediately.
 * DELETE — remove an endpoint by id (settings:write), body: { id }.
 *
 * Deliveries are signed with HMAC-SHA256 over `${timestamp}.${body}`;
 * receivers verify via the `X-OmniRAG-Signature` (sha256=hex) header together
 * with `X-OmniRAG-Timestamp`.
 */

export const GET = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const denied = await guardPermission(authCtx, 'settings:read');
    if (denied) return denied;

    const endpoints = await db.listWebhookEndpoints(authCtx.tenantId);
    return NextResponse.json({
      success: true,
      events: WEBHOOK_EVENTS,
      webhooks: endpoints.map(toWebhookPublicView),
    });
  } catch (error: any) {
    return serverErrorResponse('webhooks GET', error);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const denied = await guardPermission(authCtx, 'settings:write');
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const result = await createWebhookEndpoint(authCtx.tenantId, body);
    if (!result.endpoint) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.code?.startsWith('409') ? 409 : 400 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message:
          'تم إنشاء نقطة النهاية. انسخ سر التوقيع الآن — لن يظهر مرة أخرى. (Copy the signing secret now; it will not be shown again.)',
        // Shown once. The persisted row holds only AES-256-GCM ciphertext.
        plainSecret: result.plainSecret,
        signatureHeader: 'X-OmniRAG-Signature',
        webhook: toWebhookPublicView(result.endpoint),
      },
      { status: 201 },
    );
  } catch (error: any) {
    return serverErrorResponse('webhooks POST', error);
  }
});

export const PUT = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const denied = await guardPermission(authCtx, 'settings:write');
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) {
      return NextResponse.json(
        { error: 'معرّف نقطة النهاية مطلوب (id is required)', code: '400_BAD_REQUEST' },
        { status: 400 },
      );
    }

    const result = await updateWebhookEndpoint(authCtx.tenantId, id, body);
    if (!result.endpoint) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.code === '404_NOT_FOUND' ? 404 : 400 },
      );
    }

    return NextResponse.json({
      success: true,
      ...(result.plainSecret ? { plainSecret: result.plainSecret } : {}),
      webhook: toWebhookPublicView(result.endpoint),
    });
  } catch (error: any) {
    return serverErrorResponse('webhooks PUT', error);
  }
});

export const DELETE = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const denied = await guardPermission(authCtx, 'settings:write');
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) {
      return NextResponse.json(
        { error: 'معرّف نقطة النهاية مطلوب (id is required)', code: '400_BAD_REQUEST' },
        { status: 400 },
      );
    }

    await db.deleteWebhookEndpoint(id, authCtx.tenantId);
    return NextResponse.json({ success: true, message: 'تم حذف نقطة النهاية.' });
  } catch (error: any) {
    return serverErrorResponse('webhooks DELETE', error);
  }
});
