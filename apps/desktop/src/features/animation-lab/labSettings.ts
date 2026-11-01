import { DEFAULT_TUNING, type AnimationTuning } from "@/engine/animation/types";
import type { TerrainPreset } from "@/engine/physics/Terrain";

export type CameraProjection = "perspective" | "orthographic";
export type CameraView = "free" | "front" | "side" | "rear" | "three-quarter";

/** Which debug visuals are drawn. */
export interface DebugToggles {
  skeleton: boolean;
  ikTargets: boolean;
  trajectory: boolean;
  collider: boolean;
  centerOfMass: boolean;
  contacts: boolean;
}

export const LOCOMOTION_PRESETS = ["idle", "walk", "run", "fast_run", "sprint", "stop"] as const;
export type LocomotionPreset = (typeof LOCOMOTION_PRESETS)[number];

/** Speed (m/s) each locomotion button asks for. Stop and Idle ask for none. */
export const PRESET_SPEEDS: Readonly<Record<LocomotionPreset, number>> = {
  idle: 0,
  walk: 1.4,
  run: 3.5,
  fast_run: 5.5,
  sprint: 8,
  stop: 0,
};

export const MAX_COMMAND_SPEED = 10;
export const BEND_FORWARD_DEGREES = 55;
export const BEND_BACKWARD_DEGREES = -45;
export const TURN_STEP_RADIANS = Math.PI / 2;

/** Everything the lab's controls edit. Serializable; the simulation is driven from it by `LabController`. */
export interface LabSettings {
  tuning: AnimationTuning;
  /** Commanded movement speed in m/s. */
  speed: number;
  activePreset: LocomotionPreset;
  /** Treadmill mode: the root stays put and the ground moves. */
  inPlace: boolean;
  /** Hold the facing fixed so the body can strafe and backpedal. */
  lockedFacing: boolean;
  /** Direction of travel relative to the facing when the facing is locked, in degrees. */
  strafeDirection: number;
  terrain: TerrainPreset;
  projection: CameraProjection;
  view: CameraView;
  followCamera: boolean;
  paused: boolean;
  debug: DebugToggles;
}

export const DEFAULT_SETTINGS: LabSettings = {
  tuning: { ...DEFAULT_TUNING },
  speed: 0,
  activePreset: "idle",
  inPlace: false,
  lockedFacing: false,
  strafeDirection: 0,
  terrain: "course",
  projection: "perspective",
  view: "three-quarter",
  followCamera: true,
  paused: false,
  debug: { skeleton: false, ikTargets: false, trajectory: false, collider: false, centerOfMass: false, contacts: false },
};
