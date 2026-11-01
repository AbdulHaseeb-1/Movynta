import { Vector3 } from "three";
import {
  BONE_NAMES,
  createBoneMap,
  type BodyProportions,
  type BoneDefinition,
  type BoneMap,
  type BoneName,
  type CharacterConfig,
  type FootGeometry,
  type Side,
} from "./types";

/** A 1.78 m stylized adult. */
export const DEFAULT_PROPORTIONS: BodyProportions = {
  hipHalfWidth: 0.09,
  thigh: 0.44,
  shin: 0.43,
  ankleHeight: 0.08,
  heelBack: 0.07,
  ballForward: 0.15,
  toeLength: 0.07,
  pelvisToLowerSpine: 0.08,
  lowerSpine: 0.12,
  midSpine: 0.14,
  upperSpine: 0.18,
  neck: 0.08,
  headRadius: 0.11,
  shoulderHalfWidth: 0.19,
  clavicleHeight: 0.15,
  upperArm: 0.28,
  forearm: 0.26,
  hand: 0.09,
};

export const DEFAULT_CHARACTER_CONFIG: CharacterConfig = {
  proportions: DEFAULT_PROPORTIONS,
  limbRadius: 0.035,
};

export function scaleProportions(base: BodyProportions, k: number): BodyProportions {
  return {
    hipHalfWidth: base.hipHalfWidth * k,
    thigh: base.thigh * k,
    shin: base.shin * k,
    ankleHeight: base.ankleHeight * k,
    heelBack: base.heelBack * k,
    ballForward: base.ballForward * k,
    toeLength: base.toeLength * k,
    pelvisToLowerSpine: base.pelvisToLowerSpine * k,
    lowerSpine: base.lowerSpine * k,
    midSpine: base.midSpine * k,
    upperSpine: base.upperSpine * k,
    neck: base.neck * k,
    headRadius: base.headRadius * k,
    shoulderHalfWidth: base.shoulderHalfWidth * k,
    clavicleHeight: base.clavicleHeight * k,
    upperArm: base.upperArm * k,
    forearm: base.forearm * k,
    hand: base.hand * k,
  };
}

/** Height of the hip joints above the ground in the straight-leg rest pose. */
export function restHipHeight(p: BodyProportions): number {
  return p.thigh + p.shin + p.ankleHeight;
}

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

function side(name: string, s: Side): BoneName {
  const candidate = `${name}_${s}`;
  const found = BONE_NAMES.find((bone) => bone === candidate);
  if (!found) throw new Error(`Unknown bone "${candidate}"`);
  return found;
}

/** Builds the bone hierarchy (parents always precede children) from the proportions. */
export function buildSkeleton(config: CharacterConfig): BoneMap<BoneDefinition> {
  const p = config.proportions;
  const defs: Partial<Record<BoneName, BoneDefinition>> = {};
  const add = (name: BoneName, parent: BoneName | null, offset: Vector3): void => {
    defs[name] = { name, parent, offset };
  };

  add("root", null, v(0, 0, 0));
  add("pelvis", "root", v(0, restHipHeight(p), 0));
  add("spine_lower", "pelvis", v(0, p.pelvisToLowerSpine, 0));
  add("spine_mid", "spine_lower", v(0, p.lowerSpine, 0));
  add("spine_upper", "spine_mid", v(0, p.midSpine, 0));
  add("neck", "spine_upper", v(0, p.upperSpine, 0));
  add("head", "neck", v(0, p.neck, 0));

  for (const s of ["l", "r"] as const) {
    const sign = s === "l" ? 1 : -1;
    add(side("clavicle", s), "spine_upper", v(sign * 0.03, p.upperSpine - 0.03, 0));
    add(side("upper_arm", s), side("clavicle", s), v(sign * (p.shoulderHalfWidth - 0.03), 0, 0));
    add(side("forearm", s), side("upper_arm", s), v(0, -p.upperArm, 0));
    add(side("hand", s), side("forearm", s), v(0, -p.forearm, 0));
    add(side("thigh", s), "pelvis", v(sign * p.hipHalfWidth, 0, 0));
    add(side("shin", s), side("thigh", s), v(0, -p.thigh, 0));
    add(side("foot", s), side("shin", s), v(0, -p.shin, 0));
    add(side("toe", s), side("foot", s), v(0, -p.ankleHeight, p.ballForward));
  }

  return createBoneMap((name) => {
    const def = defs[name];
    if (!def) throw new Error(`Skeleton is missing bone "${name}"`);
    return def;
  });
}

export function footGeometry(p: BodyProportions): FootGeometry {
  return {
    heel: v(0, -p.ankleHeight, -p.heelBack),
    ball: v(0, -p.ankleHeight, p.ballForward),
    toeTip: v(0, -p.ankleHeight, p.ballForward + p.toeLength),
  };
}

/** Bones whose parent chain is validated by tests, in a stable order. */
export const EXPECTED_BONE_COUNT = BONE_NAMES.length;

/** Approximate mass fractions per bone, used for the center-of-mass estimate. They sum to one. */
export const BONE_MASS: BoneMap<number> = {
  root: 0,
  pelvis: 0.148,
  spine_lower: 0.1,
  spine_mid: 0.1,
  spine_upper: 0.14,
  neck: 0.01,
  head: 0.07,
  clavicle_l: 0.005,
  upper_arm_l: 0.027,
  forearm_l: 0.016,
  hand_l: 0.007,
  clavicle_r: 0.005,
  upper_arm_r: 0.027,
  forearm_r: 0.016,
  hand_r: 0.007,
  thigh_l: 0.1,
  shin_l: 0.0465,
  foot_l: 0.0145,
  toe_l: 0,
  thigh_r: 0.1,
  shin_r: 0.0465,
  foot_r: 0.0145,
  toe_r: 0,
};
