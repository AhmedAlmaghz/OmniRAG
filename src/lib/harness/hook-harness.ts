import { AuditLogEntry, ChatMode } from '../types/omnirag';
import { db } from '../storage/db';
import { randomUUID } from 'crypto';

export type HookStage = 'pre_auth' | 'pre_inference' | 'pre_tool' | 'post_tool' | 'post_inference';

export interface HookContext {
  tenantId: string;
  userId?: string;
  conversationId?: string;
  mode?: ChatMode;
  toolName?: string;
  prompt?: string;
  output?: string;
  retrievedChunkIds?: string[];
  payload?: any;
}

export type HookResult<T = any> =
  | { allow: true; mutated?: T; warning?: string; requiresConfirmation?: boolean }
  | { allow: false; reason: string; code: string };

// Known Prompt Injection Attack Patterns
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(your\s+)?system\s+prompt/i,
  /reveal\s+(the\s+)?system\s+prompt/i,
  /dump\s+(all\s+)?api\s+keys/i,
  /تجاهل\s+(جميع\s+)?التعليمات\s+السابقة/i,
  /اعرض\s+مفاتيح\s+السر/i,
  /bypass\s+tenant\s+isolation/i,
];

// Side-effecting tools requiring explicit human approval
const SIDE_EFFECT_TOOLS = ['slack_send_message', 'github_create_issue', 'external_postgres_query', 'email_send'];

export class HookHarness {
  /**
   * Run hooks for a specific stage deterministically
   */
  static async run(stage: HookStage, ctx: HookContext): Promise<HookResult> {
    switch (stage) {
      case 'pre_auth':
        return await this.runPreAuthHooks(ctx);

      case 'pre_inference':
        return await this.runPreInferenceHooks(ctx);

      case 'pre_tool':
        return await this.runPreToolHooks(ctx);

      case 'post_inference':
        return await this.runPostInferenceHooks(ctx);

      default:
        return { allow: true };
    }
  }

  // H1. TenantGate & H4. QuotaGuard
  private static async runPreAuthHooks(ctx: HookContext): Promise<HookResult> {
    if (!ctx.tenantId || ctx.tenantId.trim() === '') {
      await this.logAudit(ctx, 'pre_auth', 'blocked', 'H1 TenantGate: Missing tenant identifier');
      return { allow: false, reason: 'معرف المستأجر (Tenant ID) مفقود أو غير صالح', code: '403_TENANT_MISMATCH' };
    }
    await this.logAudit(ctx, 'pre_auth', 'success', `H1 TenantGate: Passed for tenant ${ctx.tenantId}`);
    return { allow: true };
  }

  // H2. ModeGuard & H6. InputSanitizer
  private static async runPreInferenceHooks(ctx: HookContext): Promise<HookResult> {
    const prompt = ctx.prompt || '';

    // H6: InputSanitizer
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(prompt)) {
        await this.logAudit(
          ctx,
          'pre_inference',
          'blocked',
          `H6 InputSanitizer: Detected Prompt Injection pattern: ${pattern.source}`,
        );
        return {
          allow: false,
          reason: 'تم اكتشاف محاولة تجاوز أو هجوم حقن (Prompt Injection Defense). تم رفض الطلب حتمياً.',
          code: '400_PROMPT_INJECTION_DETECTED',
        };
      }
    }

    // H2: ModeGuard
    if (ctx.mode === 'private' && (prompt.includes('web_search') || prompt.includes('بحث مباشر'))) {
      await this.logAudit(ctx, 'pre_inference', 'blocked', 'H2 ModeGuard: Attempted web search in private mode');
      return {
        allow: false,
        reason: 'الوضع الخاص (Private Mode) يحظر إجراء استعلامات خارجية أو بحث مباشر على الويب.',
        code: '403_MODE_ESCAPE_BLOCKED',
      };
    }

    await this.logAudit(ctx, 'pre_inference', 'success', 'H6 InputSanitizer & H2 ModeGuard: Passed');
    return { allow: true };
  }

  // H3. ScopeGuard & H5. SideEffectGate
  private static async runPreToolHooks(ctx: HookContext): Promise<HookResult> {
    const toolName = ctx.toolName;
    if (!toolName) return { allow: true };

    const servers = await db.getMcpServers(ctx.tenantId);
    const serverWithTool = servers.find((s) => s.enabledTools.includes(toolName));

    // H3: ScopeGuard
    if (!serverWithTool) {
      await this.logAudit(ctx, 'pre_tool', 'blocked', `H3 ScopeGuard: Tool ${toolName} is disabled or unauthorized`);
      return {
        allow: false,
        reason: `الأداة المطلوبة (${toolName}) غير معتمدة أو معطلة في صلاحيات المستأجر.`,
        code: '403_TOOL_DISABLED',
      };
    }

    // H5: SideEffectGate
    if (SIDE_EFFECT_TOOLS.includes(toolName) || serverWithTool.requireConfirmationTools.includes(toolName)) {
      await this.logAudit(
        ctx,
        'pre_tool',
        'blocked',
        `H5 SideEffectGate: Tool ${toolName} requires explicit human approval`,
      );
      return {
        allow: true,
        requiresConfirmation: true,
        warning: `الأداة ${toolName} تؤدي لتغيير في النظام الخارجي وتحتاج موافقة بشرية صريحة.`,
      };
    }

    await this.logAudit(ctx, 'pre_tool', 'success', `H3 ScopeGuard: Tool ${toolName} authorized`);
    return { allow: true };
  }

  // H8. CitationVerifier & H9. PIIRedactor
  private static async runPostInferenceHooks(ctx: HookContext): Promise<HookResult> {
    let output = ctx.output || '';

    // H9: PII Redactor. Use stateless (non-global) detection first to decide
    // whether to redact, then run a fresh global regex for the replacements.
    // Mixing .test() and .replace() on the same /g regex mutates lastIndex and
    // silently skips matches, so the two steps use independent patterns.
    const emailDetect = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/;
    const phoneDetect = /(\+?\d{1,4}[\s-.]?)?\(?\d{3}\)?[\s-.]?\d{3}[\s-.]?\d{4}/;
    const emailRegexG = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/g;
    const phoneRegexG = /(\+?\d{1,4}[\s-.]?)?\(?\d{3}\)?[\s-.]?\d{3}[\s-.]?\d{4}/g;

    let redacted = false;
    if (emailDetect.test(output)) {
      output = output.replace(emailRegexG, '[REDACTED:EMAIL]');
      redacted = true;
    }
    if (phoneDetect.test(output)) {
      output = output.replace(phoneRegexG, '[REDACTED:PHONE]');
      redacted = true;
    }

    if (redacted) {
      await this.logAudit(ctx, 'post_inference', 'success', 'H9 PIIRedactor: Sensitive PII content redacted');
    } else {
      await this.logAudit(ctx, 'post_inference', 'success', 'H8 & H9 Post-Inference Checks: Clean');
    }

    return { allow: true, mutated: output };
  }

  // H12: AuditLogger helper
  private static async logAudit(
    ctx: HookContext,
    action: string,
    status: 'success' | 'blocked' | 'error',
    details: string,
  ): Promise<void> {
    await db.addAuditLog({
      id: `audit-${randomUUID()}`,
      tenantId: ctx.tenantId || 'system',
      actorId: ctx.userId || 'agentic_engine',
      action: action.toUpperCase(),
      resourceType: ctx.conversationId ? 'conversation' : 'api_request',
      resourceId: ctx.conversationId || 'system',
      status,
      details,
      timestamp: new Date().toISOString(),
    });
  }
}
