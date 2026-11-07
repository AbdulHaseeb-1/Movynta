import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import type { CommandExecutionResult } from "../../editor-bridge/editor-bridge.types.js";
import type { CommandProposalService } from "../../editor-bridge/proposals/command-proposal.service.js";
import type { CommandProposalRecord, ProposalRun } from "../../editor-bridge/proposals/proposals.types.js";

/**
 * The bookkeeping every tool that proposes or applies a batch shares, so a batch counts the same however it reached the
 * editor: one call that proposes and applies, or a proposal applied by editor.apply_proposal later.
 */

/** The run a proposal belongs to, in the form the proposal service checks ownership with. */
export function proposalRun(context: AgentRunContext): ProposalRun {
  return { id: context.runId, userId: context.userId, projectId: context.projectId, clientId: context.clientId };
}

/** A plan step a batch carries out, or why the stepId names none. */
export type PlanStepLookup =
  | { readonly ok: true; readonly step: { readonly id: string; readonly title: string } | undefined }
  | {
      readonly ok: false;
      readonly rejection: {
        readonly status: "rejected";
        readonly reason: string;
        readonly availableStepIds: readonly string[];
      };
    };

/** Finds `stepId` in the latest plan. Leaving it out is fine; naming a step that is not there is refused. */
export function resolvePlanStep(context: AgentRunContext, stepId: string | undefined): PlanStepLookup {
  if (stepId === undefined) return { ok: true, step: undefined };
  const steps = context.progress.plans.at(-1)?.steps ?? [];
  const step = steps.find((candidate) => candidate.id === stepId);
  if (step) return { ok: true, step: { id: step.id, title: step.title } };
  return {
    ok: false,
    rejection: {
      status: "rejected",
      reason: "stepId does not match a step of the latest plan. Record a plan first, or leave stepId out.",
      availableStepIds: steps.map((candidate) => candidate.id),
    },
  };
}

/** Records a new proposal with the run and tells the chat about it. */
export function recordProposal(
  context: AgentRunContext,
  proposal: CommandProposalRecord,
  options: { readonly stepId: string | undefined; readonly supersedes: string | undefined },
): void {
  context.progress.proposals.push({ id: proposal.id, ...(options.stepId ? { stepId: options.stepId } : {}) });
  context.events.emit("editor.proposal.created", {
    proposalId: proposal.id,
    summary: proposal.summary,
    requiresApproval: proposal.requiresApproval,
    commandCount: proposal.commands.length,
    baseRevision: proposal.baseRevision,
    supersedes: options.supersedes ?? null,
    planStepId: options.stepId ?? null,
  });
}

/**
 * How many batches may be applied before the scene is checked. A chunk of work is one part of the model, which often
 * takes a few batches (make it, place it, shape it); what follows must wait for the check of what came before.
 */
export const MAX_UNCHECKED_BATCHES = 3;

/**
 * The most commands a hand-written batch may hold. A bigger batch is several parts at once, and a mistake in it
 * cannot be told from the rest. Batches a tool calculated (a planId, or a generated proposal) are not held to this.
 */
export const MAX_HAND_WRITTEN_COMMANDS = 40;

export interface ChunkRejection {
  readonly status: "rejected";
  readonly reason: string;
  readonly nextAction: string;
}

/**
 * Refuses a new batch while earlier work is unchecked, or when a hand-written batch is too big to be one chunk.
 * The refusal says what to do, so the run goes on after the step it asks for.
 */
export function chunkRejection(
  context: AgentRunContext,
  batch: { readonly handWrittenCommands?: number },
): ChunkRejection | undefined {
  const { batchesSinceCheck } = context.progress;
  if (batchesSinceCheck >= MAX_UNCHECKED_BATCHES) {
    return {
      status: "rejected",
      reason: `${batchesSinceCheck} batches have been applied since the scene was last checked. Verify this chunk before starting the next.`,
      nextAction:
        "Call validation.check_scene, then measure or capture what you just built and fix anything wrong. Then propose the next chunk.",
    };
  }
  const size = batch.handWrittenCommands ?? 0;
  if (size > MAX_HAND_WRITTEN_COMMANDS) {
    return {
      status: "rejected",
      reason: `This batch has ${size} commands; a hand-written batch may have at most ${MAX_HAND_WRITTEN_COMMANDS}. Split the work into chunks, one part of the model each.`,
      nextAction:
        "Propose the first part alone, apply it, check it, then propose the next. For many identical parts use editor.plan_duplicates or modeling.generate_commands, which are not held to this limit.",
    };
  }
  return undefined;
}

/** What the model is told about an apply attempt. */
export interface ApplyView {
  readonly proposalId: string;
  readonly status: CommandExecutionResult["status"];
  readonly revision: number | null;
  readonly results: CommandExecutionResult["results"];
  readonly message: string | null;
  readonly rebased: boolean;
}

/**
 * Applies a proposal and, when it applied, marks what the change makes stale: the scene check, the brief's
 * measurements and any pictures a review would rely on.
 */
export async function applyProposal(
  proposals: Pick<CommandProposalService, "apply">,
  context: AgentRunContext,
  proposalId: string,
): Promise<ApplyView> {
  const result = await proposals.apply(proposalRun(context), proposalId);
  if (result.status === "applied") {
    context.progress.unverifiedChanges = true;
    context.progress.batchesSinceCheck += 1;
    context.progress.brief.stale = true;
    const quality = context.progress.quality;
    quality.changes += 1;
    quality.captureRevision = null;
    quality.viewpoints = [];
    quality.outcome = null;
    quality.summary = "";
  }
  return {
    proposalId: result.proposalId,
    status: result.status,
    revision: result.revision ?? null,
    results: result.results,
    message: result.message ?? null,
    rebased: result.rebased ?? false,
  };
}

/** The next step after an apply, so the model does not have to work it out from the status. */
export function afterApply(view: ApplyView): string {
  return view.status === "applied"
    ? "Applied. Finish what this chunk needs, then verify it before starting the next: validation.check_scene, then measure or capture the part you built."
    : "Not applied. Read message and each result, fix those commands and propose again.";
}
