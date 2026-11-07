import { evaluateBrief, type BriefCheckResult, type EditorContext } from "@movynta/editor-protocol";
import type { MeshCheck, QualityScenario, ScenarioOutcome, ScenarioScore } from "./types";

type SceneObject = EditorContext["objects"][number];

/** The id acceptance checks use for everything the assistant added, taken as one group. */
export const SUBJECT_ID = "__quality_subject__";

/**
 * The scene with a group around everything that is new, however the assistant named and nested it. A check on the
 * group then measures the whole build without knowing what its parts are called.
 */
export function withSubject(before: EditorContext, after: EditorContext): EditorContext {
  const known = new Set(before.objects.map((object) => object.id));
  const added = after.objects.filter((object) => !known.has(object.id));
  const addedIds = new Set(added.map((object) => object.id));
  const top = new Set(added.filter((object) => object.parentId === null || !addedIds.has(object.parentId)).map((object) => object.id));

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const object of added) {
    if (!top.has(object.id) || !object.worldBounds) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis] ?? Infinity, object.worldBounds.min[axis] ?? Infinity);
      max[axis] = Math.max(max[axis] ?? -Infinity, object.worldBounds.max[axis] ?? -Infinity);
    }
  }
  const subject: SceneObject = {
    id: SUBJECT_ID,
    name: "Subject",
    type: "empty",
    parentId: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    worldBounds: Number.isFinite(min[0]) ? { min, max } : null,
  };
  return { ...after, objects: [...after.objects.map((object) => (top.has(object.id) ? { ...object, parentId: SUBJECT_ID } : object)), subject] };
}

function extraResult(index: number, label: string, passed: boolean, measured: string, expected: string): BriefCheckResult {
  return { index, label, kind: "count", status: passed ? "pass" : "fail", measured, expected };
}

const AXIS = { x: 0, y: 1, z: 2 } as const;
const format = (value: number): string => String(Number.parseFloat(value.toPrecision(4)));
const rangeText = (min: number | undefined, max: number | undefined): string =>
  min !== undefined && max !== undefined ? `between ${format(min)} and ${format(max)}` : min !== undefined ? `at least ${format(min)}` : `at most ${format(max ?? 0)}`;
const within = (value: number, min: number | undefined, max: number | undefined): boolean => (min === undefined || value >= min - 1e-6) && (max === undefined || value <= max + 1e-6);

/** Judges one statement about a mesh. A mesh that cannot be found or measured fails it and says so. */
function meshResult(index: number, check: MeshCheck, outcome: ScenarioOutcome) {
  const mesh = outcome.meshes[check.objectId];
  const unknown = "could not be inspected";
  if (check.kind === "closed") return extraResult(index, check.label ?? `${check.objectId} is still a closed solid`, mesh?.openEdges === 0, mesh ? `${mesh.openEdges} open edges` : unknown, "0 open edges");
  if (check.kind === "volume") return extraResult(index, check.label, mesh !== undefined && within(mesh.volume, check.min, check.max), mesh ? format(mesh.volume) : unknown, rangeText(check.min, check.max));
  if (check.kind === "openings") return extraResult(index, check.label, mesh?.openings === check.count, mesh ? `${mesh.openings} openings` : unknown, `${check.count} openings`);
  if (check.kind === "opening-at") {
    const centers = mesh?.openingCenters.map((center) => center[AXIS[check.axis]] ?? NaN) ?? [];
    return extraResult(index, check.label, centers.some((value) => within(value, check.min, check.max)),
      mesh ? (centers.length === 0 ? "no openings" : `openings at ${check.axis} ${centers.map(format).join(", ")}`) : unknown, `an opening ${rangeText(check.min, check.max)} on ${check.axis}`);
  }
  if (check.kind === "has-vertex") {
    const tolerance = check.tolerance ?? 0.02;
    const found = mesh?.vertices.some((vertex) => vertex.every((value, axis) => Math.abs(value - (check.point[axis] ?? NaN)) <= tolerance));
    return extraResult(index, check.label, found === true, mesh ? (found ? "found" : "no vertex there") : unknown, `a vertex at ${check.point.map(format).join(", ")}`);
  }
  return extraResult(index, check.label, mesh !== undefined && within(mesh.faces, check.min, check.max), mesh ? `${mesh.faces} faces` : unknown, rangeText(check.min, check.max));
}

/** Judges what a run left behind against the scenario's acceptance checks. Pure: the same outcome always scores the same. */
export function scoreScenario(scenario: QualityScenario, outcome: ScenarioOutcome): ScenarioScore {
  const scene = withSubject(outcome.before, outcome.after);
  const results: BriefCheckResult[] = [...evaluateBrief(scene, { checks: scenario.checks }).results];

  if (scenario.minimumParts !== undefined) {
    const known = new Set(outcome.before.objects.map((object) => object.id));
    const parts = outcome.after.objects.filter((object) => object.type === "mesh" && !known.has(object.id)).length;
    results.push(extraResult(results.length, `At least ${scenario.minimumParts} separate parts`, parts >= scenario.minimumParts, `${parts} found`, `at least ${scenario.minimumParts}`));
  }
  for (const check of scenario.meshChecks ?? []) results.push(meshResult(results.length, check, outcome));

  const passed = results.filter((result) => result.status === "pass").length;
  return { scenarioId: scenario.id, passed, total: results.length, ratio: results.length === 0 ? 0 : passed / results.length, results };
}
