import type { AgentRunContext } from "./agent-runs.types.js";

/** Narrows the SDK's untyped run context, which it passes as `unknown` to approval callbacks. */
export function isAgentRunContext(value: unknown): value is AgentRunContext {
  return (
    typeof value === "object" &&
    value !== null &&
    "runId" in value &&
    typeof value.runId === "string" &&
    "userId" in value &&
    typeof value.userId === "string" &&
    "events" in value &&
    "progress" in value
  );
}
