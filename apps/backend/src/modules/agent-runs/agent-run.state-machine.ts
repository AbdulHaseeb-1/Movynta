import { ConflictError } from "../../common/errors/app-error.js";
import type { AgentRunStatus } from "./agent-runs.types.js";

/** Every status a run can have, in the order a run moves through them. */
export const AGENT_RUN_STATUSES = [
  "created",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

/** The statuses from which a run cannot move on. */
export const TERMINAL_RUN_STATUSES: readonly AgentRunStatus[] = ["completed", "failed", "cancelled"];

const TRANSITIONS: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
  created: ["running", "failed", "cancelled"],
  running: ["waiting_approval", "completed", "failed", "cancelled"],
  waiting_approval: ["running", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

/** A run was asked to move to a status that its current status does not allow. */
export class InvalidRunTransitionError extends ConflictError {
  constructor(from: AgentRunStatus, to: AgentRunStatus) {
    super(`Cannot move an agent run from ${from} to ${to}`, { from, to });
  }
}

/** Returns `to` when the transition is allowed; throws otherwise. */
export function transitionRun(from: AgentRunStatus, to: AgentRunStatus): AgentRunStatus {
  if (!TRANSITIONS[from].includes(to)) throw new InvalidRunTransitionError(from, to);
  return to;
}

/** Whether a run in this status has finished for good and can no longer change. */
export function isTerminal(status: AgentRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}
