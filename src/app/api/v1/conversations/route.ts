import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/storage/db';
import { Conversation, Message } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') || 'tenant-acme-01';
    const conversationId = searchParams.get('conversationId');

    if (conversationId) {
      const messages = await db.getMessages(conversationId, tenantId);
      const conversation = await db.getConversationById(conversationId, tenantId);
      return NextResponse.json({ conversation, messages });
    }

    const conversations = await db.getConversations(tenantId);
    return NextResponse.json({ conversations });
  } catch (err: any) {
    console.error("GET /api/v1/conversations error:", err);
    return NextResponse.json({ error: err.message || 'Failed to fetch conversations' }, { status: 500 });
  }
});

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    const body = await req.json();
    const tenantId = authCtx.tenantId;
    const action = body.action || 'create';

    if (action === 'create') {
      const newConv: Conversation = {
        id: body.id || `conv-${Date.now()}`,
        tenantId,
        title: body.title || 'محادثة جديدة',
        mode: body.mode || 'hybrid',
        model: body.model || 'gemini-3.6-flash',
        collectionIds: body.collectionIds || [],
        enabledMcpServers: body.enabledMcpServers || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await db.saveConversation(newConv);

      // Seed initial welcome message for the new conversation if provided or default
      const welcomeMsg: Message = {
        id: `msg-welcome-${newConv.id}`,
        tenantId,
        conversationId: newConv.id,
        role: 'assistant',
        content: body.welcomeText || 'مرحباً بك في الجلسة الجديدة. كيف يمكنني مساعدتك؟',
        createdAt: new Date().toISOString(),
        modelUsed: newConv.model,
      };
      await db.addMessage(welcomeMsg);

      const conversations = await db.getConversations(tenantId);
      return NextResponse.json({ success: true, conversation: newConv, conversations }, { status: 201 });
    }

    if (action === 'save_message' && body.message) {
      const msg: Message = body.message;
      await db.addMessage(msg);
      return NextResponse.json({ success: true });
    }

    if (action === 'delete' && body.conversationId) {
      await db.deleteConversation(body.conversationId, tenantId);
      const conversations = await db.getConversations(tenantId);
      return NextResponse.json({ success: true, conversations });
    }

    if (action === 'rename' && body.conversationId && body.title) {
      const conv = await db.getConversationById(body.conversationId, tenantId);
      if (conv) {
        conv.title = body.title;
        conv.updatedAt = new Date().toISOString();
        await db.saveConversation(conv);
      }
      const conversations = await db.getConversations(tenantId);
      return NextResponse.json({ success: true, conversations });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error("POST /api/v1/conversations error:", err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
});
