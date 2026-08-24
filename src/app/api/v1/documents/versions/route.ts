import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/storage/db';
import { serverErrorResponse } from '@/lib/api/safeError';

export const dynamic = 'force-dynamic';

/**
 * Version-action validation. The body was previously destructured raw with no
 * schema: `versionNumber` could be any junk cast with Number(), and version
 * `content` had NO size bound (a single request could write hundreds of MB of
 * jsonb into the documents row). Mirrors the documents POST limits.
 */
const MAX_CONTENT_CHARS = 4_000_000;

const versionsActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('revert'),
    documentId: z.string().min(1, 'معرف المستند مطلوب'),
    versionNumber: z.number().int().min(1).max(10000),
  }),
  z.object({
    action: z.literal('create'),
    documentId: z.string().min(1, 'معرف المستند مطلوب'),
    title: z.string().trim().max(500, 'العنوان طويل جداً (الحد 500 حرف)').optional(),
    content: z
      .string()
      .min(1, 'محتوى الإصدار مطلوب')
      .max(MAX_CONTENT_CHARS, 'المحتوى يتجاوز الحد الأقصى المسموح (4 ملايين حرف)'),
    changeSummary: z.string().trim().max(500).optional(),
    createdBy: z.string().trim().max(200).optional(),
  }),
]);

export const GET = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const tenantId = authCtx.tenantId;
    const documentId = req.nextUrl.searchParams.get('documentId');

    if (!documentId) {
      return NextResponse.json({ error: 'Missing documentId parameter' }, { status: 400 });
    }

    const doc = await db.getDocumentById(documentId, tenantId);
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const versions = await db.getDocumentVersions(documentId, tenantId);

    return NextResponse.json({
      success: true,
      documentId,
      currentVersion: doc.version || 1,
      versions,
    });
  } catch (error: any) {
    return serverErrorResponse('document versions GET', error);
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const tenantId = authCtx.tenantId;
    const body = await req.json();

    const parsed = versionsActionSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json(
        {
          error: firstIssue?.message || 'بيانات طلب الإصدارات غير صالحة',
          code: 'VALIDATION_ERROR',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        { status: 400 },
      );
    }

    const data = parsed.data;

    if (data.action === 'revert') {
      const result = await db.revertDocumentVersion(data.documentId, data.versionNumber, tenantId);
      if (!result) {
        return NextResponse.json({ error: 'Target version not found or revert failed' }, { status: 404 });
      }

      const allVersions = await db.getDocumentVersions(data.documentId, tenantId);

      return NextResponse.json({
        success: true,
        message: `تم استرجاع المستند إلى الإصدار v${data.versionNumber} بنجاح`,
        document: result.document,
        restoredVersion: result.restoredVersion,
        versions: allVersions,
      });
    }

    // action === 'create'
    const result = await db.createDocumentVersion(
      data.documentId,
      {
        title: data.title,
        content: data.content,
        changeSummary: data.changeSummary,
        createdBy: data.createdBy,
      },
      tenantId,
    );

    if (!result) {
      return NextResponse.json({ error: 'Failed to create document version' }, { status: 400 });
    }

    const allVersions = await db.getDocumentVersions(data.documentId, tenantId);

    return NextResponse.json({
      success: true,
      message: `تم حفظ الإصدار v${result.version.versionNumber} بنجاح`,
      document: result.document,
      version: result.version,
      versions: allVersions,
    });
  } catch (error: any) {
    return serverErrorResponse('document versions POST', error);
  }
});
