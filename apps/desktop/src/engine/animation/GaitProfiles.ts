import { lerp } from "../core/math";

/** Everything about the shape of a gait that depends on speed. Angles are radians, lengths meters. */
export interface GaitProfile {
  /** Distance between consecutive footfalls (one step). A stride is two steps. */
  stepLength: number;
  /** Fraction of the cycle each foot spends on the ground. Below 0.5 there is a flight phase. */
  duty: number;
  /** Peak ankle height of the swing foot above the ground. */
  swingHeight: number;
  /** Mean lowering of the pelvis from fully straight legs. */
  pelvisDrop: number;
  /** Half of the peak-to-peak vertical pelvis motion. */
  bounce: number;
  /** Lateral pelvis shift toward the support foot. */
  sway: number;
  /** Shoulder swing amplitude. */
  armSwing: number;
  /** Elbow flexion held while moving. */
  elbowBase: number;
  /** Extra elbow flexion as the arm swings forward. */
  elbowSwing: number;
  /** Torso forward lean at steady speed. */
  lean: number;
  /** Half the lateral distance between footfalls. */
  footWidth: number;
  /** Dorsiflexion of the foot at touchdown (0 for a forefoot strike). */
  heelStrike: number;
  /** Plantar flexion of the foot at push-off. */
  toeOff: number;
  /** Stance progress at which the heel starts to rise. */
  heelRise: number;
  /** Pelvis rotation amplitude about the vertical axis. */
  pelvisYaw: number;
  /** Chest counter-rotation amplitude. */
  chestYaw: number;
}

interface Anchor {
  readonly speed: number;
  readonly profile: GaitProfile;
}

const p = (
  stepLength: number,
  duty: number,
  swingHeight: number,
  pelvisDrop: number,
  bounce: number,
  sway: number,
  armSwing: number,
  elbowBase: number,
  elbowSwing: number,
  lean: number,
  footWidth: number,
  heelStrike: number,
  toeOff: number,
  heelRise: number,
  pelvisYaw: number,
  chestYaw: number,
): GaitProfile => ({
  stepLength, duty, swingHeight, pelvisDrop, bounce, sway, armSwing, elbowBase, elbowSwing, lean,
  footWidth, heelStrike, toeOff, heelRise, pelvisYaw, chestYaw,
});

const D = Math.PI / 180;

/**
 * Anchor profiles from slow shuffle to sprint. Walking has double support (duty above 0.5);
 * running has flight (duty below 0.5). Values between anchors are interpolated linearly in speed.
 */
const ANCHORS: readonly Anchor[] = [
  { speed: 0.0, profile: p(0.20, 0.76, 0.04, 0.0, 0.004, 0.025, 0.05, 0.15, 0.0, 0.0, 0.10, 12 * D, 8 * D, 0.7, 0.03, 0.03) },
  { speed: 0.6, profile: p(0.40, 0.70, 0.06, 0.004, 0.010, 0.030, 0.20, 0.20, 0.05, 0.02, 0.10, 16 * D, 22 * D, 0.62, 0.06, 0.07) },
  { speed: 1.4, profile: p(0.70, 0.62, 0.09, 0.010, 0.018, 0.024, 0.38, 0.28, 0.12, 0.04, 0.09, 18 * D, 35 * D, 0.58, 0.09, 0.11) },
  { speed: 2.2, profile: p(0.88, 0.56, 0.12, 0.020, 0.024, 0.016, 0.58, 0.70, 0.25, 0.07, 0.085, 14 * D, 36 * D, 0.62, 0.11, 0.15) },
  { speed: 3.0, profile: p(1.05, 0.44, 0.22, 0.028, 0.026, 0.012, 0.76, 1.30, 0.30, 0.11, 0.075, 8 * D, 32 * D, 0.62, 0.13, 0.19) },
  { speed: 3.5, profile: p(1.18, 0.38, 0.25, 0.035, 0.030, 0.010, 0.86, 1.40, 0.30, 0.15, 0.07, 5 * D, 30 * D, 0.55, 0.14, 0.22) },
  { speed: 5.5, profile: p(1.65, 0.32, 0.33, 0.04, 0.028, 0.008, 1.00, 1.50, 0.28, 0.27, 0.06, 2 * D, 36 * D, 0.42, 0.17, 0.27) },
  { speed: 8.0, profile: p(2.15, 0.26, 0.37, 0.048, 0.030, 0.005, 1.15, 1.62, 0.25, 0.40, 0.05, 0, 42 * D, 0.32, 0.20, 0.32) },
  { speed: 10.0, profile: p(2.50, 0.24, 0.39, 0.052, 0.032, 0.004, 1.20, 1.65, 0.24, 0.42, 0.045, 0, 44 * D, 0.3, 0.22, 0.34) },
];

const KEYS: readonly (keyof GaitProfile)[] = [
  "stepLength", "duty", "swingHeight", "pelvisDrop", "bounce", "sway", "armSwing", "elbowBase", "elbowSwing",
  "lean", "footWidth", "heelStrike", "toeOff", "heelRise", "pelvisYaw", "chestYaw",
];

export function createGaitProfile(): GaitProfile {
  const first = ANCHORS[0];
  if (!first) throw new Error("Gait anchors are empty");
  return { ...first.profile };
}

/** Interpolates the anchor profiles for `speed` (m/s) into `out`. Speeds outside the table are clamped. */
export function profileForSpeed(speed: number, out: GaitProfile): GaitProfile {
  const first = ANCHORS[0];
  const last = ANCHORS[ANCHORS.length - 1];
  if (!first || !last) throw new Error("Gait anchors are empty");
  if (speed <= first.speed) return Object.assign(out, first.profile);
  if (speed >= last.speed) return Object.assign(out, last.profile);
  for (let i = 1; i < ANCHORS.length; i++) {
    const hi = ANCHORS[i];
    const lo = ANCHORS[i - 1];
    if (!hi || !lo || speed > hi.speed) continue;
    const t = (speed - lo.speed) / (hi.speed - lo.speed);
    for (const key of KEYS) out[key] = lerp(lo.profile[key], hi.profile[key], t);
    return out;
  }
  return Object.assign(out, last.profile);
}

/** 0 for a walking gait, 1 for a running gait, from the duty factor. */
export function runness(duty: number): number {
  const t = (0.56 - duty) / 0.12;
  return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
}
