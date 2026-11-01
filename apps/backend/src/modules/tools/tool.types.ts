import { z } from "zod";
import type { ToolsetDefinition } from "./catalog/toolsets.js";
import type { AgentRunContext } from "../agent-runs/agent-runs.types.js";

export const TOOL_PERMISSIONS = ["read", "plan", "propose", "apply", "skill"] as const;
export type ToolPermission = (typeof TOOL_PERMISSIONS)[number];

/** Tool names are `namespace.tool_name`, for example `editor.get_context`. */
export const TOOL_NAME_PATTERN = /^[a-z_]+\.[a-z_]+$/;

/**
 * A tool the agent may call. `execute` receives already validated input, so
 * the handler never sees unparsed model output.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly namespace: string;
  readonly description: string;
  readonly permission: ToolPermission;
  readonly parameters: z.ZodObject;
  requiresApproval(args: unknown, context: AgentRunContext): Promise<boolean>;
  execute(args: unknown, context: AgentRunContext): Promise<unknown>;
}

export interface ToolSpec<S extends z.ZodObject> {
  readonly name: string;
  readonly description: string;
  readonly permission: ToolPermission;
  readonly parameters: S;
  readonly requiresApproval?: (input: z.output<S>, context: AgentRunContext) => boolean | Promise<boolean>;
  readonly execute: (input: z.output<S>, context: AgentRunContext) => unknown;
}

/** Builds a tool definition whose input and output are typed by its Zod schema. */
export function defineTool<S extends z.ZodObject>(spec: ToolSpec<S>): ToolDefinition {
  if (!TOOL_NAME_PATTERN.test(spec.name)) throw new Error(`Invalid tool name "${spec.name}"`);
  const [namespace = ""] = spec.name.split(".");

  return {
    name: spec.name,
    namespace,
    description: spec.description,
    permission: spec.permission,
    parameters: spec.parameters,
    async requiresApproval(args, context) {
      if (!spec.requiresApproval) return false;
      const parsed = spec.parameters.safeParse(args);
      // Invalid input is rejected by execute; approval is only asked for valid input.
      if (!parsed.success) return false;
      return spec.requiresApproval(parsed.data, context);
    },
    async execute(args, context) {
      const input = spec.parameters.parse(args);
      return spec.execute(input, context);
    },
  };
}

/** Model-facing names cannot contain dots, so `editor.get_context` becomes `editor__get_context`. */
export const PROVIDER_NAME_SEPARATOR = "__";

export function toProviderToolName(name: string): string {
  return name.replace(".", PROVIDER_NAME_SEPARATOR);
}

/** Reverses `toProviderToolName`. Names without the separator are returned unchanged. */
export function fromProviderToolName(name: string): string {
  return name.replace(PROVIDER_NAME_SEPARATOR, ".");
}

/** Public, serialisable view of a tool: what an agent sees, without handlers. */
export interface ToolDescriptor {
  readonly name: string;
  readonly providerName: string;
  readonly namespace: string;
  readonly description: string;
  readonly permission: ToolPermission;
  /** JSON Schema of the arguments, as documentation. The SDK derives the strict provider schema itself. */
  readonly inputSchema: Record<string, unknown>;
}

export function describeTool(definition: ToolDefinition): ToolDescriptor {
  return {
    name: definition.name,
    providerName: toProviderToolName(definition.name),
    namespace: definition.namespace,
    description: definition.description,
    permission: definition.permission,
    inputSchema: z.toJSONSchema(definition.parameters, { io: "input", unrepresentable: "any" }),
  };
}

export interface ToolCatalogView {
  readonly tools: readonly ToolDescriptor[];
  readonly toolsets: readonly ToolsetDefinition[];
}
