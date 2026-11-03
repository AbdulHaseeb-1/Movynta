import { MathUtils, Vector3, type Box3 } from "three";
import type { ViewSpec } from "@movynta/editor-protocol";

export type Projection = "perspective" | "orthographic";

/** Where a camera stands and what it looks at, in world space. */
export interface CameraPose {
  projection: Projection;
  position: Vector3;
  target: Vector3;
  up: Vector3;
  /** Vertical field of view in degrees. Used by perspective cameras. */
  fov: number;
  /** The height the view covers, in world units. Used by orthographic cameras. */
  orthographicHeight: number;
}

/** The camera the user looks through now, for the "current" preset. */
export interface CurrentCamera {
  position: Vector3;
  target: Vector3;
  fov: number;
}

/** What a view is framed around: a sphere that holds the focused objects, or the whole scene. */
export interface Subject {
  center: Vector3;
  radius: number;
}

type AxisPreset = "front" | "back" | "left" | "right" | "top" | "bottom";

const DEFAULT_FOV = 40;
/** Empty space left around the subject, as a factor of its size. */
const MARGIN = 1.15;
const MIN_RADIUS = 0.25;
/** Used when the scene has nothing to frame. */
const EMPTY_SCENE_RADIUS = 2;
/** The elevation at which the three axes look equally short. */
const ISOMETRIC_ELEVATION = 35.264;
const ISOMETRIC_AZIMUTH = 45;

/** Directions from the subject to the camera. A front view stands on +Z and looks toward -Z. */
const AXIS_DIRECTIONS: Readonly<Record<AxisPreset, readonly [number, number, number]>> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
};

function isAxisPreset(preset: string): preset is AxisPreset {
  return preset in AXIS_DIRECTIONS;
}

/** The sphere that holds `box`, or a default one when there is nothing to frame. */
export function subjectOf(box: Box3 | null): Subject {
  if (!box || box.isEmpty()) return { center: new Vector3(), radius: EMPTY_SCENE_RADIUS };
  const size = box.getSize(new Vector3());
  return { center: box.getCenter(new Vector3()), radius: Math.max(size.length() / 2, MIN_RADIUS) };
}

/** The direction from the subject to a camera that circles it, 0 degrees being the front. */
export function orbitDirection(azimuthDegrees: number, elevationDegrees: number): Vector3 {
  const azimuth = MathUtils.degToRad(azimuthDegrees);
  const elevation = MathUtils.degToRad(elevationDegrees);
  return new Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
}

/**
 * Straight up until the view is actually vertical. A steep orbit keeps the picture's up in the same
 * direction instead of snapping onto the floor a degree early. An exact top or bottom view still uses
 * the far side of the floor, and a view that is only a hair off vertical keeps that side's heading.
 */
function upFor(towardCamera: Vector3): Vector3 {
  const unit = towardCamera.clone().normalize();
  const worldUp = new Vector3(0, 1, 0);
  if (Math.abs(unit.dot(worldUp)) < 1 - 1e-6) return worldUp;
  const horizontal = new Vector3(unit.x, 0, unit.z);
  if (horizontal.lengthSq() > 1e-12) {
    horizontal.normalize();
    return unit.y > 0 ? horizontal.multiplyScalar(-1) : horizontal;
  }
  return new Vector3(0, 0, unit.y > 0 ? -1 : 1);
}

/** Near plane for a capture. A close custom camera must not clip the subject it is aimed at. */
export function captureNear(distance: number): number {
  const safe = Math.max(distance, 1e-4);
  return Math.min(0.02, safe * 0.05);
}

/** Where the capture grid and axes sit so they appear with the framed subject, not at the world origin. */
export function guidePlacement(subject: Subject): { origin: Vector3; floor: Vector3; size: number; axisLength: number } {
  return {
    origin: subject.center.clone(),
    floor: new Vector3(subject.center.x, subject.center.y - subject.radius, subject.center.z),
    size: Math.max(subject.radius * 4, 2),
    axisLength: Math.max(subject.radius, 0.5),
  };
}

/** How far a perspective camera must stand to see a sphere of `radius` whole. */
function fitDistance(radius: number, fovDegrees: number, aspect: number): number {
  const vertical = MathUtils.degToRad(fovDegrees) / 2;
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  return (radius * MARGIN) / Math.sin(Math.min(vertical, horizontal));
}

function heightAtDistance(distance: number, fovDegrees: number): number {
  return 2 * distance * Math.tan(MathUtils.degToRad(fovDegrees) / 2);
}

/**
 * Turns a view the assistant asked for into a camera. A custom `camera` is used as given. Otherwise the camera
 * comes from `orbit`, else `preset` (default isometric), standing back far enough to show `subject` whole.
 * Axis presets are orthographic unless `projection` says otherwise, so proportions can be judged from them.
 */
export function frameView(spec: ViewSpec, subject: Subject, aspect: number, current: CurrentCamera): CameraPose {
  const projection = spec.projection;

  if (spec.camera) {
    const position = new Vector3().fromArray(spec.camera.position);
    const target = new Vector3().fromArray(spec.camera.target);
    const offset = position.clone().sub(target);
    if (offset.length() < 1e-6) throw new Error("camera.position and camera.target must be different points");
    const fov = spec.camera.fov ?? DEFAULT_FOV;
    return {
      projection: projection ?? "perspective",
      position,
      target,
      up: upFor(offset),
      fov,
      orthographicHeight: heightAtDistance(offset.length(), fov),
    };
  }

  const zoom = spec.zoom ?? 1;

  if (!spec.orbit && spec.preset === "current") {
    const target = current.target.clone();
    const offset = current.position.clone().sub(target);
    const distance = Math.max(offset.length(), 1e-3) / zoom;
    const position = target.clone().add(offset.normalize().multiplyScalar(distance));
    return {
      projection: projection ?? "perspective",
      position,
      target,
      up: upFor(offset),
      fov: current.fov,
      orthographicHeight: heightAtDistance(distance, current.fov),
    };
  }

  const preset = spec.preset ?? "isometric";
  const axisAligned = !spec.orbit && isAxisPreset(preset);
  const direction = spec.orbit
    ? orbitDirection(spec.orbit.azimuthDegrees, spec.orbit.elevationDegrees)
    : isAxisPreset(preset)
      ? new Vector3().fromArray(AXIS_DIRECTIONS[preset])
      : orbitDirection(ISOMETRIC_AZIMUTH, ISOMETRIC_ELEVATION);
  const chosen = projection ?? (axisAligned ? "orthographic" : "perspective");

  const target = subject.center.clone();
  if (chosen === "orthographic") {
    const halfHeight = ((subject.radius * MARGIN) / zoom) * (aspect >= 1 ? 1 : 1 / aspect);
    const distance = Math.max(subject.radius * 3, 1);
    return {
      projection: chosen,
      position: target.clone().add(direction.clone().multiplyScalar(distance)),
      target,
      up: upFor(direction),
      fov: DEFAULT_FOV,
      orthographicHeight: halfHeight * 2,
    };
  }
  const distance = fitDistance(subject.radius, DEFAULT_FOV, aspect) / zoom;
  return {
    projection: chosen,
    position: target.clone().add(direction.clone().multiplyScalar(distance)),
    target,
    up: upFor(direction),
    fov: DEFAULT_FOV,
    orthographicHeight: heightAtDistance(distance, DEFAULT_FOV),
  };
}
