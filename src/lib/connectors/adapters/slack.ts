import type { ConnectorDescriptor, ConnectorFieldDescriptor, ConnectorExtraction } from '../types';
import { buildConfigSchema } from '../schemaBuilder';

/**
 * Slack connector — archives a channel's recent messages via the Web API
 * (bot token xoxb-… with channels:history scope). User ids are resolved to
 * display names best-effort via users.list.
 */

const SLACK_API = 'https://slack.com/api';
const MAX_MESSAGES_DEFAULT = 200;

async function slackGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${SLACK_API}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 401) throw new Error('رمز Slack مرفوض (401) — تحقق من Bot Token.');
  if (!res.ok) throw new Error(`فشل طلب Slack (HTTP ${res.status}).`);
  const data = await res.json();
  if (!data?.ok) {
    const code = data?.error || 'unknown_error';
    if (code === 'channel_not_found') {
      throw new Error('القناة غير موجودة أو البوت غير مدعو إليها (channel_not_found).');
    }
    if (code === 'not_authed' || code === 'invalid_auth') {
      throw new Error('مصادقة Slack فاشلة — تحقق من الرمز ونطاقات الصلاحية.');
    }
    throw new Error(`Slack API error: ${code}`);
  }
  return data;
}

export async function extractFromSlack(config: Record<string, unknown>): Promise<ConnectorExtraction> {
  const channelId = typeof config?.channelId === 'string' ? config.channelId.trim() : '';
  const botToken = typeof config?.botToken === 'string' ? config.botToken.trim() : '';
  if (!channelId) throw new Error('معرف قناة Slack (channelId) مطلوب.');
  if (!botToken) throw new Error('رمز Slack Bot Token مطلوب.');

  const limit = Math.min(Math.max(Number(config?.maxMessages) || MAX_MESSAGES_DEFAULT, 10), 1000);

  // Best-effort user directory for readable attribution.
  const userNames = new Map<string, string>();
  try {
    const users = await slackGet('users.list?limit=500', botToken);
    for (const member of users.members || []) {
      const name = member?.real_name || member?.profile?.display_name || member?.name;
      if (member?.id && name) userNames.set(member.id, name);
    }
  } catch {
    /* attribution is cosmetic — history is the critical payload */
  }

  const history = await slackGet(
    `conversations.history?channel=${encodeURIComponent(channelId)}&limit=${limit}`,
    botToken,
  );
  const messages: any[] = (history.messages || []).slice().reverse(); // chronological
  if (messages.length === 0) throw new Error('القناة فارغة — لا توجد رسائل قابلة للأرشفة.');

  const lines = messages.map((m) => {
    const who = userNames.get(m.user || '') || m.user || 'مستخدم';
    const when = m.ts ? new Date(Number(m.ts) * 1000).toISOString().replace('T', ' ').slice(0, 16) : '';
    const text =
      typeof m.text === 'string'
        ? m.text.replace(/<@[^>]+>/g, (match: string) => {
            const id = match.slice(2, -1);
            return `@${userNames.get(id) || id}`;
          })
        : '';
    return `**${who}** (${when}):\n${text}`;
  });

  return {
    title: `[Slack] قناة ${channelId}`,
    content: `# أرشيف قناة Slack — ${channelId}\n\nعدد الرسائل: ${messages.length}\n\n${lines.join('\n\n')}`,
    sourceUrl: `https://slack.com/app_redirect?channel=${channelId}`,
    itemsProcessed: messages.length,
  };
}

const slackFields: ConnectorFieldDescriptor[] = [
  {
    key: 'channelId',
    labelAr: 'معرف القناة (Channel ID)',
    labelEn: 'Channel ID',
    type: 'text',
    required: true,
    placeholder: 'C0123456789',
    helpAr: 'انسخ المعرف من قائمة القناة → Copy link (آخر مقطع بعد /archives/).',
    helpEn: 'Copy the id from the channel menu → Copy link (last segment after /archives/).',
  },
  {
    key: 'botToken',
    labelAr: 'رمز Slack Bot Token',
    labelEn: 'Slack Bot Token (xoxb-…)',
    type: 'password',
    required: true,
    secret: true,
    helpAr: 'يتطلب نطاق channels:history ودعوة البوت للقناة.',
    helpEn: 'Requires channels:history scope and the bot invited to the channel.',
  },
  {
    key: 'maxMessages',
    labelAr: 'الحد الأقصى للرسائل',
    labelEn: 'Max Messages',
    type: 'number',
    required: false,
    default: 200,
  },
];

export const slackConnector: ConnectorDescriptor = {
  type: 'slack',
  nameAr: 'قنوات Slack',
  nameEn: 'Slack Channels',
  descriptionAr: 'أرشفة نقاشات القنوات للاستعلام الذكي عبر واجهة Slack Web API.',
  descriptionEn: 'Archive channel conversations via the Slack Web API.',
  category: 'workplace',
  iconName: 'MessageSquare',
  defaultSchedule: '0 */2 * * *',
  supportsSchedule: true,
  fields: slackFields,
  configSchema: buildConfigSchema(slackFields),
  extract: extractFromSlack,
};
