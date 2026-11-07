import type { RunState, StreamedRunResult } from "@openai/agents";
import type { AppAgent } from "../agents/definitions/definitions.types.js";
import type { ApprovalPreview } from "../approvals/approvals.types.js";
import type { ModelingDimension } from "../../shared/types/modeling-plan.types.js";
import type { AGENT_RUN_EVENT_TYPES } from "./agent-run.events.js";
import type { AGENT_RUN_STATUSES } from "./agent-run.state-machine.js";
import type { ReasoningEffort } from "../providers/model-capabilities.js";
import type { ProviderId } from "../providers/providers.types.js";
import type { RunProgress } from "./run-progress.js";
import type { RunClock } from "./run-clock.js";
import type { AttachmentSummary } from "@movynta/contracts";

/** The status of a run, as defined by the state machine. */
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** The kinds of event a run can publish to its event stream. */
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
  /** Plans, batches and verification state, updated by the tools as the run goes. */
  readonly progress: RunProgress;
  /** False when pictures must not be sent to this run's model, so tools return measurements only. */
  readonly supportsToolImages: boolean;
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
  /** The assistant looked at the scene. The pictures stay in the editor, filed under `captureId`; only their names travel here. */
  readonly "viewport.captured": {
    readonly captureId: string;
    readonly views: readonly { readonly label: string; readonly width: number; readonly height: number }[];
    /** False when the model connection cannot take images, so nothing was drawn. */
    readonly imagesSent: boolean;
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
  /** The model stopped before the work was finished, so the run asks it to carry on. */
  readonly "agent.continued": {
    readonly attempt: number;
    readonly reasons: readonly string[];
  };
  /** A separate agent is examining the finished work. */
  readonly "review.started": { readonly attempt: number };
  /** The reviewer's verdict. `summary` is short; the findings go to the builder, not to the stream. */
  readonly "review.completed": {
    readonly attempt: number;
    readonly outcome: "ready" | "needs_refinement" | "blocked";
    readonly summary: string;
    readonly findingCount: number;
  };
  readonly "run.completed": { readonly usage: number };
  readonly "run.failed": { readonly code: string; readonly message: string };
  readonly "run.cancelled": { readonly runId: string };
};

/** The payload of an event, whose shape depends on its type. */
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

/** A run as it is stored, including its server-side state. */
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
  /** The pictures the user attached to the request. Their pixels are not stored. */
  readonly attachments: readonly AttachmentSummary[];
  /** Plans and unfinished work saved when the run paused for an approval. Server-side only. */
  readonly progress?: RunProgress | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What is needed to create a run record. */
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
  readonly attachments?: readonly AttachmentSummary[];
  readonly now: string;
}

/** The fields that a status change may update on a run. */
export interface RunUpdate {
  readonly status?: AgentRunStatus;
  readonly finalOutput?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly usage?: Readonly<Record<string, number>>;
  readonly runState?: string | null;
  readonly progressJson?: string | null;
}

/** The answer to starting a run. */
export interface AgentRunAccepted {
  readonly runId: string;
  readonly sessionId: string;
  readonly status: AgentRunStatus;
  readonly eventsUrl: string;
}

/** A run as the API returns it, without server-side state. */
export interface AgentRunView {
  readonly id: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly agentId: string;
  readonly status: AgentRunStatus;
  readonly finalOutput: string | undefined;
  readonly error: { readonly code: string; readonly message: string } | undefined;
  readonly usage: Readonly<Record<string, number>> | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An approval as the API returns it. */
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

/** The answer to deciding one approval. */
export interface ApprovalDecisionResult {
  readonly approvalId: string;
  readonly approvalStatus: string;
  readonly runStatus: AgentRunStatus;
}

/** The result of one streamed model turn. */
export type RunResult = StreamedRunResult<AgentRunContext, AppAgent>;
/** The serialisable state of a run's model turn, which is kept while it waits for approval. */
export type RunStateOf = RunState<AgentRunContext, AppAgent>;

/** A run that is executing now: its abort handle, its clock, and the subscription that feeds the clock. */
export interface ActiveRun {
  readonly controller: AbortController;
  readonly clock: RunClock;
  readonly unsubscribe: () => void;
}
