import { Vector3, type Quaternion } from "three";
import { DEG, eulerFromQuat, quatFromEuler } from "../core/math";
import { BONE_NAMES, createBoneMap, type BoneMap, type BoneName } from "./types";

/** Allowed local rotation range in degrees per XYZ Euler component, measured from the rest pose. */
export interface AxisRange {
  readonly min: number;
  readonly max: number;
}

export interface JointLimit {
  readonly x: AxisRange;
  readonly y: AxisRange;
  readonly z: AxisRange;
}

const r = (min: number, max: number): AxisRange => ({ min, max });
const lim = (x: AxisRange, y: AxisRange, z: AxisRange): JointLimit => ({ x, y, z });

/** Mirrors a left-side limit for the right side: twist (Y) and side-bend/abduction (Z) change sign. */
function mirror(limit: JointLimit): JointLimit {
  return lim(limit.x, r(-limit.y.max, -limit.y.min), r(-limit.z.max, -limit.z.min));
}

const LEFT_LIMITS = {
  clavicle: lim(r(-20, 20), r(-25, 25), r(-15, 30)),
  upperArm: lim(r(-185, 85), r(-100, 100), r(-45, 175)),
  forearm: lim(r(-152, 5), r(-95, 95), r(-6, 6)),
  hand: lim(r(-75, 75), r(-35, 35), r(-35, 25)),
  thigh: lim(r(-125, 56), r(-42, 42), r(-32, 48)),
  shin: lim(r(-1, 152), r(-8, 8), r(-6, 6)),
  foot: lim(r(-58, 62), r(-28, 28), r(-22, 22)),
  toe: lim(r(-65, 28), r(-6, 6), r(-6, 6)),
} as const;

function limitFor(name: BoneName): JointLimit {
  switch (name) {
    case "root":
      return lim(r(-180, 180), r(-180, 180), r(-180, 180));
    case "pelvis":
      return lim(r(-30, 30), r(-45, 45), r(-30, 30));
    case "spine_lower":
      return lim(r(-25, 45), r(-25, 25), r(-25, 25));
    case "spine_mid":
      return lim(r(-20, 35), r(-30, 30), r(-25, 25));
    case "spine_upper":
      return lim(r(-15, 30), r(-35, 35), r(-20, 20));
    case "neck":
      return lim(r(-35, 50), r(-60, 60), r(-35, 35));
    case "head":
      return lim(r(-35, 40), r(-45, 45), r(-30, 30));
    case "clavicle_l":
      return LEFT_LIMITS.clavicle;
    case "clavicle_r":
      return mirror(LEFT_LIMITS.clavicle);
    case "upper_arm_l":
      return LEFT_LIMITS.upperArm;
    case "upper_arm_r":
      return mirror(LEFT_LIMITS.upperArm);
    case "forearm_l":
      return LEFT_LIMITS.forearm;
    case "forearm_r":
      return mirror(LEFT_LIMITS.forearm);
    case "hand_l":
      return LEFT_LIMITS.hand;
    case "hand_r":
      return mirror(LEFT_LIMITS.hand);
    case "thigh_l":
      return LEFT_LIMITS.thigh;
    case "thigh_r":
      return mirror(LEFT_LIMITS.thigh);
    case "shin_l":
      return LEFT_LIMITS.shin;
    case "shin_r":
      return mirror(LEFT_LIMITS.shin);
    case "foot_l":
      return LEFT_LIMITS.foot;
    case "foot_r":
      return mirror(LEFT_LIMITS.foot);
    case "toe_l":
      return LEFT_LIMITS.toe;
    case "toe_r":
      return mirror(LEFT_LIMITS.toe);
    default:
      return assertNever(name);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled bone "${String(value)}"`);
}

export const JOINT_LIMITS: BoneMap<JointLimit> = createBoneMap(limitFor);

const scratchEuler = new Vector3();

function clampAxis(value: number, range: AxisRange): number {
  const min = range.min * DEG;
  const max = range.max * DEG;
  return value < min ? min : value > max ? max : value;
}

/** Tolerance (radians) before a rotation counts as outside its limit, to absorb float noise. */
const LIMIT_EPSILON = 1e-4;

/** True when the local rotation lies inside the joint's anatomical range. */
export function isWithinLimits(name: BoneName, q: Quaternion): boolean {
  const limit = JOINT_LIMITS[name];
  eulerFromQuat(q, scratchEuler);
  const { x, y, z } = scratchEuler;
  return (
    x >= limit.x.min * DEG - LIMIT_EPSILON &&
    x <= limit.x.max * DEG + LIMIT_EPSILON &&
    y >= limit.y.min * DEG - LIMIT_EPSILON &&
    y <= limit.y.max * DEG + LIMIT_EPSILON &&
    z >= limit.z.min * DEG - LIMIT_EPSILON &&
    z <= limit.z.max * DEG + LIMIT_EPSILON
  );
}

/** Euler angles (degrees) a rotation had before it was clamped. Filled on request for debugging and tests. */
export interface ClampDetail {
  x: number;
  y: number;
  z: number;
}

/** Clamps a local rotation into its range in place. Returns true if it had to change. */
export function clampToLimits(name: BoneName, q: Quaternion, detail?: ClampDetail): boolean {
  if (isWithinLimits(name, q)) return false;
  const limit = JOINT_LIMITS[name];
  eulerFromQuat(q, scratchEuler);
  if (detail) {
    detail.x = scratchEuler.x / DEG;
    detail.y = scratchEuler.y / DEG;
    detail.z = scratchEuler.z / DEG;
  }
  quatFromEuler(q, clampAxis(scratchEuler.x, limit.x), clampAxis(scratchEuler.y, limit.y), clampAxis(scratchEuler.z, limit.z));
  return true;
}

/** Bones that can be clamped (everything except the root, which carries world heading). */
export const LIMITED_BONES: readonly BoneName[] = BONE_NAMES.filter((name) => name !== "root");
