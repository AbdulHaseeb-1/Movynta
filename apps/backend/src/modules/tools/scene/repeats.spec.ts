import { buildingObjects, sceneObject, sceneOf } from "../../../testing/scene-fixtures.js";
import { MAX_MEMBER_IDS, arrangementOf, findRepeats } from "./repeats.js";
import { SceneIndex } from "./scene-index.js";
import { SignatureBook } from "./signature.js";

function report(objects: ReturnType<typeof sceneObject>[], options: { rootId?: string; minCount?: number; limit?: number } = {}) {
  const index = new SceneIndex(sceneOf(objects));
  return findRepeats(index, new SignatureBook(index), { rootId: options.rootId, minCount: options.minCount ?? 3, limit: options.limit ?? 10 });
}

describe("findRepeats on a building", () => {
  const result = report(buildingObjects({ floors: 6, columns: 20 }));

  it("reports 120 windows as one group, not as windows, frames and panes", () => {
    expect(result.groups.map((group) => [group.name, group.count])).toEqual([["Window", 120]]);
    expect(result.groups[0]).toMatchObject({ type: "empty", descendantsEach: 2, parentCount: 1, parentIds: ["facade"], templateId: "window_0_0" });
  });

  it("finds the grid the windows sit in, with its counts and spacing", () => {
    expect(result.groups[0]?.arrangement).toEqual({ kind: "grid", axes: ["x", "y"], counts: [20, 6], steps: [1.2, 3] });
  });

  it("counts the objects the group stands for, and names only the first members", () => {
    // Building, walls, roof and facade, then 120 windows with a frame and a pane each.
    expect(result.scanned).toBe(4 + 120 * 3);
    expect(result.covered).toBe(120 * 3);
    expect(result.groups[0]?.memberIds).toHaveLength(MAX_MEMBER_IDS);
    expect(result.groups[0]?.memberIdsOmitted).toBe(120 - MAX_MEMBER_IDS);
    expect(result.omittedGroups).toBe(0);
  });

  it("limits the search to one branch", () => {
    const inside = report(buildingObjects({ floors: 6, columns: 20 }), { rootId: "window_0_0" });
    expect(inside.groups).toEqual([]);
    const facade = report(buildingObjects({ floors: 6, columns: 20 }), { rootId: "facade" });
    expect(facade.groups).toHaveLength(1);
  });
});

describe("findRepeats grouping", () => {
  it("reports the parts of copies when the copies themselves are not alike", () => {
    // Each unit holds one frame, but the units differ in size, so only the frames repeat.
    const objects = [
      ...[1, 2, 3].flatMap((n) => [
        sceneObject({ id: `u${n}`, name: `Unit ${n}`, type: "empty", size: null }),
        sceneObject({ id: `u${n}f`, name: "Frame", parentId: `u${n}`, at: [n * 5, 0, 0], size: [1, 1, 1] }),
        sceneObject({ id: `u${n}x`, name: `Extra${"x".repeat(n)}`, parentId: `u${n}`, at: [n * 5, 2, 0], size: [n, n, n] }),
      ]),
    ];
    expect(report(objects).groups.map((group) => [group.name, group.count])).toEqual([["Frame", 3]]);
  });

  it("reports identical containers once, not the identical things inside them", () => {
    const objects = [
      ...Array.from({ length: 5 }, (_, n) => [
        sceneObject({ id: `floor${n}`, name: `Floor ${n}`, type: "empty", size: null }),
        sceneObject({ id: `win${n}`, name: "Window", parentId: `floor${n}`, at: [0, n * 3, 0] }),
      ]).flat(),
    ];
    expect(report(objects).groups.map((group) => [group.name, group.count, group.descendantsEach])).toEqual([["Floor", 5, 1]]);
  });

  it("respects minCount, including a pair", () => {
    const pair = [sceneObject({ id: "a", name: "Arm.001", at: [-1, 0, 0] }), sceneObject({ id: "b", name: "Arm.002", at: [1, 0, 0] })];
    expect(report(pair).groups).toEqual([]);
    expect(report(pair, { minCount: 2 }).groups).toMatchObject([{ name: "Arm", count: 2, arrangement: { kind: "line", axis: "x", count: 2, step: 2 } }]);
  });

  it("does not merge objects that differ in size, name or type", () => {
    const objects = [
      ...[0, 1, 2].map((n) => sceneObject({ id: `a${n}`, name: "Post", at: [n, 0, 0], size: [0.2, 3, 0.2] })),
      ...[0, 1, 2].map((n) => sceneObject({ id: `b${n}`, name: "Post", at: [n, 5, 0], size: [0.2, 3, 0.3] })),
      ...[0, 1, 2].map((n) => sceneObject({ id: `c${n}`, name: "Beam", at: [n, 9, 0], size: [0.2, 3, 0.2] })),
    ];
    expect(report(objects).groups.map((group) => [group.name, group.count]).sort()).toEqual([["Beam", 3], ["Post", 3], ["Post", 3]]);
  });

  it("orders groups by how much of the scene they stand for, and caps them", () => {
    const small = [0, 1, 2].map((n) => sceneObject({ id: `s${n}`, name: "Bolt", at: [n, 0, 0], size: [0.1, 0.1, 0.1] }));
    const large = [0, 1, 2, 3, 4, 5].map((n) => sceneObject({ id: `l${n}`, name: "Plank", at: [n, 3, 0], size: [2, 0.1, 0.4] }));
    const objects = [...small, ...large];
    expect(report(objects).groups.map((group) => group.name)).toEqual(["Plank", "Bolt"]);
    const capped = report(objects, { limit: 1 });
    expect(capped.groups).toHaveLength(1);
    expect(capped.omittedGroups).toBe(1);
  });

  it("skips objects it cannot compare, such as meshes with no bounds", () => {
    const objects = [0, 1, 2, 3].map((n) => sceneObject({ id: `m${n}`, name: "Mystery", size: null }));
    expect(report(objects)).toMatchObject({ scanned: 4, covered: 0, groups: [] });
  });

  it("reports nothing for an empty scene", () => {
    expect(report([])).toEqual({ scanned: 0, covered: 0, groups: [], omittedGroups: 0 });
  });

  it("lists every parent a group spreads over, up to five, and counts them", () => {
    const objects = [
      // Different names, so only the windows repeat.
      ...Array.from({ length: 7 }, (_, n) => sceneObject({ id: `p${n}`, name: `Zone-${"ABCDEFG"[n]}`, type: "empty", size: null })),
      ...Array.from({ length: 7 }, (_, n) => sceneObject({ id: `w${n}`, name: "Window", parentId: `p${n}`, at: [0, n * 3, 0] })),
    ];
    const group = report(objects).groups[0];
    expect(group?.parentCount).toBe(7);
    expect(group?.parentIds).toHaveLength(5);
  });
});

describe("arrangementOf", () => {
  const unit: [number, number, number] = [1, 1, 1];

  it("recognises a line along any axis", () => {
    expect(arrangementOf([[0, 0, 0], [0, 0, 2.5], [0, 0, 5]], unit)).toEqual({ kind: "line", axis: "z", count: 3, step: 2.5 });
  });

  it("finds a line whatever order the members are listed in", () => {
    expect(arrangementOf([[4, 0, 0], [0, 0, 0], [2, 0, 0], [6, 0, 0]], unit)).toEqual({ kind: "line", axis: "x", count: 4, step: 2 });
  });

  it("tolerates small differences in position", () => {
    expect(arrangementOf([[0, 0, 0], [2.001, 0.002, 0], [3.999, 0, 0.001]], unit)).toMatchObject({ kind: "line", axis: "x", step: 2 });
  });

  it("recognises a grid of two axes, and of three", () => {
    const flat = [0, 1].flatMap((row) => [0, 1, 2].map((column) => [column * 2, row * 3, 0] as [number, number, number]));
    expect(arrangementOf(flat, unit)).toEqual({ kind: "grid", axes: ["x", "y"], counts: [3, 2], steps: [2, 3] });
    const cube = [0, 1].flatMap((a) => [0, 1].flatMap((b) => [0, 1].map((c) => [a, b, c] as [number, number, number])));
    expect(arrangementOf(cube, unit)).toEqual({ kind: "grid", axes: ["x", "y", "z"], counts: [2, 2, 2], steps: [1, 1, 1] });
  });

  it("calls uneven spacing scattered", () => {
    expect(arrangementOf([[0, 0, 0], [2, 0, 0], [5, 0, 0]], unit)).toEqual({ kind: "scattered" });
  });

  it("calls a grid with a missing cell scattered, because it cannot be one array", () => {
    expect(arrangementOf([[0, 0, 0], [2, 0, 0], [0, 3, 0]], unit)).toEqual({ kind: "scattered" });
  });

  it("calls a row with two members in one place scattered", () => {
    expect(arrangementOf([[0, 0, 0], [0, 0, 0], [2, 0, 0], [4, 0, 0]], unit)).toEqual({ kind: "scattered" });
  });

  it("notices objects piled in one place", () => {
    expect(arrangementOf([[1, 1, 1], [1, 1, 1], [1, 1, 1]], unit)).toEqual({ kind: "coincident" });
  });

  it("scales its tolerance with the size of the objects", () => {
    // A 100-unit object jittered by 0.5 is still on its line; a 0.1-unit one is not.
    expect(arrangementOf([[0, 0, 0], [200.5, 0, 0], [400, 0, 0]], [100, 100, 100])).toMatchObject({ kind: "line" });
    expect(arrangementOf([[0, 0, 0], [2.5, 0, 0], [4, 0, 0]], [0.1, 0.1, 0.1])).toEqual({ kind: "scattered" });
  });
});
