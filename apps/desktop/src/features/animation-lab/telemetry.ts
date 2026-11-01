import type { AnimationStateId } from "@/engine/animation/types";
import type { FootMode } from "@/engine/animation/GaitController";
import type { StateTransition } from "@/engine/animation/AnimationStateMachine";
import type { JumpPhase } from "@/engine/animation/JumpSequence";
import type { PlaybackState } from "@/engine/animation/AnimationTimeline";

export interface FootTelemetry {
  mode: FootMode;
  /** True when the foot is on the ground and locked. */
  contact: boolean;
  /** Progress through the current stance or swing, 0..1. */
  progress: number;
}

/** A snapshot of the simulation for the debug panels. Read about ten times a second. */
export interface Telemetry {
  state: AnimationStateId;
  previousState: AnimationStateId;
  timeInState: number;
  transitions: readonly StateTransition[];
  fps: number;
  steps: number;
  simulationTime: number;
  speed: number;
  desiredSpeed: number;
  heading: number;
  yaw: number;
  grounded: boolean;
  verticalVelocity: number;
  jumpPhase: JumpPhase;
  gaitMode: "idle" | "moving";
  gaitPhase: number;
  strideLength: number;
  cadence: number;
  duty: number;
  lean: number;
  pelvisHeight: number;
  feet: { l: FootTelemetry; r: FootTelemetry };
  position: { x: number; y: number; z: number };
  limitCorrections: number;
  timeline: {
    active: boolean;
    state: PlaybackState;
    time: number;
    duration: number;
    loop: boolean;
    speed: number;
  };
}
