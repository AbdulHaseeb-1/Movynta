import { Quaternion, Vector3 } from "three";
import { z } from "zod";
import { Pose, type BoneMask } from "../character/Pose";
import { BONE_NAMES, type BoneName } from "../character/types";
import { DEG, clamp, eulerFromQuat, quatFromEuler } from "../core/math";

/**
 * Keyframe format (version 1). A clip is plain JSON-serialisable data:
 *
 *   {
 *     "version": 1,
 *     "name": "wave",
 *     "duration": 2,                         // seconds
 *     "loop": true,
 *     "tracks": {                            // only keyed bones appear
 *       "upper_arm_l": [
 *         { "time": 0,   "rotation": [x, y, z, w] },   // local unit quaternion, same convention as the rig
 *         { "time": 1.0, "rotation": [x, y, z, w] }
 *       ]
 *     }
 *   }
 *
 * Rotations are local joint rotations relative to the bone's parent (identity is the rest pose).
 * Between keys the timeline slerps along the shortest arc. A bone without a track is not touched.
 */
export interface Keyframe {
  readonly time: number;
  readonly rotation: readonly [number, number, number, number];
}

export interface AnimationClip {
  readonly version: 1;
  name: string;
  duration: number;
  loop: boolean;
  tracks: Partial<Record<BoneName, Keyframe[]>>;
}

export function createClip(name = "Untitled", duration = 2): AnimationClip {
  return { version: 1, name, duration, loop: true, tracks: {} };
}

const keyframeSchema = z.object({
  time: z.number().min(0),
  rotation: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
});

const clipSchema = z.object({
  version: z.literal(1),
  name: z.string().max(80),
  duration: z.number().positive().max(600),
  loop: z.boolean(),
  tracks: z.partialRecord(z.enum(BONE_NAMES), z.array(keyframeSchema)),
});

/**
 * Validates untrusted clip data (an imported file, pasted JSON). Returns the clip with its keys sorted and clamped
 * to the clip duration, or `null` if the data does not match the documented format.
 */
export function parseClip(data: unknown): AnimationClip | null {
  const parsed = clipSchema.safeParse(data);
  if (!parsed.success) return null;
  const clip = createClip(parsed.data.name, parsed.data.duration);
  clip.loop = parsed.data.loop;
  for (const name of BONE_NAMES) {
    const keys = parsed.data.tracks[name];
    if (!keys || keys.length === 0) continue;
    clip.tracks[name] = keys
      .map((key) => ({ time: Math.min(key.time, parsed.data.duration), rotation: key.rotation }))
      .sort((p, q) => p.time - q.time);
  }
  return clip;
}

const a = new Quaternion();
const b = new Quaternion();
const euler = new Vector3();

function setQuat(q: Quaternion, rotation: Keyframe["rotation"]): void {
  q.set(rotation[0], rotation[1], rotation[2], rotation[3]).normalize();
}

export type PlaybackState = "stopped" | "playing" | "paused";

/** Plays and edits a keyframe clip. It produces a partial pose; blending it into the character is up to the caller. */
export class AnimationTimeline {
  clip: AnimationClip;
  state: PlaybackState = "stopped";
  time = 0;
  /** Playback rate multiplier. */
  speed = 1;
  loop = true;
  readonly pose = new Pose();

  constructor(clip: AnimationClip = createClip()) {
    this.clip = clip;
    this.loop = clip.loop;
  }

  get duration(): number {
    return this.clip.duration;
  }

  setClip(clip: AnimationClip): void {
    this.clip = clip;
    this.loop = clip.loop;
    this.time = 0;
    this.state = "stopped";
  }

  play(): void {
    if (this.state === "stopped" && this.time >= this.clip.duration) this.time = 0;
    this.state = "playing";
  }

  pause(): void {
    if (this.state === "playing") this.state = "paused";
  }

  resume(): void {
    if (this.state === "paused") this.state = "playing";
  }

  stop(): void {
    this.state = "stopped";
    this.time = 0;
  }

  scrub(time: number): void {
    this.time = clamp(time, 0, this.clip.duration);
  }

  update(dt: number): void {
    if (this.state !== "playing") return;
    this.time += dt * this.speed;
    const length = this.clip.duration;
    if (this.time >= length) {
      if (this.loop) this.time %= length;
      else {
        this.time = length;
        this.state = "paused";
      }
    } else if (this.time < 0) {
      this.time = this.loop ? length + (this.time % length) : 0;
    }
  }

  /** Bones that have at least one key, with weight 1. */
  mask(): BoneMask {
    const mask: BoneMask = {};
    for (const name of BONE_NAMES) if ((this.clip.tracks[name]?.length ?? 0) > 0) mask[name] = 1;
    return mask;
  }

  /** Evaluates every track at the current time into `pose` (untracked bones are left alone). */
  evaluate(time: number = this.time, pose: Pose = this.pose): Pose {
    for (const name of BONE_NAMES) {
      const keys = this.clip.tracks[name];
      if (!keys || keys.length === 0) continue;
      this.sampleTrack(keys, time, pose.rotations[name]);
    }
    return pose;
  }

  private sampleTrack(keys: readonly Keyframe[], time: number, out: Quaternion): void {
    const first = keys[0];
    const last = keys[keys.length - 1];
    if (!first || !last) return;
    if (time <= first.time) return setQuat(out, first.rotation);
    if (time >= last.time) return setQuat(out, last.rotation);
    for (let i = 1; i < keys.length; i++) {
      const next = keys[i];
      const prev = keys[i - 1];
      if (!next || !prev || time > next.time) continue;
      setQuat(a, prev.rotation);
      setQuat(b, next.rotation);
      const span = next.time - prev.time;
      return void out.copy(a).slerp(b, span <= 1e-9 ? 1 : (time - prev.time) / span);
    }
    setQuat(out, last.rotation);
  }

  /** Reads the keyed bone's Euler angles (degrees) at `time`, for the editor's joint controls. */
  getEulerDegrees(bone: BoneName, time: number = this.time): { x: number; y: number; z: number } {
    const keys = this.clip.tracks[bone];
    if (!keys || keys.length === 0) return { x: 0, y: 0, z: 0 };
    this.sampleTrack(keys, time, a);
    eulerFromQuat(a, euler);
    return { x: euler.x / DEG, y: euler.y / DEG, z: euler.z / DEG };
  }

  /** Inserts or replaces the key at `time` for `bone`. Keys stay sorted. */
  setKey(bone: BoneName, time: number, rotation: Quaternion): void {
    const t = clamp(time, 0, this.clip.duration);
    const keys = this.clip.tracks[bone] ?? [];
    const key: Keyframe = { time: t, rotation: [rotation.x, rotation.y, rotation.z, rotation.w] };
    const existing = keys.findIndex((k) => Math.abs(k.time - t) < 1e-3);
    if (existing >= 0) keys[existing] = key;
    else keys.push(key);
    keys.sort((p, q) => p.time - q.time);
    this.clip.tracks[bone] = keys;
  }

  /** Same as `setKey`, from Euler angles in degrees (XYZ order, like the joint limits). */
  setKeyEuler(bone: BoneName, time: number, xDeg: number, yDeg: number, zDeg: number): void {
    this.setKey(bone, time, quatFromEuler(new Quaternion(), xDeg * DEG, yDeg * DEG, zDeg * DEG));
  }

  removeKey(bone: BoneName, time: number): boolean {
    const keys = this.clip.tracks[bone];
    if (!keys) return false;
    const index = keys.findIndex((k) => Math.abs(k.time - time) < 1e-3);
    if (index < 0) return false;
    keys.splice(index, 1);
    if (keys.length === 0) delete this.clip.tracks[bone];
    return true;
  }

  keyTimes(bone: BoneName): number[] {
    return (this.clip.tracks[bone] ?? []).map((k) => k.time);
  }

  toJSON(): AnimationClip {
    return { ...this.clip, loop: this.loop };
  }
}
