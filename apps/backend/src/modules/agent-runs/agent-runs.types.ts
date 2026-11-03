import type { RunState, StreamedRunResult } from "@openai/agents";
import type { AppAgent } from "../agents/definitions/definitions.types.js";
import type { ApprovalPreview } from "../approvals/approvals.types.js";
import type {
  ModelingDimension,
  ModelingPlan,
} from "../../shared/types/modeling-plan.types.js";
import type { AGENT_RUN_EVENT_TYPES } from "./agent-run.events.js";
import type { AGENT_RUN_STATUSES } from "./agent-run.state-machine.js";
import type { ReasoningEffort } from "../providers/model-capabilities.js";
import type { ProviderId } from "../providers/providers.types.js";

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export type AgentRunEventType = (typeof AGENT_RUN_EVENT_TYPES)[number];

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

/** Payload shape for each event type. Clients receive these as JSON, so each shape is part of the stream contract. */
export type AgentRunEventPayloads = {
  readonly "run.started": {
    readonly runId: string;
    readonly sessionId: string;
    readonly agentId: string;
    readonly selectedSkillIds: readonly string[];
  };
  readonly "agent.started": { readonly agentName: string };
  readonly "agent.message.delta": { readonly delta: string };
  readonly "agent.message.completed": { readonly text: string };
  readonly "skill.loaded": {
    readonly skillId: string;
    readonly version: string;
  };
  readonly "tool.started": {
    readonly toolName: string;
    readonly permission: string;
  };
  readonly "tool.completed": {
    readonly toolName: string;
    readonly durationMs: number;
  };
  readonly "tool.failed": {
    readonly toolName: string;
    readonly message: string;
  };
  readonly "editor.proposal.created": {
    readonly proposalId: string;
    readonly summary: string;
    readonly requiresApproval: boolean;
    readonly commandCount: number;
    readonly baseRevision: number;
    readonly supersedes: string | null;
    readonly planStepId: string | null;
  };
  readonly "approval.required": {
    readonly approvalId: string;
    readonly toolName: string;
    readonly summary: string;
    readonly requiresApproval: true;
  };
  readonly "approval.resolved": {
    readonly approvalId: string;
    readonly decision: "approve" | "reject";
  };
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
  emit<T extends AgentRunEventType>(
    type: T,
    payload: AgentRunEventPayloads[T],
  ): void;
}

export interface AgentRunRecord {
  readonly reasoningEffort?: ReasoningEffort | undefined;
  readonly providerBaseUrl?: string | undefined;
  readonly providerId?: ProviderId | undefined;
  readonly providerModel?: string | undefined;
  readonly id: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly projectId: string;
  readonly agentId: string;
  readonly editorClientId: string | undefined;
  readonly dimension: ModelingDimension | undefined;
  readonly selectedSkillIds: readonly string[];
  readonly status: AgentRunStatus;
  readonly input: string;
  readonly finalOutput: string | undefined;
  readonly errorCode: string | undefined;
  readonly errorMessage: string | undefined;
  readonly usage: Readonly<Record<string, number>> | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewAgentRun {
  readonly reasoningEffort?: ReasoningEffort | undefined;
  readonly providerBaseUrl?: string | undefined;
  readonly providerId?: ProviderId | undefined;
  readonly providerModel?: string | undefined;
  readonly id: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly projectId: string;
  readonly agentId: string;
  readonly editorClientId: string | undefined;
  readonly dimension: ModelingDimension | undefined;
  readonly selectedSkillIds: readonly string[];
  readonly input: string;
  readonly now: string;
}

export interface RunUpdate {
  readonly status?: AgentRunStatus;
  readonly finalOutput?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly usage?: Readonly<Record<string, number>>;
  readonly runState?: string | null;
}

export interface AgentRunAccepted {
  readonly runId: string;
  readonly sessionId: string;
  readonly status: AgentRunStatus;
  readonly eventsUrl: string;
}

export interface AgentRunView {
  readonly id: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly agentId: string;
  readonly status: AgentRunStatus;
  readonly finalOutput: string | undefined;
  readonly error:
    { readonly code: string; readonly message: string } | undefined;
  readonly usage: Readonly<Record<string, number>> | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApprovalView {
  readonly id: string;
  readonly runId: string;
  readonly toolName: string;
  readonly status: string;
  readonly preview: ApprovalPreview;
  readonly reason: string | undefined;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decidedAt: string | undefined;
}

export interface ApprovalDecisionResult {
  readonly approvalId: string;
  readonly approvalStatus: string;
  readonly runStatus: AgentRunStatus;
}

export type RunResult = StreamedRunResult<AgentRunContext, AppAgent>;
export type RunStateOf = RunState<AgentRunContext, AppAgent>;

export interface ActiveRun {
  readonly controller: AbortController;
  readonly timer: NodeJS.Timeout;
}
