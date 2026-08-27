import type { ConnectorDescriptor, ConnectorFieldDescriptor, ConnectorExtraction } from '../types';
import { buildConfigSchema } from '../schemaBuilder';
import { htmlToText } from '../../mcp/net';

/**
 * Email connector — reads recent messages from an IMAP mailbox via imapflow.
 * Works with Gmail app passwords, Outlook, Fastmail, any standard IMAP server.
 *
 * Only envelopes + the first text/plain (or text/html) body part are fetched;
 * attachments are intentionally out of scope for the connector (they belong to
 * the file pipeline). Read-only: nothing is ever deleted or marked on the
 * server beyond IMAP's implicit \Seen semantics of FETCH.
 */

const MAX_MESSAGES_DEFAULT = 25;

/** Walks an imapflow bodyStructure tree for the first readable text part. */
function findTextPart(node: any): { part: string; html: boolean } | null {
  if (!node || typeof node !== 'object') return null;
  const type = String(node.type || '').toLowerCase();
  const subtype = String(node.subtype || '').toLowerCase();
  if (type === 'text' && node.part) {
    return { part: String(node.part), html: subtype === 'html' };
  }
  for (const child of node.childNodes || []) {
    const found = findTextPart(child);
    if (found) return found;
  }
  return null;
}

export async function extractFromEmail(config: Record<string, unknown>): Promise<ConnectorExtraction> {
  const host = typeof config?.imapServer === 'string' ? config.imapServer.trim() : '';
  const user = typeof config?.emailAddress === 'string' ? config.emailAddress.trim() : '';
  const pass = typeof config?.appPassword === 'string' ? config.appPassword.trim() : '';
  const mailbox = (typeof config?.mailbox === 'string' && config.mailbox.trim()) || 'INBOX';
  const port = Number(config?.imapPort) || 993;
  if (!host || !user || !pass) throw new Error('خادم IMAP وعنوان البريد وكلمة المرور/رمز التطبيق مطلوبة.');

  const maxMessages = Math.min(Math.max(Number(config?.maxMessages) || MAX_MESSAGES_DEFAULT, 1), 100);

  // Lazy import keeps imapflow out of bundles that never touch email sync.
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user, pass },
    logger: false as any,
    emitLogs: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(mailbox);
    try {
      const total = (client.mailbox && client.mailbox.exists) || 0;
      if (total === 0) throw new Error(`صندوق "${mailbox}" فارغ.`);
      const from = Math.max(1, total - maxMessages + 1);

      const sections: string[] = [];
      let processed = 0;
      for await (const msg of client.fetch(`${from}:${total}`, {
        envelope: true,
        bodyStructure: true,
        uid: true,
      })) {
        const env = msg.envelope || {};
        const subject = env.subject || '(بدون موضوع)';
        const fromName = env.from?.[0]?.name || env.from?.[0]?.address || 'مرسل غير معروف';
        const date = env.date ? new Date(env.date).toISOString().slice(0, 16) : '';

        let body = '';
        const textPart = findTextPart(msg.bodyStructure);
        if (textPart?.part) {
          try {
            const download = await client.download(String(msg.uid), textPart.part, { uid: true });
            const chunks: Buffer[] = [];
            for await (const chunk of download.content as AsyncIterable<Buffer>) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const raw = Buffer.concat(chunks).toString('utf8');
            body = textPart.html ? htmlToText(raw) : raw;
          } catch {
            body = ''; // unreadable part — envelope still indexed
          }
        }

        sections.push(`## ${subject}\nمن: ${fromName} | التاريخ: ${date}\n\n${body.trim() || '(لا يوجد نص في الجسم)'}`);
        processed++;
      }

      if (processed === 0) throw new Error('لم تُجلب أي رسالة من الصندوق.');

      return {
        title: `[بريد] ${mailbox} — ${user}`,
        content: `# أرشيف بريد ${user} (${mailbox})\n\nعدد الرسائل: ${processed}\n\n${sections.join('\n\n---\n\n')}`,
        itemsProcessed: processed,
      };
    } finally {
      lock.release();
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (/authentication|invalid credentials|LOGIN/i.test(msg)) {
      throw new Error('مصادقة IMAP فاشلة — تحقق من العنوان وكلمة المرور (Gmail يتطلب رمز تطبيق App Password).');
    }
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(msg)) {
      throw new Error(`تعذر الوصول لخادم IMAP "${host}:${port}" — تحقق من العنوان والمنفذ.`);
    }
    throw new Error(`فشل جلب البريد: ${msg}`);
  } finally {
    try {
      await client.logout();
    } catch {
      /* connection may already be closed */
    }
  }
}

const emailFields: ConnectorFieldDescriptor[] = [
  {
    key: 'emailAddress',
    labelAr: 'عنوان البريد الإلكتروني',
    labelEn: 'Email Address',
    type: 'text',
    required: true,
    placeholder: 'team@company.com',
  },
  {
    key: 'appPassword',
    labelAr: 'كلمة المرور / رمز التطبيق',
    labelEn: 'Password / App Password',
    type: 'password',
    required: true,
    secret: true,
    helpAr: 'Gmail: أنشئ App Password من حساب Google → Security. لا تعمل كلمة المرور العادية مع 2FA.',
    helpEn: 'Gmail: create an App Password (Google account → Security). Regular passwords fail with 2FA.',
  },
  {
    key: 'imapServer',
    labelAr: 'خادم IMAP',
    labelEn: 'IMAP Host',
    type: 'text',
    required: true,
    default: 'imap.gmail.com',
  },
  {
    key: 'imapPort',
    labelAr: 'منفذ IMAP',
    labelEn: 'IMAP Port',
    type: 'number',
    required: false,
    default: 993,
  },
  {
    key: 'mailbox',
    labelAr: 'اسم الصندوق',
    labelEn: 'Mailbox Name',
    type: 'text',
    required: false,
    default: 'INBOX',
  },
  {
    key: 'maxMessages',
    labelAr: 'الحد الأقصى للرسائل',
    labelEn: 'Max Messages',
    type: 'number',
    required: false,
    default: 25,
  },
];

export const emailConnector: ConnectorDescriptor = {
  type: 'email',
  nameAr: 'صندوق البريد الإلكتروني (IMAP)',
  nameEn: 'Email Inbox (IMAP)',
  descriptionAr: 'قراءة الرسائل الحديثة من أي خادم IMAP (Gmail/Outlook/غيرها) وفهرسة نصوصها.',
  descriptionEn: 'Read recent messages from any IMAP server (Gmail/Outlook/others) and index their text.',
  category: 'workplace',
  iconName: 'Mail',
  defaultSchedule: '0 */2 * * *',
  supportsSchedule: true,
  fields: emailFields,
  configSchema: buildConfigSchema(emailFields),
  extract: extractFromEmail,
};
