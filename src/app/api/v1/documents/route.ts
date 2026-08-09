import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { Document, DocumentChunk } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId') || 'tenant-acme-01';
  const docs = db.getDocuments(tenantId);
  return NextResponse.json({ documents: docs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = body.tenantId || 'tenant-acme-01';
    const { title, content, language = 'ar', collectionIds = [] } = body;

    if (!title || !content) {
      return NextResponse.json({ error: 'العنوان والمحتوى مطلوبان' }, { status: 400 });
    }

    const docId = `doc-${Date.now()}`;
    const newDoc: Document = {
      id: docId,
      tenantId,
      title,
      content,
      sourceType: 'file',
      language,
      status: 'indexed',
      chunkCount: 0,
      createdAt: new Date().toISOString(),
      metadata: { source: 'User Upload' },
      collectionIds,
    };

    // Auto-chunking logic (500 chars per chunk)
    const chunkSize = 400;
    const chunkTextList: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunkTextList.push(content.substring(i, i + chunkSize));
    }

    newDoc.chunkCount = chunkTextList.length;
    db.addDocument(newDoc);

    chunkTextList.forEach((text, index) => {
      const chunk: DocumentChunk = {
        id: `chunk-${docId}-${index + 1}`,
        tenantId,
        documentId: docId,
        documentTitle: title,
        content: text,
        chunkIndex: index,
        pageNumber: 1,
        language,
        metadata: { position: index },
      };
      db.addChunk(chunk);
    });

    return NextResponse.json({ success: true, document: newDoc }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const docId = req.nextUrl.searchParams.get('id');
  const tenantId = req.nextUrl.searchParams.get('tenantId') || 'tenant-acme-01';

  if (!docId) return NextResponse.json({ error: 'Missing document id' }, { status: 400 });

  db.deleteDocument(docId, tenantId);
  return NextResponse.json({ success: true });
}
