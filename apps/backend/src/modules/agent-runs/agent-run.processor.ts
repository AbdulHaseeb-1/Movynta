import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import {
  extractAllTextOutput,
  InputGuardrailTripwireTriggered,
  MaxTurnsExceededError,
  RunContext,
  RunState,
  type Runner,
  type RunStreamEvent,
  type StreamedRunResult,
} from "@openai/agents";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig } from "../../config/configuration.js";
import { AgentRegistry } from "../agents/agent.registry.js";
import { AGENT_RUNNER } from "../agents/agent.tokens.js";
import type { AppAgent } from "../agents/definitions/agent-definition.js";
import type { ApprovalPreview } from "../approvals/approval.preview.js";
import { ApprovalsService } from "../approvals/approvals.service.js";
import { CommandProposalService } from "../editor-bridge/proposals/command-proposal.service.js";
import { SessionsService } from "../sessions/sessions.service.js";
import type { AgentRunContext } from "./agent-run.context.js";
import { AgentRunEventsService } from "./agent-run-events.service.js";
import { AgentRunRepository, type AgentRunRecord, type RunUpdate } from "./agent-run.repository.js";
import type { AgentRunStatus } from "./agent-run.state-machine.js";
import { extractTextDelta, interruptionCallId, toRegistryToolName } from "./agent-run.stream-mapper.js";

type RunResult = StreamedRunResult<AgentRunContext, AppAgent>;
type RunStateOf = RunState<AgentRunContext, AppAgent>;

/** Abort reasons, so the processor can tell a timeout from a cancellation. */
const TIMEOUT_REASON = "run_timeout";
const CANCEL_REASON = "run_cancelled";

interface ActiveRun {
  readonly controller: AbortController;
  readonly timer: NodeJS.Timeout;
}

/** Runs the SDK agent for a run record: streams its events, pauses for approvals, and resumes after decisions. */
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
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Starts a run in the background. Failures are recorded on the run, never thrown to the caller. */
  start(run: AgentRunRecord): void {
    this.launch(run, (context, signal) =>
      this.runner.run(this.agents.agent(run.agentId), run.input, {
        stream: true,
        context,
        session: this.sessions.store(run.sessionId),
        signal,
        maxTurns: this.config.agents.maxTurns,
      }),
    );
  }

  /** Continues a run that was waiting for approval, after every decision has been recorded. */
  resume(run: AgentRunRecord): void {
    this.launch(run, async (context, signal) => {
      const agent = this.agents.agent(run.agentId);
      const serialized = this.runs.readRunState(run.id);
      if (!serialized) throw new Error("Run state is missing");
      // The restored state keeps its approval records; the run context is merged in so tools get live handles.
      const state = await RunState.fromStringWithContext<AgentRunContext, AppAgent>(
        agent,
        serialized,
        new RunContext<AgentRunContext>(context),
        { contextStrategy: "merge" },
      );
      this.applyDecisions(state, run.id);
      return this.runner.run(agent, state, {
        stream: true,
        session: this.sessions.store(run.sessionId),
        signal,
        maxTurns: this.config.agents.maxTurns,
      });
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
    execute: (context: AgentRunContext, signal: AbortSignal) => Promise<RunResult> | RunResult,
  ): void {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(TIMEOUT_REASON), this.config.agents.runTimeoutMs);
    this.active.set(run.id, { controller, timer });

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
      plans: [],
    };

    this.drive(run, () => execute(context, controller.signal)).catch((error: unknown) => {
      this.logger.error(`run ${run.id} crashed in the processor`, error instanceof Error ? error.stack : undefined);
    });
  }

  private async drive(run: AgentRunRecord, execute: () => Promise<RunResult> | RunResult): Promise<void> {
    const entry = this.active.get(run.id);
    try {
      const result = await execute();
      for await (const event of result) this.handleStreamEvent(run.id, event);
      await result.completed;

      if (this.isCancelled(run.id)) return;
      if (result.interruptions.length > 0) {
        this.pauseForApprovals(run, result);
      } else {
        this.complete(run.id, result);
      }
    } catch (error) {
      if (this.isCancelled(run.id)) return;
      this.fail(run.id, error, entry?.controller.signal.reason === TIMEOUT_REASON);
    } finally {
      if (entry) clearTimeout(entry.timer);
      this.active.delete(run.id);
    }
  }

  private handleStreamEvent(runId: string, event: RunStreamEvent): void {
    switch (event.type) {
      case "raw_model_stream_event": {
        const delta = extractTextDelta(event.data);
        if (delta !== undefined) this.events.publish(runId, "agent.message.delta", { delta });
        return;
      }
      case "agent_updated_stream_event":
        this.events.publish(runId, "agent.started", { agentName: event.agent.name });
        return;
      case "run_item_stream_event":
        // Tool progress is published by the tool wrapper, and reasoning items are never forwarded.
        if (event.name === "message_output_created") {
          this.events.publish(runId, "agent.message.completed", { text: extractAllTextOutput([event.item]) });
        }
        return;
    }
  }

  private pauseForApprovals(run: AgentRunRecord, result: RunResult): void {
    const serialized = result.state.toString();
    for (const item of result.interruptions) {
      const callId = interruptionCallId(item.rawItem);
      if (!callId) throw new Error("Interrupted tool call has no call id");
      const toolName = toRegistryToolName(item.name) ?? "unknown";
      const preview = this.buildPreview(run.id, toolName, item.arguments);
      const approval = this.approvals.create(run, { callId, toolName, preview });
      this.events.publish(run.id, "approval.required", {
        approvalId: approval.id,
        toolName,
        summary: preview.summary ?? toolName,
        requiresApproval: true,
      });
    }
    this.setStatus(run.id, "waiting_approval", { runState: serialized });
    this.logger.log(`run ${run.id} is waiting for ${result.interruptions.length} approval(s)`);
  }

  private complete(runId: string, result: RunResult): void {
    const usage = result.state.usage;
    const finalOutput = typeof result.finalOutput === "string" ? result.finalOutput : "";
    this.setStatus(runId, "completed", {
      finalOutput,
      usage: {
        requests: usage.requests,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      },
      runState: null,
    });
    this.events.publish(runId, "run.completed", { usage: usage.totalTokens });
    this.logger.log(`run ${runId} completed (${usage.totalTokens} tokens)`);
  }

  private fail(runId: string, error: unknown, timedOut: boolean): void {
    const { code, message } = classifyFailure(error, timedOut);
    this.logger.warn(`run ${runId} failed with ${code}`);
    this.setStatus(runId, "failed", { errorCode: code, errorMessage: message, runState: null });
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
        state.reject(item, { message: decision.reason ?? "The user rejected this action" });
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
    if (typeof parsed === "object" && parsed !== null && "proposalId" in parsed && typeof parsed.proposalId === "string") {
      return parsed.proposalId;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Maps failures to stable codes and messages that are safe to show to clients. */
export function classifyFailure(error: unknown, timedOut: boolean): { code: string; message: string } {
  if (timedOut) return { code: "run_timeout", message: "The agent run exceeded its time limit" };
  if (error instanceof InputGuardrailTripwireTriggered) {
    return { code: "guardrail_blocked", message: "This request cannot be processed" };
  }
  if (error instanceof MaxTurnsExceededError) {
    return { code: "max_turns_exceeded", message: "The agent reached its step limit" };
  }
  return { code: "run_failed", message: "The agent run failed" };
}
