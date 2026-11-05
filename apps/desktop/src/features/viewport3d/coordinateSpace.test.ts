import { describe, expect, it } from "vitest";
import { LineSegments, PerspectiveCamera, Scene, ShaderMaterial, Vector3 } from "three";
import { addCoordinateSpace, originProjection, updateCoordinateSpace } from "./coordinateSpace";

describe("origin marker", () => {
  it("hides the origin when it is behind the camera and shows it when it is in front", () => {
    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, -10);
    camera.lookAt(0, 0, -11);
    camera.updateMatrixWorld(true);
    expect(originProjection(camera)).toBeNull();
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const visible = originProjection(camera);
    expect(visible).not.toBeNull();
    expect(visible?.left).toBeCloseTo(0.5, 5);
    expect(visible?.top).toBeCloseTo(0.5, 5);
  });
});

describe("coordinate grid", () => {
  it("tracks panning on grid increments and expands its spacing and fade at distant zoom", () => {
    const grid = addCoordinateSpace(new Scene());
    const lines = grid.children[0];
    const axes = grid.children[1];
    if (!(lines instanceof LineSegments) || !(lines.material instanceof ShaderMaterial) || !(axes instanceof LineSegments))
      throw new Error("Expected grid lines and axes");
    updateCoordinateSpace(grid, new Vector3(127, 0, -83), 500);
    expect(lines.scale.x).toBe(10);
    expect(lines.position.toArray()).toEqual([130, 0, -80]);
    expect(axes.position.toArray()).toEqual([0, 0, 0]);
    expect(lines.material.uniforms["uFadeFar"]?.value).toBe(1500);
    updateCoordinateSpace(grid, new Vector3(1.3, 0, -2.7), 10);
    expect(lines.scale.x).toBe(1);
    expect(lines.position.toArray()).toEqual([1, 0, -3]);
    expect(lines.material.uniforms["uFadeFar"]?.value).toBe(60);
  });
});
