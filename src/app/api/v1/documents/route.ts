import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { Document, DocumentChunk } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId') || 'tenant-acme-01';
  const documentId = req.nextUrl.searchParams.get('documentId');

  if (documentId) {
    const allChunks = await db.getChunks(tenantId);
    const docChunks = allChunks.filter((c) => c.documentId === documentId);
    return NextResponse.json({ chunks: docChunks });
  }

  const docs = await db.getDocuments(tenantId);
  return NextResponse.json({ documents: docs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = body.tenantId || 'tenant-acme-01';
    const { title, content, language = 'ar', collectionIds = [], chunkingConfig } = body;

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
      metadata: { source: 'User Upload', chunkingConfig },
      collectionIds,
    };

    // Advanced dynamic chunking logic
    const strategy = chunkingConfig?.strategy || 'semantic';
    const targetSize = Math.max(128, chunkingConfig?.size || 512);
    const overlapPercent = Math.min(50, Math.max(0, chunkingConfig?.overlap || 20));
    const charSize = Math.floor(targetSize * 2.5); // ~2.5 chars per token for AR/EN
    const overlapChars = Math.floor(charSize * (overlapPercent / 100));
    const step = Math.max(50, charSize - overlapChars);

    const chunkTextList: string[] = [];

    if (strategy === 'markdown') {
      const sections = content.split(/(?=\n#+ )/);
      sections.forEach((s: string) => {
        if (s.trim()) chunkTextList.push(s.trim());
      });
    } else {
      for (let i = 0; i < content.length; i += step) {
        const snippet = content.substring(i, i + charSize).trim();
        if (snippet) chunkTextList.push(snippet);
      }
    }

    newDoc.chunkCount = chunkTextList.length;
    await db.addDocument(newDoc);

    for (let index = 0; index < chunkTextList.length; index++) {
      const text = chunkTextList[index];
      const chunk: DocumentChunk = {
        id: `chunk-${docId}-${index + 1}`,
        tenantId,
        documentId: docId,
        documentTitle: title,
        content: text,
        chunkIndex: index,
        pageNumber: 1,
        language,
        metadata: { position: index, strategy, tokenCount: Math.round(text.length / 2.8) },
      };
      await db.addChunk(chunk);
    }

    return NextResponse.json({ success: true, document: newDoc, chunkCount: chunkTextList.length }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const docId = req.nextUrl.searchParams.get('id');
  const tenantId = req.nextUrl.searchParams.get('tenantId') || 'tenant-acme-01';

  if (!docId) return NextResponse.json({ error: 'Missing document id' }, { status: 400 });

  await db.deleteDocument(docId, tenantId);
  return NextResponse.json({ success: true });
}
