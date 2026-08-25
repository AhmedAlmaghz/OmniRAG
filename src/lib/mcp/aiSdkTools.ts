import { tool as aiTool, dynamicTool, jsonSchema, type ToolSet } from 'ai';
import { z } from 'zod';
import { type MCPToolDefinition, getToolDefinition } from './registry/tools';
import type { ToolExecutionOutcome } from './dispatcher';

/**
 * Bridges the central MCP world into Vercel AI SDK v7 native tool-calling.
 *
 * The MCP registry (registry/tools.ts) stays the SINGLE source of truth for
 * tool schemas; this module derives AI SDK `tool()` definitions (zod input
 * schemas) from it so the agentic chat loop uses the SDK's native multi-step
 * tool loop instead of hand-rolled Gemini FunctionDeclarations. Tenant-defined
 * custom tool schemas (AI-generated / remote servers) are exposed through
 * `dynamicTool` + raw JSON Schema.
 *
 * Human-in-the-loop is preserved: tools flagged for confirmation never
 * actually execute here — their execute() returns a PENDING marker payload
 * that the caller detects after generation to surface an approval request,
 * mirroring the protocol gateway's requireConfirmation semantics.
 */

export const MCP_PENDING_APPROVAL_MARKER = '__mcpPendingApproval';

/** Minimal shape of tenant-stored custom tool schemas (see server-factory). */
export interface CustomToolSchema {
  toolName?: string;
  description?: string;
  properties?: Record<string, { type: string; description: string; enum?: string[] }>;
  required?: string[];
}

export interface McpToolBuildOptions {
  tenantId: string;
  /** Tools that must surface a human approval request before executing. */
  requireApprovalTools: Iterable<string>;
  /** Executes a tool through the unified MCP dispatcher (audit/timeouts/sim stamps). */
  runSafely: (toolName: string, args: Record<string, any>) => Promise<ToolExecutionOutcome>;
  /** Called after every auto-executed (non-approval) tool call. */
  onAutoExecuted?: (info: {
    toolName: string;
    args: Record<string, any>;
    outputResult: any;
    latencyMs: number;
    isError: boolean;
    hasSideEffect: boolean;
  }) => void;
  /** Called INSTEAD of executing when a tool requires human approval. */
  onPendingApproval?: (toolName: string, args: Record<string, any>) => void;
}

function propToZod(prop: { type: string; description: string; enum?: string[] }): z.ZodTypeAny {
  const described = <T extends z.ZodTypeAny>(schema: T): z.ZodTypeAny =>
    prop.description ? schema.describe(prop.description) : schema;

  switch (prop.type) {
    case 'number':
    case 'integer':
      return described(z.number());
    case 'boolean':
      return described(z.boolean());
    default:
      if (prop.enum && prop.enum.length > 0) {
        return described(z.enum(prop.enum as [string, ...string[]]));
      }
      return described(z.string());
  }
}

function registryInputSchema(def: MCPToolDefinition): z.ZodObject<any> {
  const required = new Set(def.parameters.required || []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [propName, prop] of Object.entries(def.parameters.properties || {})) {
    const fieldSchema = propToZod(prop);
    shape[propName] = required.has(propName) ? fieldSchema : fieldSchema.optional();
  }
  return z.object(shape);
}

function normalizeJsonSchemaLike(cs: CustomToolSchema): Record<string, any> {
  return {
    type: 'object',
    properties: cs.properties || {},
    required: cs.required || [],
  };
}

/**
 * Builds an AI SDK ToolSet for the given tenant-enabled MCP tools. Names not
 * present in the central registry are treated as custom/remote tools and are
 * exposed dynamically from their stored JSON-like schema.
 */
export function buildTenantMcpTools(
  toolNames: string[],
  customSchemas: Record<string, CustomToolSchema>,
  options: McpToolBuildOptions,
): ToolSet {
  const approvalRequired = new Set(options.requireApprovalTools);
  const toolSet: ToolSet = {};
  const seen = new Set<string>();

  for (const toolName of toolNames) {
    if (seen.has(toolName)) continue;
    seen.add(toolName);

    const def = getToolDefinition(toolName);
    const cs = customSchemas[toolName];

    const description = def?.description || cs?.description || `أداة MCP مخصصة برمجية: ${toolName}`;

    const execute = async (args: Record<string, any>): Promise<string> => {
      // Registry tools honor their declared confirmation flag; custom/remote
      // tools (no registry definition) default to approval-required, matching
      // the protocol gateway's hasSideEffect:true listing for them.
      const isApprovalRequired = approvalRequired.has(toolName) || (def ? def.requireConfirmation === true : true);

      if (isApprovalRequired) {
        // Never execute side-effect tools silently — surface the approval
        // request to the caller and hand back a structured pending payload.
        options.onPendingApproval?.(toolName, args);
        return JSON.stringify({
          [MCP_PENDING_APPROVAL_MARKER]: true,
          toolName,
          inputParams: args,
          message: 'هذه الأداة تتطلب موافقة بشرية قبل التنفيذ.',
        });
      }

      const outcome = await options.runSafely(toolName, args);
      options.onAutoExecuted?.({
        toolName,
        args,
        outputResult: outcome.result,
        latencyMs: outcome.latencyMs,
        isError: outcome.isError,
        hasSideEffect: def?.hasSideEffect ?? false,
      });

      return JSON.stringify(
        outcome.isError
          ? { mcpToolFailed: true, error: outcome.errorMessage || 'فشل تنفيذ الأداة', detail: outcome.result }
          : outcome.result,
      );
    };

    if (def) {
      toolSet[toolName] = aiTool({
        description,
        inputSchema: registryInputSchema(def),
        execute: execute as (args: any) => Promise<string>,
      });
    } else {
      // Custom / AI-generated / remote tool: expose its stored JSON schema
      // directly through a dynamic tool.
      toolSet[toolName] = dynamicTool({
        description,
        inputSchema: jsonSchema<any>(normalizeJsonSchemaLike(cs || {})),
        execute: execute as (args: any) => Promise<string>,
      });
    }
  }

  return toolSet;
}
