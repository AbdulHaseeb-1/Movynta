import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import { originProjection } from "./coordinateSpace";

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
