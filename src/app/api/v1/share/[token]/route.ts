import { createLogger } from '@/lib/logging/logger';

const log = createLogger('AppApiV1ShareToken');

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/security/rateLimiter';
import { getEnv } from '@/lib/env/runtimeEnv';
import { db } from '@/lib/storage/db';
import { getShareByLinkToken } from '@/lib/services/membershipService';

export const dynamic = 'force-dynamic';

/** Max characters of document content exposed through a public share link. */
const SHARED_EXCERPT_LIMIT = 4000;

/**
 * PUBLIC read-only share link (Phase 5). No authentication — possession of
 * the unguessable 192-bit link token is the only credential, so the route is
 * rate-limited tightly and returns read-only payloads exclusively.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  try {
    // Preload runtime env so DB access works under the runtime-env pattern.
    for (const key of ['DATABASE_URL', 'POSTGRES_URL', 'QDRANT_URL', 'QDRANT_API_KEY']) {
      getEnv(key, req);
    }

    const rateLimit = await checkRateLimit(req, 20, 60000, 'public-share-link');
    if (!rateLimit.success && rateLimit.response) return rateLimit.response;

    const { token } = await params;
    const share = await getShareByLinkToken(String(token || '').trim());
    if (!share) {
      return NextResponse.json(
        { error: 'رابط المشاركة غير صالح أو منتهي (Share link invalid or expired)' },
        { status: 404 },
      );
    }

    const tenantId = share.tenantId;

    if (share.resourceType === 'document') {
      const doc = await db.getDocumentById(share.resourceId, tenantId).catch(() => undefined);
      if (!doc) {
        return NextResponse.json({ error: 'المورد لم يعد متاحا (Resource no longer available)' }, { status: 404 });
      }
      return NextResponse.json({
        resourceType: 'document',
        sharedAt: share.createdAt,
        document: {
          id: doc.id,
          title: doc.title,
          sourceType: doc.sourceType,
          status: doc.status,
          chunkCount: doc.chunkCount,
          createdAt: doc.createdAt,
          content: doc.content.slice(0, SHARED_EXCERPT_LIMIT),
          truncated: doc.content.length > SHARED_EXCERPT_LIMIT,
        },
      });
    }

    if (share.resourceType === 'conversation') {
      const conversation = await db.getConversationById(share.resourceId, tenantId).catch(() => undefined);
      if (!conversation) {
        return NextResponse.json({ error: 'المورد لم يعد متاحا (Resource no longer available)' }, { status: 404 });
      }
      const messages = await db.getMessages(conversation.id, tenantId).catch(() => []);
      return NextResponse.json({
        resourceType: 'conversation',
        sharedAt: share.createdAt,
        conversation: {
          id: conversation.id,
          title: conversation.title,
          mode: conversation.mode,
          createdAt: conversation.createdAt,
          messages: messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          })),
        },
      });
    }

    // collection
    const collections = await db.getCollections(tenantId).catch(() => []);
    const collection = collections.find((c) => c.id === share.resourceId);
    if (!collection) {
      return NextResponse.json({ error: 'المورد لم يعد متاحا (Resource no longer available)' }, { status: 404 });
    }
    const documents = await db.getDocuments(tenantId).catch(() => []);
    const inCollection = documents.filter(
      (d) => Array.isArray(d.collectionIds) && d.collectionIds.includes(collection.id),
    );
    return NextResponse.json({
      resourceType: 'collection',
      sharedAt: share.createdAt,
      collection: {
        id: collection.id,
        name: collection.name,
        description: collection.description,
        documentCount: collection.documentCount,
        createdAt: collection.createdAt,
        documents: inCollection.map((d) => ({
          id: d.id,
          title: d.title,
          sourceType: d.sourceType,
          status: d.status,
          chunkCount: d.chunkCount,
          createdAt: d.createdAt,
          excerpt: d.content.slice(0, 500),
        })),
      },
    });
  } catch (err) {
    log.error('[share link] Unexpected error:', (err as Error)?.message);
    return NextResponse.json({ error: 'خطأ داخلي في الخادم (Internal Server Error)' }, { status: 500 });
  }
}
