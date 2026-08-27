import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/storage/db';
import { Collection } from '@/lib/types/omnirag';
import { getEnv } from '@/lib/env/runtimeEnv';
import { serverErrorResponse } from '@/lib/api/safeError';
import { guardPermission } from '@/lib/auth/permissions';
import { guardQuota } from '@/lib/services/planService';

export const dynamic = 'force-dynamic';

/**
 * Collection creation payload. Previously `name` was accepted unvalidated —
 * an empty or whitespace-only name produced an unnamed collection card in the
 * UI, and an unbounded description could bloat the row.
 */
const createCollectionSchema = z.object({
  name: z.string().trim().min(1, 'اسم المجموعة مطلوب').max(200, 'اسم المجموعة طويل جدا'),
  description: z.string().trim().max(2000).default(''),
});

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  // Load client-supplied dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  try {
    const denied = await guardPermission(authCtx, 'collections:read');
    if (denied) return denied;

    const tenantId = authCtx.tenantId;
    const collections = await db.getCollections(tenantId);
    return NextResponse.json({ collections });
  } catch (err: any) {
    console.error('API Error in collections GET:', err);
    return NextResponse.json(
      { collections: [], error: 'حدث خطأ داخلي في الخادم. يرجى المحاولة مرة أخرى لاحقاً.', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  // Load client-supplied dynamic environment keys from headers into process.env / global store
  getEnv('GEMINI_API_KEY', req);
  getEnv('UNSTRUCTURED_API_KEY', req);
  getEnv('MISTRAL_API_KEY', req);
  getEnv('DATABASE_URL', req);
  getEnv('POSTGRES_URL', req);
  getEnv('QDRANT_URL', req);
  getEnv('QDRANT_API_KEY', req);

  try {
    const denied = await guardPermission(authCtx, 'collections:write');
    if (denied) return denied;

    // Plan quota (Phase 7): collection ceiling for the workspace's plan.
    const quotaDenied = await guardQuota(authCtx.tenantId, 'maxCollections');
    if (quotaDenied) return quotaDenied;

    const body = await req.json();
    const tenantId = authCtx.tenantId;

    const parsed = createCollectionSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message || 'بيانات المجموعة غير صالحة', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    const { name, description } = parsed.data;

    // Reject duplicate collection names within the same tenant — duplicates
    // make the collection picker ambiguous and confuse citation grouping.
    const existing = await db.getCollections(tenantId);
    if (existing.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) {
      return NextResponse.json(
        { error: `توجد مجموعة بنفس الاسم "${name}" بالفعل`, code: 'DUPLICATE_NAME' },
        { status: 409 },
      );
    }

    const col: Collection = {
      id: `col-${Date.now()}`,
      tenantId,
      name,
      description,
      documentCount: 0,
      createdAt: new Date().toISOString(),
    };

    await db.addCollection(col);
    return NextResponse.json({ collection: col }, { status: 201 });
  } catch (err: any) {
    return serverErrorResponse('collections POST', err);
  }
});
