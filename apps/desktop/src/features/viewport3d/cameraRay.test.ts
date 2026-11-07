import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Raycaster, Vector2 } from "three";
import { setCameraRay } from "./cameraRay";
describe("camera clipping on selection rays", () => {
  it("converts planar near and far distances for an off-axis perspective ray", () => {
    const camera = new PerspectiveCamera(90, 1, 1, 10);
    camera.updateMatrixWorld();
    const ray = new Raycaster();
    setCameraRay(ray, new Vector2(0.75, 0), camera);
    expect(ray.near).toBeCloseTo(1.25);
    expect(ray.far).toBeCloseTo(12.5);
  });
});
