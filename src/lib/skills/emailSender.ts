import { getEnv } from '@/lib/env/runtimeEnv';

/**
 * Email skill engine — sends real email through the first configured provider:
 *   1. Resend (RESEND_API_KEY)
 *   2. SMTP   (SMTP_HOST [+ SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE])
 *
 * Sender address comes from EMAIL_FROM (or SMTP_FROM / RESEND_FROM).
 * When nothing is configured the result is an honest, structured failure —
 * the tool NEVER pretends an email was sent.
 *
 * The MCP tool wrapping this engine is flagged requireConfirmation, so the
 * human approval gate runs before execute() is ever reached.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_RECIPIENTS = 10;
const MAX_BODY_CHARS = 50000;

export interface SendEmailParams {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  html?: boolean;
}

export interface SendEmailResult {
  success: boolean;
  simulated: false;
  provider?: 'resend' | 'smtp';
  messageId?: string;
  error?: string;
  recipients?: string[];
}

function parseRecipients(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw.map((r) => String(r).trim())
    : String(raw || '')
        .split(/[,;،]/)
        .map((r) => r.trim());
  return list.filter(Boolean);
}

export function resolveEmailProvider(): 'resend' | 'smtp' | null {
  if (getEnv('RESEND_API_KEY')) return 'resend';
  if (getEnv('SMTP_HOST')) return 'smtp';
  return null;
}

function resolveFromAddress(provider: 'resend' | 'smtp'): string | null {
  return getEnv('EMAIL_FROM') || getEnv(provider === 'resend' ? 'RESEND_FROM' : 'SMTP_FROM') || null;
}

/** Validates recipients/subject/body; throws readable Arabic errors. */
export function validateEmailParams(params: SendEmailParams): void {
  const to = params.to || [];
  if (to.length === 0) throw new Error('مستلم واحد على الأقل مطلوب (to)');
  if (to.length > MAX_RECIPIENTS) throw new Error(`الحد الأقصى ${MAX_RECIPIENTS} مستلمين لكل إرسال`);
  const invalid = [...to, ...(params.cc || [])].filter((addr) => !EMAIL_PATTERN.test(addr));
  if (invalid.length > 0) {
    throw new Error(`عناوين بريد غير صالحة: ${invalid.join('، ')}`);
  }
  if (!params.subject?.trim()) throw new Error('موضوع الرسالة (subject) مطلوب');
  if (!params.body?.trim()) throw new Error('نص الرسالة (body) مطلوب');
  if (params.body.length > MAX_BODY_CHARS) {
    throw new Error(`نص الرسالة يتجاوز الحد الأقصى (${MAX_BODY_CHARS} حرفا)`);
  }
}

async function sendViaResend(params: SendEmailParams, from: string): Promise<SendEmailResult> {
  const apiKey = getEnv('RESEND_API_KEY');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: params.to,
        cc: params.cc && params.cc.length > 0 ? params.cc : undefined,
        subject: params.subject,
        ...(params.html ? { html: params.body } : { text: params.body }),
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        simulated: false,
        error: `فشل الإرسال عبر Resend (HTTP ${res.status}): ${data?.message || res.statusText}`,
      };
    }
    return { success: true, simulated: false, provider: 'resend', messageId: data?.id, recipients: params.to };
  } catch (err: any) {
    return { success: false, simulated: false, error: `فشل الإرسال عبر Resend: ${err?.message || err}` };
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaSmtp(params: SendEmailParams, from: string): Promise<SendEmailResult> {
  const nodemailer = await import('nodemailer');
  const host = getEnv('SMTP_HOST');
  const port = Number(getEnv('SMTP_PORT') || 587);
  const user = getEnv('SMTP_USER');
  const pass = getEnv('SMTP_PASS');
  const secure = getEnv('SMTP_SECURE') === 'true' || port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    ...(user ? { auth: { user, pass: pass || undefined } } : {}),
  });

  try {
    const info = await transporter.sendMail({
      from,
      to: params.to.join(', '),
      cc: params.cc && params.cc.length > 0 ? params.cc.join(', ') : undefined,
      subject: params.subject,
      ...(params.html ? { html: params.body } : { text: params.body }),
    });
    return { success: true, simulated: false, provider: 'smtp', messageId: info.messageId, recipients: params.to };
  } catch (err: any) {
    return { success: false, simulated: false, error: `فشل الإرسال عبر SMTP (${host}): ${err?.message || err}` };
  } finally {
    transporter.close();
  }
}

/**
 * Sends the email through the first configured provider.
 * Returns a structured honest result; throws only on invalid parameters.
 */
export async function sendSkillEmail(rawParams: {
  to: unknown;
  cc?: unknown;
  subject: string;
  body: string;
  html?: boolean;
}): Promise<SendEmailResult> {
  const params: SendEmailParams = {
    to: parseRecipients(rawParams.to),
    cc: parseRecipients(rawParams.cc),
    subject: String(rawParams.subject || ''),
    body: String(rawParams.body || ''),
    html: Boolean(rawParams.html),
  };
  validateEmailParams(params);

  const provider = resolveEmailProvider();
  if (!provider) {
    return {
      success: false,
      simulated: false,
      error:
        'لا يوجد مزود بريد مهيأ. أضف RESEND_API_KEY (خدمة Resend) أو إعدادات SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS ثم أعد المحاولة.',
    };
  }

  const from = resolveFromAddress(provider);
  if (!from) {
    return {
      success: false,
      simulated: false,
      error: `عنوان المرسل غير مهيأ: أضف EMAIL_FROM (مثل "OmniRAG <no-reply@example.com>") لتفعيل الإرسال عبر ${provider === 'resend' ? 'Resend' : 'SMTP'}.`,
    };
  }

  return provider === 'resend' ? sendViaResend(params, from) : sendViaSmtp(params, from);
}
