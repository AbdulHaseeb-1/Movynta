import { MathUtils, Spherical, Vector3, type Quaternion } from "three";
import type { ViewPresetId } from "./viewPresets";

/** One axis shown by the orientation gizmo. */
export interface OrientationAxis {
  label: "X" | "Y" | "Z";
  positive: boolean;
  preset: ViewPresetId;
  direction: readonly [number, number, number];
}

/** The axes shown by the orientation gizmo. */
export const ORIENTATION_AXES: readonly OrientationAxis[] = [
  { label: "X", positive: true, preset: "right", direction: [1, 0, 0] },
  { label: "X", positive: false, preset: "left", direction: [-1, 0, 0] },
  { label: "Y", positive: true, preset: "top", direction: [0, 1, 0] },
  { label: "Y", positive: false, preset: "bottom", direction: [0, -1, 0] },
  { label: "Z", positive: true, preset: "front", direction: [0, 0, 1] },
  { label: "Z", positive: false, preset: "back", direction: [0, 0, -1] },
];

/** Project world axes into camera space, with positive depth closest to the viewer. */
export function projectOrientation(cameraRotation: Quaternion) {
  const inverse = cameraRotation.clone().invert();
  return ORIENTATION_AXES.map((axis) => {
    const direction = new Vector3(...axis.direction).applyQuaternion(inverse);
    return { ...axis, x: direction.x, y: -direction.y, depth: direction.z };
  });
}

/** Orbit around the existing target without changing its distance. */
export function orbitFromDrag(
  position: Vector3,
  target: Vector3,
  dx: number,
  dy: number,
  minPolar: number,
  maxPolar: number,
): Vector3 {
  const orbit = new Spherical().setFromVector3(position.clone().sub(target));
  orbit.theta -= dx * 0.012;
  orbit.phi = MathUtils.clamp(orbit.phi - dy * 0.012, Math.max(0.0001, minPolar), Math.min(Math.PI - 0.0001, maxPolar));
  return new Vector3().setFromSpherical(orbit).add(target);
}
