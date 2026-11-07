import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, PerspectiveCamera } from "three";
import { idsInRect } from "./boxSelect";
describe("object box selection", () => {
  it("uses only visible descendant bounds and respects camera clipping", () => {
    const group = new Group(),
      shown = new Mesh(new BoxGeometry()),
      hidden = new Mesh(new BoxGeometry());
    hidden.position.x = 100;
    hidden.visible = false;
    group.add(shown, hidden);
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.z = 5;
    camera.updateMatrixWorld();
    expect(
      idsInRect([["group", group]], camera, {
        minX: -0.1,
        maxX: 0.1,
        minY: -0.1,
        maxY: 0.1,
      }),
    ).toEqual(["group"]);
    camera.far = 2;
    camera.updateProjectionMatrix();
    expect(
      idsInRect([["group", group]], camera, {
        minX: -1,
        maxX: 1,
        minY: -1,
        maxY: 1,
      }),
    ).toEqual([]);
  });
});
