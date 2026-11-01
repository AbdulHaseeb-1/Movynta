import { tool } from "@openai/agents";
import { Logger } from "@nestjs/common";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error.js";
import { isAgentRunContext } from "../agent-runs/agent-run.context.js";
import type { AgentRunContext } from "../agent-runs/agent-runs.types.js";
import { toProviderToolName, type ToolDefinition } from "./tool.types.js";

const logger = new Logger("ToolExecution");

/** Messages safe to show the model. Anything unexpected is reduced to a generic message. */
function describeError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof z.ZodError) return "Tool input did not match its schema";
  return "Tool execution failed";
}

/**
 * Runs one tool with progress events and timing. Failures are returned to the
 * model as `{ error }` so it can recover; the run itself keeps going. Arguments
 * are never logged.
 */
async function runTool(definition: ToolDefinition, input: unknown, context: AgentRunContext): Promise<string> {
  const startedAt = Date.now();
  context.events.emit("tool.started", { toolName: definition.name, permission: definition.permission });
  try {
    const result = await definition.execute(input, context);
    const durationMs = Date.now() - startedAt;
    context.events.emit("tool.completed", { toolName: definition.name, durationMs });
    logger.log(`${definition.name} completed in ${durationMs}ms`);
    return JSON.stringify(result ?? null);
  } catch (error) {
    const message = describeError(error);
    context.events.emit("tool.failed", { toolName: definition.name, message });
    logger.warn(`${definition.name} failed: ${message}`);
    return JSON.stringify({ error: message });
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
