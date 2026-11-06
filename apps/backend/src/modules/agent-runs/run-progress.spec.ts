import {
  continuationPrompt,
  emptyRunProgress,
  invalidateStaleQualityReview,
  openWorkReasons,
  qualityCompletionNotice,
  requiresQualityReview,
  parseRunProgress,
  serializeRunProgress,
  type RunProgress,
} from "./run-progress.js";

type Plan = RunProgress["plans"][number];

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
    expect(requiresQualityReview("Create a realistic person", "2d")).toBe(false);
    expect(requiresQualityReview("Just a rough blockout of a realistic person", "3d")).toBe(false);
    expect(requiresQualityReview("Move the cube", "3d")).toBe(false);
    expect(requiresQualityReview("Move the realistic car", "3d")).toBe(false);
  });
  it("keeps changed quality work open until reviewed and discloses an unfinished result", () => {
    const progress = emptyRunProgress(); progress.quality.required = true; progress.quality.changes = 1;
    expect(openWorkReasons(progress, () => undefined).join(" ")).toContain("modeling.assess_quality");
    expect(qualityCompletionNotice(progress, false)).toContain("not visually verified");
    progress.quality.outcome = "needs_refinement"; progress.quality.summary = "Hands are missing.";
    expect(openWorkReasons(progress, () => undefined).join(" ")).toContain("refine");
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
    invalidateStaleQualityReview(progress, 5);
    expect(progress.quality.outcome).toBe("ready");
    invalidateStaleQualityReview(progress, 6);
    expect(progress.quality.outcome).toBeNull();
    expect(progress.quality.viewpoints).toEqual([]);
    expect(openWorkReasons(progress, () => undefined).join(" ")).toContain("modeling.assess_quality");
  });
  it("loads progress saved before the quality fields existed", () => {
    const progress = parseRunProgress(JSON.stringify({ plans: [], proposals: [], unverifiedChanges: false, sceneErrors: 0 }));
    expect(progress.quality.required).toBe(false);
    expect(progress.quality.changes).toBe(0);
  });
});
