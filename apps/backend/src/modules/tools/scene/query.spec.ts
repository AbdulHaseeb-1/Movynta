import { buildingObjects, sceneObject, sceneOf } from "../../../testing/scene-fixtures.js";
import { queryObjects, type ObjectQuery } from "./query.js";
import { SceneIndex } from "./scene-index.js";

const base: ObjectQuery = { sortBy: "scene", descending: false, offset: 0, limit: 50 };

function run(query: Partial<ObjectQuery>, objects = buildingObjects({ floors: 6, columns: 20 }), selected: string[] = []) {
  return queryObjects(new SceneIndex(sceneOf(objects)), { ...base, ...query }, selected);
}

describe("queryObjects", () => {
  it("selects by name pattern", () => {
    expect(run({ nameMatches: "window.*" }).total).toBe(120);
    expect(run({ nameMatches: "Window.00?" }).total).toBe(9);
    // Frame and Pane contain an e; Walls and Roof do not.
    expect(run({ nameMatches: "*e*", type: ["mesh"] }).total).toBe(240);
  });

  it("selects by type", () => {
    expect(run({ type: ["empty"] }).total).toBe(1 + 1 + 120);
    expect(run({ type: ["light", "camera"] }).total).toBe(0);
  });

  it("selects direct children, the top level, or everything below", () => {
    expect(run({ parentId: "facade" }).total).toBe(120);
    expect(run({ parentId: "window_0_0" }).matches.map((match) => match.name)).toEqual(["Frame", "Pane"]);
    expect(run({ parentId: null }).matches.map((match) => match.id)).toEqual(["building"]);
    expect(run({ withinId: "building" }).total).toBe(3 + 360);
    expect(run({ withinId: "window_0_0" }).total).toBe(2);
  });

  it("selects by position: the windows above the second floor", () => {
    const upper = run({ nameMatches: "window*", position: { y: { min: 5 } } });
    expect(upper.total).toBe(4 * 20);
    expect(upper.matches.every((match) => (match.center?.[1] ?? 0) >= 5)).toBe(true);
  });

  it("selects by size, with both ends of a range", () => {
    expect(run({ size: { y: { min: 1.3, max: 1.5 } }, type: ["mesh"] }).total).toBe(120);
    expect(run({ size: { x: { max: 0.9 } } }).total).toBe(120);
  });

  it("combines filters", () => {
    const result = run({ nameMatches: "window*", position: { y: { min: 5 }, x: { max: 2.5 } } });
    expect(result.total).toBe(4 * 3);
  });

  it("leaves out objects with no geometry when asked for a size or position", () => {
    // The building and the facade have no bounds; each window group has them from what it holds.
    expect(run({ position: { x: { min: -1000 } }, type: ["empty"] }).total).toBe(120);
    expect(run({ size: { x: { min: 0 } }, type: ["empty"] }).total).toBe(120);
    // A filter with no axis in it asks nothing.
    expect(run({ size: {}, type: ["empty"] }).total).toBe(122);
  });

  it("selects by visibility and by selection", () => {
    const objects = [sceneObject({ id: "a" }), sceneObject({ id: "b", visible: false }), sceneObject({ id: "c" })];
    expect(run({ visible: false }, objects).matches.map((match) => match.id)).toEqual(["b"]);
    expect(run({ visible: true }, objects).total).toBe(2);
    expect(run({ selected: true }, objects, ["c"]).matches.map((match) => match.id)).toEqual(["c"]);
    expect(run({ selected: false }, objects, ["c"]).total).toBe(2);
  });

  it("sorts by name, size, or position, either way, with objects that cannot be sorted last", () => {
    const objects = [
      sceneObject({ id: "g", name: "Group", type: "empty", size: null }),
      sceneObject({ id: "s", name: "small", at: [5, 0, 0], size: [1, 1, 1] }),
      sceneObject({ id: "b", name: "Big", at: [1, 0, 0], size: [3, 3, 3] }),
      sceneObject({ id: "m", name: "mid", at: [3, 0, 0], size: [2, 2, 2] }),
    ];
    const ids = (query: Partial<ObjectQuery>) => run(query, objects).matches.map((match) => match.id);
    expect(ids({ sortBy: "name" })).toEqual(["b", "g", "m", "s"]);
    expect(ids({ sortBy: "size" })).toEqual(["s", "m", "b", "g"]);
    expect(ids({ sortBy: "size", descending: true })).toEqual(["b", "m", "s", "g"]);
    expect(ids({ sortBy: "x", descending: true })).toEqual(["s", "m", "b", "g"]);
  });

  it("pages the matches and says where to go next", () => {
    const first = run({ nameMatches: "window*", limit: 50 });
    expect(first).toMatchObject({ total: 120, hasMore: true, nextOffset: 50 });
    expect(first.matches).toHaveLength(50);
    const last = run({ nameMatches: "window*", limit: 50, offset: 100 });
    expect(last.matches).toHaveLength(20);
    expect(last.hasMore).toBe(false);
    expect(last.nextOffset).toBeUndefined();
    expect(run({ nameMatches: "window*", offset: 500 }).matches).toEqual([]);
  });

  it("gives each match what a command needs, rounded", () => {
    const [match] = run({ nameMatches: "window.001" }).matches;
    expect(match).toEqual({ id: "window_0_0", name: "Window.001", type: "empty", parentId: "facade", size: [1, 1.4, 0.2], center: [0, 0, 5] });
  });
});
