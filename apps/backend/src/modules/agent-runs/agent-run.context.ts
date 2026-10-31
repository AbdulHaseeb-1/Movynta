import type { ModelingDimension, ModelingPlan } from "../../shared/schemas/modeling-plan.schema.js";
import type { AgentRunEventSink } from "./agent-run.events.js";

/**
 * Per-run state shared with tools through the SDK run context. It holds only
 * server-side identifiers and state; nothing here is ever sent to the model
 * as raw data.
 */
export interface AgentRunContext {
  readonly runId: string;
  readonly userId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly clientId: string;
  readonly dimension: ModelingDimension | undefined;
  /** Skill ids selected for this request. `skills.load_skill` only loads these. */
  readonly selectedSkillIds: readonly string[];
  readonly events: AgentRunEventSink;
  readonly signal: AbortSignal;
  readonly plans: ModelingPlan[];
}

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
    "plans" in value
  );
}
