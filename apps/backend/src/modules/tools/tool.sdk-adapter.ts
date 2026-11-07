import { tool } from "@openai/agents";
import { Logger } from "@nestjs/common";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error.js";
import { isAgentRunContext } from "../agent-runs/agent-run.context.js";
import type { AgentRunContext } from "../agent-runs/agent-runs.types.js";
import { RichToolResult, type ToolOutputPart } from "./tool-result.js";
import { describeIssues, invalidInputResult } from "./tool-input-issues.js";
import { toProviderToolName, type ToolDefinition } from "./tool.types.js";

const logger = new Logger("ToolExecution");

/** Messages safe to show the model. Anything unexpected is reduced to a generic message. */
function describeError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof z.ZodError) return "Tool input did not match its schema";
  return "Tool execution failed";
}

/**
 * Arguments the tool's schema refused. The SDK would otherwise refuse them itself and tell the model only "an error
 * occurred, try again", with the reason redacted, so the model repeats the same mistake. Carried to {@link runTool}
 * instead, they come back to the model as the fields to fix.
 */
/**
 * The marker is plain data under a key no tool schema has: the SDK copies parsed input (to decide approvals), so a
 * class instance or object identity would not survive, and every schema is strict, so a model cannot send the key.
 */
const REFUSED_KEY = "__movyntaRefusedArguments";
const refusedSchema = z
  .object({
    [REFUSED_KEY]: z.object({
      error: z.string(),
      issues: z.array(z.object({ path: z.string(), message: z.string() })),
      moreIssues: z.number().optional(),
    }),
  })
  .strict();
type InvalidToolArguments = z.infer<typeof refusedSchema>;
type Refusal = InvalidToolArguments[typeof REFUSED_KEY];

function refused(error: z.ZodError, input: unknown): InvalidToolArguments {
  return { [REFUSED_KEY]: invalidInputResult(error, input) };
}

function refusalOf(value: unknown): Refusal | undefined {
  const parsed = refusedSchema.safeParse(value);
  return parsed.success ? parsed.data[REFUSED_KEY] : undefined;
}

/**
 * The schema the SDK is given: the same schema, so the model is shown the same JSON schema and the SDK still turns the
 * nulls of strict mode back into missing fields, but its top-level parse reports a refusal instead of throwing it.
 */
function reportingParameters(schema: z.ZodObject): z.ZodObject {
  const copy = schema.clone();
  copy.parse = (data: unknown) => {
    const parsed = schema.safeParse(data);
    return parsed.success ? parsed.data : refused(parsed.error, data);
  };
  return copy;
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
  if (error instanceof AppError && error.details) return { details: error.details };
  // A value checked inside the tool, such as commands a program returned: say which field, never the value itself.
  if (error instanceof z.ZodError) return { details: { issues: describeIssues(error) } };
  return {};
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
  const refusal = refusalOf(input);
  if (refusal) {
    const first = refusal.issues[0];
    context.events.emit("tool.failed", {
      toolName: definition.name,
      message: first ? `Invalid arguments: ${first.path}: ${first.message}`.slice(0, 500) : "Invalid arguments",
    });
    logger.warn(
      `${definition.name} refused invalid arguments (${refusal.issues.length + (refusal.moreIssues ?? 0)} issue(s))`,
    );
    return JSON.stringify(refusal);
  }
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
    parameters: reportingParameters(definition.parameters),
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
