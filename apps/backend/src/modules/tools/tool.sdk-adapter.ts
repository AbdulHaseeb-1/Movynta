import { tool } from "@openai/agents";
import { Logger } from "@nestjs/common";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error.js";
import { isAgentRunContext } from "../agent-runs/agent-run.context.js";
import type { AgentRunContext } from "../agent-runs/agent-runs.types.js";
import { RichToolResult, type ToolOutputPart } from "./tool-result.js";
import { toProviderToolName, type ToolDefinition } from "./tool.types.js";

const logger = new Logger("ToolExecution");

/** Messages safe to show the model. Anything unexpected is reduced to a generic message. */
function describeError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof z.ZodError) return "Tool input did not match its schema";
  return "Tool execution failed";
}

/** The first rejected command, so the chat can say what went wrong instead of only "conflicts". */
function firstIssue(error: unknown): string | undefined {
  const issues: unknown = error instanceof AppError ? error.details?.["issues"] : undefined;
  if (!Array.isArray(issues) || issues.length === 0) return undefined;
  const first: unknown = issues[0];
  if (typeof first !== "object" || first === null || !("message" in first)) return undefined;
  return typeof first.message === "string" ? first.message : undefined;
}

/**
 * Structured detail the model needs to correct its call, such as which command in a batch was rejected.
 * Domain errors never put secrets in `details`, so they are passed along as they are.
 */
function errorDetails(error: unknown): { details?: Readonly<Record<string, unknown>> } {
  return error instanceof AppError && error.details ? { details: error.details } : {};
}

/**
 * Runs one tool with progress events and timing. Failures are returned to the
 * model as `{ error }` so it can recover; the run itself keeps going. Arguments
 * are never logged.
 */
async function runTool(
  definition: ToolDefinition,
  input: unknown,
  context: AgentRunContext,
): Promise<string | ToolOutputPart[]> {
  const startedAt = Date.now();
  context.events.emit("tool.started", { toolName: definition.name, permission: definition.permission });
  try {
    const result = await definition.execute(input, context);
    const durationMs = Date.now() - startedAt;
    context.events.emit("tool.completed", { toolName: definition.name, durationMs });
    logger.log(`${definition.name} completed in ${durationMs}ms`);
    // Pictures go to the model as structured parts; everything else is JSON text.
    if (result instanceof RichToolResult) return result.parts();
    return JSON.stringify(result ?? null);
  } catch (error) {
    const message = describeError(error);
    const issue = firstIssue(error);
    context.events.emit("tool.failed", {
      toolName: definition.name,
      message: issue ? `${message}: ${issue}` : message,
    });
    logger.warn(`${definition.name} failed: ${message}`);
    return JSON.stringify({ error: message, ...errorDetails(error) });
  }
}

/** Adapts a registry definition to the Agents SDK `tool()` helper. */
export function toSdkTool(definition: ToolDefinition) {
  return tool<z.ZodObject, AgentRunContext>({
    name: toProviderToolName(definition.name),
    description: definition.description,
    parameters: definition.parameters,
    needsApproval: (runContext, input: unknown) => {
      const context: unknown = runContext.context;
      if (!isAgentRunContext(context)) return Promise.reject(new Error("Missing agent run context"));
      return definition.requiresApproval(input, context);
    },
    execute: (input: unknown, runContext) => {
      if (!runContext) throw new Error("Tool invoked without a run context");
      return runTool(definition, input, runContext.context);
    },
  });
}
