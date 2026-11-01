import { Quaternion } from "three";
import { Pose, blendPoses, type BoneMask } from "../character/Pose";
import { BONE_NAMES, type BoneName } from "../character/types";
import { smoothstep } from "../core/math";
import { ANIMATION_STATES, type AnimationStateId } from "./types";

/** Shape changes a state adds on top of the speed-driven gait. They are blended, never switched. */
export interface StateStyle {
  /** Added forward lean (radians). */
  leanAdd: number;
  /** Multiplier on arm swing. */
  armSwing: number;
  /** Multiplier on vertical pelvis bounce. */
  bounce: number;
  /** Added elbow flexion (radians). */
  elbowAdd: number;
  /** Head pitch offset (radians, positive looks down). */
  headDown: number;
  /** Added pelvis lowering (meters). */
  pelvisDrop: number;
  /** Arms held out for balance (0..1). */
  armsOut: number;
  /** Extra lean into turns. */
  turnLean: number;
}

const style = (s: Partial<StateStyle>): StateStyle => ({
  leanAdd: 0, armSwing: 1, bounce: 1, elbowAdd: 0, headDown: 0, pelvisDrop: 0, armsOut: 0, turnLean: 1, ...s,
});

export const STATE_STYLES: Readonly<Record<AnimationStateId, StateStyle>> = {
  idle: style({}),
  accelerate: style({ leanAdd: 0.1, armSwing: 1.1, bounce: 1.05, elbowAdd: 0.1 }),
  walk: style({}),
  run: style({}),
  fast_run: style({ leanAdd: 0.02, armSwing: 1.05 }),
  sprint: style({ leanAdd: 0.03, armSwing: 1.12, elbowAdd: 0.05, headDown: -0.05 }),
  decelerate: style({ leanAdd: -0.14, armSwing: 0.85, bounce: 0.9, armsOut: 0.2, pelvisDrop: 0.015 }),
  stop: style({ leanAdd: -0.1, armSwing: 0.55, bounce: 0.7, armsOut: 0.12, pelvisDrop: 0.012 }),
  turn: style({ armSwing: 0.8, armsOut: 0.08, turnLean: 1.35 }),
  jump: style({ armSwing: 0.2, armsOut: 0.05 }),
  fall: style({ armSwing: 0.1, armsOut: 0.6, leanAdd: -0.03 }),
  land: style({ armSwing: 0.2, armsOut: 0.25, leanAdd: 0.08 }),
};

const STYLE_KEYS: readonly (keyof StateStyle)[] = [
  "leanAdd", "armSwing", "bounce", "elbowAdd", "headDown", "pelvisDrop", "armsOut", "turnLean",
];

function emptyWeights(): Record<AnimationStateId, number> {
  return {
    idle: 1, accelerate: 0, walk: 0, run: 0, fast_run: 0, sprint: 0, decelerate: 0, stop: 0, turn: 0, jump: 0, fall: 0, land: 0,
  };
}

/** Bones that follow IK instead of being blended as FK. */
const IK_DRIVEN: ReadonlySet<BoneName> = new Set<BoneName>(["thigh_l", "shin_l", "foot_l", "toe_l", "thigh_r", "shin_r", "foot_r", "toe_r"]);

/**
 * Blends animation states and layers.
 * - State weights crossfade over `blendDuration` and can be interrupted at any moment: the new target
 *   takes weight from everything else in proportion, so there is never a jump.
 * - Pose crossfades use quaternion slerp from a snapshot of the last pose, for discontinuous changes.
 */
export class AnimationBlender {
  readonly weights = emptyWeights();
  readonly style: StateStyle = { ...STATE_STYLES.idle };
  target: AnimationStateId = "idle";
  blendDuration = 0.25;
  private readonly snapshot = new Pose();
  private readonly scratchTarget = new Quaternion();
  private crossfadeTime = 0;
  private crossfadeDuration = 0;

  /** Returns to the initial idle weights and clears any pose crossfade. */
  reset(): void {
    Object.assign(this.weights, emptyWeights());
    Object.assign(this.style, STATE_STYLES.idle);
    this.target = "idle";
    this.crossfadeTime = this.crossfadeDuration;
  }

  setTarget(state: AnimationStateId): void {
    this.target = state;
  }

  update(dt: number): void {
    const step = this.blendDuration <= 1e-4 ? 1 : dt / this.blendDuration;
    const before = this.weights[this.target];
    const after = Math.min(1, before + step);
    this.weights[this.target] = after;
    const others = 1 - before;
    const scale = others > 1e-9 ? (1 - after) / others : 0;
    for (const id of ANIMATION_STATES) if (id !== this.target) this.weights[id] *= scale;

    for (const key of STYLE_KEYS) {
      let value = 0;
      for (const id of ANIMATION_STATES) value += this.weights[id] * STATE_STYLES[id][key];
      this.style[key] = value;
    }
  }

  /** Total weight of the in-air states, used to blend airborne body shape. */
  get airborneWeight(): number {
    return this.weights.jump + this.weights.fall;
  }

  /** Remembers the pose to fade away from. Call right before a discontinuous change. */
  beginCrossfade(from: Pose, duration: number): void {
    this.snapshot.copy(from);
    this.crossfadeTime = 0;
    this.crossfadeDuration = Math.max(duration, 1e-3);
  }

  get crossfading(): boolean {
    return this.crossfadeTime < this.crossfadeDuration;
  }

  /** Slerps every FK bone from the snapshot toward `pose` (in place). Legs are left to IK. */
  applyCrossfade(dt: number, pose: Pose): void {
    if (!this.crossfading) return;
    this.crossfadeTime += dt;
    const weight = smoothstep(this.crossfadeTime / this.crossfadeDuration);
    for (const name of BONE_NAMES) {
      if (IK_DRIVEN.has(name)) continue;
      // Read the target before the output (which is the same quaternion) is overwritten with the snapshot.
      this.scratchTarget.copy(pose.rotations[name]);
      pose.rotations[name].copy(this.snapshot.rotations[name]).slerp(this.scratchTarget, weight);
    }
  }

  /** Layers `layer` over `base` for the masked bones with `weight`, writing into `base`. */
  static applyLayer(base: Pose, layer: Pose, mask: BoneMask, weight: number): void {
    const scratch = new Pose();
    blendPoses(scratch, base, layer, weight, mask);
    base.copy(scratch);
  }
}
