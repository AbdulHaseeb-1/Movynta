import { describe, expect, it } from "vitest";
import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import type { ViewSpec } from "@movynta/editor-protocol";
import { frameView, orbitDirection, subjectOf, type CameraPose, type CurrentCamera } from "./framing";
import { isInFrame, projectBounds } from "./screenBounds";

const current: CurrentCamera = { position: new Vector3(5, 4, 7), target: new Vector3(0, 0, 0), fov: 45 };
const unitCube = new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
const subject = subjectOf(unitCube);
const frame = (spec: ViewSpec, aspect = 4 / 3) => frameView(spec, subject, aspect, current);

function cameraFor(pose: CameraPose, aspect = 4 / 3): PerspectiveCamera | OrthographicCamera {
  const camera =
    pose.projection === "orthographic"
      ? new OrthographicCamera(
          (-pose.orthographicHeight * aspect) / 2,
          (pose.orthographicHeight * aspect) / 2,
          pose.orthographicHeight / 2,
          -pose.orthographicHeight / 2,
          0.01,
          100,
        )
      : new PerspectiveCamera(pose.fov, aspect, 0.01, 100);
  camera.position.copy(pose.position);
  camera.up.copy(pose.up);
  camera.lookAt(pose.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

describe("framing a view", () => {
  it("stands each axis preset on its side of the subject", () => {
    expect(frame({ preset: "front" }).position.z).toBeGreaterThan(0);
    expect(frame({ preset: "back" }).position.z).toBeLessThan(0);
    expect(frame({ preset: "right" }).position.x).toBeGreaterThan(0);
    expect(frame({ preset: "left" }).position.x).toBeLessThan(0);
    expect(frame({ preset: "top" }).position.y).toBeGreaterThan(0);
    expect(frame({ preset: "bottom" }).position.y).toBeLessThan(0);
    for (const side of ["front", "back", "left", "right", "top", "bottom"] as const) {
      const pose = frame({ preset: side });
      expect(pose.projection).toBe("orthographic");
      expect(pose.target.toArray()).toEqual([0, 0, 0]);
    }
  });

  it("looks straight along the axis, so a front view shows no depth", () => {
    const pose = frame({ preset: "front" });
    expect(pose.position.x).toBeCloseTo(0);
    expect(pose.position.y).toBeCloseTo(0);
  });

  it("keeps the picture's up away from the view direction on top and bottom views", () => {
    expect(frame({ preset: "top" }).up.toArray()).toEqual([0, 0, -1]);
    expect(frame({ preset: "bottom" }).up.toArray()).toEqual([0, 0, 1]);
    expect(frame({ preset: "front" }).up.toArray()).toEqual([0, 1, 0]);
  });

  it("makes the isometric view perspective, from a corner above the subject", () => {
    const pose = frame({ preset: "isometric" });
    expect(pose.projection).toBe("perspective");
    expect(pose.position.x).toBeGreaterThan(0);
    expect(pose.position.y).toBeGreaterThan(0);
    expect(pose.position.z).toBeGreaterThan(0);
    expect(frame({}).position.toArray()).toEqual(pose.position.toArray());
  });

  it("circles the subject by azimuth and elevation, 0 degrees being the front", () => {
    expect(orbitDirection(0, 0).toArray()).toEqual([0, 0, 1]);
    expect(orbitDirection(90, 0).x).toBeCloseTo(1);
    expect(orbitDirection(180, 0).z).toBeCloseTo(-1);
    expect(orbitDirection(0, 90).y).toBeCloseTo(1);
    const pose = frame({ orbit: { azimuthDegrees: 90, elevationDegrees: 30 } });
    expect(pose.position.x).toBeGreaterThan(0);
    expect(pose.position.y).toBeGreaterThan(0);
    expect(pose.projection).toBe("perspective");
  });

  it("stands far enough back to show the whole subject, in tall and wide pictures", () => {
    for (const aspect of [4 / 3, 1, 3 / 4, 16 / 9]) {
      const camera = cameraFor(frame({ preset: "isometric" }, aspect), aspect);
      const rect = projectBounds(unitCube, camera, 800, 800 / aspect);
      expect(rect).not.toBeNull();
      if (!rect) continue;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(800);
      expect(rect.y + rect.height).toBeLessThanOrEqual(800 / aspect);
    }
  });

  it("moves closer as zoom grows", () => {
    const near = frame({ preset: "isometric", zoom: 2 }).position.length();
    const far = frame({ preset: "isometric" }).position.length();
    expect(near).toBeCloseTo(far / 2);
    expect(frame({ preset: "front", zoom: 2 }).orthographicHeight).toBeCloseTo(frame({ preset: "front" }).orthographicHeight / 2);
  });

  it("uses an exact camera as given, and refuses one that looks at itself", () => {
    const pose = frame({ camera: { position: [4, 3, 6], target: [0, 1, 0], fov: 30 } });
    expect(pose.position.toArray()).toEqual([4, 3, 6]);
    expect(pose.target.toArray()).toEqual([0, 1, 0]);
    expect(pose.fov).toBe(30);
    expect(pose.projection).toBe("perspective");
    expect(() => frame({ camera: { position: [1, 1, 1], target: [1, 1, 1] } })).toThrow(/different points/);
  });

  it("lets the assistant choose the projection of any view", () => {
    expect(frame({ preset: "front", projection: "perspective" }).projection).toBe("perspective");
    expect(frame({ preset: "isometric", projection: "orthographic" }).projection).toBe("orthographic");
  });

  it("repeats the user's own view for the current preset", () => {
    const pose = frame({ preset: "current" });
    expect(pose.position.toArray()).toEqual([5, 4, 7]);
    expect(pose.fov).toBe(45);
    const closer = frame({ preset: "current", zoom: 2 });
    expect(closer.position.length()).toBeCloseTo(new Vector3(5, 4, 7).length() / 2);
  });

  it("frames a default space when there is nothing in the scene, and a point-sized object with room around it", () => {
    expect(subjectOf(null).radius).toBeGreaterThan(1);
    expect(subjectOf(new Box3()).radius).toBeGreaterThan(1);
    const point = subjectOf(new Box3(new Vector3(1, 1, 1), new Vector3(1, 1, 1)));
    expect(point.center.toArray()).toEqual([1, 1, 1]);
    expect(point.radius).toBeGreaterThan(0);
  });
});

describe("placing an object on the picture", () => {
  const camera = cameraFor(frame({ preset: "front", projection: "perspective" }));

  it("puts the middle of the subject in the middle of the picture", () => {
    const rect = projectBounds(unitCube, camera, 800, 600);
    expect(rect).not.toBeNull();
    if (!rect) return;
    expect(rect.x + rect.width / 2).toBeCloseTo(400, 0);
    expect(rect.y + rect.height / 2).toBeCloseTo(300, 0);
    expect(isInFrame(rect, 800, 600)).toBe(true);
  });

  it("measures y from the top of the picture", () => {
    const high = new Box3(new Vector3(-0.1, 0.3, -0.1), new Vector3(0.1, 0.5, 0.1));
    const rect = projectBounds(high, camera, 800, 600);
    expect(rect && rect.y + rect.height / 2).toBeLessThan(300);
  });

  it("reports a box behind the camera as absent, and one far to the side as out of frame", () => {
    const behind = new Box3(new Vector3(-1, -1, 50), new Vector3(1, 1, 52));
    expect(projectBounds(behind, camera, 800, 600)).toBeNull();
    const aside = new Box3(new Vector3(40, -1, -1), new Vector3(42, 1, 1));
    const rect = projectBounds(aside, camera, 800, 600);
    expect(rect).not.toBeNull();
    expect(isInFrame(rect, 800, 600)).toBe(false);
    expect(isInFrame(null, 800, 600)).toBe(false);
  });

  it("agrees between orthographic and perspective on where the centre is", () => {
    const orthographic = cameraFor(frame({ preset: "front" }));
    const rect = projectBounds(unitCube, orthographic, 800, 600);
    expect(rect && rect.x + rect.width / 2).toBeCloseTo(400, 0);
  });
});
