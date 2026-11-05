import { z } from "zod";
import { modelingPlanSchema } from "../../shared/schemas/modeling-plan.schema.js";

/** Tools whose batches change the scene. A plan step that names one of them is work the run must finish. */
const SCENE_STEP_TOOLS: ReadonlySet<string> = new Set([
  "editor.propose_commands",
  "modeling.generate_commands",
  "modeling.propose_generated",
]);

const proposalRecordSchema = z.object({
  id: z.string(),
  stepId: z.string().optional(),
});

/**
 * What a run has done so far, kept by the tools and read when a run might be finished. It is saved with the
 * run when it pauses for an approval, so a resumed run still knows its plan and its unfinished work.
 */
export const runProgressSchema = z.object({
  /** Plans recorded in this run, in order. The latest one is the current plan. */
  plans: z.array(modelingPlanSchema),
  /** Every batch the run proposed, with the plan step it was recorded against. */
  proposals: z.array(proposalRecordSchema),
  /** True after a batch was applied and before validation.check_scene ran again. */
  unverifiedChanges: z.boolean(),
  /** Error-severity issues in the last scene check. */
  sceneErrors: z.number().int().nonnegative(),
});

export type RunProgress = z.infer<typeof runProgressSchema>;
export type ProposalRecord = RunProgress["proposals"][number];

/** Returns the state where nothing has been planned, proposed or changed. */
export function emptyRunProgress(): RunProgress {
  return { plans: [], proposals: [], unverifiedChanges: false, sceneErrors: 0 };
}

export function serializeRunProgress(progress: RunProgress): string {
  return JSON.stringify(progress);
}

export function parseRunProgress(json: string): RunProgress {
  return runProgressSchema.parse(JSON.parse(json));
}

/** Reports the status of a proposal of this run, or undefined when it is unknown. */
export type ProposalStatusLookup = (proposalId: string) => string | undefined;

/**
 * Lists what keeps a run from being finished, in words the model can act on. An empty list means the run may
 * end: every scene step of the latest plan has an applied batch, no batch is left waiting, and the last
 * change was checked without errors.
 */
export function openWorkReasons(progress: RunProgress, statusOf: ProposalStatusLookup): string[] {
  const reasons: string[] = [];
  const latestPlan = progress.plans.at(-1);
  // Steps are held to account when the plan has no batch yet, or when batches name its steps. A run whose batches
  // never name a step is not held to step names, so an unnamed batch does not keep the run open.
  const namesSteps =
    latestPlan !== undefined &&
    progress.proposals.some(
      (proposal) => latestPlan.steps.some((step) => step.id === proposal.stepId),
    );
  if (latestPlan && (namesSteps || progress.proposals.length === 0)) {
    const applied = new Set(
      progress.proposals
        .filter((proposal) => proposal.stepId !== undefined && statusOf(proposal.id) === "applied")
        .map((proposal) => proposal.stepId),
    );
    for (const step of latestPlan.steps) {
      if (SCENE_STEP_TOOLS.has(step.toolName) && !applied.has(step.id)) {
        reasons.push(`plan step "${step.title}" (stepId ${step.id}) has no applied batch`);
      }
    }
  }

  const waiting = progress.proposals.filter((proposal) => statusOf(proposal.id) === "proposed").length;
  if (waiting > 0) {
    reasons.push(`${waiting} proposed batch${waiting === 1 ? " is" : "es are"} not applied`);
  }
  if (progress.unverifiedChanges) {
    reasons.push("the scene changed after its last check, so run validation.check_scene");
  }
  if (progress.sceneErrors > 0) {
    reasons.push(`the last scene check reported ${progress.sceneErrors} error${progress.sceneErrors === 1 ? "" : "s"}`);
  }
  return reasons;
}

/** The message that asks the model to carry on, listing the reasons the run is not finished. */
export function continuationPrompt(reasons: readonly string[]): string {
  return [
    "The work is not finished yet:",
    ...reasons.map((reason) => `- ${reason}`),
    "Continue with tool calls until each item is done: apply the waiting batches, name plan steps with stepId, and run validation.check_scene after changes.",
    "If you cannot finish without a decision from the user, ask one specific question and stop.",
  ].join("\n");
}
