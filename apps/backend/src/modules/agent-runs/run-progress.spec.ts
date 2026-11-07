import { briefSchema } from "@movynta/editor-protocol";
import {
  briefBlocksReady,
  briefCompletionNotice,
  completionNotice,
  continuationPrompt,
  emptyRunProgress,
  invalidateStaleQualityReview,
  openWorkReasons,
  qualityCompletionNotice,
  requiresQualityReview,
  reviewDue,
  parseRunProgress,
  serializeRunProgress,
  type RunProgress,
} from "./run-progress.js";

type Plan = RunProgress["plans"][number];

/** A run that built something and has a brief measured on the final scene, passing unless `failing` lists lines. */
function withBrief(progress: RunProgress, failing: string[] = [], measurable = true): void {
  progress.quality.changes = Math.max(progress.quality.changes, 1);
  progress.brief.current = briefSchema.parse({ subject: "Chair", checks: [{ kind: "count", selector: { name: "Seat" } }, { kind: "count", selector: { name: "Leg" }, min: 4 }] });
  progress.brief.stale = false;
  progress.brief.last = { revision: 4, measurable, total: 2, passed: 2 - failing.length, failing };
}

const torsoStep: Plan["steps"][number] = {
  id: "torso",
  title: "Torso",
  toolName: "editor.propose_commands",
  description: "Create the torso",
  requiresApproval: false,
};
const checkStep: Plan["steps"][number] = {
  id: "check",
  title: "Check",
  toolName: "validation.check_scene",
  description: "Check the scene",
  requiresApproval: false,
};
const plan: Plan = { goal: "Build a torso", dimension: "3d", steps: [torsoStep, checkStep] };

function withProgress(progress: Partial<RunProgress>): RunProgress {
  return { ...emptyRunProgress(), ...progress };
}

describe("openWorkReasons", () => {
  it("lets a run with nothing planned, proposed or changed end", () => {
    expect(openWorkReasons(emptyRunProgress(), () => undefined)).toEqual([]);
  });

  it("keeps the run open while a scene step of the latest plan has no applied batch", () => {
    const reasons = openWorkReasons(withProgress({ plans: [plan] }), () => undefined);
    expect(reasons).toEqual(['plan step "Torso" (stepId torso) has no applied batch']);
  });

  it("does not wait for steps that are not scene changes", () => {
    const checkOnly: Plan = { ...plan, steps: [checkStep] };
    expect(openWorkReasons(withProgress({ plans: [checkOnly] }), () => undefined)).toEqual([]);
  });

  it("closes a step once a batch that names it has been applied", () => {
    const progress = withProgress({ plans: [plan], proposals: [{ id: "prp_1", stepId: "torso" }] });
    expect(openWorkReasons(progress, (id) => (id === "prp_1" ? "applied" : undefined))).toEqual([]);
  });

  it("uses only the latest plan", () => {
    const older: Plan = { ...plan, steps: [{ ...torsoStep, id: "old", title: "Old" }] };
    const progress = withProgress({ plans: [older, plan], proposals: [{ id: "prp_1", stepId: "torso" }] });
    expect(openWorkReasons(progress, (id) => (id === "prp_1" ? "applied" : undefined))).toEqual([]);
  });

  it("does not hold the run to step names when its batches never name a step", () => {
    const progress = withProgress({ plans: [plan], proposals: [{ id: "prp_1" }] });
    expect(openWorkReasons(progress, () => "applied")).toEqual([]);
  });

  it("reports batches that are still waiting to be applied", () => {
    const progress = withProgress({ proposals: [{ id: "prp_1" }, { id: "prp_2" }] });
    expect(openWorkReasons(progress, () => "proposed")).toEqual(["2 proposed batches are not applied"]);
    expect(openWorkReasons(progress, (id) => (id === "prp_1" ? "superseded" : "proposed"))).toEqual(["1 proposed batch is not applied"]);
  });

  it("counts a batch whose apply started and never finished as unfinished work", () => {
    const progress = withProgress({ proposals: [{ id: "prp_1" }, { id: "prp_2" }] });
    expect(openWorkReasons(progress, (id) => (id === "prp_1" ? "applying" : "applied"))).toEqual(["1 proposed batch is not applied"]);
  });

  it("asks for a scene check after a change and reports the errors of the last check", () => {
    expect(openWorkReasons(withProgress({ unverifiedChanges: true }), () => undefined)).toEqual([
      "the scene changed after its last check, so run validation.check_scene",
    ]);
    expect(openWorkReasons(withProgress({ sceneErrors: 2 }), () => undefined)).toEqual(["the last scene check reported 2 errors"]);
    expect(openWorkReasons(withProgress({ sceneErrors: 1 }), () => undefined)).toEqual(["the last scene check reported 1 error"]);
  });
});

describe("run progress storage", () => {
  it("keeps plans and proposals through a save and a load", () => {
    const progress = withProgress({ plans: [plan], proposals: [{ id: "prp_1", stepId: "torso" }], unverifiedChanges: true, sceneErrors: 1 });
    progress.quality.required = true;
    progress.quality.changes = 2;
    progress.quality.captureRevision = 5;
    progress.quality.viewpoints = ["front", "side"];
    progress.quality.outcome = "needs_refinement";
    progress.quality.summary = "Hands need work.";
    expect(parseRunProgress(serializeRunProgress(progress))).toEqual(progress);
  });
});

describe("continuationPrompt", () => {
  it("lists each reason and asks for tool calls", () => {
    const prompt = continuationPrompt(["1 proposed batch is not applied", "the scene changed after its last check"]);
    expect(prompt).toContain("- 1 proposed batch is not applied");
    expect(prompt).toContain("- the scene changed after its last check");
    expect(prompt).toContain("validation.check_scene");
  });
});

describe("quality review completion", () => {
  it("targets explicit 3D realism and refinement, while allowing an explicitly requested blockout", () => {
    expect(requiresQualityReview("Create a realistic person", "3d")).toBe(true);
    expect(requiresQualityReview("Improve this sculpture", "3d")).toBe(true);
    expect(requiresQualityReview("Make it better", "3d")).toBe(true);
    expect(requiresQualityReview("Create a detailed model", "3d")).toBe(true);
    expect(requiresQualityReview("Create a realistic person", undefined)).toBe(false);
    expect(requiresQualityReview("Just a rough blockout of a realistic person", "3d")).toBe(false);
    expect(requiresQualityReview("Move the cube", "3d")).toBe(false);
    expect(requiresQualityReview("Move the realistic car", "3d")).toBe(false);
  });
  it("chooses which requests are reviewed: none, those asking for quality, or every build", () => {
    expect(requiresQualityReview("Create a realistic person", "3d", "off")).toBe(false);
    expect(requiresQualityReview("Add a cube", "3d")).toBe(false);
    expect(requiresQualityReview("Add a cube", "3d", "quality")).toBe(false);
    expect(requiresQualityReview("Add a cube", "3d", "builds")).toBe(true);
    expect(requiresQualityReview("Make a chair", undefined, "builds")).toBe(false);
    expect(requiresQualityReview("Move the cube", "3d", "builds")).toBe(false);
    expect(requiresQualityReview("Just a rough blockout of a chair", "3d", "builds")).toBe(false);
    expect(requiresQualityReview("Create a realistic person", "3d", "quality")).toBe(true);
  });
  it("is due a review once the work is done and not before, and never more than the limit", () => {
    const progress = emptyRunProgress(); progress.quality.required = true;
    expect(reviewDue(progress, 2)).toBe(false);
    progress.quality.changes = 1;
    expect(reviewDue(progress, 2)).toBe(true);
    expect(reviewDue(progress, 0)).toBe(false);
    progress.quality.reviews = 2;
    expect(reviewDue(progress, 2)).toBe(false);
    progress.quality.reviews = 1; progress.quality.outcome = "ready";
    expect(reviewDue(progress, 2)).toBe(false);
    progress.quality.outcome = null; progress.quality.required = false;
    expect(reviewDue(progress, 2)).toBe(false);
  });
  it("gives the builder the reviewer's major findings with their fixes as work, and the minor ones as notes", () => {
    const progress = emptyRunProgress(); progress.quality.required = true; withBrief(progress);
    progress.quality.outcome = "needs_refinement";
    progress.quality.findings = [
      { aspect: "legs", observation: "No legs.", severity: "major", fix: "Add four legs." },
      { aspect: "back", observation: "Floating.", severity: "major" },
      { aspect: "color", observation: "Flat.", severity: "minor" },
    ];
    const reasons = openWorkReasons(progress, () => undefined);
    expect(reasons[0]).toContain("found 2 major problems");
    expect(reasons).toContain("  - legs: No legs. Fix: Add four legs.");
    expect(reasons).toContain("  - back: Floating.");
    expect(reasons).toContain("minor notes, worth fixing if cheap:");
    expect(reasons).toContain("  - color: Flat.");
    // A review that has not happened yet is the run loop's to start, so the builder is not told to do it.
    progress.quality.outcome = null;
    expect(openWorkReasons(progress, () => undefined)).toEqual([]);
  });
  it("discloses an unfinished review and the last verdict when the run ends", () => {
    const progress = emptyRunProgress(); progress.quality.required = true; progress.quality.changes = 1;
    withBrief(progress);
    expect(qualityCompletionNotice(progress, false)).toContain("not visually verified");
    expect(qualityCompletionNotice(progress, true)).toContain("An independent review of the final result was not completed");
    progress.quality.outcome = "needs_refinement"; progress.quality.summary = "Hands are missing.";
    progress.quality.findings = [{ aspect: "hands", observation: "Missing.", severity: "major" }];
    expect(openWorkReasons(progress, () => undefined).join(" ")).toContain("independent review");
    expect(qualityCompletionNotice(progress, true)).toContain("Hands are missing");
    progress.quality.outcome = "blocked";
    expect(openWorkReasons(progress, () => undefined)).toEqual([]);
    expect(qualityCompletionNotice(progress, true)).toContain("blocked");
    progress.quality.outcome = "ready";
    expect(qualityCompletionNotice(progress, true)).toBeUndefined();
  });
  it("invalidates a ready review if the scene changes or is unavailable", () => {
    const progress = emptyRunProgress();
    progress.quality.required = true; progress.quality.changes = 1;
    progress.quality.captureRevision = 5; progress.quality.viewpoints = ["front", "side"]; progress.quality.outcome = "ready";
    withBrief(progress);
    invalidateStaleQualityReview(progress, 5);
    expect(progress.quality.outcome).toBe("ready");
    invalidateStaleQualityReview(progress, 6);
    expect(progress.quality.outcome).toBeNull();
    expect(progress.quality.viewpoints).toEqual([]);
    expect(reviewDue(progress, 2)).toBe(true);
  });
  it("holds a quality run open until it has a brief, then until the brief was measured on the final scene and passes", () => {
    const progress = emptyRunProgress(); progress.quality.required = true; progress.quality.changes = 1; progress.quality.outcome = "ready";
    expect(openWorkReasons(progress, () => undefined).join(" ")).toContain("modeling.record_brief");
    withBrief(progress);
    expect(openWorkReasons(progress, () => undefined)).toEqual([]);
    progress.brief.stale = true;
    expect(openWorkReasons(progress, () => undefined).join(" ")).toContain("validation.check_brief");
    progress.brief.stale = false; progress.brief.last = null;
    expect(openWorkReasons(progress, () => undefined).join(" ")).toContain("validation.check_brief");
    withBrief(progress, ['count of objects named "Leg…": 3 found, needs at least 4']);
    const reasons = openWorkReasons(progress, () => undefined);
    expect(reasons[0]).toContain("1 of 2 brief checks do not pass");
    expect(reasons.join("\n")).toContain("3 found, needs at least 4");
  });
  it("asks for a brief only when the request wanted quality, and holds any brief that exists to its checks", () => {
    const ordinary = emptyRunProgress(); ordinary.quality.changes = 1;
    expect(openWorkReasons(ordinary, () => undefined)).toEqual([]);
    expect(briefBlocksReady(ordinary)).toBeUndefined();
    withBrief(ordinary, ["size y of named \"Seat\": 2, needs at most 1"]);
    expect(openWorkReasons(ordinary, () => undefined)[0]).toContain("brief checks do not pass");
    const none = emptyRunProgress(); none.quality.required = true; none.quality.changes = 1;
    expect(briefBlocksReady(none)).toContain("modeling.record_brief");
  });
  it("lists at most five failing checks in a reason and counts the rest", () => {
    const progress = emptyRunProgress();
    withBrief(progress, Array.from({ length: 8 }, (_, index) => `check ${index}: wrong, needs right`));
    const text = openWorkReasons(progress, () => undefined).join("\n");
    expect(text).toContain("check 4:");
    expect(text).not.toContain("check 5:");
    expect(text).toContain("and 3 more");
  });
  it("does not hold a run for checks that the editor cannot measure, but says so at the end", () => {
    const progress = emptyRunProgress();
    withBrief(progress, ["size y of named \"Seat\": no bounds, needs at least 1"], false);
    expect(openWorkReasons(progress, () => undefined)).toEqual([]);
    expect(briefBlocksReady(progress)).toBeUndefined();
    expect(briefCompletionNotice(progress)).toContain("could not measure");
  });
  it("discloses failing, unmeasured and revised briefs, and stays silent for a clean one", () => {
    const clean = emptyRunProgress(); withBrief(clean);
    expect(briefCompletionNotice(clean)).toBeUndefined();
    expect(completionNotice(clean, true)).toBeUndefined();
    const failing = emptyRunProgress(); withBrief(failing, ["gap: 0.4, needs at most 0.01"]);
    expect(briefCompletionNotice(failing)).toContain("1 of 2 brief checks do not pass: gap: 0.4");
    const stale = emptyRunProgress(); withBrief(stale); stale.brief.stale = true;
    expect(briefCompletionNotice(stale)).toContain("not measured on the final scene");
    const revised = emptyRunProgress(); withBrief(revised); revised.brief.revisions = 2;
    expect(briefCompletionNotice(revised)).toBe("The brief was revised 2 times after it was first recorded.");
    const unplanned = emptyRunProgress(); unplanned.quality.changes = 1;
    expect(briefCompletionNotice(unplanned)).toBeUndefined();
  });
  it("puts the brief before the quality review in the closing notice", () => {
    const progress = emptyRunProgress(); progress.quality.required = true; withBrief(progress, ["gap: 0.4, needs at most 0.01"]);
    const notice = completionNotice(progress, true) ?? "";
    expect(notice.indexOf("brief checks do not pass")).toBeLessThan(notice.indexOf("requested quality is not verified"));
  });
  it("keeps and restores the brief when a paused run is saved", () => {
    const progress = emptyRunProgress(); withBrief(progress, ["gap: 0.4, needs at most 0.01"]); progress.brief.revisions = 1;
    expect(parseRunProgress(serializeRunProgress(progress)).brief).toEqual(progress.brief);
  });
  it("loads progress saved before the quality fields existed", () => {
    const progress = parseRunProgress(JSON.stringify({ plans: [], proposals: [], unverifiedChanges: false, sceneErrors: 0 }));
    expect(progress.quality.required).toBe(false);
    expect(progress.quality.changes).toBe(0);
    expect(progress.brief).toEqual({ current: null, revisions: 0, stale: false, last: null });
  });
});
