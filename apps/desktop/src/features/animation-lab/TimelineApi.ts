import { Vector3 } from "three";
import type { CharacterSimulation } from "@/engine/CharacterSimulation";
import { parseClip } from "@/engine/animation/AnimationTimeline";
import { createWaveClip } from "@/engine/animation/clips";
import type { BoneName } from "@/engine/character/types";
import { DEG, eulerFromQuat } from "@/engine/core/math";

export interface JointAngles {
  x: number;
  y: number;
  z: number;
}

const scratch = new Vector3();

/**
 * The timeline's commands as plain methods, so the UI never reaches into engine objects. Every method is
 * synchronous and cheap; the panel re-reads telemetry afterwards.
 */
export class TimelineApi {
  private readonly sim: CharacterSimulation;

  constructor(sim: CharacterSimulation) {
    this.sim = sim;
  }

  play(): void {
    this.sim.timelineActive = true;
    this.sim.timeline.play();
  }

  /** Loads the built-in "hand on hip, waving" clip and plays it over the current motion. */
  playWave(): void {
    this.sim.timeline.setClip(createWaveClip());
    this.sim.timelineActive = true;
    this.sim.timeline.play();
  }

  pause(): void {
    this.sim.timeline.pause();
  }

  resume(): void {
    this.sim.timeline.resume();
  }

  stop(): void {
    this.sim.timeline.stop();
  }

  toggleLoop(): void {
    this.sim.timeline.loop = !this.sim.timeline.loop;
  }

  setSpeed(speed: number): void {
    this.sim.timeline.speed = speed;
  }

  scrub(time: number): void {
    this.sim.timeline.scrub(time);
  }

  setLayerActive(active: boolean): void {
    this.sim.timelineActive = active;
  }

  /** The playhead, read live from the engine (telemetry is sampled slower than a user can press keys). */
  get time(): number {
    return this.sim.timeline.time;
  }

  keyTimes(bone: BoneName): number[] {
    return this.sim.timeline.keyTimes(bone);
  }

  /** Angles of a joint at the playhead: its keyed value if it has keys, otherwise the live pose. */
  angles(bone: BoneName): JointAngles {
    const timeline = this.sim.timeline;
    if (timeline.keyTimes(bone).length > 0) return timeline.getEulerDegrees(bone);
    eulerFromQuat(this.sim.pose.rotations[bone], scratch);
    return { x: scratch.x / DEG, y: scratch.y / DEG, z: scratch.z / DEG };
  }

  /** Writes a key for the joint at the playhead and turns the keyframe layer on. */
  setAngles(bone: BoneName, angles: JointAngles): void {
    this.sim.timeline.setKeyEuler(bone, this.sim.timeline.time, angles.x, angles.y, angles.z);
    this.sim.timelineActive = true;
  }

  removeKey(bone: BoneName): void {
    this.sim.timeline.removeKey(bone, this.sim.timeline.time);
  }

  exportJson(): string {
    return JSON.stringify(this.sim.timeline.toJSON(), null, 2);
  }

  /** Loads a clip from JSON text. Returns false if it is not valid. */
  importJson(text: string): boolean {
    try {
      const clip = parseClip(JSON.parse(text));
      if (!clip) return false;
      this.sim.timeline.setClip(clip);
      return true;
    } catch {
      return false;
    }
  }
}
