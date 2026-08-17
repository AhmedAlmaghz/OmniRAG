import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/storage/db';
import { Conversation, Message } from '@/lib/types/omnirag';

export const dynamic = 'force-dynamic';

export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = authCtx.tenantId;
    const conversationId = searchParams.get('conversationId');

    if (conversationId) {
      const messages = await db.getMessages(conversationId, tenantId);
      const conversation = await db.getConversationById(conversationId, tenantId);
      return NextResponse.json({ conversation, messages });
    }

    const conversations = await db.getConversations(tenantId);
    return NextResponse.json({ conversations });
  } catch (err: unknown) {
    console.error('GET /api/v1/conversations error:', err);
    return NextResponse.json({ error: 'فشل جلب المحادثات (Failed to fetch conversations)' }, { status: 500 });
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
        model: body.model || 'gemini-3.7-flash',
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
      // Security (C2): override client-supplied tenantId so the message is
      // persisted under the authenticated caller's tenant (cross-tenant
      // impersonation guard). Also regenerate the id and timestamp server-side:
      // the comment below previously promised this but the code passed the
      // client-supplied id through unchanged, allowing spoofed ids and
      // collisions with messages already in other conversations.
      msg.tenantId = tenantId;
      msg.id = `msg-${randomUUID()}`;
      msg.createdAt = msg.createdAt || new Date().toISOString();
      await db.addMessage(msg);
      return NextResponse.json({ success: true, messageId: msg.id });
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
  } catch (err: unknown) {
    console.error('POST /api/v1/conversations error:', err);
    return NextResponse.json({ error: 'خطأ داخلي في الخادم (Internal Server Error)' }, { status: 500 });
  }
});
