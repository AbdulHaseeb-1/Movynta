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
  | { readonly ok: false; readonly rejection: { readonly status: "rejected"; readonly reason: string; readonly availableStepIds: readonly string[] } };

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
    ? "Applied. Run validation.check_scene once you have made the changes this step needs."
    : "Not applied. Read message and each result, fix those commands and propose again.";
}
