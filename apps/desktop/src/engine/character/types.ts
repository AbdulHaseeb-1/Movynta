import type { Quaternion, Vector3 } from "three";

/**
 * Stable bone names. Coordinate convention (right-handed, Y up, character faces +Z, character's left is +X):
 * - Rest pose: every local rotation is identity. Arms and legs hang along -Y, the spine points +Y, feet point +Z.
 * - Rotating a -Y limb about +X by +theta swings it BACKWARD (hip extension, knee flexion, shoulder extension).
 * - Rotating a +Y spine bone about +X by +theta bends it FORWARD (flexion).
 * - Rotating a -Y limb about +Z by +theta swings it toward +X (abduction on the left side, adduction on the right).
 * - Rotating the foot about +X by +theta points the toes DOWN (plantar flexion).
 */
export const BONE_NAMES = [
  "root",
  "pelvis",
  "spine_lower",
  "spine_mid",
  "spine_upper",
  "neck",
  "head",
  "clavicle_l",
  "upper_arm_l",
  "forearm_l",
  "hand_l",
  "clavicle_r",
  "upper_arm_r",
  "forearm_r",
  "hand_r",
  "thigh_l",
  "shin_l",
  "foot_l",
  "toe_l",
  "thigh_r",
  "shin_r",
  "foot_r",
  "toe_r",
] as const;

export type BoneName = (typeof BONE_NAMES)[number];
export type Side = "l" | "r";
export const SIDES: readonly Side[] = ["l", "r"];

/** A value for every bone, keyed by name. */
export type BoneMap<T> = Record<BoneName, T>;

function isCompleteBoneMap<T>(map: Partial<Record<BoneName, T>>): map is BoneMap<T> {
  return BONE_NAMES.every((name) => name in map);
}

export function createBoneMap<T>(factory: (name: BoneName) => T): BoneMap<T> {
  const map: Partial<Record<BoneName, T>> = {};
  for (const name of BONE_NAMES) map[name] = factory(name);
  if (!isCompleteBoneMap(map)) throw new Error("Bone map is incomplete");
  return map;
}

export interface LegBones {
  readonly thigh: BoneName;
  readonly shin: BoneName;
  readonly foot: BoneName;
  readonly toe: BoneName;
}

export interface ArmBones {
  readonly clavicle: BoneName;
  readonly upperArm: BoneName;
  readonly forearm: BoneName;
  readonly hand: BoneName;
}

export function legBones(side: Side): LegBones {
  return side === "l"
    ? { thigh: "thigh_l", shin: "shin_l", foot: "foot_l", toe: "toe_l" }
    : { thigh: "thigh_r", shin: "shin_r", foot: "foot_r", toe: "toe_r" };
}

export function armBones(side: Side): ArmBones {
  return side === "l"
    ? { clavicle: "clavicle_l", upperArm: "upper_arm_l", forearm: "forearm_l", hand: "hand_l" }
    : { clavicle: "clavicle_r", upperArm: "upper_arm_r", forearm: "forearm_r", hand: "hand_r" };
}

/** +1 for the left side (+X), -1 for the right side (-X). */
export function sideSign(side: Side): 1 | -1 {
  return side === "l" ? 1 : -1;
}

export interface BoneDefinition {
  readonly name: BoneName;
  readonly parent: BoneName | null;
  /** Rest translation from the parent joint, in the parent's frame (meters). */
  readonly offset: Vector3;
}

/** Linear sizes in meters. A different body is a different proportions object; nothing else is hardcoded. */
export interface BodyProportions {
  readonly hipHalfWidth: number;
  readonly thigh: number;
  readonly shin: number;
  /** Height of the ankle joint above the sole. */
  readonly ankleHeight: number;
  readonly heelBack: number;
  readonly ballForward: number;
  readonly toeLength: number;
  readonly pelvisToLowerSpine: number;
  readonly lowerSpine: number;
  readonly midSpine: number;
  readonly upperSpine: number;
  readonly neck: number;
  readonly headRadius: number;
  readonly shoulderHalfWidth: number;
  readonly clavicleHeight: number;
  readonly upperArm: number;
  readonly forearm: number;
  readonly hand: number;
}

export interface CharacterConfig {
  readonly proportions: BodyProportions;
  /** Limb radius used for rendering and the collision capsule. */
  readonly limbRadius: number;
}

/** Contact geometry of one foot in the foot bone's local frame (the origin is the ankle joint). */
export interface FootGeometry {
  readonly heel: Vector3;
  readonly ball: Vector3;
  readonly toeTip: Vector3;
}

/** Local joint rotation and pelvis translation for the whole body. Plain data, so poses can be stored and blended. */
export interface PoseData {
  readonly rotations: BoneMap<Quaternion>;
  readonly pelvisPosition: Vector3;
}
