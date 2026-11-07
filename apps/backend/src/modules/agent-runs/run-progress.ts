import { z } from "zod";
import { briefSchema, type BriefEvaluation } from "@movynta/editor-protocol";
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

/** How many planned batches a run keeps; an older one is dropped and has to be planned again. */
export const MAX_PLANNED_BATCHES = 10;

/**
 * Commands a planning tool worked out and validated, kept so editor.propose_commands can take them by `planId`
 * instead of the model copying every command, and every generated id, back into its next call.
 */
const plannedBatchSchema = z.object({
  id: z.string(),
  /** The tool that planned it, for the model to recognise it by. */
  tool: z.string(),
  sourceRevision: z.number().int().nonnegative(),
  commands: z.array(z.unknown()).min(1).max(200),
});
/** A batch of commands the planning tools calculated and kept under a planId. */
export type PlannedBatch = z.infer<typeof plannedBatchSchema>;

/** One thing the independent reviewer found wrong or right, with what to change. */
const reviewFindingSchema = z.object({
  aspect: z.string().max(80),
  observation: z.string().max(300),
  severity: z.enum(["major", "minor"]),
  fix: z.string().max(240).optional(),
});
/** One finding of the independent review, with a severity and, optionally, a fix. */
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

/** Which runs are reviewed by a separate agent: none, those that ask for quality, or every build. */
export const REVIEW_MODES = ["off", "quality", "builds"] as const;
/** When the independent review runs: never, for quality requests, or for every build. */
export type ReviewMode = (typeof REVIEW_MODES)[number];

const qualityReviewSchema = z.object({
  /** True when the finished work must be reviewed by the independent reviewer. */
  required: z.boolean().default(false),
  /** True after a picture request failed and until one succeeds: the viewport cannot draw, so nothing can be seen. */
  viewportUnavailable: z.boolean().default(false),
  /** How many independent reviews this run has had. */
  reviews: z.number().int().nonnegative().default(0),
  /** What the latest review found, kept to send the builder back to work. */
  findings: z.array(reviewFindingSchema).max(8).default([]),
  changes: z.number().int().nonnegative().default(0),
  captureRevision: z.number().int().nonnegative().nullable().default(null),
  viewpoints: z.array(z.string()).max(12).default([]),
  outcome: z.enum(["ready", "needs_refinement", "blocked"]).nullable().default(null),
  summary: z.string().max(800).default(""),
});

const briefStateSchema = z.object({
  /** The brief the run is working to, or null before one is recorded. */
  current: briefSchema.nullable().default(null),
  /** How many times the brief was replaced after it was first recorded. Shown to the user at the end. */
  revisions: z.number().int().nonnegative().default(0),
  /** True after the brief was recorded or a change was applied, and before its checks ran again. */
  stale: z.boolean().default(false),
  /** The latest measurement of the checks, kept short. */
  last: z
    .object({
      revision: z.number().int().nonnegative(),
      measurable: z.boolean(),
      total: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      /** One line for each check that did not pass: what it is, what was measured and what was needed. */
      failing: z.array(z.string().max(400)).max(40),
    })
    .nullable()
    .default(null),
});

/**
 * Whether the finished work is reviewed by a separate agent. By default that is for explicit realism and refinement
 * requests, not ordinary small edits or questions; "builds" reviews every 3D request that is not a simple transform.
 */
export function requiresQualityReview(
  input: string,
  dimension: string | undefined,
  mode: ReviewMode = "quality",
): boolean {
  if (mode === "off" || dimension !== "3d") return false;
  if (/\b(?:only|just)\s+(?:an?\s+)?(?:rough\s+)?(?:block[ -]?out|draft|prototype)\b/i.test(input)) return false;
  // A realistic object can be the target of a simple transform; that does not ask for a quality upgrade.
  if (
    /^\s*(?:please\s+)?(?:move|rotate|scale|delete|rename|hide|show|select)\b/i.test(input) &&
    !/\b(?:refine|improve|make .{0,40}(?:realistic|detailed|better))\b/i.test(input)
  )
    return false;
  if (mode === "builds") return true;
  return /\b(?:photo[ -]?real(?:istic|ism)?|realistic|realism|lifelike|life[ -]?like|high[ -]?detail(?:ed)?|highly detailed|detailed|high[ -]?quality|refine|refinement|improve|make (?:it|this|the model) better|more detailed)\b/i.test(
    input,
  );
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
  /** Batches applied since the last scene check. Proposing stops at `MAX_UNCHECKED_BATCHES` until a check runs. */
  batchesSinceCheck: z.number().int().nonnegative().default(0),
  /** Error-severity issues in the last scene check. */
  sceneErrors: z.number().int().nonnegative(),
  /** Visual evidence and the model's assessment; older paused runs have no quality state. */
  quality: qualityReviewSchema.default(() => qualityReviewSchema.parse({})),
  /** The measurable acceptance checks; older paused runs have none. */
  brief: briefStateSchema.default(() => briefStateSchema.parse({})),
  /** Batches planned by tools and not yet proposed, newest last; older paused runs have none. */
  plannedBatches: z.array(plannedBatchSchema).max(MAX_PLANNED_BATCHES).default([]),
  /** The number the next planned batch takes, so planIds are never reused within a run. */
  nextPlannedBatch: z.number().int().positive().default(1),
});

/** What a run has done so far: plans, batches, checks, brief and review. It is kept across an approval pause. */
export type RunProgress = z.infer<typeof runProgressSchema>;
/** One proposal a run made, with the plan step it carries out. */
export type ProposalRecord = RunProgress["proposals"][number];

/** Returns the state where nothing has been planned, proposed or changed. */
export function emptyRunProgress(): RunProgress {
  return {
    plans: [],
    proposals: [],
    unverifiedChanges: false,
    batchesSinceCheck: 0,
    sceneErrors: 0,
    quality: qualityReviewSchema.parse({}),
    brief: briefStateSchema.parse({}),
    plannedBatches: [],
    nextPlannedBatch: 1,
  };
}

/** Keeps a validated batch for a later editor.propose_commands call and returns the planId to name it by. */
export function rememberPlannedBatch(progress: RunProgress, batch: Omit<PlannedBatch, "id">): string {
  const id = `batch_${progress.nextPlannedBatch}`;
  progress.nextPlannedBatch += 1;
  progress.plannedBatches = [...progress.plannedBatches, { id, ...batch }].slice(-MAX_PLANNED_BATCHES);
  return id;
}

/** The planned batch named `planId`, or undefined when it was never planned or has been dropped. */
export function findPlannedBatch(progress: RunProgress, planId: string): PlannedBatch | undefined {
  return progress.plannedBatches.find((batch) => batch.id === planId);
}

/** Condenses a measurement into what the run remembers: counts and one line for each check that did not pass. */
export function summarizeEvaluation(evaluation: BriefEvaluation): NonNullable<RunProgress["brief"]["last"]> {
  return {
    revision: evaluation.revision,
    measurable: evaluation.measurable,
    total: evaluation.results.length,
    passed: evaluation.passed,
    failing: evaluation.results
      .filter((entry) => entry.status !== "pass")
      .map((entry) => `${entry.label}: ${entry.measured}, needs ${entry.expected}`.slice(0, 400)),
  };
}

/** Turns run progress into the text stored with a paused run, so the run can resume after an approval. */
export function serializeRunProgress(progress: RunProgress): string {
  return JSON.stringify(progress);
}

/** Reads run progress stored by serializeRunProgress, checking its shape. */
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
    progress.proposals.some((proposal) => latestPlan.steps.some((step) => step.id === proposal.stepId));
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

  // A batch whose apply started and never finished (the editor dropped out) is as unfinished as one never applied.
  const waiting = progress.proposals.filter((proposal) => {
    const status = statusOf(proposal.id);
    return status === "proposed" || status === "applying";
  }).length;
  if (waiting > 0) {
    reasons.push(`${waiting} proposed batch${waiting === 1 ? " is" : "es are"} not applied`);
  }
  if (progress.unverifiedChanges) {
    reasons.push("the scene changed after its last check, so run validation.check_scene");
  }
  if (progress.sceneErrors > 0) {
    reasons.push(`the last scene check reported ${progress.sceneErrors} error${progress.sceneErrors === 1 ? "" : "s"}`);
  }
  reasons.push(...briefReasons(progress));
  if (progress.quality.required && progress.quality.changes > 0 && progress.quality.outcome === "needs_refinement") {
    reasons.push(...refinementReasons(progress.quality));
  }
  return reasons;
}

/** The reviewer's findings as work for the builder: major ones to fix, then the minor ones worth a look. */
function refinementReasons(quality: RunProgress["quality"]): string[] {
  const line = (finding: ReviewFinding) =>
    `  - ${finding.aspect}: ${finding.observation}${finding.fix ? ` Fix: ${finding.fix}` : ""}`;
  const major = quality.findings.filter((finding) => finding.severity === "major");
  const minor = quality.findings.filter((finding) => finding.severity === "minor");
  return [
    `an independent review of the result found ${major.length} major problem${major.length === 1 ? "" : "s"}; fix them, then the result is reviewed again:`,
    ...major.map(line),
    ...(minor.length > 0 ? ["minor notes, worth fixing if cheap:", ...minor.map(line)] : []),
  ];
}

/**
 * True when the work is otherwise done and the independent reviewer has not yet seen it in its current state. A review
 * is never due while work is open, and no more than `limit` reviews are made in one run.
 */
export function reviewDue(progress: RunProgress, limit: number): boolean {
  const { quality } = progress;
  return quality.required && quality.changes > 0 && quality.outcome === null && quality.reviews < limit;
}

/**
 * What keeps the brief from being met. A run that asked for quality must have a brief; a brief that exists must
 * have been measured on the final scene and pass. An editor that cannot measure is disclosed at the end instead.
 */
function briefReasons(progress: RunProgress): string[] {
  const { brief, quality } = progress;
  if (quality.changes === 0) return [];
  if (brief.current === null) {
    return quality.required
      ? [
          "no brief was recorded: call modeling.record_brief with measurable checks for this request, then validation.check_brief",
        ]
      : [];
  }
  if (brief.stale || brief.last === null)
    return ["the scene changed after the brief was last measured, so run validation.check_brief"];
  if (!brief.last.measurable || brief.last.failing.length === 0) return [];
  const shown = brief.last.failing.slice(0, 5).map((line) => `  - ${line}`);
  const more =
    brief.last.failing.length > shown.length ? [`  - and ${brief.last.failing.length - shown.length} more`] : [];
  return [
    `${brief.last.failing.length} of ${brief.last.total} brief checks do not pass; fix the model (change a check only if it was wrong, and say so):`,
    ...shown,
    ...more,
  ];
}

/** Why the brief rules out calling the work ready, or undefined when it does not. */
export function briefBlocksReady(progress: RunProgress): string | undefined {
  const { brief, quality } = progress;
  if (brief.current === null)
    return quality.required
      ? "Record the brief with modeling.record_brief and check it with validation.check_brief before marking the result ready."
      : undefined;
  if (brief.stale || brief.last === null)
    return "Run validation.check_brief on the current scene before marking the result ready.";
  if (brief.last.measurable && brief.last.failing.length > 0)
    return `${brief.last.failing.length} brief check${brief.last.failing.length === 1 ? "" : "s"} still fail: ${brief.last.failing.slice(0, 3).join("; ")}`;
  return undefined;
}

/** The message that asks the model to carry on, listing the reasons the run is not finished. */
export function continuationPrompt(reasons: readonly string[]): string {
  return [
    "The work is not finished yet:",
    ...reasons.map((reason) => `- ${reason}`),
    "Continue with tool calls until each item is done: apply the waiting batches, name plan steps with stepId, and run validation.check_scene after changes.",
    "Do not claim realism or quality from structural validation or from the brief's checks alone. An independent reviewer examines the finished result; fix what it reports, and be specific about unresolved limitations.",
    "If a limitation prevents further work, say what it is. If you cannot finish without a decision from the user, ask one specific question and stop.",
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
  if (quality.outcome === "blocked")
    return `Quality review was blocked: ${quality.summary}${supportsImages ? "" : " Images were not available to the model, so the result was not visually verified."}`;
  const issue =
    quality.outcome === "needs_refinement"
      ? ` The last review found: ${quality.summary}`
      : " An independent review of the final result was not completed.";
  return `The requested quality is not verified; the result may still be unfinished.${issue}${supportsImages ? "" : " Images were not available to the model, so the result was not visually verified."}`;
}

/** What the user is told when the brief was not met, was not measured, or was changed along the way. */
export function briefCompletionNotice(progress: RunProgress): string | undefined {
  const { brief, quality } = progress;
  if (brief.current === null || quality.changes === 0) return undefined;
  const lines: string[] = [];
  if (brief.stale || brief.last === null) lines.push("The brief's checks were not measured on the final scene.");
  else if (!brief.last.measurable)
    lines.push("The editor could not measure the brief's checks, so they are unverified.");
  else if (brief.last.failing.length > 0)
    lines.push(
      `${brief.last.failing.length} of ${brief.last.total} brief checks do not pass: ${brief.last.failing.slice(0, 5).join("; ")}.`,
    );
  if (brief.revisions > 0)
    lines.push(
      `The brief was revised ${brief.revisions} time${brief.revisions === 1 ? "" : "s"} after it was first recorded.`,
    );
  return lines.length === 0 ? undefined : lines.join(" ");
}

/** Everything the run must disclose at its end: the brief and the quality review. */
export function completionNotice(progress: RunProgress, supportsImages: boolean): string | undefined {
  const notices = [briefCompletionNotice(progress), qualityCompletionNotice(progress, supportsImages)].filter(
    (notice): notice is string => notice !== undefined,
  );
  return notices.length === 0 ? undefined : notices.join("\n\n");
}
