/** Event types streamed to clients. Private reasoning and internal data are never included. */
export const AGENT_RUN_EVENT_TYPES = [
  "run.started",
  "agent.started",
  "agent.message.delta",
  "agent.message.completed",
  "skill.loaded",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "editor.proposal.created",
  "approval.required",
  "approval.resolved",
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const;

export type AgentRunEventType = (typeof AGENT_RUN_EVENT_TYPES)[number];

/** Payload shape for each event type. Clients receive these as JSON, so each shape is part of the stream contract. */
export type AgentRunEventPayloads = {
  readonly "run.started": { readonly runId: string; readonly sessionId: string; readonly agentId: string; readonly selectedSkillIds: readonly string[] };
  readonly "agent.started": { readonly agentName: string };
  readonly "agent.message.delta": { readonly delta: string };
  readonly "agent.message.completed": { readonly text: string };
  readonly "skill.loaded": { readonly skillId: string; readonly version: string };
  readonly "tool.started": { readonly toolName: string; readonly permission: string };
  readonly "tool.completed": { readonly toolName: string; readonly durationMs: number };
  readonly "tool.failed": { readonly toolName: string; readonly message: string };
  readonly "editor.proposal.created": {
    readonly proposalId: string;
    readonly summary: string;
    readonly requiresApproval: boolean;
    readonly commandCount: number;
    readonly baseRevision: number;
  };
  readonly "approval.required": { readonly approvalId: string; readonly toolName: string; readonly summary: string; readonly requiresApproval: true };
  readonly "approval.resolved": { readonly approvalId: string; readonly decision: "approve" | "reject" };
  readonly "run.completed": { readonly usage: number };
  readonly "run.failed": { readonly code: string; readonly message: string };
  readonly "run.cancelled": { readonly runId: string };
};

export type AgentRunEventPayload = AgentRunEventPayloads[AgentRunEventType];

/** Client-facing envelope. `seq` orders events and is sent as the SSE `id`. */
export interface AgentRunEvent {
  readonly id: string;
  readonly runId: string;
  readonly seq: number;
  readonly type: AgentRunEventType;
  readonly timestamp: string;
  readonly payload: AgentRunEventPayload;
}

/** Narrow sink given to tools so they can report progress without knowing about storage. */
export interface AgentRunEventSink {
  emit<T extends AgentRunEventType>(type: T, payload: AgentRunEventPayloads[T]): void;
}
