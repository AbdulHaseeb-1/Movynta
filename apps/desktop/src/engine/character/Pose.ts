import { Quaternion, Vector3 } from "three";
import { clampToLimits, LIMITED_BONES, type ClampDetail } from "./JointLimits";
import { BONE_NAMES, createBoneMap, type BoneMap, type BoneName, type PoseData } from "./types";

/**
 * Local joint rotations plus the pelvis translation (relative to the root). Everything else in the
 * skeleton keeps its rest translation, so a pose is fully described by these values.
 */
export class Pose implements PoseData {
  readonly rotations: BoneMap<Quaternion> = createBoneMap(() => new Quaternion());
  readonly pelvisPosition = new Vector3();

  constructor(restPelvisPosition?: Vector3) {
    if (restPelvisPosition) this.pelvisPosition.copy(restPelvisPosition);
  }

  clone(): Pose {
    return new Pose().copy(this);
  }

  copy(other: PoseData): this {
    for (const name of BONE_NAMES) this.rotations[name].copy(other.rotations[name]);
    this.pelvisPosition.copy(other.pelvisPosition);
    return this;
  }

  /** Resets every rotation to the rest orientation. The pelvis position is left unchanged. */
  resetRotations(): this {
    for (const name of BONE_NAMES) this.rotations[name].identity();
    return this;
  }

  /** Clamps every joint to its anatomical range. Returns how many joints changed. */
  enforceLimits(clamped?: BoneName[], details?: Partial<Record<BoneName, ClampDetail>>): number {
    let changed = 0;
    for (const name of LIMITED_BONES) {
      const detail: ClampDetail | undefined = details ? { x: 0, y: 0, z: 0 } : undefined;
      if (!clampToLimits(name, this.rotations[name], detail)) continue;
      changed += 1;
      clamped?.push(name);
      if (details && detail) details[name] = detail;
    }
    return changed;
  }

  isFinite(): boolean {
    for (const name of BONE_NAMES) {
      const q = this.rotations[name];
      if (!Number.isFinite(q.x + q.y + q.z + q.w)) return false;
    }
    return Number.isFinite(this.pelvisPosition.x + this.pelvisPosition.y + this.pelvisPosition.z);
  }
}

/** Per-bone weight in [0, 1] for layered blending. Missing bones count as zero. */
export type BoneMask = Partial<Record<BoneName, number>>;

/** Bones driven by the upper-body layer (spine upwards, plus both arms). */
export const UPPER_BODY_MASK: BoneMask = {
  spine_lower: 1,
  spine_mid: 1,
  spine_upper: 1,
  neck: 1,
  head: 1,
  clavicle_l: 1,
  upper_arm_l: 1,
  forearm_l: 1,
  hand_l: 1,
  clavicle_r: 1,
  upper_arm_r: 1,
  forearm_r: 1,
  hand_r: 1,
};

/**
 * `out = slerp(a, b, weight)` per bone, optionally scaled per bone by `mask`.
 * Quaternions are interpolated on the shortest arc, so there are no Euler wraparound jumps.
 * `out` may alias `a`.
 */
export function blendPoses(out: Pose, a: PoseData, b: PoseData, weight: number, mask?: BoneMask): Pose {
  for (const name of BONE_NAMES) {
    const w = weight * (mask ? (mask[name] ?? 0) : 1);
    if (w <= 0) out.rotations[name].copy(a.rotations[name]);
    else if (w >= 1) out.rotations[name].copy(b.rotations[name]);
    else out.rotations[name].copy(a.rotations[name]).slerp(b.rotations[name], w);
  }
  const pw = mask ? Math.max(mask["pelvis"] ?? 0, 0) * weight : weight;
  out.pelvisPosition.copy(a.pelvisPosition).lerp(b.pelvisPosition, mask ? pw : weight);
  return out;
}
