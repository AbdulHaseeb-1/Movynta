import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { presetForKey, VIEW_PRESETS, viewPosition } from "./viewPresets";

describe("view presets", () => {
  it("picks a preset by numpad key, with Ctrl for the opposite side", () => {
    expect(presetForKey("Numpad1", false)?.id).toBe("front");
    expect(presetForKey("Numpad1", true)?.id).toBe("back");
    expect(presetForKey("Numpad3", false)?.id).toBe("right");
    expect(presetForKey("Numpad3", true)?.id).toBe("left");
    expect(presetForKey("Numpad7", false)?.id).toBe("top");
    expect(presetForKey("Numpad7", true)?.id).toBe("bottom");
    expect(presetForKey("Numpad5", false)).toBeUndefined();
    expect(presetForKey("Digit1", false)).toBeUndefined();
  });

  it("uses unit directions that match the assistant's view conventions", () => {
    for (const preset of VIEW_PRESETS) expect(new Vector3(...preset.direction).length()).toBeCloseTo(1, 4);
    const front = VIEW_PRESETS.find((preset) => preset.id === "front");
    expect(front?.direction).toEqual([0, 0, 1]);
    const iso = new Vector3(...(VIEW_PRESETS.find((preset) => preset.id === "isometric")?.direction ?? [0, 0, 0]));
    expect(iso.x).toBeCloseTo(iso.z, 6);
    expect(iso.y).toBeGreaterThan(0);
  });

  it("stands the camera at the distance asked for, around the target", () => {
    const target = new Vector3(1, 2, 3);
    const position = viewPosition(target, [1, 0, 0], 10);
    expect(position.toArray()).toEqual([11, 2, 3]);
  });

  it("keeps a top view looking down with a stable up, without changing where it stands", () => {
    const target = new Vector3();
    for (const direction of [[0, 1, 0], [0, -1, 0]] as const) {
      const position = viewPosition(target, direction, 8);
      expect(position.distanceTo(target)).toBeCloseTo(8, 6);
      expect(Math.abs(position.y)).toBeGreaterThan(7.999);
      const camera = new PerspectiveCamera();
      camera.position.copy(position);
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
      // Finite orientation: the camera's own up axis is not NaN.
      expect(camera.quaternion.toArray().every(Number.isFinite)).toBe(true);
    }
  });
});
