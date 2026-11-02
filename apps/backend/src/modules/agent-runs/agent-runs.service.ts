import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { Observable } from "rxjs";
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from "../../common/errors/app-error.js";
import type { AuthUser } from "../auth/auth.types.js";
import { AgentRegistry } from "../agents/agent.registry.js";
import { MODELING_COORDINATOR_ID } from "../agents/definitions/modeling-coordinator.agent.js";
import { ApprovalsService } from "../approvals/approvals.service.js";
import { EDITOR_BRIDGE } from "../editor-bridge/editor-bridge.tokens.js";
import type { EditorBridge } from "../editor-bridge/editor-bridge.types.js";
import { CommandProposalService } from "../editor-bridge/proposals/command-proposal.service.js";
import { ProjectAccessService } from "../projects/project-access.service.js";
import { SessionsService } from "../sessions/sessions.service.js";
import type { SessionRecord } from "../sessions/sessions.types.js";
import { SkillsRegistry } from "../skills/skills.registry.js";
import type {
  CreateAgentRunDto,
  DecideApprovalDto,
} from "./dto/agent-run.dto.js";
import { AgentRunProcessor } from "./agent-run.processor.js";
import { AgentRunEventsService } from "./agent-run-events.service.js";
import { AgentRunRepository } from "./agent-run.repository.js";
import { isTerminal } from "./agent-run.state-machine.js";
import { ProvidersService } from "../providers/providers.service.js";
import { reasoningEffortsFor } from "../providers/model-capabilities.js";
import type {
  AgentRunAccepted,
  AgentRunEvent,
  AgentRunEventType,
  AgentRunRecord,
  AgentRunStatus,
  AgentRunView,
  ApprovalDecisionResult,
  ApprovalView,
} from "./agent-runs.types.js";

export const HEARTBEAT_INTERVAL_MS = 15_000;

const TERMINAL_EVENTS: readonly AgentRunEventType[] = [
  "run.completed",
  "run.failed",
  "run.cancelled",
];

function toEnvelope(event: AgentRunEvent): Readonly<Record<string, unknown>> {
  return {
    id: event.id,
    runId: event.runId,
    type: event.type,
    timestamp: event.timestamp,
    payload: event.payload,
  };
}

function parseLastEventId(value: string | undefined): number {
  if (value === undefined || !/^\d{1,12}$/.test(value)) return 0;
  return Number(value);
}

function toRunView(run: AgentRunRecord): AgentRunView {
  return {
    id: run.id,
    sessionId: run.sessionId,
    projectId: run.projectId,
    agentId: run.agentId,
    status: run.status,
    finalOutput: run.finalOutput,
    error:
      run.errorCode === undefined
        ? undefined
        : { code: run.errorCode, message: run.errorMessage ?? "" },
    usage: run.usage,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

/**
 * Orchestrates run lifecycle requests: creation, ownership-checked reads, SSE
 * replay and live streaming, cancellation, and approval decisions. The SDK work
 * itself happens in AgentRunProcessor.
 */
@Injectable()
export class AgentRunsService implements OnModuleInit {
  private readonly logger = new Logger(AgentRunsService.name);

  constructor(
    private readonly runs: AgentRunRepository,
    private readonly events: AgentRunEventsService,
    private readonly sessions: SessionsService,
    private readonly projects: ProjectAccessService,
    private readonly agents: AgentRegistry,
    private readonly processor: AgentRunProcessor,
    private readonly approvals: ApprovalsService,
    private readonly proposals: CommandProposalService,
    private readonly skills: SkillsRegistry,
    private readonly providers: ProvidersService,
    @Inject(EDITOR_BRIDGE) private readonly bridge: EditorBridge,
  ) {}

  /** Runs that were active when the process stopped cannot be resumed; mark them failed. */
  onModuleInit(): void {
    for (const run of this.runs.listRunningOrWaiting()) {
      this.runs.transition(
        run.id,
        "failed",
        {
          errorCode: "run_interrupted",
          errorMessage: "The server restarted during this run",
        },
        new Date().toISOString(),
      );
      this.events.publish(run.id, "run.failed", {
        code: "run_interrupted",
        message: "The server restarted during this run",
      });
      this.logger.warn(`marked interrupted run ${run.id} as failed`);
    }
  }

  create(user: AuthUser, dto: CreateAgentRunDto): AgentRunAccepted {
    const provider = dto.providerId ? this.providers.configured(user.id, dto.providerId) : dto.useConfiguredProvider
      ? this.providers.active(user.id)
      : undefined;
    if (dto.model && !provider) throw new ValidationFailedError("Select a configured provider when choosing a model");
    const providerModel = dto.model ?? provider?.model;
    if (dto.reasoningEffort !== undefined) {
      const supported = provider && providerModel ? reasoningEffortsFor(provider.id, providerModel) : [];
      if (!supported.includes(dto.reasoningEffort))
        throw new ValidationFailedError("The selected model does not support that reasoning effort");
    }
    this.projects.assertOwner(user.id, dto.projectId);
    const agentId = dto.agentId ?? MODELING_COORDINATOR_ID;
    this.agents.summary(agentId);

    const session =
      dto.sessionId === undefined
        ? this.sessions.create(user.id, dto.projectId)
        : this.requireSession(user.id, dto.sessionId, dto.projectId);

    if (dto.editorClientId !== undefined) {
      this.bridge.assertConnection(user.id, dto.projectId, dto.editorClientId);
    }

    const selectedSkillIds = this.skills
      .selectRelevant({ message: dto.message, dimension: dto.dimension })
      .map((skill) => skill.id);
    const runId = `run_${randomUUID()}`;
    const now = new Date().toISOString();

    this.runs.insert({
      providerId: provider?.id,
      providerModel,
      reasoningEffort: dto.reasoningEffort,
      providerBaseUrl: provider?.baseUrl || undefined,
      id: runId,
      sessionId: session.id,
      userId: user.id,
      projectId: dto.projectId,
      agentId,
      editorClientId: dto.editorClientId,
      dimension: dto.dimension,
      selectedSkillIds,
      input: dto.message,
      now,
    });
    this.projects.recordActivity(dto.projectId);
    this.runs.transition(runId, "running", {}, now);
    this.events.publish(runId, "run.started", {
      runId,
      sessionId: session.id,
      agentId,
      selectedSkillIds,
    });

    const record = this.requireRun(user.id, runId);
    this.processor.start(record);
    this.logger.log(`started run ${runId} for project ${dto.projectId}`);

    return {
      runId,
      sessionId: session.id,
      status: "running",
      eventsUrl: `/api/v1/agent-runs/${runId}/events`,
    };
  }

  get(user: AuthUser, runId: string): AgentRunView {
    return toRunView(this.requireRun(user.id, runId));
  }

  /**
   * Streams run events as SSE. `Last-Event-ID` resumes after a known sequence
   * number. Events are replayed from storage, then followed live, with duplicates removed.
   */
  stream(
    user: AuthUser,
    runId: string,
    lastEventId: string | undefined,
  ): Observable<MessageEvent> {
    this.requireRun(user.id, runId);
    const afterSeq = parseLastEventId(lastEventId);

    return new Observable<MessageEvent>((subscriber) => {
      let lastSent = afterSeq;
      let live = false;
      let closed = false;
      const buffered: AgentRunEvent[] = [];

      const close = (): void => {
        if (closed) return;
        closed = true;
        subscriber.complete();
      };

      const deliver = (event: AgentRunEvent): void => {
        if (closed || event.seq <= lastSent) return;
        lastSent = event.seq;
        subscriber.next({
          id: String(event.seq),
          type: event.type,
          data: toEnvelope(event),
        });
        if (TERMINAL_EVENTS.includes(event.type)) close();
      };

      const unsubscribe = this.events.subscribe(runId, (event) => {
        if (live) deliver(event);
        else buffered.push(event);
      });
      const heartbeat = setInterval(() => {
        if (!closed) subscriber.next({ type: "heartbeat", data: "" });
      }, HEARTBEAT_INTERVAL_MS);

      for (const event of this.events.replay(runId, afterSeq)) deliver(event);
      live = true;
      for (const event of buffered) deliver(event);

      return () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    });
  }

  cancel(
    user: AuthUser,
    runId: string,
  ): { runId: string; status: AgentRunStatus } {
    const run = this.requireRun(user.id, runId);
    if (isTerminal(run.status))
      throw new ConflictError("Agent run has already finished", {
        status: run.status,
      });

    const now = new Date().toISOString();
    this.runs.transition(runId, "cancelled", {}, now);
    this.approvals.closePending(runId);
    this.processor.abort(runId);
    this.events.publish(runId, "run.cancelled", { runId });
    return { runId, status: "cancelled" };
  }

  listApprovals(user: AuthUser, runId: string): ApprovalView[] {
    return this.approvals.listForRun(user.id, runId).map((approval) => ({
      id: approval.id,
      runId: approval.runId,
      toolName: approval.toolName,
      status: approval.status,
      preview: approval.preview,
      reason: approval.reason,
      createdAt: approval.createdAt,
      expiresAt: approval.expiresAt,
      decidedAt: approval.decidedAt,
    }));
  }

  /**
   * Records an approve/reject decision. Each approval can be decided once. When
   * the last pending approval is decided, the run resumes with those decisions.
   */
  decide(
    user: AuthUser,
    runId: string,
    approvalId: string,
    dto: DecideApprovalDto,
  ): ApprovalDecisionResult {
    const run = this.requireRun(user.id, runId);
    if (run.status !== "waiting_approval")
      throw new ConflictError("Agent run is not waiting for approval", {
        status: run.status,
      });

    const approval = this.approvals.findForRun(runId, approvalId);
    if (approval.status !== "pending")
      throw new ConflictError("Approval has already been decided", {
        status: approval.status,
      });

    const now = new Date();
    if (new Date(approval.expiresAt).getTime() <= now.getTime()) {
      this.approvals.expireDue(runId, now);
      this.runs.transition(
        runId,
        "failed",
        {
          errorCode: "approval_expired",
          errorMessage: "An approval expired before it was decided",
        },
        now.toISOString(),
      );
      this.events.publish(runId, "run.failed", {
        code: "approval_expired",
        message: "An approval expired before it was decided",
      });
      throw new ConflictError("Approval has expired", { status: "expired" });
    }

    const approved = dto.decision === "approve";
    if (!this.approvals.record(approvalId, approved, dto.reason, now)) {
      throw new ConflictError("Approval has already been decided");
    }
    if (!approved && approval.toolName === "editor.apply_proposal") {
      const proposalId = approval.preview.proposalId;
      if (typeof proposalId === "string")
        this.proposals.reject(runId, proposalId);
    }
    this.events.publish(runId, "approval.resolved", {
      approvalId,
      decision: dto.decision,
    });

    if (this.approvals.pendingCount(runId) > 0) {
      return {
        approvalId,
        approvalStatus: approved ? "approved" : "rejected",
        runStatus: "waiting_approval",
      };
    }

    try {
      this.runs.transition(runId, "running", {}, now.toISOString());
    } catch (error) {
      if (error instanceof ConflictError)
        throw new ConflictError("Agent run changed while deciding", {
          status: run.status,
        });
      throw error;
    }
    this.processor.resume(this.requireRun(user.id, runId));
    return {
      approvalId,
      approvalStatus: approved ? "approved" : "rejected",
      runStatus: "running",
    };
  }

  private requireRun(userId: string, runId: string): AgentRunRecord {
    const run = this.runs.find(runId);
    if (!run || run.userId !== userId)
      throw new NotFoundError("Agent run not found");
    return run;
  }

  private requireSession(
    userId: string,
    sessionId: string,
    projectId: string,
  ): SessionRecord {
    const session = this.sessions.getOwned(userId, sessionId);
    if (session.projectId !== projectId)
      throw new ValidationFailedError("Session belongs to a different project");
    return session;
  }
}
