import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { ORIENTATION_AXES, orbitFromDrag, projectOrientation } from "./orientation";
import { VIEW_PRESETS } from "./viewPresets";

describe("orientation gizmo", () => {
  it("maps every axis end to its matching view preset", () => {
    for (const axis of ORIENTATION_AXES) {
      expect(VIEW_PRESETS.find((preset) => preset.id === axis.preset)?.direction).toEqual(axis.direction);
    }
  });

  it("projects world directions using the camera rotation, with the nearer end in front", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 5);
    camera.lookAt(new Vector3());
    const front = projectOrientation(camera.quaternion);
    expect(front[0]?.x).toBeCloseTo(1);
    expect(front[2]?.y).toBeCloseTo(-1);
    expect(front[4]?.depth).toBeCloseTo(1);
    expect(front[5]?.depth).toBeCloseTo(-1);
    camera.position.set(5, 0, 0);
    camera.lookAt(new Vector3());
    const right = projectOrientation(camera.quaternion);
    expect(right[0]?.depth).toBeCloseTo(1);
    expect(right[1]?.depth).toBeCloseTo(-1);
    expect(right[4]?.x).toBeCloseTo(-1);
  });
  it("orbits around the target at a fixed distance and respects polar limits", () => {
    const target = new Vector3(2, 1, -3);
    const start = target.clone().add(new Vector3(0, 0, 10));
    const rotated = orbitFromDrag(start, target, 50, 20, 0, Math.PI);
    expect(rotated.distanceTo(target)).toBeCloseTo(10);
    expect(rotated.x).toBeLessThan(target.x);
    expect(rotated.y).toBeGreaterThan(target.y);
    const clamped = orbitFromDrag(start, target, 0, 10000, 0.3, 2.8).sub(target);
    expect(Math.acos(clamped.y / clamped.length())).toBeCloseTo(0.3);
  });
});
