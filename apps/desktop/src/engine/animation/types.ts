export const ANIMATION_STATES = [
  "idle",
  "accelerate",
  "walk",
  "run",
  "fast_run",
  "sprint",
  "decelerate",
  "stop",
  "turn",
  "jump",
  "fall",
  "land",
] as const;

export type AnimationStateId = (typeof ANIMATION_STATES)[number];

/** Live-tunable parameters. Every field changes real behavior; none are cosmetic. */
export interface AnimationTuning {
  /** Multiplies the natural stride length for the current speed (cadence adjusts to keep world speed). */
  strideLength: number;
  /** Multiplies cadence; with a fixed speed it shortens each step by the same factor. */
  stepFrequency: number;
  /** Multiplies the speed- and acceleration-driven forward lean. */
  forwardLean: number;
  /** Manual spine bend in degrees. Positive bends forward, negative bends backward. */
  spineBend: number;
  /** Multiplies the arm swing amplitude. */
  armSwing: number;
  /** Multiplies swing-foot height and knee drive. */
  kneeLift: number;
  /** Multiplies vertical pelvis oscillation. */
  pelvisBounce: number;
  /** Maximum turn rate in degrees per second. */
  turningSpeed: number;
  /** Crossfade time between states, in seconds. */
  blendDuration: number;
  /** 0 lets stance feet follow the body (sliding); 1 locks them to the ground. */
  footIK: number;
  /** Multiplies spring-driven follow-through (head, arms, torso lag). */
  secondaryMotion: number;
}

export const DEFAULT_TUNING: AnimationTuning = {
  strideLength: 1,
  stepFrequency: 1,
  forwardLean: 1,
  spineBend: 0,
  armSwing: 1,
  kneeLift: 1,
  pelvisBounce: 1,
  turningSpeed: 280,
  blendDuration: 0.25,
  footIK: 1,
  secondaryMotion: 1,
};

/** Reference speeds (m/s) the labelled gaits are designed around. */
export const SPEED_WALK = 1.4;
export const SPEED_RUN = 3.5;
export const SPEED_FAST_RUN = 5.5;
export const SPEED_SPRINT = 8;
