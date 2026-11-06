import { describe, expect, it } from "vitest";
import { combineSelection, selectionOperation } from "./selectionOperation";

describe("box selection operations", () => {
  it("maps modifiers consistently", () => {
    expect(selectionOperation({ shiftKey: false, altKey: false })).toBe("replace");
    expect(selectionOperation({ shiftKey: true, altKey: false })).toBe("add");
    expect(selectionOperation({ shiftKey: false, altKey: true })).toBe("subtract");
    expect(selectionOperation({ shiftKey: true, altKey: true })).toBe("intersect");
  });
  it("combines unique ids while retaining selection order", () => {
    expect(combineSelection(["a", "b"], ["b", "c", "c"], "replace")).toEqual(["b", "c"]);
    expect(combineSelection(["a", "b"], ["b", "c"], "add")).toEqual(["a", "b", "c"]);
    expect(combineSelection(["a", "b"], ["b", "c"], "subtract")).toEqual(["a"]);
    expect(combineSelection(["a", "b"], ["b", "c"], "intersect")).toEqual(["b"]);
  });
});
