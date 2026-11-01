import { z } from "zod";
import { AppError } from "../../common/errors/app-error.js";

export const MAX_REPORTED_ISSUES = 8;
const MAX_ISSUE_MESSAGE_LENGTH = 200;

export interface ToolIssue {
  /** Dotted path to the offending argument, for example `commands.0.size`. Empty for the root. */
  readonly path: string;
  readonly message: string;
}

/**
 * What the model receives when a tool fails. It names what to fix, so the model
 * can correct its call instead of guessing (an opaque failure leads to blind retries).
 * It never contains stack traces, argument values, or server details.
 */
export interface ToolFailure {
  readonly error: string;
  readonly issues?: readonly ToolIssue[];
  readonly hint: string;
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.map((segment) => String(segment)).join(".");
}

export function describeIssues(error: z.ZodError): ToolIssue[] {
  return error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message.slice(0, MAX_ISSUE_MESSAGE_LENGTH),
  }));
}

/**
 * The SDK does not export `InvalidToolInputError`, so it is recognised by its
 * name. The SDK redacts the validation details before calling `errorFunction`,
 * so no per-field issues are available on this path.
 */
function isInvalidToolInputError(error: unknown): boolean {
  return error instanceof Error && error.constructor.name === "InvalidToolInputError";
}

const INVALID_INPUT_HINT =
  "Check every argument against the types and limits in the tool description, then call the tool again with valid input.";

export function toToolFailure(error: unknown): ToolFailure {
  if (isInvalidToolInputError(error)) {
    return { error: "Tool input did not match its schema", hint: INVALID_INPUT_HINT };
  }
  if (error instanceof z.ZodError) {
    return {
      error: "Tool input did not match its schema",
      issues: describeIssues(error),
      hint: INVALID_INPUT_HINT,
    };
  }
  if (error instanceof AppError) {
    return {
      error: error.message,
      hint: "Read the message, adjust your approach, and only retry if it explains how.",
    };
  }
  return {
    error: "Tool execution failed",
    hint: "The tool failed unexpectedly. Do not repeat the same call; tell the user if the task cannot continue.",
  };
}
