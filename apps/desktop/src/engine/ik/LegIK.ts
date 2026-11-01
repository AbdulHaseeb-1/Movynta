import { Quaternion, Vector3 } from "three";
import type { CharacterRig } from "../character/CharacterRig";
import type { Pose } from "../character/Pose";
import { legBones, sideSign, type Side } from "../character/types";
import { createTwoBoneSolution, solveTwoBone, type TwoBoneSolution } from "./TwoBoneIK";

/** What one leg should do this frame, in world space. */
export interface LegTarget {
  /** Desired ankle joint position. */
  readonly ankle: Vector3;
  /** Desired world orientation of the foot bone. */
  readonly footRotation: Quaternion;
  /** Toe bone flexion relative to the foot (radians, negative lifts the toes). */
  toeFlex: number;
  /** Direction the knee should point (world), normally the foot's forward axis. */
  readonly kneeDirection: Vector3;
  /**
   * Weight (0..1) of `relaxedLocal`, a foot rotation relative to the shin. A swinging foot follows the shank
   * with a near-neutral ankle instead of being held parallel to the ground, then takes the ground attitude late.
   */
  relaxed: number;
  readonly relaxedLocal: Quaternion;
  /** Derive the toe flexion from the final foot pitch instead of using `toeFlex`. */
  autoToe: boolean;
}

export function createLegTarget(): LegTarget {
  return {
    ankle: new Vector3(),
    footRotation: new Quaternion(),
    toeFlex: 0,
    kneeDirection: new Vector3(0, 0, 1),
    relaxed: 0,
    relaxedLocal: new Quaternion(),
    autoToe: false,
  };
}

export interface LegSolveReport {
  reachRatio: number;
  kneeAngle: number;
  /** Distance between the requested and the reachable ankle position. */
  ankleError: number;
}

const solution: TwoBoneSolution = createTwoBoneSolution();
const parentInverse = new Quaternion();
const footWorld = new Quaternion();
const forward = new Vector3();
/** Largest automatic toe bend (radians). */
const MAX_AUTO_TOE = 1.0;

/**
 * Solves one leg and writes the thigh, shin, foot and toe local rotations into `pose`.
 * Call after the pelvis, spine and arms are posed and `rig.updateWorld(pose)` has run, because
 * the hip position depends on the pelvis.
 */
export function solveLeg(rig: CharacterRig, pose: Pose, side: Side, target: LegTarget, report?: LegSolveReport): void {
  const bones = legBones(side);
  const hip = rig.worldPosition[bones.thigh];
  solveTwoBone(hip, target.ankle, rig.thighLength, rig.shinLength, target.kneeDirection, solution);

  // Thigh: world -> local using the pelvis orientation.
  parentInverse.copy(rig.worldRotation.pelvis).invert();
  pose.rotations[bones.thigh].copy(parentInverse).multiply(solution.thighRotation);
  // Shin: relative to the new thigh.
  parentInverse.copy(solution.thighRotation).invert();
  pose.rotations[bones.shin].copy(parentInverse).multiply(solution.shinRotation);
  // Foot: relative to the shin.
  parentInverse.copy(solution.shinRotation).invert();
  pose.rotations[bones.foot].copy(parentInverse).multiply(target.footRotation);
  if (target.relaxed > 0) pose.rotations[bones.foot].slerp(target.relaxedLocal, Math.min(target.relaxed, 1));
  // Toe: for a free (swinging or airborne) foot, bend the toes back by the foot's pitch so the tip stays level
  // and never digs in. A planted foot uses the exact value from the gait.
  if (target.autoToe) {
    footWorld.copy(solution.shinRotation).multiply(pose.rotations[bones.foot]);
    forward.set(0, 0, 1).applyQuaternion(footWorld);
    target.toeFlex = -Math.min(Math.max(Math.asin(Math.min(Math.max(-forward.y, -1), 1)), 0), MAX_AUTO_TOE);
  }
  const half = target.toeFlex / 2;
  pose.rotations[bones.toe].set(Math.sin(half), 0, 0, Math.cos(half));

  if (report) {
    report.reachRatio = solution.reachRatio;
    report.kneeAngle = solution.kneeAngle;
    report.ankleError = solution.ankle.distanceTo(target.ankle);
  }
}

export function solveLegs(
  rig: CharacterRig,
  pose: Pose,
  targets: Readonly<Record<Side, LegTarget>>,
  reports?: Readonly<Record<Side, LegSolveReport>>,
): void {
  rig.updateWorld(pose);
  for (const side of ["l", "r"] as const) solveLeg(rig, pose, side, targets[side], reports?.[side]);
  rig.updateWorld(pose);
}

/** Lateral hip offset sign helper re-exported for callers that build default targets. */
export const hipSide = sideSign;
