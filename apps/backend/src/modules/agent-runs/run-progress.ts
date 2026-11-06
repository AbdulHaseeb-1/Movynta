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

const qualityReviewSchema = z.object({
  required: z.boolean().default(false),
  changes: z.number().int().nonnegative().default(0),
  captureRevision: z.number().int().nonnegative().nullable().default(null),
  viewpoints: z.array(z.string()).max(12).default([]),
  outcome: z.enum(["ready", "needs_refinement", "blocked"]).nullable().default(null),
  summary: z.string().max(800).default(""),
});

/** Quality gates are for explicit realism/refinement requests, not ordinary small edits or questions. */
export function requiresQualityReview(input: string, dimension: string | undefined): boolean {
  if (dimension !== "3d") return false;
  if (/\b(?:only|just)\s+(?:an?\s+)?(?:rough\s+)?(?:block[ -]?out|draft|prototype)\b/i.test(input)) return false;
  // A realistic object can be the target of a simple transform; that does not ask for a quality upgrade.
  if (/^\s*(?:please\s+)?(?:move|rotate|scale|delete|rename|hide|show|select)\b/i.test(input) && !/\b(?:refine|improve|make .{0,40}(?:realistic|detailed|better))\b/i.test(input)) return false;
  return /\b(?:photo[ -]?real(?:istic|ism)?|realistic|realism|lifelike|life[ -]?like|high[ -]?detail(?:ed)?|highly detailed|detailed|high[ -]?quality|refine|refinement|improve|make (?:it|this|the model) better|more detailed)\b/i.test(input);
}

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
  /** Visual evidence and the model's assessment; older paused runs have no quality state. */
  quality: qualityReviewSchema.default(() => qualityReviewSchema.parse({})),
});

export type RunProgress = z.infer<typeof runProgressSchema>;
export type ProposalRecord = RunProgress["proposals"][number];

/** Returns the state where nothing has been planned, proposed or changed. */
export function emptyRunProgress(): RunProgress {
  return { plans: [], proposals: [], unverifiedChanges: false, sceneErrors: 0, quality: qualityReviewSchema.parse({}) };
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
  if (progress.quality.required && progress.quality.changes > 0) {
    if (progress.quality.outcome === null) reasons.push("the requested quality work needs a fresh visual review: capture at least two distinct live views and call modeling.assess_quality, or report a concrete blocker");
    if (progress.quality.outcome === "needs_refinement") reasons.push("the latest quality review identified issues: refine the scene, then capture and assess the new result, or record a blocker");
  }
  return reasons;
}

/** The message that asks the model to carry on, listing the reasons the run is not finished. */
export function continuationPrompt(reasons: readonly string[]): string {
  return [
    "The work is not finished yet:",
    ...reasons.map((reason) => `- ${reason}`),
    "Continue with tool calls until each item is done: apply the waiting batches, name plan steps with stepId, and run validation.check_scene after changes.",
    "When a quality review is requested, do not claim realism from structural validation. Use modeling.assess_quality after inspecting fresh live views, make targeted improvements when needed, and be specific about unresolved limitations.",
    "If images are unavailable or a limitation prevents further work, record a blocked assessment explaining it. If you cannot finish without a decision from the user, ask one specific question and stop.",
  ].join("\n");
}

/** Invalidate a ready review if the scene changed or could not be checked before completion. */
export function invalidateStaleQualityReview(progress: RunProgress, revision: number | null): void {
  const quality = progress.quality;
  if (quality.required && quality.outcome === "ready" && (revision === null || quality.captureRevision !== revision)) {
    quality.captureRevision = null;
    quality.viewpoints = [];
    quality.outcome = null;
    quality.summary = "";
  }
}

/** A deterministic disclosure when the quality gate was not satisfied or was blocked. */
export function qualityCompletionNotice(progress: RunProgress, supportsImages: boolean): string | undefined {
  const quality = progress.quality;
  if (!quality.required || quality.changes === 0 || quality.outcome === "ready") return undefined;
  if (quality.outcome === "blocked") return `Quality review was blocked: ${quality.summary}${supportsImages ? "" : " Images were not available to the model, so the result was not visually verified."}`;
  const issue = quality.outcome === "needs_refinement" ? ` The last review found: ${quality.summary}` : " A final visual quality review was not completed.";
  return `The requested quality is not verified; the result may still be unfinished.${issue}${supportsImages ? "" : " Images were not available to the model, so the result was not visually verified."}`;
}
