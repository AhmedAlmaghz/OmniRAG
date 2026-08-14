import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';

export const dynamic = 'force-dynamic';

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
    console.error('API Error in document versions GET:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx) => {
  try {
    const tenantId = authCtx.tenantId;
    const body = await req.json();
    const { action, documentId, versionNumber, title, content, changeSummary, createdBy } = body;

    if (!documentId) {
      return NextResponse.json({ error: 'Missing documentId parameter' }, { status: 400 });
    }

    if (action === 'revert') {
      if (!versionNumber) {
        return NextResponse.json({ error: 'Missing versionNumber to revert' }, { status: 400 });
      }

      const result = await db.revertDocumentVersion(documentId, Number(versionNumber), tenantId);
      if (!result) {
        return NextResponse.json({ error: 'Target version not found or revert failed' }, { status: 404 });
      }

      const allVersions = await db.getDocumentVersions(documentId, tenantId);

      return NextResponse.json({
        success: true,
        message: `تم استرجاع المستند إلى الإصدار v${versionNumber} بنجاح`,
        document: result.document,
        restoredVersion: result.restoredVersion,
        versions: allVersions,
      });
    }

    if (action === 'create') {
      if (!content) {
        return NextResponse.json({ error: 'Content is required for creating a new version' }, { status: 400 });
      }

      const result = await db.createDocumentVersion(
        documentId,
        {
          title,
          content,
          changeSummary,
          createdBy,
        },
        tenantId
      );

      if (!result) {
        return NextResponse.json({ error: 'Failed to create document version' }, { status: 400 });
      }

      const allVersions = await db.getDocumentVersions(documentId, tenantId);

      return NextResponse.json({
        success: true,
        message: `تم حفظ الإصدار v${result.version.versionNumber} بنجاح`,
        document: result.document,
        version: result.version,
        versions: allVersions,
      });
    }

    return NextResponse.json({ error: 'Invalid action. Supported actions: revert, create' }, { status: 400 });
  } catch (error: any) {
    console.error('API Error in document versions POST:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
});
