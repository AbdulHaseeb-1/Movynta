import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import {
  extractAllTextOutput,
  type AgentInputItem,
  RunContext,
  RunState,
  Runner as SdkRunner,
  type Runner,
  type RunStreamEvent,
} from "@openai/agents";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig } from "../../config/config.types.js";
import { AgentRegistry } from "../agents/agent.registry.js";
import { QUALITY_REVIEWER_ID } from "../agents/definitions/quality-reviewer.agent.js";
import { AGENT_RUNNER } from "../agents/agent.tokens.js";
import type { AppAgent } from "../agents/definitions/definitions.types.js";
import type { ApprovalPreview } from "../approvals/approvals.types.js";
import { ApprovalsService } from "../approvals/approvals.service.js";
import { EDITOR_BRIDGE } from "../editor-bridge/editor-bridge.tokens.js";
import type { EditorBridge } from "../editor-bridge/editor-bridge.types.js";
import { CommandProposalService } from "../editor-bridge/proposals/command-proposal.service.js";
import { SessionsService } from "../sessions/sessions.service.js";
import { AgentRunEventsService } from "./agent-run-events.service.js";
import { classifyFailure, describeError } from "./agent-run.failure.js";
import { buildReviewRequest } from "./review-request.js";
import { AgentRunRepository } from "./agent-run.repository.js";
import { ProvidersService } from "../providers/providers.service.js";
import { ProviderTransport } from "../providers/provider-transport.js";
import { pictureBridgedModel } from "../providers/chat-completions-pictures.js";
import { reasoningModelSettings, requiredModelSettings } from "../providers/model-capabilities.js";
import { extractTextDelta, interruptionCallId, toRegistryToolName } from "./agent-run.stream-mapper.js";
import { RunClock, type RunStop } from "./run-clock.js";
import { messageWithAttachments, type RunAttachment } from "./run-attachments.js";
import {
  continuationPrompt,
  emptyRunProgress,
  invalidateStaleQualityReview,
  openWorkReasons,
  completionNotice,
  requiresQualityReview,
  reviewDue,
  serializeRunProgress,
  type RunProgress,
} from "./run-progress.js";
import type {
  ActiveRun,
  AgentRunContext,
  AgentRunRecord,
  AgentRunStatus,
  RunResult,
  RunStateOf,
  RunUpdate,
} from "./agent-runs.types.js";

/** Abort reasons, so the processor can tell a timeout, a stall and a cancellation apart. */
const TIMEOUT_REASON = "run_timeout";
const STALL_REASON = "run_stalled";
const CANCEL_REASON = "run_cancelled";

interface RunTotals {
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

const NO_TOTALS: RunTotals = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

function addTotals(sum: RunTotals, usage: RunTotals): RunTotals {
  return {
    requests: sum.requests + usage.requests,
    inputTokens: sum.inputTokens + usage.inputTokens,
    outputTokens: sum.outputTokens + usage.outputTokens,
    totalTokens: sum.totalTokens + usage.totalTokens,
  };
}

function stopOf(reason: unknown): RunStop | undefined {
  if (reason === TIMEOUT_REASON) return "timeout";
  if (reason === STALL_REASON) return "stalled";
  return undefined;
}

/**
 * Runs the SDK agent for a run record: streams its events, pauses for approvals, resumes after decisions,
 * and asks the model to carry on while the work is not finished.
 */
@Injectable()
export class AgentRunProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(AgentRunProcessor.name);
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    @Inject(AGENT_RUNNER) private readonly runner: Runner,
    private readonly agents: AgentRegistry,
    private readonly sessions: SessionsService,
    private readonly runs: AgentRunRepository,
    private readonly events: AgentRunEventsService,
    private readonly approvals: ApprovalsService,
    private readonly proposals: CommandProposalService,
    @Inject(EDITOR_BRIDGE) private readonly bridge: EditorBridge,
    private readonly providers: ProvidersService,
    private readonly transport: ProviderTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Starts a run in the background. Failures are recorded on the run, never thrown to the caller. */
  start(run: AgentRunRecord, attachments: readonly RunAttachment[] = []): void {
    const progress = emptyRunProgress();
    progress.quality.required = requiresQualityReview(run.input, run.dimension, this.config.agents.reviewMode);
    // The pictures go to the model with this first turn only; the stored history keeps their names, not their pixels.
    const input = attachments.length > 0 ? messageWithAttachments(run.input, attachments) : run.input;
    this.launch(run, progress, (context, signal) => this.turn(run, context, signal, input));
  }

  /** Continues a run that was waiting for approval, after every decision has been recorded. */
  resume(run: AgentRunRecord): void {
    this.launch(run, run.progress ?? emptyRunProgress(), async (context, signal) => {
      const agent = this.agents.agent(run.agentId);
      const serialized = this.runs.readRunState(run.id);
      if (!serialized) throw new Error("Run state is missing");
      // The restored state keeps its approval records; the run context is merged in so tools get live handles.
      const state = await RunState.fromStringWithContext<AgentRunContext, AppAgent>(
        agent,
        serialized,
        new RunContext<AgentRunContext>(context),
        {
          contextStrategy: "merge",
        },
      );
      this.applyDecisions(state, run.id);
      return (await this.runnerFor(run)).run(agent, state, {
        stream: true,
        session: this.sessions.store(run.sessionId),
        signal,
        maxTurns: this.config.agents.maxTurns,
      });
    });
  }

  /** One model turn of the run, with the session's history. */
  private async turn(
    run: AgentRunRecord,
    context: AgentRunContext,
    signal: AbortSignal,
    input: string | AgentInputItem[],
  ): Promise<RunResult> {
    return (await this.runnerFor(run)).run(this.agents.agent(run.agentId), input, {
      stream: true,
      context,
      session: this.sessions.store(run.sessionId),
      signal,
      maxTurns: this.config.agents.maxTurns,
    });
  }

  private async runnerFor(run: AgentRunRecord): Promise<Runner> {
    if (!this.config.agents.enabled) throw new Error("Agents are disabled");
    if (!run.providerId) return this.runner;
    const credentials = await this.providers.credentials(
      run.userId,
      run.providerId,
      run.providerModel,
      run.providerBaseUrl,
    );
    const transport = await this.transport.model(credentials);
    // Chat Completions cannot carry pictures in a tool result; the bridge moves them into the next user message.
    const model = run.providerId === "openai-compatible" ? pictureBridgedModel(transport) : transport;
    return new SdkRunner({
      modelProvider: { getModel: () => model },
      modelSettings: {
        ...requiredModelSettings(run.providerId, credentials.model),
        ...(run.reasoningEffort ? reasoningModelSettings(run.providerId, credentials.model, run.reasoningEffort) : {}),
      },
      // Without stored responses, replayed reasoning items must not point at ids the server never kept.
      ...(run.providerId === "chatgpt" ? { reasoningItemIdPolicy: "omit" as const } : {}),
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
    });
  }

  /** Aborts an active run. The caller is responsible for the status change. */
  abort(runId: string): void {
    this.active.get(runId)?.controller.abort(CANCEL_REASON);
  }

  onModuleDestroy(): void {
    for (const runId of this.active.keys()) this.abort(runId);
  }

  private launch(
    run: AgentRunRecord,
    progress: RunProgress,
    first: (context: AgentRunContext, signal: AbortSignal) => Promise<RunResult>,
  ): void {
    const controller = new AbortController();
    const clock = new RunClock(
      {
        totalMs: this.config.agents.runTimeoutMs,
        idleMs: this.config.agents.runIdleTimeoutMs,
      },
      (stop) => controller.abort(stop === "timeout" ? TIMEOUT_REASON : STALL_REASON),
    );
    // Any event of the run is a sign of progress; a run that goes quiet for too long is stopped.
    const unsubscribe = this.events.subscribe(run.id, () => clock.touch());
    this.active.set(run.id, { controller, clock, unsubscribe });

    const context: AgentRunContext = {
      runId: run.id,
      userId: run.userId,
      projectId: run.projectId,
      sessionId: run.sessionId,
      clientId: run.editorClientId ?? "",
      dimension: run.dimension,
      selectedSkillIds: run.selectedSkillIds,
      events: this.events.sinkFor(run.id),
      signal: controller.signal,
      progress,
      supportsToolImages: this.providers.picturesAllowed(run.userId, run.providerId),
    };

    clock.start();
    this.drive(run, context, controller.signal, () => first(context, controller.signal)).catch((error: unknown) => {
      this.logger.error(`run ${run.id} crashed in the processor`, error instanceof Error ? error.stack : undefined);
    });
  }

  /**
   * Streams each model turn. When a turn ends with work still open, it asks the model to carry on, up to the
   * configured limit. Approvals pause the run; the stored state and progress let it resume later.
   */
  private async drive(
    run: AgentRunRecord,
    context: AgentRunContext,
    signal: AbortSignal,
    first: () => Promise<RunResult>,
  ): Promise<void> {
    try {
      let result = await first();
      let totals = NO_TOTALS;
      let continuations = 0;
      for (;;) {
        for await (const event of result) this.handleStreamEvent(run.id, event);
        await result.completed;
        totals = addTotals(totals, result.state.usage);

        if (this.isCancelled(run.id)) return;
        if (result.interruptions.length > 0) {
          this.pauseForApprovals(run, context, result);
          return;
        }

        if (context.progress.quality.required && context.progress.quality.outcome === "ready") {
          // Another editor can change the scene after assessment. Never claim the old review covers it.
          let revision: number | null = null;
          try {
            this.bridge.assertConnection(context.userId, context.projectId, context.clientId);
            revision = (await this.bridge.getContext(context.clientId)).revision;
          } catch {
            // A disconnected editor leaves the review unverified, not a false success.
          }
          invalidateStaleQualityReview(context.progress, revision);
        }
        const reasonsNow = () =>
          openWorkReasons(context.progress, (proposalId) => this.proposalStatus(run.id, proposalId));
        let reasons = reasonsNow();
        // The builder has nothing left open, so a different agent looks at the result before the run may end. What it
        // finds comes back as work for the builder, in the same way as an unfinished step.
        if (reasons.length === 0 && reviewDue(context.progress, this.config.agents.reviewLimit)) {
          // The reviewer's model calls are part of what this run cost.
          totals = addTotals(totals, await this.review(run, context, signal));
          if (this.isCancelled(run.id)) return;
          reasons = reasonsNow();
        }
        // A continuation that answers again without a tool call has chosen to stop, most likely to ask the user
        // something. The run ends with that reply instead of repeating the request until the limit.
        const acted = result.newItems.some((item) => item.type === "tool_call_item");
        if (
          reasons.length === 0 ||
          continuations >= this.config.agents.continuationLimit ||
          (continuations > 0 && !acted)
        ) {
          this.complete(run.id, result, totals, completionNotice(context.progress, context.supportsToolImages));
          return;
        }

        continuations += 1;
        this.logger.log(`run ${run.id} continues (${continuations}): ${reasons.join("; ")}`);
        this.events.publish(run.id, "agent.continued", {
          attempt: continuations,
          reasons,
        });
        result = await this.turn(run, context, signal, continuationPrompt(reasons));
      }
    } catch (error) {
      if (this.isCancelled(run.id)) return;
      this.fail(run, error, stopOf(signal.reason));
    } finally {
      this.disarm(run.id);
    }
  }

  /**
   * Has the independent reviewer judge the finished work. It starts with no history and no memory of the build, with
   * read-only tools, and records its verdict through the same quality tool the builder no longer has. A review that cannot
   * run is recorded as blocked, never as approval.
   */
  private async review(run: AgentRunRecord, context: AgentRunContext, signal: AbortSignal): Promise<RunTotals> {
    const quality = context.progress.quality;
    quality.reviews += 1;
    const attempt = quality.reviews;
    // Written before anything is cleared: a later review is told what the earlier one asked for.
    const request = buildReviewRequest(run.input, context.progress);
    // Pictures the builder took do not count: the reviewer has to look for itself, at the scene as it is now.
    quality.captureRevision = null;
    quality.viewpoints = [];
    quality.findings = [];
    quality.summary = "";
    quality.viewportUnavailable = false;
    this.events.publish(run.id, "review.started", { attempt });
    const blocked = (summary: string) => {
      quality.outcome = "blocked";
      quality.summary = summary;
    };
    let result: RunResult | undefined;
    try {
      const runner = await this.runnerFor(run);
      // Streamed, so a slow model call still counts as activity and does not trip the idle limit. The reviewer's words are
      // not forwarded: the user reads the builder's reply, and sees the review as one step.
      result = await runner.run(this.agents.agent(QUALITY_REVIEWER_ID), request, {
        stream: true,
        context,
        signal,
        maxTurns: this.config.agents.reviewMaxTurns,
      });
      for await (const event of result) {
        void event;
        this.active.get(run.id)?.clock.touch();
      }
      await result.completed;
    } catch (error) {
      // A stop, a timeout and a cancellation end the whole run; anything else only ends the review.
      if (signal.aborted || this.isCancelled(run.id)) throw error;
      this.logger.warn(`run ${run.id} review ${attempt} failed: ${describeError(error)}`);
      if (quality.outcome === null) blocked("The independent review could not be completed.");
    }
    if (quality.outcome === null) blocked("The reviewer finished without recording a verdict.");
    this.events.publish(run.id, "review.completed", {
      attempt,
      outcome: quality.outcome ?? "blocked",
      summary: quality.summary.slice(0, 300),
      findingCount: quality.findings.length,
    });
    return result ? addTotals(NO_TOTALS, result.state.usage) : NO_TOTALS;
  }

  /** Stops the clock and forgets the run. Safe to call more than once. */
  private disarm(runId: string): void {
    const entry = this.active.get(runId);
    if (!entry) return;
    entry.clock.stop();
    entry.unsubscribe();
    this.active.delete(runId);
  }

  private proposalStatus(runId: string, proposalId: string): string | undefined {
    try {
      return this.proposals.require(runId, proposalId).status;
    } catch {
      return undefined;
    }
  }

  private handleStreamEvent(runId: string, event: RunStreamEvent): void {
    this.active.get(runId)?.clock.touch();
    switch (event.type) {
      case "raw_model_stream_event": {
        const delta = extractTextDelta(event.data);
        if (delta !== undefined) this.events.publish(runId, "agent.message.delta", { delta });
        return;
      }
      case "agent_updated_stream_event":
        this.events.publish(runId, "agent.started", {
          agentName: event.agent.name,
        });
        return;
      case "run_item_stream_event":
        // Tool progress is published by the tool wrapper, and reasoning items are never forwarded.
        if (event.name === "message_output_created") {
          this.events.publish(runId, "agent.message.completed", {
            text: extractAllTextOutput([event.item]),
          });
        }
        return;
    }
  }

  private pauseForApprovals(run: AgentRunRecord, context: AgentRunContext, result: RunResult): void {
    const serialized = result.state.toString();
    for (const item of result.interruptions) {
      const callId = interruptionCallId(item.rawItem);
      if (!callId) throw new Error("Interrupted tool call has no call id");
      const toolName = toRegistryToolName(item.name) ?? "unknown";
      const preview = this.buildPreview(run.id, toolName, item.arguments);
      const approval = this.approvals.create(run, {
        callId,
        toolName,
        preview,
      });
      this.events.publish(run.id, "approval.required", {
        approvalId: approval.id,
        toolName,
        summary: preview.summary ?? toolName,
        requiresApproval: true,
      });
    }
    // The plans and unfinished work travel with the run, so the resumed run still knows what it set out to do.
    this.setStatus(run.id, "waiting_approval", {
      runState: serialized,
      progressJson: serializeRunProgress(context.progress),
    });
    this.logger.log(`run ${run.id} is waiting for ${result.interruptions.length} approval(s)`);
  }

  private complete(runId: string, result: RunResult, totals: RunTotals, notice?: string): void {
    const original = typeof result.finalOutput === "string" ? result.finalOutput : "";
    const finalOutput = notice ? [original.trimEnd(), notice].filter(Boolean).join("\n\n") : original;
    // The preceding message-completed event already separates paragraphs in the desktop stream.
    if (notice) this.events.publish(runId, "agent.message.delta", { delta: notice });
    this.setStatus(runId, "completed", {
      finalOutput,
      usage: {
        requests: totals.requests,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        totalTokens: totals.totalTokens,
      },
      runState: null,
    });
    this.events.publish(runId, "run.completed", {
      usage: totals.totalTokens,
    });
    this.logger.log(`run ${runId} completed (${totals.totalTokens} tokens)`);
  }

  private fail(run: AgentRunRecord, error: unknown, stop: RunStop | undefined): void {
    const runId = run.id;
    const { code, message } = classifyFailure(error, stop);
    // The client only gets a short message; the full cause stays in the server log.
    this.logger.error(
      `run ${runId} failed with ${code} [provider=${run.providerId ?? "default"} model=${run.providerModel ?? "default"} effort=${run.reasoningEffort ?? "auto"}]: ${describeError(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
    this.setStatus(runId, "failed", {
      errorCode: code,
      errorMessage: message,
      runState: null,
    });
    this.events.publish(runId, "run.failed", { code, message });
  }

  private applyDecisions(state: RunStateOf, runId: string): void {
    const decisions = new Map(this.approvals.decisionsFor(runId).map((decision) => [decision.callId, decision]));
    for (const item of [...state.getInterruptions()]) {
      const callId = interruptionCallId(item.rawItem);
      const decision = callId === undefined ? undefined : decisions.get(callId);
      if (!decision) throw new Error("An interrupted tool call has no approval decision");
      if (decision.approved) {
        state.approve(item);
      } else {
        state.reject(item, {
          message: decision.reason ?? "The user rejected this action",
        });
        // A batch the user refused is no longer waiting for the run to apply it.
        const proposalId =
          toRegistryToolName(item.name) === "editor.apply_proposal" ? parseProposalId(item.arguments) : undefined;
        if (proposalId !== undefined) this.proposals.reject(runId, proposalId);
      }
    }
  }

  /** Previews are built from server-side records, never from model output alone. */
  private buildPreview(runId: string, toolName: string, rawArguments: string | undefined): ApprovalPreview {
    if (toolName !== "editor.apply_proposal") return { toolName, summary: `Run ${toolName}` };

    const proposalId = parseProposalId(rawArguments);
    if (proposalId === undefined) return { toolName, proposalId: null, summary: "Apply a proposed change" };
    try {
      const proposal = this.proposals.require(runId, proposalId);
      return {
        toolName,
        proposalId: proposal.id,
        summary: proposal.summary,
        requiresApproval: proposal.requiresApproval,
        commandCount: proposal.commands.length,
        commands: [...proposal.commands],
      };
    } catch {
      return { toolName, proposalId, summary: "Apply a proposed change" };
    }
  }

  private setStatus(runId: string, to: AgentRunStatus, update: RunUpdate): void {
    this.runs.transition(runId, to, update, new Date().toISOString());
  }

  private isCancelled(runId: string): boolean {
    return this.runs.find(runId)?.status === "cancelled";
  }
}

function parseProposalId(rawArguments: string | undefined): string | undefined {
  if (rawArguments === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "proposalId" in parsed &&
      typeof parsed.proposalId === "string"
    ) {
      return parsed.proposalId;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
