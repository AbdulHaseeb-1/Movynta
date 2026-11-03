import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  extractAllTextOutput,
  RunContext,
  RunState,
  Runner as SdkRunner,
  type Runner,
  type RunStreamEvent,
} from "@openai/agents";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig } from "../../config/config.types.js";
import { AgentRegistry } from "../agents/agent.registry.js";
import { AGENT_RUNNER } from "../agents/agent.tokens.js";
import type { AppAgent } from "../agents/definitions/definitions.types.js";
import type { ApprovalPreview } from "../approvals/approvals.types.js";
import { ApprovalsService } from "../approvals/approvals.service.js";
import { CommandProposalService } from "../editor-bridge/proposals/command-proposal.service.js";
import { SessionsService } from "../sessions/sessions.service.js";
import { AgentRunEventsService } from "./agent-run-events.service.js";
import { classifyFailure, describeError } from "./agent-run.failure.js";
import { AgentRunRepository } from "./agent-run.repository.js";
import { ProvidersService } from "../providers/providers.service.js";
import { ProviderTransport } from "../providers/provider-transport.js";
import {
  reasoningModelSettings,
  requiredModelSettings,
} from "../providers/model-capabilities.js";
import {
  extractTextDelta,
  interruptionCallId,
  toRegistryToolName,
} from "./agent-run.stream-mapper.js";
import type {
  ActiveRun,
  AgentRunContext,
  AgentRunRecord,
  AgentRunStatus,
  RunResult,
  RunStateOf,
  RunUpdate,
} from "./agent-runs.types.js";

/** Abort reasons, so the processor can tell a timeout from a cancellation. */
const TIMEOUT_REASON = "run_timeout";
const CANCEL_REASON = "run_cancelled";

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
    private readonly providers: ProvidersService,
    private readonly transport: ProviderTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Starts a run in the background. Failures are recorded on the run, never thrown to the caller. */
  start(run: AgentRunRecord): void {
    this.launch(run, async (context, signal) =>
      (await this.runnerFor(run)).run(
        this.agents.agent(run.agentId),
        run.input,
        {
          stream: true,
          context,
          session: this.sessions.store(run.sessionId),
          signal,
          maxTurns: this.config.agents.maxTurns,
        },
      ),
    );
  }

  /** Continues a run that was waiting for approval, after every decision has been recorded. */
  resume(run: AgentRunRecord): void {
    this.launch(run, async (context, signal) => {
      const agent = this.agents.agent(run.agentId);
      const serialized = this.runs.readRunState(run.id);
      if (!serialized) throw new Error("Run state is missing");
      // The restored state keeps its approval records; the run context is merged in so tools get live handles.
      const state = await RunState.fromStringWithContext<
        AgentRunContext,
        AppAgent
      >(agent, serialized, new RunContext<AgentRunContext>(context), {
        contextStrategy: "merge",
      });
      this.applyDecisions(state, run.id);
      return (await this.runnerFor(run)).run(agent, state, {
        stream: true,
        session: this.sessions.store(run.sessionId),
        signal,
        maxTurns: this.config.agents.maxTurns,
      });
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
    const model = await this.transport.model(credentials);
    return new SdkRunner({
      modelProvider: { getModel: () => model },
      modelSettings: {
        ...requiredModelSettings(run.providerId),
        ...(run.reasoningEffort
          ? reasoningModelSettings(
              run.providerId,
              credentials.model,
              run.reasoningEffort,
            )
          : {}),
      },
      // Without stored responses, replayed reasoning items must not point at ids the server never kept.
      ...(run.providerId === "chatgpt"
        ? { reasoningItemIdPolicy: "omit" as const }
        : {}),
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
    execute: (
      context: AgentRunContext,
      signal: AbortSignal,
    ) => Promise<RunResult> | RunResult,
  ): void {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(TIMEOUT_REASON),
      this.config.agents.runTimeoutMs,
    );
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
      // Chat Completions tool messages carry text only; every other transport accepts images in tool results.
      supportsToolImages: run.providerId !== "openai-compatible",
    };

    this.drive(run, () => execute(context, controller.signal)).catch(
      (error: unknown) => {
        this.logger.error(
          `run ${run.id} crashed in the processor`,
          error instanceof Error ? error.stack : undefined,
        );
      },
    );
  }

  private async drive(
    run: AgentRunRecord,
    execute: () => Promise<RunResult> | RunResult,
  ): Promise<void> {
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
      this.fail(
        run,
        error,
        entry?.controller.signal.reason === TIMEOUT_REASON,
      );
    } finally {
      if (entry) clearTimeout(entry.timer);
      this.active.delete(run.id);
    }
  }

  private handleStreamEvent(runId: string, event: RunStreamEvent): void {
    switch (event.type) {
      case "raw_model_stream_event": {
        const delta = extractTextDelta(event.data);
        if (delta !== undefined)
          this.events.publish(runId, "agent.message.delta", { delta });
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

  private pauseForApprovals(run: AgentRunRecord, result: RunResult): void {
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
    this.setStatus(run.id, "waiting_approval", { runState: serialized });
    this.logger.log(
      `run ${run.id} is waiting for ${result.interruptions.length} approval(s)`,
    );
  }

  private complete(runId: string, result: RunResult): void {
    const usage = result.state.usage;
    const finalOutput =
      typeof result.finalOutput === "string" ? result.finalOutput : "";
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

  private fail(run: AgentRunRecord, error: unknown, timedOut: boolean): void {
    const runId = run.id;
    const { code, message } = classifyFailure(error, timedOut);
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
    const decisions = new Map(
      this.approvals
        .decisionsFor(runId)
        .map((decision) => [decision.callId, decision]),
    );
    for (const item of [...state.getInterruptions()]) {
      const callId = interruptionCallId(item.rawItem);
      const decision = callId === undefined ? undefined : decisions.get(callId);
      if (!decision)
        throw new Error("An interrupted tool call has no approval decision");
      if (decision.approved) {
        state.approve(item);
      } else {
        state.reject(item, {
          message: decision.reason ?? "The user rejected this action",
        });
      }
    }
  }

  /** Previews are built from server-side records, never from model output alone. */
  private buildPreview(
    runId: string,
    toolName: string,
    rawArguments: string | undefined,
  ): ApprovalPreview {
    if (toolName !== "editor.apply_proposal")
      return { toolName, summary: `Run ${toolName}` };

    const proposalId = parseProposalId(rawArguments);
    if (proposalId === undefined)
      return { toolName, proposalId: null, summary: "Apply a proposed change" };
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

  private setStatus(
    runId: string,
    to: AgentRunStatus,
    update: RunUpdate,
  ): void {
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
