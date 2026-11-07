import { describe, expect, it } from "vitest";
import type { EditorContext } from "@movynta/editor-protocol";
import { buildScenario, formatScorecard, QUALITY_SCENARIOS, scenarioById, scoreScenario, SUBJECT_ID, summarizeRuns, withSubject } from "./index";
import type { LiveRunResult, ScenarioScore } from "./index";

const failedLabels = (score: ScenarioScore): string[] => score.results.filter((result) => result.status !== "pass").map((result) => result.label);
const describeFailures = (score: ScenarioScore): string => score.results.filter((result) => result.status !== "pass").map((result) => `${result.label}: ${result.measured}, needs ${result.expected}`).join("\n");

describe("quality scenarios", () => {
  it("are well formed: unique ids, labelled checks and defects that exist", () => {
    expect(new Set(QUALITY_SCENARIOS.map((scenario) => scenario.id)).size).toBe(QUALITY_SCENARIOS.length);
    for (const scenario of QUALITY_SCENARIOS) {
      const labels = scenario.checks.map((check) => check.label);
      expect(labels.every((label) => label !== undefined && label.length > 0), `${scenario.id} has an unlabelled check`).toBe(true);
      expect(new Set(labels).size, `${scenario.id} repeats a label`).toBe(labels.length);
      expect(new Set(scenario.defects.map((defect) => defect.id)).size).toBe(scenario.defects.length);
      expect(scenario.prompt.length).toBeGreaterThan(20);
    }
  });

  describe.each(QUALITY_SCENARIOS.map((scenario) => [scenario.id, scenario] as const))("%s", (_id, scenario) => {
    it("is met in full by its known answer, built on the real editor", () => {
      const score = scoreScenario(scenario, buildScenario(scenario.id));
      expect(failedLabels(score), describeFailures(score)).toEqual([]);
      expect(score.ratio).toBe(1);
    });

    it.each(scenario.defects.map((defect) => [defect.id, defect] as const))("fails exactly the checks of the defect %s", (_defect, defect) => {
      const score = scoreScenario(scenario, buildScenario(scenario.id, defect.id));
      expect(failedLabels(score).sort(), `${defect.description}\n${describeFailures(score)}`).toEqual([...defect.fails].sort());
      expect(score.ratio).toBeLessThan(1);
    });

    it("has a defect for every check, so each one is shown to be able to fail", () => {
      const caught = new Set(scenario.defects.flatMap((defect) => defect.fails));
      const everyCheck = scoreScenario(scenario, buildScenario(scenario.id)).results.map((result) => result.label);
      expect(everyCheck.filter((label) => !caught.has(label))).toEqual([]);
    });

    it("does not depend on what the assistant calls its parts", () => {
      const outcome = buildScenario(scenario.id);
      const known = new Set(outcome.before.objects.map((object) => object.id));
      const renamed: EditorContext = { ...outcome.after, objects: outcome.after.objects.map((object) => (known.has(object.id) ? object : { ...object, name: `Thing ${object.id}` })) };
      expect(scoreScenario(scenario, { ...outcome, after: renamed })).toEqual(scoreScenario(scenario, outcome));
    });
  });

  it("scores an unchanged scene as failing, not as nothing to judge", () => {
    const chair = scenarioById("chair");
    const empty = buildScenario("chair");
    const score = scoreScenario(chair, { before: empty.after, after: empty.after, meshes: {} });
    expect(score.ratio).toBe(0);
    expect(score.results.every((result) => result.status !== "pass")).toBe(true);
  });
});

describe("withSubject", () => {
  const object = (id: string, parentId: string | null, bounds: [number[], number[]] | null): EditorContext["objects"][number] => ({
    id, name: id, type: "mesh", parentId, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    worldBounds: bounds ? { min: [bounds[0]?.[0] ?? 0, bounds[0]?.[1] ?? 0, bounds[0]?.[2] ?? 0], max: [bounds[1]?.[0] ?? 0, bounds[1]?.[1] ?? 0, bounds[1]?.[2] ?? 0] } : null,
  });
  const scene = (objects: EditorContext["objects"]): EditorContext => ({ projectId: "p", revision: 1, activeSceneName: "Main", selectedObjectIds: [], objects });

  it("wraps what is new, leaves what was there, and spans the top-level new objects", () => {
    const before = scene([object("old", null, [[5, 5, 5], [6, 6, 6]])]);
    const after = scene([
      ...before.objects,
      object("root", null, [[0, 0, 0], [2, 3, 1]]),
      object("child", "root", [[0, 0, 0], [1, 1, 1]]),
      object("beside", "old", [[-1, 0, 0], [0, 1, 1]]),
    ]);
    const wrapped = withSubject(before, after);
    const subject = wrapped.objects.find((entry) => entry.id === SUBJECT_ID);
    expect(subject?.worldBounds).toEqual({ min: [-1, 0, 0], max: [2, 3, 1] });
    const parents = Object.fromEntries(wrapped.objects.map((entry) => [entry.id, entry.parentId]));
    expect(parents).toMatchObject({ old: null, root: SUBJECT_ID, child: "root", beside: SUBJECT_ID });
  });

  it("has no bounds when nothing was added", () => {
    const before = scene([object("old", null, [[0, 0, 0], [1, 1, 1]])]);
    expect(withSubject(before, before).objects.find((entry) => entry.id === SUBJECT_ID)?.worldBounds).toBeNull();
  });
});

describe("scorecard", () => {
  const run = (scenarioId: string, trial: number, ratio: number, failing: string[], extra: Partial<LiveRunResult> = {}): LiveRunResult => ({
    scenarioId, trial, runId: `run_${scenarioId}_${trial}`, status: "completed", durationMs: 30_000, usage: { requests: 4, inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
    score: { scenarioId, passed: Math.round(ratio * 4), total: 4, ratio, results: failing.map((label, index) => ({ index, label, kind: "size", status: "fail", measured: "1", expected: "2" })) },
    ...extra,
  });

  it("averages each scenario, counts perfect trials and ranks the checks that fail", () => {
    const card = summarizeRuns([
      run("chair", 1, 1, []),
      run("chair", 2, 0.75, ["No loose parts"]),
      run("chair", 3, 0.5, ["No loose parts", "Chair height"], { status: "failed" }),
      run("table", 1, 1, [], { durationMs: 10_000, usage: { requests: 2, inputTokens: 400, outputTokens: 100, totalTokens: 500 } }),
    ]);
    const chair = card.scenarios.find((row) => row.scenarioId === "chair");
    expect(chair).toMatchObject({ trials: 3, meanRatio: 0.75, worstRatio: 0.5, perfect: 1, stoppedEarly: 1, meanSeconds: 30, meanTokens: 1200 });
    expect(chair?.failures).toEqual([{ label: "No loose parts", count: 2 }, { label: "Chair height", count: 1 }]);
    // Each scenario counts once: (0.75 + 1) / 2, not the mean of four trials.
    expect(card.meanRatio).toBeCloseTo(0.875, 10);
    expect(card.perfectRate).toBe(0.5);
    expect(card.trials).toBe(4);
  });

  it("prints a table with the failing checks under their scenario and the totals", () => {
    const text = formatScorecard(summarizeRuns([run("chair", 1, 0.75, ["No loose parts"]), run("table", 1, 1, [])]));
    expect(text).toContain("scenario");
    expect(text).toMatch(/chair\s+1\s+75%\s+0\/1/);
    expect(text).toContain("failed 1/1: No loose parts");
    expect(text).toContain("overall score 88%, 50% of 2 trials passed every check");
  });

  it("copes with nothing run", () => {
    expect(summarizeRuns([])).toEqual({ scenarios: [], meanRatio: 0, perfectRate: 0, trials: 0 });
    expect(formatScorecard(summarizeRuns([]))).toContain("overall score 0%");
  });
});
