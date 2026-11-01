import { Quaternion } from "three";
import { createClip, type AnimationClip } from "./AnimationTimeline";
import type { BoneName } from "../character/types";
import { DEG, quatFromEuler } from "../core/math";

type Euler = readonly [x: number, y: number, z: number];

const q = new Quaternion();

function key(clip: AnimationClip, bone: BoneName, time: number, [x, y, z]: Euler): void {
  quatFromEuler(q, x * DEG, y * DEG, z * DEG);
  const keys = clip.tracks[bone] ?? [];
  keys.push({ time, rotation: [q.x, q.y, q.z, q.w] });
  clip.tracks[bone] = keys;
}

/**
 * The stick-figure stance from the reference drawing: one hand on the hip, the other arm raised with the forearm
 * bent upward beside the head, waving. Angles are the joint's Euler angles in degrees (see the rig's conventions).
 */
export function createWaveClip(): AnimationClip {
  const clip = createClip("Hand on hip, waving", 2);
  // Found by searching the joint-limit-respecting angles of the stick figure for: elbow out at shoulder height,
  // forearm and hand straight up beside the head; the other hand resting at the hip with the elbow out.
  const waveFlex = [-90, -66, -108, -66, -90] as const;
  waveFlex.forEach((flex, index) => {
    const time = index * 0.5;
    key(clip, "upper_arm_l", time, [-60, 0, 90]);
    key(clip, "forearm_l", time, [flex, -30, 0]);
    key(clip, "hand_l", time, [(flex + 90) * 0.5, 0, 0]);
  });
  for (const time of [0, 2]) {
    key(clip, "upper_arm_r", time, [60, 30, -50]);
    key(clip, "forearm_r", time, [-105, 30, 0]);
    key(clip, "head", time, [0, 8, 6]);
  }
  return clip;
}
