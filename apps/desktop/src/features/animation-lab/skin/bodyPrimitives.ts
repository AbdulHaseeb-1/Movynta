import { Quaternion, Vector3 } from "three";
import { CharacterRig } from "@/engine/character/CharacterRig";
import { Pose } from "@/engine/character/Pose";
import { armBones, BONE_NAMES, createBoneMap, legBones, sideSign, type BoneMap, type BoneName, type CharacterConfig } from "@/engine/character/types";

const Z_AXIS = new Vector3(0, 0, 1);
type Side = "l" | "r";
const SIDES: readonly Side[] = ["l", "r"];

/** Thickness of every stroke of the figure (meters). A drawn stick figure uses one stroke width throughout. */
export const STROKE_RADIUS = 0.045;
/** How much of the head radius the head center sits above the head joint (below 1 buries the neck in the circle). */
export const HEAD_SEAT = 0.85;

/**
 * One stroke of the figure: a round tube between two points of the bind pose. The tube moves with `owner`; near its
 * ends it blends toward the bone on the other side of that joint, which is what rounds the elbows, knees and so on.
 */
export interface BodyPrimitive {
  readonly name: string;
  /** Strokes of one chain (spine, one arm, one leg) join with exact unions; chains are filleted into each other. */
  readonly chain: string;
  readonly a: Vector3;
  readonly b: Vector3;
  readonly radius: number;
  readonly owner: BoneName;
  /** Bone blended in around `a`, or null when the stroke ends there. */
  readonly startNeighbor: BoneName | null;
  /** Bone blended in around `b`, or null when the stroke ends there. */
  readonly endNeighbor: BoneName | null;
}

/** World transform of every bone in the bind pose (all joint rotations at rest). */
export interface BindPose {
  readonly positions: BoneMap<Vector3>;
  readonly rotations: BoneMap<Quaternion>;
}

/**
 * The mesh is built in a relaxed A-pose, not with the limbs pressed against the body: arms and legs a little apart, so
 * the strokes do not fuse with the torso or each other and every limb gets its own clean weights.
 */
export const BIND_ARM_SPREAD = (22 * Math.PI) / 180;
export const BIND_LEG_SPREAD = (7 * Math.PI) / 180;

export function createBindPose(config: CharacterConfig): BindPose {
  const rig = new CharacterRig(config);
  const pose = new Pose(rig.restPelvisPosition);
  const spread = new Quaternion();
  for (const side of SIDES) {
    const sign = sideSign(side);
    pose.rotations[armBones(side).upperArm].copy(spread.setFromAxisAngle(Z_AXIS, sign * BIND_ARM_SPREAD));
    pose.rotations[legBones(side).thigh].copy(spread.setFromAxisAngle(Z_AXIS, sign * BIND_LEG_SPREAD));
  }
  rig.updateWorld(pose);
  return {
    positions: createBoneMap((name) => rig.worldPosition[name].clone()),
    rotations: createBoneMap((name) => rig.worldRotation[name].clone()),
  };
}


/** The stickman as a set of strokes in the bind pose. Same strokes and radius as the earlier capsule figure. */
export function buildBodyPrimitives(config: CharacterConfig, bind: BindPose = createBindPose(config)): BodyPrimitive[] {
  const at = (bone: BoneName): Vector3 => bind.positions[bone].clone();
  /** A point offset from a bone, in that bone's own (bind-pose) frame: a fingertip, a toe tip, the head center. */
  const beyond = (bone: BoneName, offset: Vector3): Vector3 => offset.clone().applyQuaternion(bind.rotations[bone]).add(bind.positions[bone]);
  const { headRadius, hand, toeLength } = config.proportions;
  const stroke = (
    chain: string,
    name: string,
    a: Vector3,
    b: Vector3,
    owner: BoneName,
    startNeighbor: BoneName | null,
    endNeighbor: BoneName | null,
    radius = STROKE_RADIUS,
  ): BodyPrimitive => ({ name, chain, a, b, radius, owner, startNeighbor, endNeighbor });

  const primitives: BodyPrimitive[] = [
    stroke("spine", "pelvis-spine_lower", at("pelvis"), at("spine_lower"), "pelvis", null, "spine_lower"),
    stroke("spine", "spine_lower-spine_mid", at("spine_lower"), at("spine_mid"), "spine_lower", "pelvis", "spine_mid"),
    stroke("spine", "spine_mid-spine_upper", at("spine_mid"), at("spine_upper"), "spine_mid", "spine_lower", "spine_upper"),
    stroke("spine", "spine_upper-neck", at("spine_upper"), at("neck"), "spine_upper", "spine_mid", "neck"),
    stroke("spine", "neck-head", at("neck"), at("head"), "neck", "spine_upper", "head"),
    // The head is a sphere seated on the neck, exactly as in the drawing.
    stroke("head", "head", beyond("head", new Vector3(0, headRadius * HEAD_SEAT, 0)), beyond("head", new Vector3(0, headRadius * HEAD_SEAT, 0)), "head", null, null, headRadius),
  ];

  for (const side of SIDES) {
    const bone = (base: string): BoneName => {
      const name = `${base}_${side}`;
      return BONE_BY_NAME[name] ?? "root";
    };
    const clavicle = bone("clavicle");
    const upperArm = bone("upper_arm");
    const forearm = bone("forearm");
    const handBone = bone("hand");
    const thigh = bone("thigh");
    const shin = bone("shin");
    const foot = bone("foot");
    const toe = bone("toe");
    primitives.push(
      stroke(`arm_${side}`, `shoulder-bar_${side}`, at("neck"), at(clavicle), "spine_upper", null, clavicle),
      stroke(`arm_${side}`, `clavicle-upper_arm_${side}`, at(clavicle), at(upperArm), clavicle, "spine_upper", upperArm),
      stroke(`arm_${side}`, `upper_arm-forearm_${side}`, at(upperArm), at(forearm), upperArm, clavicle, forearm),
      stroke(`arm_${side}`, `forearm-hand_${side}`, at(forearm), at(handBone), forearm, upperArm, handBone),
      stroke(`arm_${side}`, `hand-fingertip_${side}`, at(handBone), beyond(handBone, new Vector3(0, -hand, 0)), handBone, forearm, null),
      stroke(`leg_${side}`, `hip-bar_${side}`, at("pelvis"), at(thigh), "pelvis", null, thigh),
      stroke(`leg_${side}`, `thigh-shin_${side}`, at(thigh), at(shin), thigh, "pelvis", shin),
      stroke(`leg_${side}`, `shin-foot_${side}`, at(shin), at(foot), shin, thigh, foot),
      stroke(`leg_${side}`, `foot-toe_${side}`, at(foot), at(toe), foot, shin, toe),
      stroke(`leg_${side}`, `toe-tip_${side}`, at(toe), beyond(toe, new Vector3(0, 0, toeLength)), toe, foot, null),
    );
  }
  return primitives;
}


/** Lookup that turns a computed bone name into a checked `BoneName` without a type assertion. */
const BONE_BY_NAME: Readonly<Record<string, BoneName | undefined>> = Object.fromEntries(BONE_NAMES.map((name) => [name, name]));
