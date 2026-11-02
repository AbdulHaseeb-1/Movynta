import { Quaternion, Vector3, type Bone } from "three";
import type { Rig } from "./rig";

/** How many passes down the chain one step of a drag makes at most, and how close counts as reaching the target. */
export const IK_ITERATIONS = 12;
export const IK_TOLERANCE = 1e-4;

const joint = new Vector3();
const reached = new Vector3();
const toEffector = new Vector3();
const toTarget = new Vector3();
const turn = new Quaternion();
const world = new Quaternion();
const parentWorld = new Quaternion();

/**
 * The bones that bend when `bone` is dragged: the ones above it, nearest first, at most `length` of
 * them. Empty for a bone at the top of its hierarchy or a chain length of zero, which is dragged alone.
 */
export function chainAbove(rig: Rig, bone: number, length: number): Bone[] {
  const chain: Bone[] = [];
  for (let above = rig.parents[bone] ?? -1; above >= 0 && chain.length < length; above = rig.parents[above] ?? -1) {
    const parent = rig.bones[above];
    if (parent) chain.push(parent);
  }
  return chain;
}

/**
 * Bends a chain of bones so that the joint of `effector` comes as near as it can to `target`, a point
 * in the world. Each bone of `chain` (the bones above the effector, nearest first) is turned about its
 * own joint to swing the effector toward the target, one after the other, and the passes repeat until
 * it arrives or `iterations` run out. Bones are only turned, never stretched, so every joint keeps its
 * distance from the next, and the joint at the far end of the chain stays where it is.
 *
 * A target out of reach leaves the chain stretched straight toward it. Returns how far the effector
 * is from the target afterwards.
 */
export function solveChain(
  effector: Bone,
  chain: readonly Bone[],
  target: Vector3,
  iterations: number = IK_ITERATIONS,
): number {
  effector.getWorldPosition(reached);
  for (let pass = 0; pass < iterations && reached.distanceTo(target) > IK_TOLERANCE; pass += 1) {
    for (const bone of chain) {
      bone.getWorldPosition(joint);
      toEffector.copy(reached).sub(joint);
      toTarget.copy(target).sub(joint);
      if (toEffector.lengthSq() < 1e-12 || toTarget.lengthSq() < 1e-12) continue;
      turn.setFromUnitVectors(toEffector.normalize(), toTarget.normalize());
      // The turn is in the world; the bone stores its rotation relative to its parent.
      bone.getWorldQuaternion(world);
      if (bone.parent) bone.parent.getWorldQuaternion(parentWorld);
      else parentWorld.identity();
      bone.quaternion.copy(parentWorld.invert().multiply(turn).multiply(world));
      bone.updateMatrixWorld(true);
      effector.getWorldPosition(reached);
    }
  }
  return reached.distanceTo(target);
}
