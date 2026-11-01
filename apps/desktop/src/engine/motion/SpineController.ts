import { Quaternion } from "three";
import type { Pose } from "../character/Pose";
import { JOINT_LIMITS } from "../character/JointLimits";
import type { BoneName } from "../character/types";
import { DEG, clamp, quatFromEuler } from "../core/math";

export interface SpineInput {
  /** Total sagittal bend in radians. Positive bends forward, negative bends backward. */
  flexion: number;
  /** Side bend in radians. Positive bends toward the character's left (+X). */
  lateral: number;
  /** Twist of the upper spine in radians. Positive turns toward the left. */
  twist: number;
  /** How strongly the head stays level against spine and pelvis pitch (0..1). */
  headStabilization: number;
  /** Pelvis forward pitch (radians) that the legs must accommodate. Added to the pelvis. */
  pelvisPitch: number;
}

export interface SpineResult {
  /** Extra pelvis pitch used to compensate the bend (radians, positive tips forward). */
  pelvisPitch: number;
  /** Horizontal pelvis shift along the facing axis that keeps the center of mass over the feet (meters). */
  pelvisShift: number;
  /** Extra pelvis lowering as the knees absorb a deep bend (meters). */
  pelvisDrop: number;
  /** Sum of pitch applied through the spine, for diagnostics (radians). */
  spinePitch: number;
}

export function createSpineResult(): SpineResult {
  return { pelvisPitch: 0, pelvisShift: 0, pelvisDrop: 0, spinePitch: 0 };
}

const SPINE_BONES = ["spine_lower", "spine_mid", "spine_upper"] as const satisfies readonly BoneName[];

/** Share of the bend each spine joint takes. Extension is lumbar-heavy; flexion spreads upward. */
const FLEXION_SHARE = [0.4, 0.35, 0.25] as const;
const EXTENSION_SHARE = [0.45, 0.35, 0.2] as const;
const LATERAL_SHARE = [0.3, 0.4, 0.3] as const;

const scratch = new Quaternion();

function limitRadians(bone: BoneName, axis: "x" | "y" | "z", sign: 1 | -1): number {
  const range = JOINT_LIMITS[bone][axis];
  return (sign > 0 ? range.max : -range.min) * DEG;
}

/**
 * Distributes a requested bend across the lumbar, mid and upper spine, then lets the pelvis and head react.
 * The bend scales down uniformly if any joint would exceed its limit, so the curve keeps its shape.
 */
export class SpineController {
  readonly result: SpineResult = createSpineResult();

  /** Writes spine, neck and head rotations into `pose`. */
  apply(pose: Pose, input: SpineInput): SpineResult {
    const forward = input.flexion >= 0;
    const shares = forward ? FLEXION_SHARE : EXTENSION_SHARE;
    const sign = forward ? 1 : -1;
    const requested = Math.abs(input.flexion);

    let scale = 1;
    for (let i = 0; i < SPINE_BONES.length; i++) {
      const bone = SPINE_BONES[i];
      const share = shares[i];
      if (!bone || share === undefined) continue;
      const limit = limitRadians(bone, "x", sign);
      if (requested * share > limit) scale = Math.min(scale, limit / (requested * share));
    }
    const total = requested * scale;

    let spinePitch = 0;
    SPINE_BONES.forEach((bone, i) => {
      const share = shares[i] ?? 0;
      const lateralShare = LATERAL_SHARE[i] ?? 0;
      const pitch = sign * total * share;
      spinePitch += pitch;
      const lateralLimit = limitRadians(bone, "z", input.lateral >= 0 ? -1 : 1);
      const side = clamp(-input.lateral * lateralShare, -Math.abs(lateralLimit), Math.abs(lateralLimit));
      const twistShare = bone === "spine_lower" ? 0.2 : bone === "spine_mid" ? 0.4 : 0.4;
      quatFromEuler(pose.rotations[bone], pitch, input.twist * twistShare, side);
    });

    // Pelvis reacts: a forward bend hinges at the hips and sends them back; extension tips the pelvis
    // forward and pushes the hips ahead so the center of mass stays over the feet.
    const sinePitch = Math.sin(spinePitch);
    const result = this.result;
    result.spinePitch = spinePitch;
    result.pelvisPitch = spinePitch >= 0 ? 0.3 * spinePitch : 0.22 * spinePitch * -1;
    result.pelvisShift = spinePitch >= 0 ? -0.2 * sinePitch : -0.16 * sinePitch;
    result.pelvisDrop = 0.05 * Math.abs(sinePitch);

    // Head stays level: neck and head cancel most of the pitch carried by the pelvis and spine.
    const carried = spinePitch + input.pelvisPitch + result.pelvisPitch;
    const stabilize = clamp(input.headStabilization, 0, 1);
    // `limitRadians(..., -1)` is the size of the allowed backward range, so the lower bound is its negative.
    const neckPitch = clamp(-carried * stabilize * 0.4, -limitRadians("neck", "x", -1), limitRadians("neck", "x", 1));
    const headPitch = clamp(-carried * stabilize * 0.6, -limitRadians("head", "x", -1), limitRadians("head", "x", 1));
    quatFromEuler(pose.rotations.neck, neckPitch, 0, 0);
    quatFromEuler(pose.rotations.head, headPitch, 0, 0);
    scratch.identity();
    return result;
  }
}
