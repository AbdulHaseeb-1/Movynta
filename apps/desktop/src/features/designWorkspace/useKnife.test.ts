import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh } from "three";
import { singleVisibleMesh } from "./useKnife";
describe("Knife mesh target", () => {
  it("requires choosing a part when more than one mesh is visible", () => {
    const root = new Group(),
      one = new Mesh(new BoxGeometry()),
      two = new Mesh(new BoxGeometry());
    root.add(one, two);
    expect(singleVisibleMesh(root)).toBeNull();
    two.visible = false;
    expect(singleVisibleMesh(root)).toEqual([0]);
    expect(singleVisibleMesh(one)).toEqual([]);
  });
});
