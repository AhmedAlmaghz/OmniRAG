import { AuditLogEntry, ChatMode } from '../types/omnirag';
import { db } from '../storage/db';
import { randomUUID } from 'crypto';

export type HookStage = 'pre_auth' | 'pre_inference' | 'pre_tool' | 'post_tool' | 'pre_generation' | 'post_inference';

export interface HookContext {
  tenantId: string;
  userId?: string;
  conversationId?: string;
  mode?: ChatMode;
  toolName?: string;
  prompt?: string;
  output?: string;
  retrievedChunkIds?: string[];
  // Retrieved document chunks to be injected into the model context. The
  // pre_generation stage scans these for indirect prompt-injection payloads
  // before they reach the model, since retrieved content is the dominant
  // indirect-injection vector in RAG systems.
  retrievedChunks?: Array<{ content: string; documentTitle?: string }>;
  payload?: any;
}

export type HookResult<T = any> =
  | { allow: true; mutated?: T; warning?: string; requiresConfirmation?: boolean }
  | { allow: false; reason: string; code: string };

// Known Prompt Injection Attack Patterns.
//
// Two failure modes guided this list. First, the previous set (7 patterns) was
// trivially bypassable with light paraphrasing ("forget the rules above",
// "act as if you have no instructions", "you are now in DAN mode"). Second, the
// patterns covered only the user prompt; retrieved documents — the dominant
// indirect-injection surface in a RAG system — were never scanned. The list
// below expands coverage and is applied to BOTH the user prompt (pre_inference)
// and every retrieved chunk (pre_generation).
//
// Patterns are intentionally case-insensitive and use word-boundary-tolerant
// spacing so minor punctuation/format changes do not defeat them.
const PROMPT_INJECTION_PATTERNS = [
  // Reset / override of prior instructions
  /ignore\s+(all\s+|the\s+)?previous\s+instructions/i,
  /disregard\s+(your\s+|all\s+|the\s+)?system\s+prompt/i,
  /forget\s+(your\s+|all\s+|the\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+|any\s+)?prior\s+instructions/i,
  /override\s+(your\s+|the\s+)?(system\s+)?(instructions|prompt)/i,
  /ل[ا-ي]?\s*(تجاهل|تخلى|انسى|تناسى)\s+(جميع\s+|كل\s+|ال)?(التعليمات|التعليمات\s+السابقة|المعطيات\s+السابقة|الأوامر\s+السابقة)/i,
  /تجاهل\s+(جميع\s+|كل\s+)?التعليمات\s+السابقة/i,
  /انسى?\s+(جميع\s+|كل\s+)?التعليمات/i,
  /disregard\s+(everything|all)\s+(above|before)/i,
  /start\s+(a\s+)?new\s+(conversation|session|task)\s+without\s+(your|any)\s+(prior|previous)\s+(instructions|rules|context)/i,

  // System-prompt / secret exfiltration
  /reveal\s+((the|your)\s+)?system\s+prompt/i,
  /show\s+(me\s+)?((your|the)\s+)?(system\s+)?prompt/i,
  /print\s+((your|the)\s+)?system\s+(prompt|instructions)/i,
  /dump\s+(all\s+|the\s+)?api\s+keys/i,
  /(reveal|expose|share|leak|send)\s+(the\s+|all\s+|your\s+)?(api\s+)?keys/i,
  /اعرض\s+مفاتيح\s+السر/i,
  /(reveal|expose|share|leak|send)\s+(your|the)\s+secret/i,

  // Persona / jailbreak appends ("injection appenders")
  /\b(DAN|do\s+anything\s+now)\b/i,
  /(act|pretend|simulate)\s+as\s+if\s+you\s+(have\s+)?no\s+(instructions|rules|constraints)/i,
  /you\s+are\s+now\s+in\s+(developer|jailbreak|unrestricted|root)\s+mode/i,
  /(developer|jailbreak|unrestricted|root)\s+mode\s+(enabled|activated)/i,
  /enable\s+(developer|jailbreak|root)\s+mode/i,
  /\bjailbreak\b/i,
  /\bno\s+restrictions?\b/i,
  /\bالأوامر\s+(المطلقة|بدون\s+قيود)\b/i,
  /تصرّف\s+كأنك\s+بدون\s+قيود/i,

  // Tenant / isolation bypass
  /bypass\s+tenant\s+isolation/i,
  /(access|fetch|query)\s+(all\s+|other\s+)?tenants?/i,
  /تجاوز\s+عزل\s+المستأجر/i,
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

      case 'pre_generation':
        return await this.runPreGenerationHooks(ctx);

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

  // H2. ModeGuard & H6. InputSanitizer — scans the user prompt.
  // Scanning of retrieved document chunks happens at the pre_generation stage
  // (see runPreGenerationHooks) so that indirect injection embedded in retrieved
  // context is caught before it reaches the model.
  private static async runPreInferenceHooks(ctx: HookContext): Promise<HookResult> {
    const prompt = ctx.prompt || '';

    // H6: InputSanitizer
    const blockedPattern = this.findInjectionPattern(prompt);
    if (blockedPattern) {
      await this.logAudit(
        ctx,
        'pre_inference',
        'blocked',
        `H6 InputSanitizer: Detected Prompt Injection pattern: ${blockedPattern.source}`,
      );
      return {
        allow: false,
        reason: 'تم اكتشاف محاولة تجاوز أو هجوم حقن (Prompt Injection Defense). تم رفض الطلب حتمياً.',
        code: '400_PROMPT_INJECTION_DETECTED',
      };
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

  // H6b. RetrievedContentSanitizer — scans retrieved document chunks for prompt
  // injection before they are injected into the model context. Returns the
  // sanitized chunk list for downstream use so a caller could optionally drop
  // or redact offending chunks. This implementation BLOCKS the whole generation
  // when an injection pattern is found in any chunk, which is the safe default
  // for a deterministic policy engine: a hostile document that can freely
  // override the model's instructions cannot be partially trusted.
  private static async runPreGenerationHooks(ctx: HookContext): Promise<HookResult> {
    const chunks = ctx.retrievedChunks || [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const text = chunk?.content ?? '';
      const blockedPattern = this.findInjectionPattern(text);
      if (blockedPattern) {
        await this.logAudit(
          ctx,
          'pre_generation',
          'blocked',
          `H6b RetrievedContentSanitizer: Detected Prompt Injection pattern in chunk ${i}${
            chunk?.documentTitle ? ` (${chunk.documentTitle})` : ''
          }: ${blockedPattern.source}`,
        );
        return {
          allow: false,
          reason:
            'تم اكتشاف محتوى مسترجَن يحتوي على تعليمات حقن (Indirect Prompt Injection). تم رفض الطلب حتمياً حمايةً للنموذج.',
          code: '400_INDIRECT_PROMPT_INJECTION_DETECTED',
        };
      }
    }
    await this.logAudit(ctx, 'pre_generation', 'success', 'H6b RetrievedContentSanitizer: Chunks clean');
    return { allow: true, mutated: chunks };
  }

  // Helpers

  /**
   * Return the first injection pattern that matches the given text, or null.
   * Uses a fresh non-global regex test per call so `lastIndex` state from any
   * prior `.replace()` on a global regex cannot silently skip matches here.
   */
  private static findInjectionPattern(text: string): RegExp | null {
    if (!text) return null;
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        // Reset lastIndex defensively — patterns here are non-global, but a
        // caller could mutate them. `.test()` on a global regex mutates state.
        pattern.lastIndex = 0;
        return pattern;
      }
    }
    return null;
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
