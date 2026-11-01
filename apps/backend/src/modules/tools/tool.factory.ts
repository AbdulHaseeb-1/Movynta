import { tool } from "@openai/agents";
import { Logger } from "@nestjs/common";
import { z } from "zod";
import { isAgentRunContext } from "../agent-runs/agent-run.context.js";
import type { AgentRunContext } from "../agent-runs/agent-runs.types.js";
import { toToolFailure } from "./tool-errors.js";
import { toProviderToolName, type ToolDefinition } from "./tool.types.js";

const logger = new Logger("ToolExecution");

/** Results above this size are replaced by a short error so one call cannot flood the model's context. */
export const MAX_TOOL_OUTPUT_CHARS = 60_000;

function serializeResult(toolName: string, result: unknown): string {
  const json = JSON.stringify(result ?? null);
  if (json.length <= MAX_TOOL_OUTPUT_CHARS) return json;
  return JSON.stringify({
    error: `Result of ${toolName} is too large (${json.length} characters; limit ${MAX_TOOL_OUTPUT_CHARS}).`,
    hint: "Ask for something narrower, or use a summary tool instead of reading everything.",
  });
}

/**
 * Runs one tool with progress events and timing. Failures are returned to the
 * model as a structured `{ error, issues?, hint }` so it can recover; the run
 * itself keeps going. Arguments are never logged.
 */
async function runTool(definition: ToolDefinition, input: unknown, context: AgentRunContext): Promise<string> {
  const startedAt = Date.now();
  context.events.emit("tool.started", { toolName: definition.name, permission: definition.permission });
  try {
    const result = await definition.execute(input, context);
    const durationMs = Date.now() - startedAt;
    context.events.emit("tool.completed", { toolName: definition.name, durationMs });
    logger.log(`${definition.name} completed in ${durationMs}ms`);
    return serializeResult(definition.name, result);
  } catch (error) {
    const failure = toToolFailure(error);
    context.events.emit("tool.failed", { toolName: definition.name, message: failure.error });
    logger.warn(`${definition.name} failed: ${failure.error}`);
    return JSON.stringify(failure);
  }
}

/** Adapts a registry definition to the Agents SDK `tool()` helper. */
export function toSdkTool(definition: ToolDefinition) {
  return tool<z.ZodObject, AgentRunContext>({
    name: toProviderToolName(definition.name),
    description: definition.description,
    parameters: definition.parameters,
    // Invalid arguments are rejected by the SDK before `execute` runs; without this the model
    // only sees a generic "try again" and cannot tell which argument was wrong.
    errorFunction: (runContext, error) => {
      const failure = toToolFailure(error);
      // These failures never reach `runTool`, so report them here to keep the event stream complete.
      const context: unknown = runContext.context;
      if (isAgentRunContext(context)) context.events.emit("tool.failed", { toolName: definition.name, message: failure.error });
      logger.warn(`${definition.name} failed: ${failure.error}`);
      return JSON.stringify(failure);
    },
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
