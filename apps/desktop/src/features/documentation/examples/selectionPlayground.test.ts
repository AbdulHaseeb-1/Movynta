import { describe, expect, it } from "vitest";
import { boxSelect, clickSelect, itemsInRect, operationText, rectFrom, type PlaygroundItem } from "./selectionPlayground";

const items: readonly PlaygroundItem[] = [
  { id: "a", label: "A", center: { x: 1, y: 1 } },
  { id: "b", label: "B", center: { x: 5, y: 1 } },
  { id: "c", label: "C", center: { x: 9, y: 9 } },
];
const none = { shiftKey: false, altKey: false };
const shift = { shiftKey: true, altKey: false };
const alt = { shiftKey: false, altKey: true };
const both = { shiftKey: true, altKey: true };

describe("selection playground", () => {
  it("counts items by their centers, whichever way the box was dragged", () => {
    expect(itemsInRect(items, rectFrom({ x: 6, y: 2 }, { x: 0, y: 0 }))).toEqual(["a", "b"]);
  });

  it("combines a box with the selection as the workspace does", () => {
    expect(boxSelect(["c"], ["a", "b"], none)).toEqual(["a", "b"]);
    expect(boxSelect(["c"], ["a"], shift)).toEqual(["c", "a"]);
    expect(boxSelect(["a", "c"], ["a"], alt)).toEqual(["c"]);
    expect(boxSelect(["a", "c"], ["a", "b"], both)).toEqual(["a"]);
  });

  it("selects one item on a click and toggles it on Shift-click", () => {
    expect(clickSelect(["a", "b"], "c", none)).toEqual(["c"]);
    expect(clickSelect(["a"], "b", shift)).toEqual(["a", "b"]);
    expect(clickSelect(["a", "b"], "a", shift)).toEqual(["b"]);
    expect(clickSelect(["a"], null, none)).toEqual([]);
    expect(clickSelect(["a"], null, shift)).toEqual(["a"]);
  });

  it("describes what releasing the box will do", () => {
    expect(operationText(both)).toContain("Shift+Alt");
  });
});
