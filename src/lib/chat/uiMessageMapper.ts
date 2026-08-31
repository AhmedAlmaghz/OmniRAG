import type { JSONValue, UIMessage } from 'ai';
import type { Citation, MCPToolCall, Message } from '@/lib/types/omnirag';

/**
 * Bridges the AI SDK UI-message-stream world (Phase 4 streaming) and the
 * legacy `Message[]` contract that ChatStudio's rendering/export/persistence
 * layers consume.
 *
 * The chat/stream route emits, besides text and tool parts, structured data
 * parts: data-citations, data-blocked, data-pending-tool, data-tool-calls,
 * data-meta and data-suggestions. This module extracts them and derives the
 * legacy message list — including DETERMINISTIC artifact injection: skill
 * tools (create_chart / generate_image / create_office_document / build_report
 * / create_tutorial_guide) return ready-to-render markdown snippets in their
 * output, and we append any snippet the model forgot to embed so artifacts
 * always render.
 */

/** Shape of the trailing data-meta part emitted by chat/stream. */
export interface ChatStreamMeta {
  modelUsed: string;
  tokensUsed: { input: number; output: number };
  configured: boolean;
}

/** Structural view of tool / dynamic-tool UI parts (registry + custom tools). */
interface ToolPartLike {
  type: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

function asToolPart(part: UIMessage['parts'][number]): ToolPartLike | null {
  if (typeof part?.type !== 'string') return null;
  if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
    return part as unknown as ToolPartLike;
  }
  return null;
}

/** Name of a tool part: `tool-<name>` prefix or the dynamic-tool toolName. */
export function toolPartName(part: ToolPartLike): string {
  return part.type === 'dynamic-tool' ? part.toolName || 'dynamic' : part.type.slice('tool-'.length);
}

/** Reads the LAST data part with the given name (e.g. 'citations'). */
export function getDataPart<T = JSONValue>(ui: UIMessage, name: string): T | undefined {
  const wanted = `data-${name}`;
  for (let i = ui.parts.length - 1; i >= 0; i--) {
    const part = ui.parts[i] as unknown as { type?: string; data?: JSONValue };
    if (part && part.type === wanted) return part.data as T;
  }
  return undefined;
}

export function getCitations(ui: UIMessage): Citation[] | undefined {
  const raw = getDataPart<unknown>(ui, 'citations');
  return Array.isArray(raw) ? (raw as Citation[]) : undefined;
}

export function getChatMeta(ui: UIMessage): ChatStreamMeta | undefined {
  const raw = getDataPart<ChatStreamMeta>(ui, 'meta');
  return raw && typeof raw === 'object' && 'modelUsed' in raw ? raw : undefined;
}

export function getBlockedReason(ui: UIMessage): string | undefined {
  const raw = getDataPart<{ reason?: string }>(ui, 'blocked');
  return raw?.reason;
}

export function getPendingToolCall(ui: UIMessage): MCPToolCall | undefined {
  const raw = getDataPart<MCPToolCall>(ui, 'pending-tool');
  return raw && typeof raw === 'object' && 'scopedToolName' in raw ? raw : undefined;
}

export function getExecutedToolCalls(ui: UIMessage): MCPToolCall[] | undefined {
  const raw = getDataPart<unknown>(ui, 'tool-calls');
  return Array.isArray(raw) ? (raw as MCPToolCall[]) : undefined;
}

/**
 * Provider failure text carried by the stream's error part. The stream route
 * rewrites these via UIMessageStreamOptions.onError (quota, provider errors);
 * without surfacing it, a failed generation rendered as an EMPTY bubble while
 * the user waited through minutes of retry backoff.
 */
export function getErrorText(ui: UIMessage): string | undefined {
  const part = ui.parts.find((p) => p.type === 'error') as { type: 'error'; errorText?: string } | undefined;
  const text = part?.errorText;
  return typeof text === 'string' && text.trim() ? text.trim() : undefined;
}

/** Concatenated plain text of a UI message. */
export function extractText(ui: UIMessage): string {
  return ui.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n')
    .trim();
}

/**
 * Tool outputs of executed skills are JSON strings (the MCP bridge stringifies
 * results). Parses defensively; returns null for non-object outputs.
 */
function parseToolOutput(output: unknown): Record<string, unknown> | null {
  if (!output) return null;
  if (typeof output === 'object') return output as Record<string, unknown>;
  if (typeof output !== 'string') return null;
  try {
    const parsed = JSON.parse(output);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Ready-to-render markdown snippets produced by skill tools in this message:
 * chart fences, image embeds and download links.
 */
export function collectArtifactSnippets(ui: UIMessage): string[] {
  const snippets: string[] = [];
  for (const part of ui.parts) {
    const toolPart = asToolPart(part);
    if (!toolPart || toolPart.state !== 'output-available') continue;
    const output = parseToolOutput(toolPart.output);
    if (!output) continue;
    for (const field of ['markdownFence', 'markdownImage', 'markdownLink'] as const) {
      const value = output[field];
      if (typeof value === 'string' && value.trim()) snippets.push(value.trim());
    }
  }
  return snippets;
}

export interface LegacyMapContext {
  tenantId: string;
  conversationId: string;
  /**
   * UIMessage carries no timestamp; this map assigns each message id a stable
   * createdAt the first time it is mapped so re-renders don't drift the clock.
   */
  timestamps: Map<string, string>;
}

function stableCreatedAt(timestamps: Map<string, string>, id: string): string {
  const existing = timestamps.get(id);
  if (existing) return existing;
  const now = new Date().toISOString();
  timestamps.set(id, now);
  return now;
}

/** Maps one streamed UI message to the legacy Message contract. */
export function mapUiMessageToLegacy(ui: UIMessage, ctx: LegacyMapContext): Message | null {
  if (ui.role !== 'user' && ui.role !== 'assistant') return null;

  let content = extractText(ui);

  const message: Message = {
    id: ui.id,
    tenantId: ctx.tenantId,
    conversationId: ctx.conversationId,
    role: ui.role,
    content,
    createdAt: stableCreatedAt(ctx.timestamps, ui.id),
  };

  if (ui.role === 'assistant') {
    // Provider failures arrive as an error part with NO text part: surface
    // them as the message content so the bubble explains itself instead of
    // rendering empty after a long retry wait.
    const errorText = getErrorText(ui);
    if (errorText && !content) {
      content = `⚠️ ${errorText}`;
      message.content = content;
    }

    // Deterministic artifact injection: append any skill snippet the model
    // did not embed verbatim so charts/images/files always render.
    for (const snippet of collectArtifactSnippets(ui)) {
      if (!content.includes(snippet)) {
        content = content ? `${content}\n\n${snippet}` : snippet;
      }
    }
    message.content = content;

    const citations = getCitations(ui);
    if (citations && citations.length > 0) message.citations = citations;

    const meta = getChatMeta(ui);
    if (meta) {
      if (meta.modelUsed) message.modelUsed = meta.modelUsed;
      if (meta.tokensUsed) message.tokensUsed = meta.tokensUsed;
    }
  }

  return message;
}

/** Maps a full streamed conversation to the legacy Message[] contract. */
export function mapUiMessagesToLegacy(uiMessages: UIMessage[], ctx: LegacyMapContext): Message[] {
  const mapped: Message[] = [];
  for (const ui of uiMessages) {
    const legacy = mapUiMessageToLegacy(ui, ctx);
    if (legacy) mapped.push(legacy);
  }
  return mapped;
}

/**
 * Converts persisted legacy messages back into UI messages so useChat can own
 * the conversation state after loading a saved conversation.
 */
export function legacyMessagesToUi(messages: Message[]): UIMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const parts: UIMessage['parts'] = [{ type: 'text', text: m.content }];
      if (m.role === 'assistant') {
        if (m.citations && m.citations.length > 0) {
          parts.push({ type: 'data-citations', data: m.citations as unknown as JSONValue });
        }
        if (m.modelUsed || m.tokensUsed) {
          parts.push({
            type: 'data-meta',
            data: {
              modelUsed: m.modelUsed || '',
              tokensUsed: m.tokensUsed || { input: 0, output: 0 },
              configured: true,
            } as unknown as JSONValue,
          });
        }
      }
      return { id: m.id, role: m.role, parts } as UIMessage;
    });
}

/** Text of the last user message — the `prompt` the chat/stream route expects. */
export function extractLastUserText(uiMessages: UIMessage[]): string {
  for (let i = uiMessages.length - 1; i >= 0; i--) {
    if (uiMessages[i].role === 'user') return extractText(uiMessages[i]);
  }
  return '';
}
