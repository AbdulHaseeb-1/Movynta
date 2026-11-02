import { Vector3, type Camera, type Vector2 } from "three";
import type { Rig } from "./rig";

/** How close, in screen pixels, a click has to be to a joint or to a bone's stick to pick it. */
export const JOINT_RADIUS_PX = 10;
export const STICK_RADIUS_PX = 7;
/** A joint wins over a stick this many pixels closer to the click, so the dots are easy to hit. */
const JOINT_PREFERENCE_PX = 4;

const point = new Vector3();
/** Screen position of each joint, reused between clicks; grown only when a rig has more bones. */
let screen = new Float64Array(0);
let shown = new Uint8Array(0);

/** Where a joint falls on screen, in pixels, or undefined when it is behind the camera. */
function project(
  camera: Camera,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  into: Float64Array,
  at: number,
): boolean {
  point.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
  // Looking down -z in view space; anything at or past the camera's plane has no place on screen.
  if (point.z >= 0) return false;
  point.applyMatrix4(camera.projectionMatrix);
  into[at] = (point.x * 0.5 + 0.5) * width;
  into[at + 1] = (-point.y * 0.5 + 0.5) * height;
  return true;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const sx = bx - ax;
  const sy = by - ay;
  const lengthSquared = sx * sx + sy * sy;
  const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * sx + (py - ay) * sy) / lengthSquared));
  return Math.hypot(px - (ax + sx * along), py - (ay + sy * along));
}

/**
 * The bone under a point of the view: the bone whose joint is nearest the point, or whose stick (the
 * line from its joint to a child's) is, as a bone's stick runs from its own joint down to its child.
 * Returns its index, or undefined when nothing is within reach. `joints` is {@link BoneWorld.positions}
 * (x, y, z of each bone); `ndc` is the point in normalized device coordinates; `width` and `height` are
 * the size of the view in pixels. The camera's matrices must be current, as they are after a frame.
 */
export function pickBone(
  rig: Rig,
  joints: Float64Array,
  camera: Camera,
  ndc: Vector2,
  width: number,
  height: number,
): number | undefined {
  const count = rig.bones.length;
  if (screen.length < count * 2) {
    screen = new Float64Array(count * 2);
    shown = new Uint8Array(count);
  }
  for (let bone = 0; bone < count; bone += 1) {
    shown[bone] = project(
      camera,
      joints[bone * 3] ?? 0,
      joints[bone * 3 + 1] ?? 0,
      joints[bone * 3 + 2] ?? 0,
      width,
      height,
      screen,
      bone * 2,
    )
      ? 1
      : 0;
  }
  const px = (ndc.x * 0.5 + 0.5) * width;
  const py = (-ndc.y * 0.5 + 0.5) * height;

  let best: number | undefined;
  let bestScore = Infinity;
  for (let bone = 0; bone < count; bone += 1) {
    if (!shown[bone]) continue;
    const jointDistance = Math.hypot(px - (screen[bone * 2] ?? 0), py - (screen[bone * 2 + 1] ?? 0));
    if (jointDistance <= JOINT_RADIUS_PX && jointDistance - JOINT_PREFERENCE_PX < bestScore) {
      best = bone;
      bestScore = jointDistance - JOINT_PREFERENCE_PX;
    }
    const parent = rig.parents[bone] ?? -1;
    if (parent < 0 || !shown[parent]) continue;
    const stickDistance = distanceToSegment(
      px,
      py,
      screen[parent * 2] ?? 0,
      screen[parent * 2 + 1] ?? 0,
      screen[bone * 2] ?? 0,
      screen[bone * 2 + 1] ?? 0,
    );
    if (stickDistance <= STICK_RADIUS_PX && stickDistance < bestScore) {
      best = parent;
      bestScore = stickDistance;
    }
  }
  return best;
}
