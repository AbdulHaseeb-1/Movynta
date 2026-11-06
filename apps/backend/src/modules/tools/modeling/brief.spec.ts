import { briefCheckSchema, briefPassed, briefSchema, evaluateBrief, type Brief, type EditorContext } from "@movynta/editor-protocol";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import { emptyRunProgress } from "../../agent-runs/run-progress.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import { createBriefTools } from "./brief.tools.js";

type Vec = [number, number, number];
type SceneObject = EditorContext["objects"][number];

function part(id: string, name: string, min: Vec, max: Vec, parentId: string | null = null): SceneObject {
  return { id, name, type: "mesh", parentId, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, worldBounds: { min, max } };
}

function sceneOf(objects: SceneObject[], revision = 3): EditorContext {
  return { projectId: "p", revision, activeSceneName: "Main", selectedObjectIds: [], objects };
}

function one(scene: EditorContext, check: unknown) {
  const [result] = evaluateBrief(scene, { checks: [briefCheckSchema.parse(check)] }).results;
  if (!result) throw new Error("No result");
  return result;
}

/** A chair: a seat on four legs, a back, and nothing wrong with it. */
const chair = sceneOf([
  part("seat", "Seat", [-0.25, 0.45, -0.25], [0.25, 0.5, 0.25]),
  part("leg1", "Leg.FL", [-0.25, 0, 0.2], [-0.2, 0.45, 0.25]),
  part("leg2", "Leg.FR", [0.2, 0, 0.2], [0.25, 0.45, 0.25]),
  part("back", "Back", [-0.25, 0.5, -0.25], [0.25, 0.95, -0.2]),
]);

describe("brief checks", () => {
  it("counts objects by exact name, id or the start of a name, ignoring letter case", () => {
    const scene = sceneOf([part("a", "Leg", [0, 0, 0], [1, 1, 1]), part("b", "Leg.001", [0, 0, 0], [1, 1, 1]), part("c", "leg.002", [0, 0, 0], [1, 1, 1]), part("d", "Seat", [0, 0, 0], [1, 1, 1])]);
    expect(one(scene, { kind: "count", selector: { namePrefix: "LEG" }, min: 3, max: 3 })).toMatchObject({ status: "pass", measured: "3 found", expected: "exactly 3" });
    expect(one(scene, { kind: "count", selector: { namePrefix: "Leg" }, min: 4 })).toMatchObject({ status: "fail", measured: "3 found", expected: "at least 4" });
    expect(one(scene, { kind: "count", selector: { name: "seat" } })).toMatchObject({ status: "pass" });
    expect(one(scene, { kind: "count", selector: { id: "zzz" } })).toMatchObject({ status: "fail", measured: "0 found" });
    expect(one(scene, { kind: "count", selector: { namePrefix: "Leg" }, max: 2, min: 0 })).toMatchObject({ status: "fail", expected: "0 to 2" });
  });

  it("measures the extent of one object on an axis", () => {
    expect(one(chair, { kind: "size", target: { name: "Seat" }, axis: "x", min: 0.4, max: 0.6 })).toMatchObject({ status: "pass", measured: "0.5" });
    expect(one(chair, { kind: "size", target: { name: "Seat" }, axis: "y", max: 0.03 })).toMatchObject({ status: "fail", measured: "0.05", expected: "at most 0.03" });
  });

  it("reads the low edge, middle or high edge, and forgives rounding noise at the floor", () => {
    const scene = sceneOf([part("leg", "Leg", [0, -1e-12, 0], [0.1, 0.45, 0.1]), part("floating", "Floating", [0, 0.2, 0], [1, 1, 1])]);
    expect(one(scene, { kind: "position", target: { name: "Leg" }, axis: "y", anchor: "min", min: 0, max: 0 })).toMatchObject({ status: "pass" });
    expect(one(scene, { kind: "position", target: { name: "Floating" }, axis: "y", anchor: "min", min: 0, max: 0 })).toMatchObject({ status: "fail", measured: "0.2", expected: "exactly 0" });
    expect(one(scene, { kind: "position", target: { name: "Leg" }, axis: "y", anchor: "center", min: 0.2, max: 0.25 })).toMatchObject({ status: "pass", measured: "0.225" });
    expect(one(scene, { kind: "position", target: { name: "Leg" }, axis: "y", anchor: "max", min: 0.5 })).toMatchObject({ status: "fail", expected: "at least 0.5" });
  });

  it("measures the gap between parts: zero when touching, negative when overlapping", () => {
    expect(one(chair, { kind: "gap", first: { name: "Leg.FL" }, second: { name: "Seat" }, axis: "y", min: -0.001, max: 0.001 })).toMatchObject({ status: "pass", measured: "0" });
    const sunk = sceneOf([part("a", "A", [0, 0, 0], [1, 1, 1]), part("b", "B", [0, 0.9, 0], [1, 2, 1])]);
    expect(one(sunk, { kind: "gap", first: { name: "A" }, second: { name: "B" }, axis: "y", min: -0.01, max: 0.01 })).toMatchObject({ status: "fail", measured: "-0.1" });
    const floating = sceneOf([part("a", "A", [0, 0, 0], [1, 1, 1]), part("b", "B", [0, 1.4, 0], [1, 2, 1])]);
    expect(one(floating, { kind: "gap", first: { name: "A" }, second: { name: "B" }, axis: "y", max: 0.01 })).toMatchObject({ status: "fail", measured: "0.4" });
  });

  it("tests that one part mirrors another and names the axis that is off", () => {
    expect(one(chair, { kind: "symmetric", first: { name: "Leg.FL" }, second: { name: "Leg.FR" }, axis: "x" })).toMatchObject({ status: "pass", measured: "exact mirror" });
    const crooked = sceneOf([part("l", "Arm.L", [-1, 1, 0], [-0.5, 2, 0.4]), part("r", "Arm.R", [0.6, 1, 0], [1.1, 2, 0.4])]);
    expect(one(crooked, { kind: "symmetric", first: { name: "Arm.L" }, second: { name: "Arm.R" }, axis: "x", tolerance: 0.01 })).toMatchObject({ status: "fail", measured: "off by 0.1 on x" });
    expect(one(crooked, { kind: "symmetric", first: { name: "Arm.L" }, second: { name: "Arm.R" }, axis: "x", tolerance: 0.2 })).toMatchObject({ status: "pass" });
    // A mirror plane that is not at zero.
    const shifted = sceneOf([part("l", "L", [1, 0, 0], [2, 1, 1]), part("r", "R", [4, 0, 0], [5, 1, 1])]);
    expect(one(shifted, { kind: "symmetric", first: { name: "L" }, second: { name: "R" }, axis: "x", planeAt: 3 })).toMatchObject({ status: "pass" });
    expect(one(shifted, { kind: "symmetric", first: { name: "L" }, second: { name: "R" }, axis: "x" })).toMatchObject({ status: "fail" });
    // A part mirrored but raised on another axis is not symmetric.
    const raised = sceneOf([part("l", "L", [-2, 0, 0], [-1, 1, 1]), part("r", "R", [1, 0.3, 0], [2, 1.3, 1])]);
    expect(one(raised, { kind: "symmetric", first: { name: "L" }, second: { name: "R" }, axis: "x", tolerance: 0.05 })).toMatchObject({ status: "fail", measured: "off by 0.3 on y" });
  });

  it("scales the default tolerance with the size of what it compares", () => {
    // The allowance is 2% of the largest side of the parts compared: 0.002 for parts 0.1 across, 0.2 for parts 10 across.
    const small = sceneOf([part("l", "L", [-1.01, 0, 0], [-1, 0.1, 0.1]), part("r", "R", [1.003, 0, 0], [1.013, 0.1, 0.1])]);
    const big = sceneOf([part("l", "L", [-101, 0, 0], [-100, 10, 10]), part("r", "R", [100.1, 0, 0], [101.1, 10, 10])]);
    const far = sceneOf([part("l", "L", [-101, 0, 0], [-100, 10, 10]), part("r", "R", [100.5, 0, 0], [101.5, 10, 10])]);
    expect(one(small, { kind: "symmetric", first: { name: "L" }, second: { name: "R" }, axis: "x" })).toMatchObject({ status: "fail", expected: "within 0.002" });
    expect(one(big, { kind: "symmetric", first: { name: "L" }, second: { name: "R" }, axis: "x" })).toMatchObject({ status: "pass", expected: "within 0.2" });
    expect(one(far, { kind: "symmetric", first: { name: "L" }, second: { name: "R" }, axis: "x" })).toMatchObject({ status: "fail", measured: "off by 0.5 on x" });
  });

  it("checks that centers line up on an axis", () => {
    expect(one(chair, { kind: "aligned", first: { name: "Seat" }, second: { name: "Back" }, axis: "x" })).toMatchObject({ status: "pass" });
    expect(one(chair, { kind: "aligned", first: { name: "Seat" }, second: { name: "Leg.FL" }, axis: "x", tolerance: 0.05 })).toMatchObject({ status: "fail" });
  });

  it("checks that a detail lies inside its parent and says how far it sticks out", () => {
    const head = sceneOf([part("head", "Head", [-1, 0, -1], [1, 2, 1]), part("eye", "Eye", [0.2, 1, 0.5], [0.4, 1.2, 0.9]), part("horn", "Horn", [0.5, 1.5, 0], [1.3, 2.4, 0.4])]);
    expect(one(head, { kind: "contained", inner: { name: "Eye" }, outer: { name: "Head" } })).toMatchObject({ status: "pass", measured: "inside" });
    expect(one(head, { kind: "contained", inner: { name: "Horn" }, outer: { name: "Head" }, tolerance: 0.05 })).toMatchObject({ status: "fail", measured: "sticks out by 0.4 toward +y" });
  });

  it("finds parts that float free of the rest of a group and names them", () => {
    const group = (extra: SceneObject[], max: Vec = [0.25, 0.95, 0.25]): EditorContext => sceneOf([
      { ...part("chair", "Chair", [-0.25, 0, -0.25], max, null), type: "empty" },
      part("seat", "Seat", [-0.25, 0.45, -0.25], [0.25, 0.5, 0.25], "chair"),
      part("leg", "Leg", [-0.25, 0, 0.2], [-0.2, 0.45, 0.25], "chair"),
      part("back", "Back", [-0.25, 0.5, -0.25], [0.25, 0.95, -0.2], "chair"),
      ...extra,
    ]);
    expect(one(group([]), { kind: "connected", group: { name: "Chair" } })).toMatchObject({ status: "pass", measured: "3 parts form one piece", expected: "every part touching the rest" });
    const loose = group([part("arm", "Floating arm", [1, 1, 1], [1.1, 1.1, 1.1], "chair"), part("knob", "Knob", [2, 1, 1], [2.1, 1.1, 1.1], "arm")], [1.1, 1.1, 1.1]);
    expect(one(loose, { kind: "connected", group: { id: "chair" } })).toMatchObject({ status: "fail", measured: "2 of 5 parts are detached: Floating arm, Knob" });
    // Parts that only touch through a third part are still one piece.
    const chain = sceneOf([{ ...part("g", "G", [0, 0, 0], [3, 1, 1], null), type: "empty" }, part("a", "A", [0, 0, 0], [1, 1, 1], "g"), part("b", "B", [1, 0, 0], [2, 1, 1], "g"), part("c", "C", [2, 0, 0], [3, 1, 1], "g")]);
    expect(one(chain, { kind: "connected", group: { name: "G" } })).toMatchObject({ status: "pass" });
    // A small gap is loose by default and joined when the check allows it.
    const gapped = sceneOf([{ ...part("g", "G", [0, 0, 0], [1, 1.03, 1], null), type: "empty" }, part("a", "A", [0, 0, 0], [1, 1, 1], "g"), part("b", "B", [0, 1.03, 0], [1, 1.03, 1], "g")]);
    expect(one(gapped, { kind: "connected", group: { name: "G" } })).toMatchObject({ status: "fail" });
    expect(one(gapped, { kind: "connected", group: { name: "G" }, tolerance: 0.05 })).toMatchObject({ status: "pass" });
    // Only what is under the group counts: a loose object elsewhere does not make the chair come apart.
    expect(one(group([part("far", "Far", [9, 9, 9], [10, 10, 10])]), { kind: "connected", group: { name: "Chair" } })).toMatchObject({ status: "pass" });
    expect(one(group([]), { kind: "connected", group: { name: "Seat" } })).toMatchObject({ status: "pass", measured: "1 part, nothing to join" });
    expect(one(group([]), { kind: "connected", group: { name: "Table" } })).toMatchObject({ status: "unresolved" });
  });

  it("leaves a check unresolved, and says why, when an object is missing, ambiguous or has no geometry", () => {
    const scene = sceneOf([part("a", "Wheel", [0, 0, 0], [1, 1, 1], "g1"), part("b", "Wheel", [2, 0, 0], [3, 1, 1], "g2"), { ...part("c", "Group", [0, 0, 0], [0, 0, 0]), type: "empty", worldBounds: null }]);
    expect(one(scene, { kind: "size", target: { name: "Roof" }, axis: "y", min: 1 })).toMatchObject({ status: "unresolved", measured: 'no object named "Roof" exists' });
    expect(one(scene, { kind: "size", target: { name: "Wheel" }, axis: "y", min: 1 })).toMatchObject({ status: "unresolved", measured: expect.stringContaining('2 objects are named "Wheel" (a, b)') });
    expect(one(scene, { kind: "size", target: { id: "c" }, axis: "y", min: 1 })).toMatchObject({ status: "unresolved", measured: '"Group" has no geometry bounds yet' });
    expect(one(scene, { kind: "gap", first: { id: "a" }, second: { name: "Roof" }, axis: "y", min: 0 })).toMatchObject({ status: "unresolved" });
  });

  it("reports totals, the revision, and whether the editor could measure at all", () => {
    const evaluation = evaluateBrief(chair, { checks: [
      briefCheckSchema.parse({ kind: "count", selector: { namePrefix: "Leg" }, min: 2 }),
      briefCheckSchema.parse({ kind: "size", target: { name: "Seat" }, axis: "y", min: 1 }),
      briefCheckSchema.parse({ kind: "size", target: { name: "Roof" }, axis: "y", min: 1 }),
    ] });
    expect(evaluation).toMatchObject({ revision: 3, measurable: true, passed: 1, failed: 1, unresolved: 1 });
    expect(briefPassed(evaluation)).toBe(false);
    expect(briefPassed(evaluateBrief(chair, { checks: [briefCheckSchema.parse({ kind: "count", selector: { name: "Seat" } })] }))).toBe(true);
    // An editor that predates bounds sends none; that is not a pass.
    const old = sceneOf([{ ...part("a", "A", [0, 0, 0], [1, 1, 1]) }]);
    for (const object of old.objects) delete object.worldBounds;
    const unmeasured = evaluateBrief(old, { checks: [briefCheckSchema.parse({ kind: "size", target: { name: "A" }, axis: "x", min: 1 })] });
    expect(unmeasured.measurable).toBe(false);
    expect(briefPassed(unmeasured)).toBe(false);
    // An empty scene can be measured: nothing is there.
    expect(evaluateBrief(sceneOf([]), { checks: [briefCheckSchema.parse({ kind: "count", selector: { name: "A" } })] })).toMatchObject({ measurable: true, failed: 1 });
  });
});

describe("brief schema", () => {
  const check = { kind: "size", target: { name: "Seat" }, axis: "x", min: 0.4 };
  it("takes exactly one way of naming an object", () => {
    expect(briefCheckSchema.safeParse(check).success).toBe(true);
    expect(briefCheckSchema.safeParse({ ...check, target: {} }).success).toBe(false);
    expect(briefCheckSchema.safeParse({ ...check, target: { id: "a", name: "Seat" } }).success).toBe(false);
  });
  it("offers a name prefix only where several objects make sense", () => {
    expect(briefCheckSchema.safeParse({ ...check, target: { namePrefix: "Leg" } }).success).toBe(false);
    expect(briefCheckSchema.safeParse({ kind: "connected", group: { namePrefix: "Leg" } }).success).toBe(false);
    expect(briefCheckSchema.safeParse({ kind: "connected", group: { name: "Chair" } }).success).toBe(true);
    expect(briefCheckSchema.safeParse({ kind: "count", selector: { namePrefix: "Leg" }, min: 4 }).success).toBe(true);
  });
  it("needs a usable range", () => {
    expect(briefCheckSchema.safeParse({ ...check, min: undefined }).success).toBe(false);
    expect(briefCheckSchema.safeParse({ ...check, min: 2, max: 1 }).success).toBe(false);
    expect(briefCheckSchema.safeParse({ kind: "count", selector: { name: "A" }, min: 3, max: 1 }).success).toBe(false);
  });
  it("needs at least one check and no unknown fields", () => {
    expect(briefSchema.safeParse({ subject: "Chair", checks: [] }).success).toBe(false);
    expect(briefSchema.safeParse({ subject: "Chair", checks: [check], extra: 1 }).success).toBe(false);
    expect(briefSchema.parse({ subject: "Chair", checks: [check] }).assumptions).toEqual([]);
  });
});

describe("brief tools", () => {
  const brief: Brief = briefSchema.parse({
    subject: "Chair",
    checks: [
      { kind: "size", target: { name: "Seat" }, axis: "y", max: 0.06 },
      { kind: "position", target: { name: "Leg.FL" }, axis: "y", anchor: "min", min: 0, max: 0 },
    ],
  });

  function fixture(initial: EditorContext = chair) {
    let scene = initial;
    const bridge = { assertConnection: () => ({}), getContext: async () => scene } as unknown as EditorBridge;
    const progress = emptyRunProgress();
    const context = { userId: "u", projectId: "p", clientId: "c", progress } as unknown as AgentRunContext;
    const [record, check] = createBriefTools(bridge);
    if (!record || !check) throw new Error("Missing brief tools");
    return { record, check, progress, context, setScene: (next: EditorContext) => { scene = next; } };
  }

  it("refuses to check before a brief exists", async () => {
    const f = fixture();
    expect(await f.check.execute({}, f.context)).toMatchObject({ status: "rejected" });
  });

  it("records the brief, marks it unmeasured, and measures it on request", async () => {
    const f = fixture();
    expect(await f.record.execute(brief, f.context)).toMatchObject({ status: "recorded", checkCount: 2, replaced: false });
    expect(f.progress.brief).toMatchObject({ stale: true, last: null, revisions: 0 });
    expect(await f.check.execute({}, f.context)).toMatchObject({ status: "pass", passed: 2, failed: 0, unresolved: 0, revision: 3 });
    expect(f.progress.brief).toMatchObject({ stale: false, last: { measurable: true, total: 2, passed: 2, failing: [] } });
  });

  it("reports what failed with the measured and needed values, and clears once fixed", async () => {
    const f = fixture(sceneOf([part("seat", "Seat", [-0.25, 0.45, -0.25], [0.25, 0.65, 0.25]), part("leg", "Leg.FL", [0, 0.1, 0], [0.05, 0.5, 0.05])]));
    await f.record.execute(brief, f.context);
    const failed = await f.check.execute({}, f.context);
    expect(failed).toMatchObject({ status: "fail", failed: 2 });
    expect(f.progress.brief.last?.failing).toEqual([
      "size y of named \"Seat\": 0.2, needs at most 0.06",
      "min y of named \"Leg.FL\": 0.1, needs exactly 0",
    ]);
    f.setScene(chair);
    expect(await f.check.execute({}, f.context)).toMatchObject({ status: "pass" });
    expect(f.progress.brief.last?.failing).toEqual([]);
  });

  it("counts a replaced brief, warns when it had failures, and starts the measuring over", async () => {
    const f = fixture(sceneOf([part("seat", "Seat", [0, 0, 0], [1, 1, 1])]));
    await f.record.execute(brief, f.context);
    await f.check.execute({}, f.context);
    const again = await f.record.execute(brief, f.context);
    expect(again).toMatchObject({ status: "recorded", replaced: true, warning: expect.stringContaining("weakening") });
    expect(f.progress.brief).toMatchObject({ revisions: 1, stale: true, last: null });
  });

  it("says plainly when the editor sent no bounds", async () => {
    const old = sceneOf([part("seat", "Seat", [0, 0, 0], [1, 1, 1])]);
    for (const object of old.objects) delete object.worldBounds;
    const f = fixture(old);
    await f.record.execute(brief, f.context);
    expect(await f.check.execute({}, f.context)).toMatchObject({ status: "unmeasurable", message: expect.stringContaining("did not report object bounds") });
  });
});
