import { buildingObjects, sceneObject, sceneOf } from "../../../testing/scene-fixtures.js";
import { DEFAULT_FOLD_FROM, MAX_BRANCH_ENTRIES, readBranch, type BranchEntry, type BranchOptions } from "./branch.js";
import { SceneIndex } from "./scene-index.js";
import { SignatureBook } from "./signature.js";

const defaults: BranchOptions = { depth: 1, childLimit: 30, childOffset: 0, foldFrom: DEFAULT_FOLD_FROM };

function read(objects: ReturnType<typeof sceneObject>[], options: Partial<BranchOptions> = {}) {
  const index = new SceneIndex(sceneOf(objects));
  return readBranch(index, new SignatureBook(index), { ...defaults, ...options });
}

function isObject(entry: BranchEntry): entry is Extract<BranchEntry, { id: string }> {
  return !("repeat" in entry);
}

describe("readBranch", () => {
  const building = buildingObjects({ floors: 6, columns: 20 });

  it("lists the top level with summaries", () => {
    const top = read(building);
    expect(top.node).toBeUndefined();
    expect(top.children).toHaveLength(1);
    expect(top.children[0]).toMatchObject({ id: "building", name: "Building", type: "empty", childCount: 3, descendantCount: 3 + 120 * 3, size: null });
  });

  it("describes the opened object and lists its children, with the path to it", () => {
    const branch = read(building, { rootId: "building" });
    expect(branch.node).toMatchObject({ id: "building", childCount: 3 });
    expect(branch.path).toEqual([{ id: "building", name: "Building" }]);
    expect(branch.children.map((entry) => (isObject(entry) ? entry.name : entry.name))).toEqual(["Walls", "Roof", "Facade"]);
    expect(branch.children[0]).toMatchObject({ size: [26, 18, 10], center: [0, 0, 0], childCount: 0 });
  });

  it("shows 120 windows as one folded entry, with examples and the member size", () => {
    const branch = read(building, { rootId: "facade" });
    expect(branch.children).toEqual([
      { repeat: true, name: "Window", type: "empty", count: 120, templateId: "window_0_0", exampleIds: ["window_0_0", "window_0_1", "window_0_2"], size: [1, 1.4, 0.2], descendantsEach: 2 },
    ]);
    expect(branch.childrenOmitted).toBe(0);
  });

  it("lists every window when folding is off, and pages them", () => {
    const first = read(building, { rootId: "facade", foldFrom: 0, childLimit: 50 });
    expect(first.children).toHaveLength(50);
    expect(first.childrenOmitted).toBe(70);
    expect(first.nextOffset).toBe(50);
    const second = read(building, { rootId: "facade", foldFrom: 0, childLimit: 50, childOffset: 50 });
    expect(second.children).toHaveLength(50);
    expect(second.nextOffset).toBe(100);
    const last = read(building, { rootId: "facade", foldFrom: 0, childLimit: 50, childOffset: 100 });
    expect(last.children).toHaveLength(20);
    expect(last.nextOffset).toBeUndefined();
    expect(last.childrenOmitted).toBe(0);
  });

  it("does not fold a run shorter than the threshold", () => {
    const three = read([
      sceneObject({ id: "root", type: "empty", size: null }),
      ...[0, 1, 2].map((n) => sceneObject({ id: `p${n}`, name: `Post.${n}`, parentId: "root", at: [n, 0, 0] })),
    ], { rootId: "root" });
    expect(three.children).toHaveLength(3);
    expect(three.children.every(isObject)).toBe(true);
  });

  it("keeps unlike siblings apart and folds only the run that matches", () => {
    const mixed = read([
      sceneObject({ id: "root", type: "empty", size: null }),
      sceneObject({ id: "door", name: "Door", parentId: "root", size: [1, 2, 0.1] }),
      ...[0, 1, 2, 3].map((n) => sceneObject({ id: `p${n}`, name: `Post.${n}`, parentId: "root", at: [n, 0, 0] })),
      sceneObject({ id: "sign", name: "Sign", parentId: "root", size: [1, 0.3, 0.05] }),
    ], { rootId: "root" });
    expect(mixed.children.map((entry) => (isObject(entry) ? entry.name : `${entry.name} x${entry.count}`))).toEqual(["Door", "Post x4", "Sign"]);
  });

  it("opens several levels at once, with counts for what stays closed", () => {
    const deep = read(building, { rootId: "building", depth: 3 });
    const facade = deep.children.find((entry) => isObject(entry) && entry.id === "facade");
    expect(facade && isObject(facade) ? facade.children : undefined).toEqual([expect.objectContaining({ repeat: true, count: 120 })]);
    const unfolded = read(building, { rootId: "window_0_0", depth: 2 });
    expect(unfolded.children.map((entry) => (isObject(entry) ? entry.name : ""))).toEqual(["Frame", "Pane"]);
  });

  it("marks what a level leaves out when it is capped inside a deeper read", () => {
    const wide = read([
      sceneObject({ id: "root", type: "empty", size: null }),
      sceneObject({ id: "box", type: "empty", parentId: "root", size: null }),
      ...Array.from({ length: 12 }, (_, n) => sceneObject({ id: `c${n}`, name: `Different${"x".repeat(n)}`, parentId: "box", at: [n, 0, 0] })),
    ], { rootId: "root", depth: 2, childLimit: 5 });
    const box = wide.children[0];
    expect(box && isObject(box) ? box.children : []).toHaveLength(5);
    expect(box && isObject(box) ? box.childrenOmitted : 0).toBe(7);
  });

  it("stops at its entry limit and says so", () => {
    const many = [
      sceneObject({ id: "root", type: "empty", size: null }),
      ...Array.from({ length: 400 }, (_, n) => sceneObject({ id: `o${n}`, name: `Part${"x".repeat(n % 7)}${n}`, parentId: "root", at: [n, 0, 0], size: [1 + n, 1, 1] })),
    ];
    const capped = read(many, { rootId: "root", childLimit: 100, depth: 1 });
    expect(capped.children).toHaveLength(100);
    // A deeper read across many groups hits the overall limit.
    const groups = [
      sceneObject({ id: "root", type: "empty", size: null }),
      ...Array.from({ length: 100 }, (_, g) => sceneObject({ id: `g${g}`, name: `Group${"y".repeat(g)}`, type: "empty", parentId: "root", size: null })),
      ...Array.from({ length: 100 }, (_, g) => Array.from({ length: 10 }, (_, n) => sceneObject({ id: `g${g}_${n}`, name: `Leaf${"z".repeat(n)}`, parentId: `g${g}`, at: [n, g, 0], size: [1 + n, 1 + g, 1] }))).flat(),
    ];
    const truncated = read(groups, { rootId: "root", depth: 2, childLimit: 100 });
    expect(truncated.truncated).toBe(true);
    const count = (entries: BranchEntry[] | undefined): number => (entries ?? []).reduce((sum, entry) => sum + 1 + (isObject(entry) ? count(entry.children) : 0), 0);
    expect(count(truncated.children)).toBeLessThanOrEqual(MAX_BRANCH_ENTRIES);
  });

  it("only carries a descendants summary where something is below", () => {
    const branch = read(building, { rootId: "building" });
    const walls = branch.children[0];
    expect(walls && isObject(walls) ? "descendants" in walls : true).toBe(false);
    const facade = branch.children[2];
    expect(facade && isObject(facade) ? facade.descendants : undefined).toEqual({ empty: 120, mesh: 240 });
  });

  it("reports hidden objects as hidden", () => {
    const hidden = read([sceneObject({ id: "a", visible: false })]);
    expect(hidden.children[0]).toMatchObject({ visible: false });
  });
});
