import { describe, expect, it } from "vitest";
import { objectRange, type TreeRow } from "./sceneTree";

const row = (id: string, kind: TreeRow["kind"] = "mesh"): TreeRow => ({ id, name: id, kind, depth: 1, hasChildren: false, collapsed: false, visible: true, effectiveVisible: true });

describe("outliner selection range", () => {
  it("selects visible object rows between endpoints and makes the clicked row active", () => {
    const rows = [row("a"), row("collection:group", "collection"), row("b"), row("c")];
    expect(objectRange(rows, "a", "c")).toEqual(["a", "b", "c"]);
    expect(objectRange(rows, "c", "a")).toEqual(["b", "c", "a"]);
    expect(objectRange(rows, "missing", "a")).toEqual([]);
  });
});
